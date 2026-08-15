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

function assertSameArray(actual, expected, label) {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${label} must preserve its dependency order`,
  );
}

assert(
  manifest.manifest_version === 2,
  "manifest_version must remain 2 for the current runtime architecture",
);
assert(
  manifest.version === packageJson.version,
  "manifest.json and package.json versions must match",
);
assert(/^https:\/\//.test(manifest.homepage_url), "homepage_url must use HTTPS");
assert(
  new Set(manifest.permissions).size === manifest.permissions.length,
  "manifest permissions must not contain duplicates",
);

assertSameArray(
  manifest.background.scripts,
  [
    "lib/runtime.js",
    "lib/storage.js",
    "lib/adblock.js",
    "lib/config.js",
    "lib/domainFilter.js",
    "lib/proxy.js",
    "lib/proxyCredentials.js",
    "lib/session.js",
    "background.js",
  ],
  "background.scripts",
);
assert(manifest.background.persistent === true, "background page must be persistent");

assert(manifest.content_scripts.length === 1, "one content-script bundle is expected");
const contentScript = manifest.content_scripts[0];
assert(contentScript.run_at === "document_start", "content script must run at document_start");
assert(contentScript.all_frames === true, "content script must run in every frame");
assertSameArray(
  contentScript.js,
  [
    "lib/domainFilter.js",
    "lib/config.js",
    "content-scripts/main.js",
    "content-scripts/injector.js",
    "content-scripts/adblock.js",
  ],
  "content_scripts[0].js",
);

assertFilesExist(manifest.background.scripts, "background.scripts");
assertFilesExist(manifest.content_scripts.flatMap((entry) => entry.js || []), "content_scripts");
assertFilesExist(Object.values(manifest.icons), "icons");
assertFilesExist([
  manifest.browser_action.default_popup,
  manifest.options_ui.page,
], "extension pages");
