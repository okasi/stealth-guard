const { execFileSync } = require("node:child_process");
const { readFileSync, readdirSync, statSync } = require("node:fs");
const { dirname, join, normalize } = require("node:path");
const { Script } = require("node:vm");

const roots = [
  "background.js",
  "content-scripts",
  "guide",
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

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const compileClassicScriptBundle = (bundleFiles, filename) => {
  const source = bundleFiles.map((file) => readFileSync(file, "utf8")).join("\n");
  new Script(source, { filename });
};

compileClassicScriptBundle(manifest.background.scripts, "background-bundle.js");
for (const [index, contentScript] of manifest.content_scripts.entries()) {
  compileClassicScriptBundle(contentScript.js || [], `content-script-bundle-${index}.js`);
}

const compileExtensionPageScripts = (htmlFile) => {
  const html = readFileSync(htmlFile, "utf8");
  const scriptFiles = [...html.matchAll(/<script\s+[^>]*src=["']([^"']+)["'][^>]*>/gi)]
    .map((match) => normalize(join(dirname(htmlFile), match[1])));
  compileClassicScriptBundle(scriptFiles, `${htmlFile}-scripts.js`);
};

compileExtensionPageScripts(manifest.browser_action.default_popup);
compileExtensionPageScripts(manifest.options_ui.page);
compileExtensionPageScripts("guide/guide.html");
