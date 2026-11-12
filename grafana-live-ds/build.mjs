import { readFileSync, writeFileSync } from "node:fs";
import esbuild from "esbuild";

const watch = process.argv.includes("--watch");

// Grafana loads local (non-CDN, non-Angular) plugins with loadingStrategy=script,
// i.e. via a plain <script> tag, NOT as an ES module. Top-level `import` therefore
// throws "Cannot use import statement outside a module".
//
// The official scaffold ships AMD bundles (webpack library.type="amd"), which
// SystemJS loads natively and resolves externals through its shared-dependency
// import map. esbuild no longer emits AMD, so we build ESM and wrap it in an
// AMD define() below. SystemJS only supports the named-dependency AMD form:
//   define(["dep", ...], function (dep, ...) {...})
// (the require-style factory gives SystemJS Error#5 "AMD require not supported").
//
// @grafana/* (and react/rxjs) MUST stay external: bundling @grafana/data pulls in
// the byte strings "PanelCtrl"/"ConfigCtrl", which Grafana 13's Angular detector
// flags and the plugin is then refused.
const options = {
  entryPoints: ["src/module.ts"],
  bundle: true,
  outfile: "dist/module.esm.js",
  format: "esm",
  target: "es2022",
  sourcemap: true,
  logLevel: "info",
  external: ["react", "react-dom", "react/jsx-runtime", "rxjs", "@grafana/data", "@grafana/runtime", "@grafana/ui"],
};

// Convert the ESM bundle to a named-dependency AMD define() for SystemJS.
function toAmd(esmSource) {
  const packages = [];
  const paramOf = new Map();

  const collect = /import\s*(?:\{[^}]+\}|\w+)\s*from\s*"([^"]+)"/g;
  let match;
  while ((match = collect.exec(esmSource)) !== null) {
    if (!paramOf.has(match[1])) {
      paramOf.set(match[1], `__d${packages.length}`);
      packages.push(match[1]);
    }
  }

  let body = esmSource;

  // import { a, b } from "pkg";  ->  var { a, b } = __dN;
  body = body.replace(
    /import\s*\{([^}]+)\}\s*from\s*"([^"]+)";/g,
    (_m, names, pkg) => `var { ${names.trim()} } = ${paramOf.get(pkg)};`
  );
  // import x from "pkg";  ->  var x = __dN.default;
  body = body.replace(/import\s+(\w+)\s+from\s*"([^"]+)";/g, (_m, name, pkg) => `var ${name} = ${paramOf.get(pkg)}.default;`);

  // export { a, b };  ->  return { a, b };
  body = body.replace(/export\s*\{([^}]+)\};/g, (_m, names) => `return { ${names.trim()} };`);

  // Drop the source-map pointer; it would point at the intermediate ESM file.
  body = body.replace(/\/\/# sourceMappingURL=.*$/m, "");

  const params = packages.map((pkg) => paramOf.get(pkg)).join(", ");
  return `define(${JSON.stringify(packages)}, function (${params}) {\n${body}\n});\n`;
}

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  await esbuild.build(options);
  const amd = toAmd(readFileSync("dist/module.esm.js", "utf8"));
  writeFileSync("dist/module.js", amd);
}
