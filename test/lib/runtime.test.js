import { afterEach, expect, test, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  assertRuntimeResponse,
  callChromeApi,
  getChromeError,
  getTimeZoneGmtOffsetLabel,
  getTimeZoneShortName,
  loadRuntimeConfig,
  sendRuntimeMessage,
  updateTimeZoneSelectLabels,
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

test("timezone labels derive current GMT offsets from regional rules", () => {
  const winter = new Date("2026-01-15T12:00:00Z");
  const summer = new Date("2026-07-15T12:00:00Z");

  expect(getTimeZoneGmtOffsetLabel("Europe/Paris", winter)).toBe("GMT+1");
  expect(getTimeZoneGmtOffsetLabel("Europe/Paris", summer)).toBe("GMT+2");
  expect(getTimeZoneGmtOffsetLabel("Asia/Kathmandu", winter)).toBe("GMT+5:45");
  expect(getTimeZoneGmtOffsetLabel("America/New_York", winter)).toBe("GMT-5");
  expect(getTimeZoneGmtOffsetLabel("UTC", winter)).toBe("GMT+0");
  expect(getTimeZoneGmtOffsetLabel("Invalid/Timezone", winter)).toBeNull();
  expect(getTimeZoneShortName("Europe/Paris", winter)).toBe("CET");
  expect(getTimeZoneShortName("Europe/Paris", summer)).toBe("CEST");
  expect(getTimeZoneShortName("Asia/Tokyo", winter)).toBeNull();
  expect(getTimeZoneShortName("Invalid/Timezone", winter)).toBeNull();
  const utcFormatter = vi
    .spyOn(Intl, "DateTimeFormat")
    .mockImplementationOnce(function MockDateTimeFormat() {
      return {
        formatToParts: () => [{ type: "timeZoneName", value: "UTC" }],
      };
    });
  expect(getTimeZoneGmtOffsetLabel("UTC", winter)).toBe("GMT+0");
  utcFormatter.mockRestore();

  const select = {
    options: [
      {
        value: "Europe/Paris",
        textContent: " Paris ",
        dataset: {},
      },
      {
        value: "Invalid/Timezone",
        textContent: "Unknown",
        dataset: { timeZoneAbbreviation: "LOCAL" },
      },
      {
        value: "Asia/Tokyo",
        textContent: "Tokyo",
        dataset: {},
      },
    ],
  };
  updateTimeZoneSelectLabels(select, winter);
  expect(select.options[0].textContent).toBe("CET/Paris (GMT+1)");
  expect(select.options[1].textContent).toBe("LOCAL/Unknown");
  expect(select.options[2].textContent).toBe("Tokyo (GMT+9)");
  updateTimeZoneSelectLabels(select, summer);
  expect(select.options[0].textContent).toBe("CEST/Paris (GMT+2)");
  updateTimeZoneSelectLabels(null, summer);
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
