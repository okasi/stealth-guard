import { expect, test } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  buildCookieUrl,
  cookieMatchesHostname,
  createSessionManager,
  normalizeSessionHostname,
  sanitizeSessionName,
} = require("../../lib/session.js");

function createSessionHarness(options = {}) {
  let tabUrl = options.tabUrl || "https://www.example.com/account";
  const queuedTabUrls = [];
  const storageData = structuredClone(options.storageData || {});
  const state = {
    storageData,
    removed: [],
    restored: [],
    reloads: [],
    scripts: [],
    warnings: [],
  };
  const cookie = {
    name: "session",
    value: "abc",
    domain: ".example.com",
    path: "/account",
    secure: true,
    httpOnly: true,
    hostOnly: false,
    session: false,
    expirationDate: 2_000_000_000,
    sameSite: "lax",
    sameParty: true,
    storeId: "0",
    partitionKey: { topLevelSite: "https://example.com" },
  };
  const storageApi = {
    async read(keys) {
      return Object.fromEntries(
        keys
          .filter((key) => Object.hasOwn(storageData, key))
          .map((key) => [key, structuredClone(storageData[key])]),
      );
    },
    async write(items) {
      Object.assign(storageData, structuredClone(items));
    },
  };
  const tabs = {
    async get(tabId) {
      if (options.tabGetError) throw new Error("tab unavailable");
      if (queuedTabUrls.length) tabUrl = queuedTabUrls.shift();
      return { id: tabId, url: tabUrl };
    },
    async executeScript(tabId, details) {
      state.scripts.push({ tabId, code: details.code });
      if (details.code.includes("const read =")) {
        if (options.storageReadError) throw new Error("storage blocked");
        return Object.hasOwn(options, "storageSnapshot")
          ? options.storageSnapshot
          : [
              {
                localStorage: { token: "local" },
                sessionStorage: { token: "session" },
              },
            ];
      }
      if (
        options.navigateAfterClear &&
        details.code.includes("localStorage.clear()")
      ) {
        tabUrl = options.navigateAfterClear;
      }
      if (options.scriptError) throw new Error("script blocked");
      return [true];
    },
    async reload(tabId, details) {
      state.reloads.push({ tabId, details });
    },
  };
  const browserApi = { tabs };
  if (!options.noCookieApi) {
    browserApi.cookies = {
      async getAllCookieStores() {
        return options.cookieStores || [
          { id: "0", tabIds: [7] },
          { id: "other", tabIds: [99] },
        ];
      },
      async getAll(details) {
        return options.cookies || [cookie, { ...cookie, domain: "other.test" }];
      },
      async remove(details) {
        if (options.cookieRemoveError) throw new Error("remove failed");
        state.removed.push(details);
      },
      async set(details) {
        if (options.cookieSetError) throw new Error("set failed");
        state.restored.push(details);
      },
    };
  }
  const callApi = (api, method, ...args) => api[method](...args);
  const managerOptions = {
    storageApi,
    browserApi,
    callApi,
  };
  if (!options.useDefaultWarn) {
    managerOptions.warn = (...args) => state.warnings.push(args);
  }
  const manager = createSessionManager(managerOptions);
  return {
    manager,
    state,
    setTabUrl: (value) => (tabUrl = value),
    queueTabUrls: (...values) => queuedTabUrls.push(...values),
  };
}

test("normalizeSessionHostname accepts site hosts and rejects unsafe input", () => {
  const values = [
    " WWW.Example.COM ",
    "sub.example.com:8443",
    "example.com.",
    "",
    null,
    "bad host",
    "example.com/path",
    "[",
  ];

  const normalized = values.map(normalizeSessionHostname);

  expect(normalized).toEqual([
    "example.com",
    "sub.example.com",
    "example.com",
    "",
    "",
    "",
    "",
    "",
  ]);
});

test("sanitizeSessionName trims bounds and supplies a timestamped default", () => {
  const now = new Date("2026-01-02T03:04:05Z");
  const longName = "x".repeat(80);

  const trimmed = sanitizeSessionName("  Work  ", now);
  const bounded = sanitizeSessionName(longName, now);
  const fallback = sanitizeSessionName(null, now);

  expect(trimmed).toBe("Work");
  expect(bounded).toHaveLength(64);
  expect(fallback).toBe("Session " + now.toLocaleString());
});

