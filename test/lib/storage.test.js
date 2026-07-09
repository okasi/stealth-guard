import { afterEach, expect, test } from "vitest";
import { storage } from "../../lib/storage.js";

function installChromeStorageMock(result = { ok: true }) {
  const calls = [];
  globalThis.chrome = {
    runtime: { lastError: null },
    storage: {
      local: {
        get(keys, callback) {
          calls.push(["get", keys]);
          callback(result);
        },
        set(items, callback) {
          calls.push(["set", items]);
          callback();
        },
        remove(keys, callback) {
          calls.push(["remove", keys]);
          callback();
        },
        clear(callback) {
          calls.push(["clear"]);
          callback();
        }
      }
    }
  };
  return calls;
}

afterEach(() => {
  delete globalThis.chrome;
});

test("read write remove and clear resolve through chrome.storage.local", async () => {
  // Arrange
  const calls = installChromeStorageMock({ key: "value" });

  // Act
  const readResult = await storage.read("key");
  await storage.write({ key: "value" });
  await storage.remove("key");
  await storage.clear();

  // Assert
  expect(readResult).toEqual({ key: "value" });
  expect(calls).toEqual([
    ["get", "key"],
    ["set", { key: "value" }],
    ["remove", "key"],
    ["clear"]
  ]);
});

test("storage methods reject when chrome reports lastError", async () => {
  // Arrange
  installChromeStorageMock();
  chrome.runtime.lastError = new Error("storage failed");

  // Act
  const read = storage.read("key");
  const write = storage.write({ key: "value" });
  const remove = storage.remove("key");
  const clear = storage.clear();

  // Assert
  await expect(read).rejects.toThrow("storage failed");
  await expect(write).rejects.toThrow("storage failed");
  await expect(remove).rejects.toThrow("storage failed");
  await expect(clear).rejects.toThrow("storage failed");
});
