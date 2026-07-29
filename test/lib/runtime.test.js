import { afterEach, expect, test, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  assertRuntimeResponse,
  callChromeApi,
  getChromeError,
  loadRuntimeConfig,
  sendRuntimeMessage,
} = require("../../lib/runtime.js");

afterEach(() => {
  delete globalThis.chrome;
  vi.useRealTimers();
});

test("Chrome callback helpers normalize success and error responses", async () => {
  const runtime = {
    lastError: null,
    sendMessage(message, callback) {
      expect(this).toBe(runtime);
      callback({ echo: message });
    },
  };
  globalThis.chrome = {
    runtime,
  };
  await expect(sendRuntimeMessage({ type: "ping" })).resolves.toEqual({
    echo: { type: "ping" },
  });
  const calculator = {
    base: 1,
    add(value, callback) {
      callback(this.base + value);
    },
  };
  await expect(callChromeApi(calculator, "add", 2)).resolves.toBe(3);
  expect(getChromeError()).toBeNull();

  chrome.runtime.lastError = { message: "disconnected" };
  await expect(sendRuntimeMessage({ type: "ping" })).rejects.toThrow("disconnected");
  chrome.runtime.lastError = "closed";
  await expect(sendRuntimeMessage({ type: "ping" })).rejects.toThrow("closed");
  chrome.runtime = null;
  expect(getChromeError()).toBeNull();
});

test("assertRuntimeResponse returns successes and rejects missing or failed responses", () => {
  expect(assertRuntimeResponse({ success: true }, "fallback")).toEqual({
    success: true,
  });
  expect(assertRuntimeResponse({ value: 1 }, "fallback")).toEqual({ value: 1 });
  expect(() => assertRuntimeResponse(null, "fallback")).toThrow("fallback");
  expect(() =>
    assertRuntimeResponse({ success: false, error: "denied" }, "fallback"),
  ).toThrow("denied");
});

test("loadRuntimeConfig retries invalid responses and reports the final error", async () => {
  vi.useFakeTimers();
  const responses = [{ error: "starting" }, { config: { enabled: true } }];
  globalThis.chrome = {
    runtime: {
      lastError: null,
      sendMessage(message, callback) {
        callback(responses.shift());
      },
    },
  };

  const pending = loadRuntimeConfig();
  await vi.advanceTimersByTimeAsync(100);
  await expect(pending).resolves.toEqual({ enabled: true });

  chrome.runtime.sendMessage = (message, callback) =>
    callback({ error: "still unavailable" });
  const failed = loadRuntimeConfig(0);
  await expect(failed).rejects.toThrow("still unavailable");

  chrome.runtime.sendMessage = (message, callback) => callback(null);
  await expect(loadRuntimeConfig(0)).rejects.toThrow("Invalid config response");

  let attempts = 0;
  chrome.runtime.sendMessage = (message, callback) => {
    attempts++;
    if (attempts === 1) {
      chrome.runtime.lastError = { message: "Background unavailable" };
      callback();
      chrome.runtime.lastError = null;
      return;
    }
    callback({ config: { enabled: false } });
  };
  const recovered = loadRuntimeConfig();
  await vi.advanceTimersByTimeAsync(100);
  await expect(recovered).resolves.toEqual({ enabled: false });

  chrome.runtime.sendMessage = (message, callback) => {
    chrome.runtime.lastError = { message: "Background unavailable" };
    callback();
    chrome.runtime.lastError = null;
  };
  await expect(loadRuntimeConfig(0)).rejects.toThrow("Background unavailable");
});
