import { readFileSync } from "node:fs";
import vm from "node:vm";
import { expect, test, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { DEFAULT_CONFIG, getUserAgentString } = require("../lib/config.js");
const BACKGROUND_SCRIPTS = [
  "lib/storage.js",
  "lib/config.js",
  "lib/domainFilter.js",
  "lib/proxy.js",
  "lib/session.js",
  "background.js",
];

function createEvent() {
  const listeners = [];
  return {
    listeners,
    addListener(listener) {
      listeners.push(listener);
    },
    removeListener(listener) {
      const index = listeners.indexOf(listener);
      if (index >= 0) {
        listeners.splice(index, 1);
      }
    },
  };
}

async function installBackground(config = DEFAULT_CONFIG) {
  const storageData = {
    "stealth-guard-config": structuredClone(config),
  };
  const state = {
    storageData,
    proxySettings: [],
    webRTCPolicy: "default",
    broadcasts: [],
    reloads: [],
    createdTabs: [],
    notifications: [],
    removedCookies: [],
    restoredCookies: [],
    executedScripts: [],
  };
  const events = {
    onInstalled: createEvent(),
    onMessage: createEvent(),
    onUpdated: createEvent(),
    onRemoved: createEvent(),
    onBeforeSendHeaders: createEvent(),
    onProxyError: createEvent(),
    onContextMenuClicked: createEvent(),
  };
  const tab = { id: 7, url: "https://www.example.com/account", active: true };
  const cookie = {
    name: "session",
    value: "abc",
    domain: ".example.com",
    path: "/",
    secure: true,
    httpOnly: true,
    hostOnly: false,
    session: false,
    expirationDate: 2000000000,
    sameSite: "lax",
    storeId: "0",
  };

  const chrome = {
    runtime: {
      lastError: null,
      onInstalled: events.onInstalled,
      onMessage: events.onMessage,
    },
    storage: {
      local: {
        get(keys, callback) {
          const requested = Array.isArray(keys) ? keys : [keys];
          const result = {};
          for (const key of requested) {
            if (key in storageData) {
              result[key] = structuredClone(storageData[key]);
            }
          }
          callback(result);
        },
        set(items, callback) {
          Object.assign(storageData, structuredClone(items));
          callback();
        },
        remove(keys, callback) {
          for (const key of Array.isArray(keys) ? keys : [keys]) {
            delete storageData[key];
          }
          callback();
        },
        clear(callback) {
          for (const key of Object.keys(storageData)) {
            delete storageData[key];
          }
          callback();
        },
      },
    },
    webRequest: {
      onBeforeSendHeaders: events.onBeforeSendHeaders,
    },
    privacy: {
      network: {
        webRTCIPHandlingPolicy: {
          set(details, callback) {
            state.webRTCPolicy = details.value;
            callback();
          },
          get(details, callback) {
            callback({
              value: state.webRTCPolicy,
              levelOfControl: "controllable_by_this_extension",
            });
          },
        },
      },
    },
    proxy: {
      settings: {
        set(details, callback) {
          state.proxySettings.push(structuredClone(details));
          callback();
        },
      },
      onProxyError: events.onProxyError,
    },
    tabs: {
      onUpdated: events.onUpdated,
      onRemoved: events.onRemoved,
      query(details, callback) {
        callback([tab]);
      },
      sendMessage(tabId, message, callback) {
        state.broadcasts.push({ tabId, message: structuredClone(message) });
        callback();
      },
      get(tabId, callback) {
        callback(tabId === tab.id ? { ...tab } : null);
      },
      executeScript(tabId, details, callback) {
        state.executedScripts.push(details.code);
        if (details.code.includes("const snapshot")) {
          callback([
            {
              localStorage: { token: "local" },
              sessionStorage: { draft: "session" },
            },
          ]);
        } else {
          callback([true]);
        }
      },
      reload(tabId, options, callback) {
        if (typeof options === "function") {
          callback = options;
          options = {};
        }
        state.reloads.push({ tabId, options });
        if (callback) callback();
      },
      create(details) {
        state.createdTabs.push(details);
      },
    },
    cookies: {
      getAllCookieStores(callback) {
        callback([{ id: "0", tabIds: [tab.id] }]);
      },
      getAll(details, callback) {
        callback([cookie]);
      },
      remove(details, callback) {
        state.removedCookies.push(details);
        callback(details);
      },
      set(details, callback) {
        state.restoredCookies.push(details);
        callback(details);
      },
    },
    notifications: {
      create(details, callback) {
        state.notifications.push(details);
        if (callback) callback(`notification-${state.notifications.length}`);
      },
    },
    contextMenus: {
      onClicked: events.onContextMenuClicked,
      removeAll(callback) {
        callback();
      },
      create(details, callback) {
        if (callback) callback();
      },
    },
  };

  const context = vm.createContext({
    chrome,
    console: {
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    navigator: { platform: "Win32", userAgent: "Chrome/137" },
    fetch: vi.fn().mockResolvedValue({ ok: false }),
    URL,
    AbortController,
    structuredClone,
    setTimeout,
    clearTimeout,
    Date,
    Math,
    JSON,
    Promise,
    Map,
    Set,
  });

  const source = BACKGROUND_SCRIPTS.map((file) =>
    readFileSync(new URL(`../${file}`, import.meta.url), "utf8"),
  ).join("\n");
  vm.runInContext(source, context, { filename: "background-bundle.js" });
  await new Promise((resolve) => setTimeout(resolve, 0));

  async function sendMessage(request, sender = {}) {
    const listener = events.onMessage.listeners[0];
    return new Promise((resolve, reject) => {
      let resolved = false;
      const keepChannelOpen = listener(request, sender, (response) => {
        resolved = true;
        resolve(response);
      });
      if (keepChannelOpen !== true && !resolved) {
        resolve(undefined);
      }
      setTimeout(() => {
        if (!resolved && keepChannelOpen === true) {
          reject(new Error(`Timed out waiting for ${request.type}`));
        }
      }, 1000);
    });
  }

  return { chrome, events, sendMessage, state, tab };
}

test("background initializes policies and applies config changes atomically", async () => {
  const { events, sendMessage, state, tab } = await installBackground();
  const initial = await sendMessage({ type: "get-config" });

  expect(initial.config.enabled).toBe(true);
  expect(state.webRTCPolicy).toBe("disable_non_proxied_udp");
  expect(state.proxySettings.at(-1).value.mode).toBe("system");
  expect(events.onBeforeSendHeaders.listeners).toHaveLength(1);

  const headers = [{ name: "Accept", value: "*/*" }];
  const modified = events.onBeforeSendHeaders.listeners[0]({
    url: tab.url,
    requestHeaders: headers,
  });
  expect(
    modified.requestHeaders.find((header) => header.name === "User-Agent")
      .value,
  ).toBe(getUserAgentString(initial.config.useragent.preset));

  const nextConfig = structuredClone(initial.config);
  nextConfig.enabled = false;
  const updated = await sendMessage({
    type: "update-config",
    config: nextConfig,
  });

  expect(updated).toEqual({ success: true });
  expect(events.onBeforeSendHeaders.listeners).toHaveLength(0);
  expect(state.webRTCPolicy).toBe("default");
  expect(state.broadcasts.at(-1).message.type).toBe("config-updated");
});

test("background tracks fingerprint access and manages global allowlists", async () => {
  const { sendMessage, state, tab } = await installBackground();
  const current = (await sendMessage({ type: "get-config" })).config;
  current.notifications.enabled = true;
  await sendMessage({ type: "update-config", config: current });

  await sendMessage(
    {
      type: "fingerprint-detected",
      feature: "canvas",
      hostname: "forged.test",
    },
    { tab },
  );
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(
    (await sendMessage({ type: "get-triggered-features", tabId: tab.id }))
      .features,
  ).toEqual(["canvas"]);
  expect(state.notifications.at(-1).message).toContain("example.com");
  expect(
    await sendMessage(
      {
        type: "fingerprint-detected",
        feature: "unknown",
        hostname: "example.com",
      },
      { tab },
    ),
  ).toMatchObject({ success: false });

  const added = await sendMessage({
    type: "add-to-whitelist",
    domain: "example.com",
  });
  expect(added.changed).toBe(true);
  expect(added.whitelist).toContain("*.example.com");
  const duplicate = await sendMessage({
    type: "add-to-whitelist",
    domain: "example.com",
  });
  expect(duplicate.changed).toBe(false);
  const removed = await sendMessage({
    type: "remove-from-whitelist",
    domain: "www.example.com",
  });
  expect(removed.changed).toBe(true);
  await expect(
    sendMessage({ type: "add-to-whitelist", domain: "bad host" }),
  ).resolves.toMatchObject({ success: false });
});

test("background exercises proxy preparation and the full session lifecycle", async () => {
  const { sendMessage, state, tab } = await installBackground();
  const prepared = await sendMessage({
    type: "prepare-proxy-profile",
    profile: {
      name: " Main ",
      host: "proxy.test",
      port: "1080",
      scheme: "SOCKS5",
      remoteDNS: true,
    },
  });
  expect(prepared.profile).toEqual({
    name: "Main",
    host: "proxy.test",
    port: 1080,
    scheme: "socks5",
  });

  const saved = await sendMessage({
    type: "save-session",
    hostname: "example.com",
    tabId: tab.id,
    name: "Work",
  });
  expect(saved.success).toBe(true);
  expect(saved.session.cookies).toHaveLength(1);
  expect(saved.session.localStorage).toEqual({ token: "local" });

  const sessions = await sendMessage({
    type: "get-sessions",
    hostname: "example.com",
  });
  expect(sessions.sessions).toHaveLength(1);
  expect(sessions.activeSessionId).toBe(saved.session.id);

  const renamed = await sendMessage({
    type: "rename-session",
    sessionId: saved.session.id,
    name: "Personal",
  });
  expect(renamed.session.name).toBe("Personal");

  const switched = await sendMessage({
    type: "switch-session",
    sessionId: saved.session.id,
    tabId: tab.id,
  });
  expect(switched.success).toBe(true);
  expect(state.removedCookies).toHaveLength(1);
  expect(state.restoredCookies).toHaveLength(1);
  expect(state.reloads).toHaveLength(1);

  const cleared = await sendMessage({
    type: "clear-current-session",
    hostname: "example.com",
    tabId: tab.id,
  });
  expect(cleared.success).toBe(true);

  const deleted = await sendMessage({
    type: "delete-session",
    sessionId: saved.session.id,
  });
  expect(deleted.success).toBe(true);
  expect(
    (await sendMessage({ type: "get-sessions", hostname: "example.com" }))
      .sessions,
  ).toEqual([]);

  const wrongSite = await sendMessage({
    type: "save-session",
    hostname: "other.test",
    tabId: tab.id,
  });
  expect(wrongSite).toMatchObject({ success: false });
  expect(
    await sendMessage({
      type: "switch-session",
      sessionId: "missing",
      tabId: tab.id,
    }),
  ).toMatchObject({ success: false, error: "Session not found" });
});
