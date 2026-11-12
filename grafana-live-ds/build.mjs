import esbuild from "esbuild";

const watch = process.argv.includes("--watch");

const options = {
  entryPoints: ["src/module.ts"],
  bundle: true,
  outfile: "dist/module.js",
  format: "esm",
  target: "es2022",
  sourcemap: true,
  logLevel: "info",
  // Resolved by Grafana at runtime via its SystemJS shared-dependency map
  // (public/app/features/plugins/loader/sharedDependencies.ts).
  // Do NOT bundle these: @grafana/data contains the byte strings "PanelCtrl"/
  // "ConfigCtrl", which Grafana 13's Angular detector would flag and reject.
  external: ["react", "react-dom", "rxjs", "@grafana/data", "@grafana/runtime", "@grafana/ui"],
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  await esbuild.build(options);
}
