import { afterEach, expect, test } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { storage } = require("../../lib/storage.js");

function installChromeStorageMock(result = { ok: true }) {
  const calls = [];
  globalThis.chrome = {
    runtime: { lastError: null },
    storage: {
      local: {
        get(keys, callback) {
          if (this !== chrome.storage.local) {
            throw new TypeError("Illegal invocation");
          }
          calls.push(["get", keys]);
          callback(result);
        },
        set(items, callback) {
          if (this !== chrome.storage.local) {
            throw new TypeError("Illegal invocation");
          }
          calls.push(["set", items]);
          callback();
        },
      },
    },
  };
  return calls;
}

afterEach(() => {
  delete globalThis.chrome;
  delete globalThis.callChromeApi;
});

test("storage uses the shared browser API caller when scripts are bundled", async () => {
  installChromeStorageMock();
  globalThis.callChromeApi = (api, methodName, ...args) =>
    new Promise((resolve) => api[methodName](...args, resolve));

  await expect(storage.read("key")).resolves.toEqual({ ok: true });
});

test("read and write resolve through chrome.storage.local", async () => {
  const calls = installChromeStorageMock({ key: "value" });

  const readResult = await storage.read("key");
  await storage.write({ key: "value" });

  expect(readResult).toEqual({ key: "value" });
  expect(calls).toEqual([
    ["get", "key"],
    ["set", { key: "value" }],
  ]);
});

test("storage methods reject when chrome reports lastError", async () => {
  installChromeStorageMock();
  chrome.runtime.lastError = new Error("storage failed");

  const read = storage.read("key");
  const write = storage.write({ key: "value" });

  await expect(read).rejects.toThrow("storage failed");
  await expect(write).rejects.toThrow("storage failed");
});
