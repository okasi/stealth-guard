const { existsSync, readFileSync, readdirSync } = require("node:fs");
const { createHash } = require("node:crypto");
const { normalizeGpuProfile } = require("../lib/gpuProfiles.js");

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const packageLock = JSON.parse(readFileSync("package-lock.json", "utf8"));

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
  [packageJson.version, packageLock.version, packageLock.packages[""].version]
    .every((version) => version === manifest.version),
  "manifest.json, package.json and both package-lock.json versions must match",
);
assert(/^https:\/\//.test(manifest.homepage_url), "homepage_url must use HTTPS");
assert(
  manifest.update_url ===
    "https://github.com/okasi/stealth-guard/releases/latest/download/updates.xml",
  "update_url must point to the stable GitHub Release update manifest",
);
assert(
  new Set(manifest.permissions).size === manifest.permissions.length,
  "manifest permissions must not contain duplicates",
);

assertSameArray(
  manifest.background.scripts,
  [
    "lib/runtime.js",
    "lib/storage.js",
    "lib/filterLists.js",
    "lib/adblock.js",
    "lib/gpuProfiles.js",
    "lib/curlProfiles.js",
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
    "lib/runtime.js",
    "lib/filterLists.js",
    "lib/domainFilter.js",
    "lib/gpuProfiles.js",
    "lib/curlProfiles.js",
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

const bundledGpuProfileIndex = JSON.parse(
  readFileSync("profiles/clearcote/index.json", "utf8"),
);
const bundledGpuProfiles = bundledGpuProfileIndex.profiles;
assert(
  Array.isArray(bundledGpuProfiles) && bundledGpuProfiles.length > 0,
  "bundled GPU profile index must contain profiles",
);
const bundledGpuProfileIds = bundledGpuProfiles.map((profile) => profile.id);
assert(
  new Set(bundledGpuProfileIds).size === bundledGpuProfileIds.length,
  "bundled GPU profile ids must be unique",
);
assert(
  bundledGpuProfileIndex.count === bundledGpuProfiles.length,
  "bundled GPU profile count must match the index",
);
assertFilesExist(
  [
    "profiles/clearcote/LICENSE",
    "profiles/clearcote/NOTICE.md",
    "profiles/clearcote/index.json",
    ...bundledGpuProfileIds.map((id) => `profiles/clearcote/${id}.json`),
  ],
  "bundled GPU profiles",
);

const bundledGpuVendorCounts = {};
const bundledGpuRuntimeSignatures = new Map();
for (const entry of bundledGpuProfiles) {
  const id = entry.id;
  const path = `profiles/clearcote/${id}.json`;
  const profile = normalizeGpuProfile(JSON.parse(readFileSync(path, "utf8")));
  assert(profile, `bundled GPU profile is invalid: ${path}`);
  assert(profile.id === id, `bundled GPU profile id does not match its filename: ${path}`);
  assert(
    entry.gpu_vendor === profile.gpuVendor &&
      entry.gpu_family === profile.gpuFamily,
    `bundled GPU profile index metadata does not match: ${path}`,
  );
  const runtimeSignature = createHash("sha256")
    .update(JSON.stringify({ ...profile, id: "" }))
    .digest("hex");
  assert(
    !bundledGpuRuntimeSignatures.has(runtimeSignature),
    `${path} duplicates the runtime profile in ${bundledGpuRuntimeSignatures.get(runtimeSignature)}`,
  );
  bundledGpuRuntimeSignatures.set(runtimeSignature, path);
  bundledGpuVendorCounts[profile.gpuVendor] =
    (bundledGpuVendorCounts[profile.gpuVendor] || 0) + 1;
}
const indexedGpuVendorCounts = bundledGpuProfileIndex.by_vendor || {};
assert(
  Object.keys(indexedGpuVendorCounts).length ===
    Object.keys(bundledGpuVendorCounts).length &&
    Object.entries(bundledGpuVendorCounts).every(
      ([vendor, count]) => indexedGpuVendorCounts[vendor] === count,
    ),
  "bundled GPU profile vendor counts must match the index",
);

const bundledGpuProfileFiles = readdirSync("profiles/clearcote")
  .filter((file) => file.endsWith(".json") && file !== "index.json")
  .map((file) => file.slice(0, -5))
  .sort();
assertSameArray(
  bundledGpuProfileFiles,
  bundledGpuProfileIds.slice().sort(),
  "bundled GPU profile files",
);

assertFilesExist(
  [
    "profiles/apify/README.md",
    "tools/generate-apify-profile.mjs",
  ],
  "Apify GPU profile source",
);