test("buildCookieUrl normalizes cookie hosts paths and secure transport", () => {
  const secureCookie = { secure: true, domain: ".example.com", path: "account" };

  const secureUrl = buildCookieUrl(secureCookie, "fallback.test");
  const fallbackUrl = buildCookieUrl({}, "fallback.test");
  const invalid = () => buildCookieUrl({ domain: 7 }, "");

  expect(secureUrl).toBe("https://example.com/account");
  expect(fallbackUrl).toBe("http://fallback.test/");
  expect(invalid).toThrow("Invalid cookie host");
});

test("cookieMatchesHostname includes applicable cookies without collecting sibling subdomains", () => {
  const hostname = "www.example.com";
  const cookies = [
    { domain: ".example.com", hostOnly: false },
    { domain: "www.example.com", hostOnly: true },
    { domain: "login.example.com", hostOnly: true },
    { domain: "other.test", hostOnly: false },
    { domain: "", hostOnly: false },
    null,
  ];

  const matches = cookies.map((cookie) =>
    cookieMatchesHostname(cookie, hostname),
  );
  const parentDomainMatch = cookieMatchesHostname(
    { domain: ".example.com", hostOnly: false },
    "app.example.com",
  );
  const hostOnlyParentMismatch = cookieMatchesHostname(
    { domain: "example.com", hostOnly: true },
    "app.example.com",
  );
  const missingHostname = cookieMatchesHostname({ domain: "example.com" }, "");

  expect(matches).toEqual([true, true, false, false, false, false]);
  expect(parentDomainMatch).toBe(true);
  expect(hostOnlyParentMismatch).toBe(false);
  expect(missingHostname).toBe(false);
});

test("session manager runs the complete save, rename, switch, clear, and delete lifecycle", async () => {
  const { manager, state } = createSessionHarness();
  const sender = { tab: { id: 7, url: "https://www.example.com/account" } };

  const saved = await manager.saveSession({ name: " Work " }, sender);
  expect(saved).toMatchObject({
    success: true,
    session: {
      name: "Work",
      domain: "example.com",
      cookies: [{ name: "session" }],
      localStorage: { token: "local" },
      sessionStorage: { token: "session" },
    },
  });
  expect(await manager.getSessions({}, sender)).toMatchObject({
    success: true,
    activeSessionId: saved.session.id,
    sessions: [{ id: saved.session.id }],
  });

  expect(
    await manager.renameSession({ sessionId: saved.session.id, name: "Home" }),
  ).toMatchObject({ success: true, session: { name: "Home" } });
  expect(
    await manager.switchSession({ sessionId: saved.session.id, tabId: 7 }),
  ).toEqual({ success: true });
  expect(state.removed).toHaveLength(1);
  expect(state.restored[0]).toMatchObject({
    domain: ".example.com",
    sameSite: "lax",
    sameParty: true,
    expirationDate: 2_000_000_000,
    partitionKey: { topLevelSite: "https://example.com" },
  });
  expect(state.reloads).toHaveLength(1);

  expect(await manager.clearCurrentSession({ tabId: 7 })).toEqual({
    success: true,
  });
  expect(
    await manager.deleteSession({ sessionId: saved.session.id }),
  ).toEqual({ success: true });
  expect((await manager.getSessions({ hostname: "example.com" })).sessions).toEqual(
    [],
  );
});

test("session manager serializes saves and retains only the newest domain sessions", async () => {
  const { manager } = createSessionHarness({ noCookieApi: true });
  const saves = await Promise.all(
    Array.from({ length: 21 }, (_, index) =>
      manager.saveSession({
        tabId: 7,
        hostname: "example.com",
        name: `Session ${index + 1}`,
      }),
    ),
  );
  const result = await manager.getSessions({ domain: "example.com" });

  expect(saves.every((entry) => entry.success)).toBe(true);
  expect(result.sessions).toHaveLength(20);
  expect(result.sessions[0].id).toBe(saves.at(-1).session.id);
  expect(result.sessions.some((entry) => entry.name === "Session 1")).toBe(false);
  expect(result.activeSessionId).toBe(saves.at(-1).session.id);
});

