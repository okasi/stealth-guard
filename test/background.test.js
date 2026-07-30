import { readFileSync } from "node:fs";
import vm from "node:vm";
import { expect, test, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { DEFAULT_CONFIG, getUserAgentString } = require("../lib/config.js");
const BACKGROUND_SCRIPTS = [
  "lib/runtime.js",
  "lib/storage.js",
  "lib/config.js",
  "lib/domainFilter.js",
  "lib/proxy.js",
  "lib/proxyCredentials.js",
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

async function installBackground(config = DEFAULT_CONFIG, behavior = {}) {
  const storageData = {
    "stealth-guard-config": structuredClone(config),
    "stealth-guard-proxy-credentials": structuredClone(
      behavior.credentials || {},
    ),
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
    cookieQueries: [],
    contextMenus: [],
    proxyFailuresRemaining: behavior.proxyFailures || 0,
    proxyValue: { mode: "system" },
    proxyControlLevel:
      behavior.proxyControlLevel || "controlled_by_this_extension",
  };
  const events = {
    onInstalled: createEvent(),
    onMessage: createEvent(),
    onUpdated: createEvent(),
    onRemoved: createEvent(),
    onBeforeSendHeaders: createEvent(),
    onAuthRequired: createEvent(),
    onCompleted: createEvent(),
    onErrorOccurred: createEvent(),
    onProxyError: createEvent(),
    onProxySettingsChanged: createEvent(),
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
    partitionKey: { topLevelSite: "https://example.com" },
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
      onAuthRequired: events.onAuthRequired,
      onCompleted: events.onCompleted,
      onErrorOccurred: events.onErrorOccurred,
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
          if (state.proxyFailuresRemaining > 0) {
            state.proxyFailuresRemaining--;
            chrome.runtime.lastError = { message: "Proxy apply failed" };
            callback();
            chrome.runtime.lastError = null;
            return;
          }
          state.proxyValue = structuredClone(details.value);
          callback();
        },
        get(details, callback) {
          callback({
            value: structuredClone(state.proxyValue),
            levelOfControl: state.proxyControlLevel,
          });
        },
        onChange: events.onProxySettingsChanged,
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
        if (details.code.includes("return { localStorage:")) {
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
        state.cookieQueries.push(details);
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
        state.contextMenus.push(details);
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
    fetch: vi.fn().mockImplementation(async (url) => {
      if (behavior.exitIp && String(url).includes("api.ipify.org")) {
        return {
          ok: true,
          json: async () => ({ ip: behavior.exitIp }),
        };
      }
      return { ok: false };
    }),
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

  const existingHeaders = [{ name: "user-agent", value: "native" }];
  const replaced = events.onBeforeSendHeaders.listeners[0]({
    url: tab.url,
    requestHeaders: existingHeaders,
  });
  expect(replaced.requestHeaders).toHaveLength(1);
  expect(replaced.requestHeaders[0].value).toBe(
    getUserAgentString(initial.config.useragent.preset),
  );
  const challengeHeaders = [{ name: "Accept", value: "*/*" }];
  expect(
    events.onBeforeSendHeaders.listeners[0]({
      url: "https://challenges.cloudflare.com/turnstile",
      requestHeaders: challengeHeaders,
    }).requestHeaders,
  ).toBe(challengeHeaders);

  const broadcastsBeforeNoop = state.broadcasts.length;
  expect(
    await sendMessage({ type: "update-config", config: initial.config }),
  ).toEqual({ success: true });
  expect(state.broadcasts).toHaveLength(broadcastsBeforeNoop);
  expect(
    await sendMessage({ type: "update-config", config: [] }),
  ).toMatchObject({ success: false, error: "Invalid configuration payload" });

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

  expect(await sendMessage({ type: "reset-config" })).toEqual({
    success: true,
  });
  expect((await sendMessage({ type: "get-config" })).config.enabled).toBe(true);
});

test("User-Agent policy keeps existing client-hint headers consistent", async () => {
  const windowsConfig = structuredClone(DEFAULT_CONFIG);
  windowsConfig.useragent.preset = "windows";
  const { events, sendMessage, tab } = await installBackground(windowsConfig);
  const current = (await sendMessage({ type: "get-config" })).config;
  expect(current.useragent.preset).toBe("windows");

  const chromiumHeaders = [
    { name: "User-Agent", value: "native" },
    { name: "Sec-CH-UA", value: '"Chromium";v="999"' },
    { name: "Sec-CH-UA-Mobile", value: "?1" },
    { name: "Sec-CH-UA-Platform", value: '"Linux"' },
    { name: "Sec-CH-UA-Arch", value: '"arm"' },
    { name: "Sec-CH-UA-Full-Version", value: '"999.0.0.0"' },
    { name: "Sec-CH-UA-Unknown", value: '"native"' },
  ];
  const rewritten = events.onBeforeSendHeaders.listeners[0]({
    url: tab.url,
    requestHeaders: chromiumHeaders,
  }).requestHeaders;
  const values = Object.fromEntries(
    rewritten.map((header) => [header.name.toLowerCase(), header.value]),
  );
  expect(values["user-agent"]).toContain("Edg/125.0.0.0");
  expect(values["sec-ch-ua"]).toContain('"Microsoft Edge";v="125"');
  expect(values["sec-ch-ua-mobile"]).toBe("?0");
  expect(values["sec-ch-ua-platform"]).toBe('"Windows"');
  expect(values["sec-ch-ua-arch"]).toBe('"x86"');
  expect(values["sec-ch-ua-full-version"]).toBe('"125.0.0.0"');
  expect(values["sec-ch-ua-unknown"]).toBeUndefined();

  const safariConfig = structuredClone(current);
  safariConfig.useragent.preset = "macos";
  expect(
    await sendMessage({ type: "update-config", config: safariConfig }),
  ).toEqual({ success: true });
  const safariHeaders = events.onBeforeSendHeaders.listeners[0]({
    url: tab.url,
    requestHeaders: [
      { name: "User-Agent", value: "native" },
      { name: "Sec-CH-UA", value: '"Chromium";v="999"' },
      { name: "Sec-CH-UA-Platform", value: '"Linux"' },
    ],
  }).requestHeaders;
  expect(safariHeaders).toEqual([
    {
      name: "User-Agent",
      value: expect.stringContaining("Version/17.6 Safari/605.1.15"),
    },
  ]);
});

test("background tracks fingerprint access and manages global allowlists", async () => {
  const { events, sendMessage, state, tab } = await installBackground();
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
  const notificationCount = state.notifications.length;
  await sendMessage(
    { type: "fingerprint-detected", feature: "canvas" },
    { tab },
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(state.notifications).toHaveLength(notificationCount);
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

  expect(
    await sendMessage({ type: "fingerprint-detected", feature: "canvas" }),
  ).toMatchObject({ success: false, error: "Missing hostname" });
  events.onUpdated.listeners[0](tab.id, { url: "https://other.test/" });
  expect(
    (await sendMessage({ type: "get-triggered-features", tabId: tab.id }))
      .features,
  ).toEqual([]);
  await sendMessage(
    { type: "fingerprint-detected", feature: "user-agent" },
    { tab },
  );
  events.onRemoved.listeners[0](tab.id);
  expect(
    (await sendMessage({ type: "get-triggered-features", tabId: tab.id }))
      .features,
  ).toEqual([]);
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
    location: {
      city: "Unknown",
      region: "",
      country: "Unknown",
      countryCode: "",
      loc: "",
      org: "",
      timezone: "",
      source: "fallback",
    },
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
  expect(state.cookieQueries[0]).toMatchObject({
    domain: "example.com",
    storeId: "0",
  });

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
  expect(state.restoredCookies[0].partitionKey).toEqual({
    topLevelSite: "https://example.com",
  });
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
  expect(
    await sendMessage({ type: "rename-session", sessionId: "missing" }),
  ).toMatchObject({ success: false, error: "Session not found" });
  expect(
    await sendMessage({ type: "delete-session" }),
  ).toMatchObject({ success: false, error: "Missing session id" });
  expect(
    await sendMessage({ type: "get-sessions", hostname: "bad host" }),
  ).toMatchObject({ success: false, error: "Missing hostname" });

  const bulkSaves = await Promise.all(
    Array.from({ length: 21 }, (_, index) =>
      sendMessage({
        type: "save-session",
        hostname: "example.com",
        tabId: tab.id,
        name: `Session ${index + 1}`,
      }),
    ),
  );
  const limited = await sendMessage({
    type: "get-sessions",
    hostname: "example.com",
  });
  expect(bulkSaves.every((result) => result.success)).toBe(true);
  expect(limited.sessions).toHaveLength(20);
  expect(limited.sessions[0].id).toBe(bulkSaves.at(-1).session.id);
  expect(limited.activeSessionId).toBe(bulkSaves.at(-1).session.id);
  expect(limited.sessions.some((session) => session.name === "Session 1")).toBe(
    false,
  );
});

test("background protects proxy credentials and reports verified connection state", async () => {
  const config = structuredClone(DEFAULT_CONFIG);
  config.proxy = {
    enabled: true,
    activeProfile: "Main",
    profiles: [
      { name: "Main", host: "proxy.test", port: 8443, scheme: "https" },
    ],
    domainRoutes: [],
    bypassList: ["localhost"],
  };
  const { events, sendMessage, state, tab } = await installBackground(config, {
    credentials: {
      "proxy.test:8443": { username: "alice", password: "secret" },
    },
    exitIp: "203.0.113.8",
  });

  expect(events.onAuthRequired.listeners).toHaveLength(1);
  expect(events.onCompleted.listeners).toHaveLength(1);
  expect(events.onErrorOccurred.listeners).toHaveLength(1);
  expect(
    (await sendMessage({ type: "get-proxy-runtime-status" })).status,
  ).toMatchObject({
    state: "connected",
    profile: "Main",
    exitIp: "203.0.113.8",
  });
  const diagnostics = await sendMessage({ type: "get-proxy-diagnostics" });
  expect(diagnostics.diagnostics).toMatchObject({
    effectiveSettings: {
      mode: "fixed_servers",
      controlLevel: "controlled_by_this_extension",
    },
    configuration: {
      enabled: true,
      routingMode: "bypass-selected",
      activeProfile: "Main",
      profileCount: 1,
      credentialProfileCount: 1,
    },
  });
  expect(
    diagnostics.diagnostics.history.map((entry) => entry.state),
  ).toEqual(["connected", "connecting"]);
  expect(JSON.stringify(diagnostics)).not.toContain("secret");
  expect(
    await sendMessage({ type: "get-proxy-diagnostics" }, { tab }),
  ).toMatchObject({ success: false });

  const authenticate = events.onAuthRequired.listeners[0];
  expect(
    authenticate({
      isProxy: false,
      requestId: "origin",
      challenger: { host: "proxy.test", port: 8443 },
    }),
  ).toEqual({});
  expect(
    authenticate({
      isProxy: true,
      requestId: "unknown",
      challenger: { host: "other.test", port: 8443 },
    }),
  ).toEqual({ cancel: true });

  const challenge = {
    isProxy: true,
    requestId: "request-1",
    challenger: { host: "PROXY.TEST", port: 8443 },
  };
  expect(authenticate(challenge)).toEqual({
    authCredentials: { username: "alice", password: "secret" },
  });
  expect(authenticate(challenge).authCredentials.username).toBe("alice");
  expect(authenticate(challenge).authCredentials.password).toBe("secret");
  expect(authenticate(challenge)).toEqual({ cancel: true });
  events.onCompleted.listeners[0]({ requestId: "request-1" });
  expect(authenticate(challenge).authCredentials.username).toBe("alice");
  events.onErrorOccurred.listeners[0]({ requestId: "request-1" });

  const statuses = await sendMessage({
    type: "get-proxy-credential-status",
    profiles: config.proxy.profiles,
  });
  expect(statuses.credentials).toEqual([
    {
      endpoint: "proxy.test:8443",
      configured: true,
      username: "alice",
      persisted: true,
    },
  ]);
  expect(statuses.credentials[0].password).toBeUndefined();
  expect(
    await sendMessage(
      { type: "get-proxy-credential-status", profiles: config.proxy.profiles },
      { tab },
    ),
  ).toMatchObject({ success: false });

  expect(
    await sendMessage({
      type: "set-proxy-credentials",
      profile: config.proxy.profiles[0],
      credentials: {
        username: "session-user",
        password: "session-secret",
        persist: false,
      },
    }),
  ).toMatchObject({
    credential: { configured: true, persisted: false },
  });
  expect(state.storageData["stealth-guard-proxy-credentials"]).toEqual({});
  expect(authenticate({ ...challenge, requestId: "session" })).toEqual({
    authCredentials: {
      username: "session-user",
      password: "session-secret",
    },
  });

  expect(
    await sendMessage({
      type: "clear-proxy-credentials",
      profile: config.proxy.profiles[0],
    }),
  ).toMatchObject({ credential: { configured: false } });
  expect(
    authenticate({ ...challenge, requestId: "cleared" }),
  ).toEqual({ cancel: true });
  expect(await sendMessage({ type: "clear-proxy-history" })).toEqual({
    success: true,
  });
  expect(state.storageData["stealth-guard-proxy-history"]).toEqual([]);
  expect(
    (await sendMessage({ type: "get-proxy-diagnostics" })).diagnostics.history,
  ).toEqual([]);
});

test("background surfaces proxy ownership conflicts without fighting them", async () => {
  const config = structuredClone(DEFAULT_CONFIG);
  config.proxy = {
    enabled: true,
    activeProfile: "Main",
    profiles: [
      { name: "Main", host: "proxy.test", port: 8080, scheme: "http" },
    ],
    domainRoutes: [],
    bypassList: [],
  };
  const { events, sendMessage, state } = await installBackground(config, {
    proxyControlLevel: "controlled_by_other_extensions",
  });

  expect(state.proxySettings).toHaveLength(0);
  expect(
    (await sendMessage({ type: "get-proxy-runtime-status" })).status,
  ).toMatchObject({ state: "conflict" });

  events.onProxySettingsChanged.listeners[0]({
    levelOfControl: "not_controllable",
  });
  expect(
    (await sendMessage({ type: "get-proxy-runtime-status" })).status,
  ).toMatchObject({ state: "conflict", controlLevel: "not_controllable" });
});

test("background retries startup and rolls back failed config application", async () => {
  const recovered = await installBackground(DEFAULT_CONFIG, {
    proxyFailures: 1,
  });
  expect((await recovered.sendMessage({ type: "get-config" })).config).toBeTruthy();
  expect(recovered.state.proxySettings).toHaveLength(2);
  expect(recovered.state.contextMenus).toHaveLength(3);

  const { sendMessage, state } = await installBackground();
  const before = (await sendMessage({ type: "get-config" })).config;
  const invalid = structuredClone(before);
  invalid.proxy.enabled = true;
  invalid.proxy.activeProfile = "Missing";

  expect(
    await sendMessage({ type: "update-config", config: invalid }),
  ).toMatchObject({ success: false });
  expect(state.storageData["stealth-guard-config"]).toEqual(before);
  expect((await sendMessage({ type: "get-config" })).config).toEqual(before);
  expect(state.broadcasts.at(-1).message.config).toEqual(before);

  const valid = structuredClone(before);
  valid.notifications.enabled = true;
  expect(
    await sendMessage({ type: "update-config", config: valid }),
  ).toEqual({ success: true });
});

test("background handles install, context-menu, proxy, and unknown events", async () => {
  const { events, sendMessage, state, tab } = await installBackground();
  expect(state.contextMenus.map((menu) => menu.id)).toEqual([
    "add-to-global-whitelist",
    "remove-from-global-whitelist",
    "test-protection",
  ]);

  await events.onInstalled.listeners[0]({ reason: "install" });
  expect(state.createdTabs.at(-1).url).toBe("options/options.html");

  const clickContextMenu = events.onContextMenuClicked.listeners[0];
  await clickContextMenu({ menuItemId: "add-to-global-whitelist" }, tab);
  expect((await sendMessage({ type: "get-config" })).config.globalWhitelist).toBe(
    "*.example.com",
  );
  expect(state.reloads.at(-1).tabId).toBe(tab.id);
  await clickContextMenu({ menuItemId: "remove-from-global-whitelist" }, tab);
  expect((await sendMessage({ type: "get-config" })).config.globalWhitelist).toBe(
    "",
  );
  await clickContextMenu({ menuItemId: "test-protection" }, tab);
  expect(state.createdTabs.at(-1).url).toBe("https://browserleaks.com/");

  const notificationCount = state.notifications.length;
  events.onProxyError.listeners[0]({ fatal: true, error: "offline" });
  expect(state.notifications).toHaveLength(notificationCount);
  const config = (await sendMessage({ type: "get-config" })).config;
  config.notifications.enabled = true;
  await sendMessage({ type: "update-config", config });
  events.onProxyError.listeners[0]({ fatal: true, error: "offline" });
  expect(state.notifications.at(-1).title).toContain("Proxy Error");

  expect(await sendMessage({ type: "unknown" })).toBeUndefined();
});
