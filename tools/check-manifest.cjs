const { existsSync, readFileSync } = require("node:fs");

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertFilesExist(paths, label) {
  for (const path of paths) {
    assert(existsSync(path), `${label} references missing file: ${path}`);
  }
}

assert(manifest.manifest_version === 2, "manifest_version must remain 2 for the current runtime architecture");
assert(manifest.version === packageJson.version, "manifest.json and package.json versions must match");
assert(/^https:\/\//.test(manifest.homepage_url), "homepage_url must use HTTPS");
assert(new Set(manifest.permissions).size === manifest.permissions.length, "manifest permissions must not contain duplicates");

assertFilesExist(manifest.background.scripts, "background.scripts");
assertFilesExist(manifest.content_scripts.flatMap((entry) => entry.js || []), "content_scripts");
assertFilesExist(Object.values(manifest.icons), "icons");
assertFilesExist([
  manifest.browser_action.default_popup,
  manifest.options_ui.page
], "extension pages");