test("session manager rejects invalid targets and commands without mutating state", async () => {
  const { manager, setTabUrl } = createSessionHarness();

  await expect(manager.saveSession({ tabId: 7 })).resolves.toMatchObject({
    success: true,
  });
  const sessions = await manager.getSessions({ hostname: "example.com" });
  const sessionId = sessions.sessions[0].id;
  expect(await manager.saveSession({})).toEqual({
    success: false,
    error: "Missing tab id",
  });
  expect(await manager.saveSession({ tabId: 7, hostname: "other.test" })).toEqual({
    success: false,
    error: "The target tab changed sites; reopen the popup and try again",
  });
  setTabUrl("chrome://settings/");
  expect(await manager.clearCurrentSession({ tabId: 7 })).toEqual({
    success: false,
    error: "The target tab is not an HTTP(S) site",
  });
  setTabUrl("https://other.test/");
  expect(await manager.switchSession({ sessionId, tabId: 7 })).toEqual({
    success: false,
    error: "This session belongs to a different site",
  });
  expect(await manager.switchSession({ tabId: 7 })).toEqual({
    success: false,
    error: "Missing session id",
  });
  expect(await manager.switchSession({ sessionId: "missing", tabId: 7 })).toEqual({
    success: false,
    error: "Session not found",
  });
  expect(await manager.renameSession({})).toEqual({
    success: false,
    error: "Missing session id",
  });
  expect(await manager.renameSession({ sessionId: "missing" })).toEqual({
    success: false,
    error: "Session not found",
  });
  expect(await manager.deleteSession({})).toEqual({
    success: false,
    error: "Missing session id",
  });
  expect(await manager.deleteSession({ sessionId: "missing" })).toEqual({
    success: true,
  });
  expect(await manager.getSessions({ hostname: "bad host" })).toMatchObject({
    success: false,
    error: "Missing hostname",
    sessions: [],
    activeSessionId: null,
  });
});

test("session manager fails closed across navigation races and tolerates site-data errors", async () => {
  const navigation = createSessionHarness({
    navigateAfterClear: "https://other.test/",
  });
  const saved = await navigation.manager.saveSession({
    tabId: 7,
    hostname: "example.com",
  });
  expect(
    await navigation.manager.switchSession({
      sessionId: saved.session.id,
      tabId: 7,
    }),
  ).toMatchObject({
    success: false,
    error: "The target tab changed sites; reopen the popup and try again",
  });
  expect(navigation.state.restored).toEqual([]);

  const failures = createSessionHarness({
    storageReadError: true,
    cookieRemoveError: true,
    cookieSetError: true,
    cookies: [
      {
        name: "minimal",
        value: "1",
        domain: "example.com",
        path: "/",
        secure: false,
        httpOnly: false,
        hostOnly: true,
        session: true,
        sameSite: "unspecified",
        storeId: "0",
      },
    ],
  });
  const fallback = await failures.manager.saveSession({
    tabId: 7,
    hostname: "example.com",
  });
  expect(fallback.session.localStorage).toEqual({});
  expect(
    await failures.manager.switchSession({
      sessionId: fallback.session.id,
      tabId: 7,
    }),
  ).toEqual({ success: true });
  expect(failures.state.warnings).toHaveLength(3);
});

test("session manager revalidates the tab at every mutation boundary", async () => {
  const saveRace = createSessionHarness();
  saveRace.queueTabUrls(
    "https://example.com/",
    "https://other.test/",
  );
  expect(
    await saveRace.manager.saveSession({ tabId: 7, hostname: "example.com" }),
  ).toMatchObject({
    success: false,
    error: "The target tab changed sites; reopen the popup and try again",
  });

  for (const failingGet of [0, 1, 2, 3]) {
    const race = createSessionHarness();
    const saved = await race.manager.saveSession({
      tabId: 7,
      hostname: "example.com",
    });
    const urls = Array.from({ length: 5 }, (_, index) =>
      index === failingGet ? "https://other.test/" : "https://example.com/",
    );
    race.queueTabUrls(...urls);
    const result = await race.manager.switchSession({
      sessionId: saved.session.id,
      tabId: 7,
      hostname: "example.com",
    });
    expect(result).toMatchObject({ success: false });
  }

  for (const failingGet of [0, 1, 2]) {
    const race = createSessionHarness();
    race.queueTabUrls(
      ...Array.from({ length: 3 }, (_, index) =>
        index === failingGet ? "https://other.test/" : "https://example.com/",
      ),
    );
    expect(
      await race.manager.clearCurrentSession({
        tabId: 7,
        hostname: "example.com",
      }),
    ).toMatchObject({ success: false });
  }
});

