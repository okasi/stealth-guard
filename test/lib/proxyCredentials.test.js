import { afterEach, expect, test, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { normalizeProxyProfile } = require("../../lib/proxy.js");
globalThis.normalizeProxyProfile = normalizeProxyProfile;
const {
  MAX_PROXY_AUTH_ATTEMPTS,
  PROXY_CREDENTIALS_STORAGE_KEY,
  createProxyCredentialManager,
  getProxyCredentialEndpoint,
  normalizeProxyCredentialStore,
  normalizeProxyCredentialText,
  normalizeStoredProxyCredential,
} = require("../../lib/proxyCredentials.js");

function createStorage(initial = {}) {
  const data = {
    [PROXY_CREDENTIALS_STORAGE_KEY]: structuredClone(initial),
  };
  return {
    data,
    read: vi.fn(async () => structuredClone(data)),
    write: vi.fn(async (items) => Object.assign(data, structuredClone(items))),
  };
}

const mainProfile = {
  name: "Main",
  scheme: "https",
  host: "Proxy.Test",
  port: 8443,
};

afterEach(() => {
  vi.restoreAllMocks();
});

test("credential helpers normalize only bounded endpoint records", () => {
  expect(normalizeProxyCredentialText(null, 3)).toBe("");
  expect(normalizeProxyCredentialText("abcdef", 3)).toBe("abc");
  expect(getProxyCredentialEndpoint(mainProfile)).toBe("proxy.test:8443");
  expect(getProxyCredentialEndpoint({ host: "bad host" })).toBeNull();
  expect(normalizeStoredProxyCredential(null)).toBeNull();
  expect(normalizeStoredProxyCredential([])).toBeNull();
  expect(normalizeStoredProxyCredential({ username: "" })).toBeNull();
  expect(
    normalizeStoredProxyCredential({ username: "alice", password: 7 }),
  ).toEqual({ username: "alice", password: "" });
  expect(normalizeProxyCredentialStore(null)).toEqual({});
  expect(normalizeProxyCredentialStore([])).toEqual({});
  expect(
    normalizeProxyCredentialStore({
      "PROXY.TEST:8443": { username: "alice", password: "secret" },
      "bad endpoint": { username: "ignored", password: "ignored" },
      "empty.test:80": { username: "" },
    }),
  ).toEqual({
    "proxy.test:8443": { username: "alice", password: "secret" },
  });
});

test("credential manager separates persistent and session secrets", async () => {
  const storage = createStorage({
    "proxy.test:8443": { username: "alice", password: "saved" },
  });
  let config = null;
  const manager = createProxyCredentialManager({
    storageApi: storage,
    getConfig: () => config,
  });
  await manager.initialize();

  expect(manager.getStatus(mainProfile)).toEqual({
    endpoint: "proxy.test:8443",
    configured: true,
    username: "alice",
    persisted: true,
  });
  expect(manager.getStatus({ host: "bad host" })).toEqual({
    endpoint: null,
    configured: false,
    username: "",
    persisted: false,
  });
  await manager.removeCredential(mainProfile);
  expect(manager.getStatus(mainProfile).configured).toBe(false);
  await manager.setCredential(mainProfile, {
    username: "alice",
    password: "saved",
  });
  await expect(manager.setCredential(null, {})).rejects.toThrow(
    "Invalid proxy profile",
  );
  await expect(
    manager.setCredential(mainProfile, { username: "" }),
  ).rejects.toThrow("username is required");

  const movedProfile = {
    ...mainProfile,
    host: "new.proxy.test",
  };
  await manager.setCredential(movedProfile, {
    username: "alice-2",
    password: "",
    keepPassword: true,
    sourceProfile: mainProfile,
  });
  config = {
    enabled: true,
    proxy: {
      enabled: true,
      activeProfile: "Moved",
      profiles: [{ ...movedProfile, name: "Moved" }],
      domainRoutes: [],
    },
  };
  expect(
    manager.handleAuthRequired({
      isProxy: true,
      requestId: "moved",
      challenger: { host: "new.proxy.test", port: 8443 },
    }),
  ).toEqual({
    authCredentials: { username: "alice-2", password: "saved" },
  });

  await manager.setCredential(movedProfile, {
    username: "session",
    password: "temporary",
    persist: false,
  });
  expect(manager.getStatus(movedProfile)).toMatchObject({
    configured: true,
    username: "session",
    persisted: false,
  });
  const writesAfterPersistentRemoval = storage.write.mock.calls.length;
  await manager.setCredential(movedProfile, {
    username: "session-2",
    password: "temporary-2",
    persist: false,
  });
  expect(storage.write).toHaveBeenCalledTimes(writesAfterPersistentRemoval);

  await expect(manager.removeCredential(null)).rejects.toThrow(
    "Invalid proxy profile",
  );
  await manager.removeCredential(movedProfile);
  expect(manager.getStatus(movedProfile).configured).toBe(false);

  await manager.setCredential(mainProfile, {
    username: "persisted",
    password: "secret",
  });
  await manager.setCredential(movedProfile, {
    username: "session",
    password: "secret",
    persist: false,
  });
  await manager.prune([movedProfile]);
  expect(manager.getStatus(mainProfile).configured).toBe(false);
  expect(manager.getStatus(movedProfile).configured).toBe(true);
  const writesAfterPrune = storage.write.mock.calls.length;
  await manager.prune([movedProfile]);
  expect(storage.write).toHaveBeenCalledTimes(writesAfterPrune);

  await manager.prune();
  expect(manager.getStatus(movedProfile).configured).toBe(false);
  await manager.setCredential(movedProfile, {
    username: "persisted-moved",
    password: "secret",
  });
  const writesBeforeAllowedPrune = storage.write.mock.calls.length;
  await manager.prune([movedProfile]);
  expect(storage.write).toHaveBeenCalledTimes(writesBeforeAllowedPrune);

  await manager.clearAll();
  expect(manager.getStatus(movedProfile).configured).toBe(false);
  expect(storage.data[PROXY_CREDENTIALS_STORAGE_KEY]).toEqual({});
});

test("auth handler answers only bounded active proxy challenges", async () => {
  const storage = createStorage();
  let config = null;
  const manager = createProxyCredentialManager({
    storageApi: storage,
    getConfig: () => config,
  });
  await manager.initialize();
  await manager.setCredential(mainProfile, {
    username: "alice",
    password: "secret",
    persist: false,
  });

  expect(manager.handleAuthRequired(null)).toEqual({});
  expect(manager.handleAuthRequired({ isProxy: false })).toEqual({});
  expect(
    manager.handleAuthRequired({
      isProxy: true,
      requestId: "disabled",
      challenger: { host: "proxy.test", port: 8443 },
    }),
  ).toEqual({ cancel: true });

  config = { enabled: false, proxy: { enabled: true } };
  expect(
    manager.handleAuthRequired({
      isProxy: true,
      requestId: "global-disabled",
      challenger: { host: "proxy.test", port: 8443 },
    }),
  ).toEqual({ cancel: true });

  config = {
    enabled: true,
    proxy: {
      enabled: true,
      activeProfile: null,
      fallbackProfiles: ["Main"],
      profiles: [mainProfile],
      domainRoutes: [{ pattern: "example.test", profile: "Main" }],
    },
  };
  expect(
    manager.handleAuthRequired({
      isProxy: true,
      requestId: "route",
      challenger: { host: "proxy.test", port: 8443 },
    }),
  ).toEqual({
    authCredentials: { username: "alice", password: "secret" },
  });
  expect(
    manager.handleAuthRequired({
      isProxy: true,
      challenger: { host: "proxy.test", port: 8443 },
    }),
  ).toEqual({ cancel: true });

  const repeated = {
    isProxy: true,
    requestId: "repeated",
    challenger: { host: "proxy.test", port: 8443 },
  };
  for (let attempt = 0; attempt < MAX_PROXY_AUTH_ATTEMPTS; attempt++) {
    expect(manager.handleAuthRequired(repeated).authCredentials).toBeTruthy();
  }
  expect(manager.handleAuthRequired(repeated)).toEqual({ cancel: true });
  manager.clearRequest({});
  manager.clearRequest(null);
  manager.clearRequest({ requestId: "repeated" });
  expect(manager.handleAuthRequired(repeated).authCredentials).toBeTruthy();

  await manager.removeCredential(mainProfile);
  expect(
    manager.handleAuthRequired({ ...repeated, requestId: "missing-secret" }),
  ).toEqual({ cancel: true });
});
