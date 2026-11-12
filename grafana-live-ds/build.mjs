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
  // Provided by Grafana at runtime; never bundle them.
  external: ["react", "react-dom", "@grafana/data", "@grafana/runtime", "@grafana/ui"],
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  await esbuild.build(options);
}