test("session manager normalizes malformed state and removes stale active entries", async () => {
  const now = Date.now();
  const sessions = Array.from({ length: 20 }, (_, index) => ({
    id: `old-${index}`,
    name: `Old ${index}`,
    domain: "example.com",
    createdAt: index ? now + index : 0,
    lastUsed: index === 0 || index % 2 ? 0 : now + index,
    cookies: [],
  }));
  const { manager, state } = createSessionHarness({
    storageData: {
      "stealth-guard-sessions": sessions,
      "stealth-guard-active-sessions": { "example.com": "old-0" },
    },
    storageSnapshot: null,
    noCookieApi: true,
  });
  const saved = await manager.saveSession({
    tabId: 7,
    hostname: "example.com",
  });
  expect(saved.session.localStorage).toEqual({});
  expect(
    state.storageData["stealth-guard-sessions"].some(
      (session) => session.id === "old-0",
    ),
  ).toBe(false);

  const activeDelete = createSessionHarness();
  const active = await activeDelete.manager.saveSession({ tabId: 7 });
  await activeDelete.manager.deleteSession({ sessionId: active.session.id });
  expect(
    activeDelete.state.storageData["stealth-guard-active-sessions"],
  ).toEqual({});

  const malformed = createSessionHarness({
    storageData: {
      "stealth-guard-sessions": {},
      "stealth-guard-active-sessions": [],
    },
  });
  expect(
    await malformed.manager.getSessions({ hostname: "example.com" }),
  ).toMatchObject({ success: true, sessions: [], activeSessionId: null });

  const timestampFallbacks = createSessionHarness({
    storageData: {
      "stealth-guard-sessions": [
        { id: "latest", domain: "example.com", lastUsed: 3, createdAt: 0 },
        { id: "created", domain: "example.com", lastUsed: 0, createdAt: 2 },
      ],
    },
  });
  expect(
    (await timestampFallbacks.manager.getSessions({ hostname: "example.com" }))
      .sessions.map((session) => session.id),
  ).toEqual(["latest", "created"]);
});

test("session manager supports browser globals and its default warning sink", async () => {
  const runtime = require("../../lib/runtime.js");
  const { getHostnameFromUrl } = require("../../lib/domainFilter.js");
  globalThis.createSerialQueue = runtime.createSerialQueue;
  globalThis.mapWithConcurrency = runtime.mapWithConcurrency;
  globalThis.getHostnameFromUrl = getHostnameFromUrl;
  try {
    const { manager } = createSessionHarness({
      useDefaultWarn: true,
      storageReadError: true,
    });
    await expect(manager.saveSession({ tabId: 7 })).resolves.toMatchObject({
      success: true,
    });
    await expect(
      manager.getSessions(
        {},
        { tab: { url: "https://www.example.com/" } },
      ),
    ).resolves.toMatchObject({ success: true });
  } finally {
    delete globalThis.createSerialQueue;
    delete globalThis.mapWithConcurrency;
    delete globalThis.getHostnameFromUrl;
  }
});

test("session manager rejects malformed tab URLs and propagates unavailable tabs", async () => {
  const malformed = createSessionHarness({ tabUrl: "https://[" });
  expect(await malformed.manager.saveSession({ tabId: 7 })).toMatchObject({
    success: false,
    error: "The target tab is not an HTTP(S) site",
  });

  const unavailable = createSessionHarness({ tabGetError: true });
  await expect(unavailable.manager.saveSession({ tabId: 7 })).rejects.toThrow(
    "tab unavailable",
  );
});
