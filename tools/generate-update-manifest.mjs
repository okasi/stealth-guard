import { createHash, createPublicKey } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

function fail(message) {
  console.error(`generate-update-manifest: ${message}`);
  process.exitCode = 1;
}

function getOption(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&apos;",
    };
    return entities[character];
  });
}

function extensionIdFromPrivateKey(keyPath) {
  const publicKey = createPublicKey(readFileSync(resolve(keyPath))).export({
    type: "spki",
    format: "der",
  });
  const digest = createHash("sha256").update(publicKey).digest();
  return [...digest.subarray(0, 16)]
    .flatMap((byte) => byte.toString(16).padStart(2, "0").split(""))
    .map((character) => String.fromCharCode("a".charCodeAt(0) + parseInt(character, 16)))
    .join("");
}

try {
  const keyPath = getOption("--key");
  const codebase = getOption("--codebase");
  const outputPath = getOption("--output");
  const manifestPath = getOption("--manifest", "manifest.json");

  if (!keyPath || !codebase || !outputPath) {
    throw new Error("usage: node tools/generate-update-manifest.mjs --key KEY.pem --codebase URL --output updates.xml [--manifest manifest.json]");
  }
  if (!/^https:\/\//.test(codebase)) {
    throw new Error("--codebase must be an HTTPS URL");
  }

  const manifest = JSON.parse(readFileSync(resolve(manifestPath), "utf8"));
  if (!/^\d+(?:\.\d+){1,3}$/.test(manifest.version)) {
    throw new Error(`manifest version is invalid: ${manifest.version}`);
  }

  const appId = extensionIdFromPrivateKey(keyPath);
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<gupdate xmlns="http://www.google.com/update2/response" protocol="2.0">
  <app appid="${escapeXml(appId)}">
    <updatecheck codebase="${escapeXml(codebase)}" version="${escapeXml(manifest.version)}" />
  </app>
</gupdate>
`;

  mkdirSync(dirname(resolve(outputPath)), { recursive: true });
  writeFileSync(resolve(outputPath), xml, "utf8");
  console.log(`Generated ${outputPath} for ${manifest.version} (${appId})`);
} catch (error) {
  fail(error.message || String(error));
}
