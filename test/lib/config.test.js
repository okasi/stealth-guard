import { afterEach, expect, test, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const configPath = require.resolve("../../lib/config.js");

function loadConfigModule(navigatorValue = { platform: "Win32", userAgent: "Chrome/125" }) {
  delete require.cache[configPath];
  Object.defineProperty(globalThis, "navigator", {
    value: navigatorValue,
    configurable: true
  });
  return require("../../lib/config.js");
}

afterEach(() => {
  delete globalThis.storage;
  vi.restoreAllMocks();
});

test("getDefaultUserAgentPreset maps platform and browser combinations", () => {
  // Arrange
  const configModule = loadConfigModule();

  // Act
  Object.defineProperty(globalThis, "navigator", { value: { platform: "MacIntel", userAgent: "Chrome/140" }, configurable: true });
  const macChrome = configModule.getDefaultUserAgentPreset();
  Object.defineProperty(globalThis, "navigator", { value: { platform: "MacIntel", userAgent: "Safari/17" }, configurable: true });
  const macSafari = configModule.getDefaultUserAgentPreset();
  Object.defineProperty(globalThis, "navigator", { value: { platform: "Win32", userAgent: "Chrome/140" }, configurable: true });
  const windows = configModule.getDefaultUserAgentPreset();
  Object.defineProperty(globalThis, "navigator", { value: { platform: null, userAgent: null }, configurable: true });
  const nonStringNavigator = configModule.getDefaultUserAgentPreset();
  Object.defineProperty(globalThis, "navigator", { value: undefined, configurable: true });
  const missingNavigator = configModule.getDefaultUserAgentPreset();

  // Assert
  expect([macChrome, macSafari, windows, nonStringNavigator, missingNavigator]).toEqual([
    "macos_chrome",
    "macos",
    "windows",
    "windows",
    "windows"
  ]);
});

test("deepMerge recursively merges objects and ignores inherited source properties", () => {
  // Arrange
  const { deepMerge } = loadConfigModule();
  const source = Object.create({ inherited: "ignored" });
  source.nested = { enabled: false };
  source.extra = { added: true };
  source.list = ["custom"];

  // Act
  const merged = deepMerge({ nested: { enabled: true, whitelist: "" }, list: ["default"] }, source);

  // Assert
  expect(merged).toEqual({ nested: { enabled: false, whitelist: "" }, extra: { added: true }, list: ["custom"] });
  expect(merged.inherited).toBeUndefined();
});

test("loadConfig deep merges stored config without re-adding removed allowlist defaults", async () => {
  // Arrange
  const { DEFAULT_CONFIG, STORAGE_KEY, loadConfig } = loadConfigModule();
  globalThis.storage = {
    read: vi.fn().mockResolvedValue({
      [STORAGE_KEY]: {
        enabled: false,
        canvas: { whitelist: "custom.canvas" },
        proxy: { bypassList: ["localhost"] }
      }
    })
  };

  // Act
  const config = await loadConfig();

  // Assert
  expect(config.enabled).toBe(false);
  expect(config.canvas.whitelist).toBe("custom.canvas");
  expect(config.webgpu.whitelist).toBe(DEFAULT_CONFIG.webgpu.whitelist);
  expect(config.proxy.enabled).toBe(DEFAULT_CONFIG.proxy.enabled);
  expect(config.proxy.bypassList).toEqual(["localhost"]);
  expect(globalThis.storage.read).toHaveBeenCalledWith(STORAGE_KEY);
});

test("loadConfig uses defaults when storage has no saved config", async () => {
  // Arrange
  const { DEFAULT_CONFIG, STORAGE_KEY, loadConfig } = loadConfigModule();
  globalThis.storage = {
    read: vi.fn().mockResolvedValue({})
  };

  // Act
  const config = await loadConfig();

  // Assert
  expect(config.enabled).toBe(DEFAULT_CONFIG.enabled);
  expect(config.canvas.whitelist).toBe(DEFAULT_CONFIG.canvas.whitelist);
  expect(globalThis.storage.read).toHaveBeenCalledWith(STORAGE_KEY);
});

test("saveConfig and resetConfig write through the configured storage API", async () => {
  // Arrange
  const { DEFAULT_CONFIG, STORAGE_KEY, resetConfig, saveConfig } = loadConfigModule();
  globalThis.storage = {
    write: vi.fn().mockResolvedValue(undefined)
  };
  const nextConfig = { enabled: false };

  // Act
  await saveConfig(nextConfig);
  await resetConfig();

  // Assert
  expect(globalThis.storage.write).toHaveBeenNthCalledWith(1, { [STORAGE_KEY]: nextConfig });
  expect(globalThis.storage.write).toHaveBeenNthCalledWith(2, { [STORAGE_KEY]: DEFAULT_CONFIG });
  expect(globalThis.storage.write.mock.calls[1][0][STORAGE_KEY]).not.toBe(DEFAULT_CONFIG);
});

test("loadConfig reports a clear error when no storage API is available", async () => {
  // Arrange
  const { loadConfig } = loadConfigModule();

  // Act
  const result = loadConfig();

  // Assert
  await expect(result).rejects.toThrow("storage API is unavailable");
});
