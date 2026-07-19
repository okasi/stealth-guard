import { afterEach, expect, test, vi } from "vitest";
import {
  loadRuntimeConfig,
  sendRuntimeMessage,
  wait,
} from "../../lib/runtime.js";

afterEach(() => {
  delete globalThis.chrome;
  vi.useRealTimers();
});

test("sendRuntimeMessage resolves responses and rejects runtime errors", async () => {
  globalThis.chrome = {
    runtime: {
      lastError: null,
      sendMessage(message, callback) {
        callback({ echo: message });
      },
    },
  };
  await expect(sendRuntimeMessage({ type: "ping" })).resolves.toEqual({
    echo: { type: "ping" },
  });

  chrome.runtime.lastError = { message: "disconnected" };
  await expect(sendRuntimeMessage({ type: "ping" })).rejects.toThrow(
    "disconnected",
  );
  chrome.runtime.lastError = "closed";
  await expect(sendRuntimeMessage({ type: "ping" })).rejects.toThrow("closed");
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
});

test("wait resolves after the requested delay", async () => {
  vi.useFakeTimers();
  const pending = wait(25);
  await vi.advanceTimersByTimeAsync(25);
  await expect(pending).resolves.toBeUndefined();
});
