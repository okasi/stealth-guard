const { execFileSync } = require("node:child_process");
const { readdirSync, statSync } = require("node:fs");
const { join } = require("node:path");

const roots = [
  "background.js",
  "content-scripts",
  "lib",
  "options",
  "popup",
  "tools"
];

function collectJavaScriptFiles(path) {
  const stats = statSync(path);
  if (stats.isFile()) {
    return /\.(?:c|m)?js$/.test(path) ? [path] : [];
  }

  return readdirSync(path)
    .flatMap((entry) => collectJavaScriptFiles(join(path, entry)));
}

const files = roots.flatMap(collectJavaScriptFiles).sort();

for (const file of files) {
  execFileSync(process.execPath, ["--check", file], { stdio: "inherit" });
}
