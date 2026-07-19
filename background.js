let currentConfig = null;
let currentDomainFilter = null;
let initializationPromise = null;
const lastNotificationTime = new Map();
const triggeredFeaturesPerTab = new Map();
let lastAppliedWebRTCPolicy = null;
let webRTCPolicyQueue = Promise.resolve();
let configMutationQueue = Promise.resolve();

const NOTIFICATION_THROTTLE_MS = 3770;
const SESSION_STORAGE_KEY = "stealth-guard-sessions";
const ACTIVE_SESSIONS_STORAGE_KEY = "stealth-guard-active-sessions";
const MAX_SAVED_SESSIONS_PER_DOMAIN = 20;
const REPORTED_FEATURES = new Set([
  ...PROTECTION_FEATURES.filter((feature) => feature !== "useragent"),
  "user-agent",
]);

const debugLog = function (...args) {
  if (
    currentConfig &&
    currentConfig.notifications &&
    currentConfig.notifications.enabled
  ) {
    console.log(...args);
  }
};

const debugWarn = function (...args) {
  if (
    currentConfig &&
    currentConfig.notifications &&
    currentConfig.notifications.enabled
  ) {
    console.warn(...args);
  }
};

const debugError = function (...args) {
  console.error(...args);
};

function getHostnameFromUrl(url) {
  try {
    return normalizeHostname(new URL(url).hostname);
  } catch (error) {
    return null;
  }
}

function resolveTabHostname(sender, fallbackHostname = null) {
  if (sender && sender.tab && sender.tab.url) {
    const tabHostname = getHostnameFromUrl(sender.tab.url);
    if (tabHostname) {
      return tabHostname;
    }
  }
  return fallbackHostname;
}

function setCurrentConfig(config) {
  currentConfig = config;
  currentDomainFilter = config ? new DomainFilter(config) : null;
}

function getDomainFilter(config = currentConfig) {
  if (!config) {
    return null;
  }

  if (!currentDomainFilter || currentDomainFilter.config !== config) {
    currentDomainFilter = new DomainFilter(config);
  }

  return currentDomainFilter;
}

function isHostnameOnGlobalAllowlist(hostname, config = currentConfig) {
  if (!hostname || !config) {
    return false;
  }

  const filter = getDomainFilter(config);
  return filter
    ? filter.isAllowlisted(hostname, config.globalWhitelist || "")
    : false;
}

function isHostnameOnFeatureAllowlist(
  hostname,
  whitelist,
  config = currentConfig,
) {
  if (!hostname || !whitelist || !config) {
    return false;
  }

  const filter = getDomainFilter(config);
  return filter ? filter.isAllowlisted(hostname, whitelist) : false;
}

function isCloudflareChallengeHostname(hostname) {
  return (
    hostname === "challenges.cloudflare.com" ||
    hostname.endsWith(".challenges.cloudflare.com")
  );
}

async function ensureBackgroundInitialized() {
  if (currentConfig) {
    return;
  }

  try {
    await initializationPromise;
  } catch (error) {
    debugError("[Background] Initial initialization failed:", error);
  }

  if (!currentConfig) {
    setCurrentConfig(await loadConfig());
  }
}

function markTriggeredFeatureForTab(tabId, hostname, feature) {
  if (typeof tabId !== "number") {
    return;
  }

  const current = triggeredFeaturesPerTab.get(tabId);
  if (!current || current.hostname !== hostname) {
    triggeredFeaturesPerTab.set(tabId, { hostname, features: new Set() });
  }

  triggeredFeaturesPerTab.get(tabId).features.add(feature);
}

function queryTabs(queryInfo) {
  return new Promise((resolve) => {
    chrome.tabs.query(queryInfo, (tabs) => {
      if (chrome.runtime.lastError) {
        debugWarn(
          "[Background] Failed to query tabs for broadcast:",
          chrome.runtime.lastError.message,
        );
        resolve([]);
        return;
      }
      resolve(tabs || []);
    });
  });
}

function sendMessageToTabIgnoringErrors(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, () => {
      // Read runtime.lastError to suppress "Unchecked runtime.lastError" noise.
      // These two failures are expected during tab broadcasts:
      // 1) Tab has no content script, 2) Receiver doesn't send a response.
      const error = chrome.runtime.lastError;
      if (error) {
        const msg = error.message || "";
        const expected =
          msg.includes(
            "Could not establish connection. Receiving end does not exist.",
          ) ||
          msg.includes(
            "The message port closed before a response was received.",
          );
        if (!expected) {
          debugWarn(
            "[Background] tabs.sendMessage warning for tab",
            tabId + ":",
            msg,
          );
        }
      }
      resolve();
    });
  });
}

function callChromeApi(method, ...args) {
  return new Promise((resolve, reject) => {
    method(...args, (result) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message || String(error)));
        return;
      }
      resolve(result);
    });
  });
}

async function broadcastConfigUpdated(config) {
  const tabs = await queryTabs({ url: ["http://*/*", "https://*/*"] });
  await Promise.all(
    tabs
      .filter((tab) => typeof tab.id === "number")
      .map((tab) =>
        sendMessageToTabIgnoringErrors(tab.id, {
          type: "config-updated",
          config,
        }),
      ),
  );
}

function resolveSessionHostname(request, sender) {
  const explicitHostname = normalizeSessionHostname(
    request && (request.hostname || request.domain),
  );
  if (explicitHostname) {
    return explicitHostname;
  }

  return normalizeSessionHostname(resolveTabHostname(sender));
}

function createSessionId() {
  return (
    "session-" +
    Date.now().toString(36) +
    "-" +
    Math.random().toString(36).slice(2, 8)
  );
}

async function readSessionState() {
  const stored = await storage.read([
    SESSION_STORAGE_KEY,
    ACTIVE_SESSIONS_STORAGE_KEY,
  ]);
  const sessions = Array.isArray(stored[SESSION_STORAGE_KEY])
    ? stored[SESSION_STORAGE_KEY]
    : [];
  const activeSessions =
    stored[ACTIVE_SESSIONS_STORAGE_KEY] &&
    typeof stored[ACTIVE_SESSIONS_STORAGE_KEY] === "object" &&
    !Array.isArray(stored[ACTIVE_SESSIONS_STORAGE_KEY])
      ? stored[ACTIVE_SESSIONS_STORAGE_KEY]
      : {};

  return { sessions, activeSessions };
}

async function writeSessionState(sessions, activeSessions) {
  await storage.write({
    [SESSION_STORAGE_KEY]: sessions,
    [ACTIVE_SESSIONS_STORAGE_KEY]: activeSessions,
  });
}

function cookiesGetAllCookieStores() {
  return callChromeApi(chrome.cookies.getAllCookieStores).then(
    (stores) => stores || [],
  );
}

function cookiesGetAll(details) {
  return callChromeApi(chrome.cookies.getAll, details).then(
    (cookies) => cookies || [],
  );
}

function cookiesRemove(details) {
  return callChromeApi(chrome.cookies.remove, details);
}

function cookiesSet(details) {
  return callChromeApi(chrome.cookies.set, details);
}

function maybeCopyCookiePartitionKey(targetDetails, cookie) {
  if (!cookie || !cookie.partitionKey) {
    return;
  }

  // Preserve partitioned cookie identity when the browser exposes it.
  // Without this, restored auth cookies may become non-partitioned and invalid.
  targetDetails.partitionKey = cookie.partitionKey;
}

async function getCookiesForHostname(hostname, tabId) {
  if (!chrome.cookies || !chrome.cookies.getAllCookieStores) {
    return [];
  }

  const stores = await cookiesGetAllCookieStores();
  const tabStores = stores.filter((store) => {
    return Array.isArray(store.tabIds) && store.tabIds.includes(tabId);
  });
  const allCookies = [];

  for (const store of tabStores) {
    const storeCookies = await cookiesGetAll({ storeId: store.id });
    const matchingCookies = storeCookies.filter((cookie) =>
      cookieMatchesHostname(cookie, hostname),
    );
    allCookies.push(...matchingCookies);
  }

  return allCookies;
}

async function clearCookiesForHostname(hostname, tabId) {
  const cookies = await getCookiesForHostname(hostname, tabId);
  const removeOperations = cookies.map(async (cookie) => {
    try {
      const removeDetails = {
        url: buildCookieUrl(cookie, hostname),
        name: cookie.name,
        storeId: cookie.storeId,
      };

      maybeCopyCookiePartitionKey(removeDetails, cookie);
      await cookiesRemove(removeDetails);
    } catch (error) {
      debugWarn("[Session] Failed to remove cookie:", cookie.name, error);
    }
  });

  await Promise.all(removeOperations);
}

async function restoreCookies(cookies, fallbackHostname) {
  if (!Array.isArray(cookies) || cookies.length === 0) {
    return;
  }

  const restoreOperations = cookies.map(async (cookie) => {
    try {
      const details = {
        url: buildCookieUrl(cookie, fallbackHostname),
        name: cookie.name,
        value: cookie.value,
        path: cookie.path,
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        storeId: cookie.storeId,
      };

      if (cookie.domain && cookie.domain.startsWith(".")) {
        details.domain = cookie.domain;
      }

      if (!cookie.session && typeof cookie.expirationDate === "number") {
        details.expirationDate = cookie.expirationDate;
      }

      if (cookie.sameSite && cookie.sameSite !== "unspecified") {
        details.sameSite = cookie.sameSite;
      }

      if (typeof cookie.sameParty === "boolean") {
        details.sameParty = cookie.sameParty;
      }

      maybeCopyCookiePartitionKey(details, cookie);

      await cookiesSet(details);
    } catch (error) {
      debugWarn(
        "[Session] Failed to restore cookie:",
        cookie && cookie.name,
        error,
      );
    }
  });

  await Promise.all(restoreOperations);
}

function executeScriptInTab(tabId, code, runAt = "document_idle") {
  return callChromeApi(chrome.tabs.executeScript, tabId, { code, runAt });
}

function getTabById(tabId) {
  return callChromeApi(chrome.tabs.get, tabId).then((tab) => tab || null);
}

async function resolveVerifiedSessionTarget(request, sender) {
  const tabId = resolveSessionTabId(request, sender);
  if (typeof tabId !== "number") {
    return { error: "Missing tab id" };
  }

  const tab = await getTabById(tabId);
  let tabUrl = null;
  try {
    tabUrl = tab && tab.url ? new URL(tab.url) : null;
  } catch (error) {
    tabUrl = null;
  }
  const isHttpSite =
    tabUrl && (tabUrl.protocol === "http:" || tabUrl.protocol === "https:");
  const hostname = normalizeSessionHostname(isHttpSite ? tabUrl.hostname : "");
  if (!hostname) {
    return { error: "The target tab is not an HTTP(S) site" };
  }

  const requestedHostname = normalizeSessionHostname(
    request && (request.hostname || request.domain),
  );
  if (requestedHostname && requestedHostname !== hostname) {
    return {
      error: "The target tab changed sites; reopen the popup and try again",
    };
  }

  return { tabId, hostname };
}

async function readTabStorageSnapshot(tabId) {
  const script = `
    (() => {
      const snapshot = { localStorage: {}, sessionStorage: {} };

      try {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key !== null) {
            snapshot.localStorage[key] = localStorage.getItem(key);
          }
        }
      } catch (error) {}

      try {
        for (let i = 0; i < sessionStorage.length; i++) {
          const key = sessionStorage.key(i);
          if (key !== null) {
            snapshot.sessionStorage[key] = sessionStorage.getItem(key);
          }
        }
      } catch (error) {}

      return snapshot;
    })();
  `;

  try {
    const results = await executeScriptInTab(tabId, script);
    return (results && results[0]) || { localStorage: {}, sessionStorage: {} };
  } catch (error) {
    debugWarn("[Session] Failed to read storage snapshot:", error);
    return { localStorage: {}, sessionStorage: {} };
  }
}

async function clearTabStorage(tabId) {
  const script = `
    (() => {
      try { localStorage.clear(); } catch (error) {}
      try { sessionStorage.clear(); } catch (error) {}
      return true;
    })();
  `;

  await executeScriptInTab(tabId, script);
}

async function restoreTabStorage(tabId, storageSnapshot) {
  const payload = JSON.stringify({
    localStorage:
      storageSnapshot && storageSnapshot.localStorage
        ? storageSnapshot.localStorage
        : {},
    sessionStorage:
      storageSnapshot && storageSnapshot.sessionStorage
        ? storageSnapshot.sessionStorage
        : {},
  });

  const script = `
    ((snapshot) => {
      try {
        localStorage.clear();
        Object.keys(snapshot.localStorage || {}).forEach((key) => {
          const value = snapshot.localStorage[key];
          localStorage.setItem(key, value === null || value === undefined ? "" : String(value));
        });
      } catch (error) {}

      try {
        sessionStorage.clear();
        Object.keys(snapshot.sessionStorage || {}).forEach((key) => {
          const value = snapshot.sessionStorage[key];
          sessionStorage.setItem(key, value === null || value === undefined ? "" : String(value));
        });
      } catch (error) {}

      return true;
    })(${payload});
  `;

  await executeScriptInTab(tabId, script);
}

function reloadTab(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.reload(tabId, { bypassCache: true }, () => {
      if (chrome.runtime.lastError) {
        debugWarn(
          "[Background] Failed to reload tab:",
          chrome.runtime.lastError.message,
        );
      }
      resolve();
    });
  });
}

function sortSessionsForHostname(sessions, hostname) {
  return sessions
    .filter((session) => session.domain === hostname)
    .sort(
      (a, b) =>
        (b.lastUsed || b.createdAt || 0) - (a.lastUsed || a.createdAt || 0),
    );
}

function cleanupSessionLimits(sessions, activeSessions, hostname) {
  const domainSessions = sortSessionsForHostname(sessions, hostname);
  if (domainSessions.length <= MAX_SAVED_SESSIONS_PER_DOMAIN) {
    return sessions;
  }

  const keepIds = new Set(
    domainSessions
      .slice(0, MAX_SAVED_SESSIONS_PER_DOMAIN)
      .map((session) => session.id),
  );
  const nextSessions = sessions.filter(
    (session) => session.domain !== hostname || keepIds.has(session.id),
  );

  if (activeSessions[hostname] && !keepIds.has(activeSessions[hostname])) {
    delete activeSessions[hostname];
  }

  return nextSessions;
}

async function applyCurrentConfig(config) {
  setCurrentConfig(config);
  await applyUserAgentSpoofing(config);
  await applyWebRTCPolicy(config);
  await applyProxySettings(config);
}

async function initializeBackground() {
  await applyCurrentConfig(await loadConfig());
  setupContextMenus();
  debugLog("Stealth Guard initialized");
}

initializationPromise = initializeBackground().catch((error) => {
  debugError("Failed to initialize Stealth Guard:", error);
  throw error;
});

chrome.runtime.onInstalled.addListener(async (details) => {
  try {
    await ensureBackgroundInitialized();
    setupContextMenus();
    if (details.reason === "install") {
      chrome.tabs.create({ url: "options/options.html" });
    }
  } catch (error) {
    debugError("Failed to finish install handling:", error);
  }
});

// HTTP User-Agent header modification using MV2 blocking webRequest.
let uaListener = null;

async function applyUserAgentSpoofing(configOverride) {
  try {
    const config = configOverride || (await getConfig());

    if (uaListener) {
      chrome.webRequest.onBeforeSendHeaders.removeListener(uaListener);
      uaListener = null;
    }

    if (
      config.enabled === false ||
      !config.useragent ||
      !config.useragent.enabled
    ) {
      debugLog("User-Agent spoofing disabled");
      return;
    }

    const preset = config.useragent.preset || "macos";
    const userAgent = getUserAgentString(preset);

    if (!userAgent) {
      throw new Error(`Invalid User-Agent preset: ${preset}`);
    }

    uaListener = function (details) {
      let hostname = null;
      try {
        hostname = new URL(details.url).hostname;
      } catch (e) {
        return { requestHeaders: details.requestHeaders };
      }

      if (isCloudflareChallengeHostname(hostname)) {
        debugLog(
          "[UA Listener] BYPASS: Cloudflare challenge domain:",
          hostname,
        );
        return { requestHeaders: details.requestHeaders };
      }

      if (
        isHostnameOnGlobalAllowlist(hostname, config) ||
        isHostnameOnFeatureAllowlist(
          hostname,
          config.useragent.whitelist || "",
          config,
        )
      ) {
        debugLog("[UA Listener] BYPASS: allowlisted domain:", hostname);
        return { requestHeaders: details.requestHeaders };
      }

      let uaHeaderFound = false;
      for (let i = 0; i < details.requestHeaders.length; ++i) {
        if (details.requestHeaders[i].name.toLowerCase() === "user-agent") {
          details.requestHeaders[i].value = userAgent;
          uaHeaderFound = true;
          break;
        }
      }

      if (!uaHeaderFound) {
        details.requestHeaders.push({
          name: "User-Agent",
          value: userAgent,
        });
      }

      return { requestHeaders: details.requestHeaders };
    };

    chrome.webRequest.onBeforeSendHeaders.addListener(
      uaListener,
      { urls: ["<all_urls>"] },
      ["blocking", "requestHeaders", "extraHeaders"],
    );

    debugLog(
      "User-Agent spoofing enabled (webRequest):",
      preset,
      "->",
      userAgent,
    );
  } catch (error) {
    debugError("Failed to apply User-Agent spoofing:", error);
    throw error;
  }
}

async function applyWebRTCPolicyValue(policy) {
  const previousOperation = webRTCPolicyQueue.catch(() => {});
  const operation = previousOperation.then(async () => {
    if (lastAppliedWebRTCPolicy === policy) {
      return;
    }

    await setWebRTCPolicySetting(policy);
    let effectiveSetting = await getWebRTCPolicySetting();
    if (effectiveSetting.value !== policy) {
      await setWebRTCPolicySetting(policy);
      effectiveSetting = await getWebRTCPolicySetting();
    }
    if (effectiveSetting.value !== policy) {
      throw new Error(
        `WebRTC policy not applied. Expected "${policy}", got "${effectiveSetting.value}"`,
      );
    }
    if (
      effectiveSetting.levelOfControl === "not_controllable" ||
      effectiveSetting.levelOfControl === "controlled_by_other_extensions"
    ) {
      throw new Error(`WebRTC policy is ${effectiveSetting.levelOfControl}`);
    }
    lastAppliedWebRTCPolicy = policy;
  });

  webRTCPolicyQueue = operation;
  return operation;
}

function setWebRTCPolicySetting(policy) {
  return new Promise((resolve, reject) => {
    chrome.privacy.network.webRTCIPHandlingPolicy.set({ value: policy }, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message || String(error)));
        return;
      }
      resolve();
    });
  });
}

function getWebRTCPolicySetting() {
  return callChromeApi(
    chrome.privacy.network.webRTCIPHandlingPolicy.get,
    {},
  ).then((details) => details || {});
}

async function applyWebRTCPolicy(configOverride) {
  try {
    const config = configOverride || (await getConfig());
    const policy =
      config.enabled !== false && config.webrtc.enabled
        ? config.webrtc.policy
        : "default";
    await applyWebRTCPolicyValue(policy);
    debugLog("[WebRTC] Base policy applied:", policy);
  } catch (error) {
    debugError("Failed to apply WebRTC policy:", error);
    throw error;
  }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    const newHostname = getHostnameFromUrl(changeInfo.url);
    const tabData = triggeredFeaturesPerTab.get(tabId);
    if (!newHostname || (tabData && tabData.hostname !== newHostname)) {
      triggeredFeaturesPerTab.delete(tabId);
    }
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  triggeredFeaturesPerTab.delete(tabId);
});

function handleFingerprintDetectedMessage(request, sender) {
  if (!request || !REPORTED_FEATURES.has(request.feature)) {
    return { success: false, error: "Invalid fingerprint feature" };
  }

  const hostname = resolveTabHostname(sender, request.hostname);
  if (!hostname) {
    return { success: false, error: "Missing hostname" };
  }
  debugLog(
    "[Background] Fingerprint detected:",
    request.feature,
    "on",
    hostname,
  );

  if (sender.tab && typeof sender.tab.id === "number") {
    markTriggeredFeatureForTab(sender.tab.id, hostname, request.feature);
  }

  handleFingerprintDetection(request.feature, hostname).catch((error) => {
    debugError("[Background] Failed to process fingerprint detection:", error);
  });

  return { success: true };
}

async function handleGetConfigMessage() {
  try {
    debugLog(
      "Getting config, current:",
      currentConfig ? "loaded" : "not loaded",
    );
    const config = await getConfig();
    debugLog("Sending config response:", config ? "success" : "null");
    return { config };
  } catch (error) {
    debugError("Error getting config:", error);
    return { config: null, error: error.message };
  }
}

function serializeConfigValue(value) {
  try {
    return JSON.stringify(value);
  } catch (error) {
    return String(value);
  }
}

function didConfigSectionChange(previousConfig, nextConfig, key) {
  return (
    serializeConfigValue(previousConfig ? previousConfig[key] : undefined) !==
    serializeConfigValue(nextConfig ? nextConfig[key] : undefined)
  );
}

function getConfigChangeFlags(previousConfig, nextConfig) {
  const globalEnabledChanged = didConfigSectionChange(
    previousConfig,
    nextConfig,
    "enabled",
  );
  const globalWhitelistChanged = didConfigSectionChange(
    previousConfig,
    nextConfig,
    "globalWhitelist",
  );

  return {
    userAgentChanged:
      didConfigSectionChange(previousConfig, nextConfig, "useragent") ||
      globalWhitelistChanged ||
      globalEnabledChanged,
    webrtcChanged:
      didConfigSectionChange(previousConfig, nextConfig, "webrtc") ||
      globalEnabledChanged,
    proxyChanged:
      didConfigSectionChange(previousConfig, nextConfig, "proxy") ||
      globalWhitelistChanged ||
      globalEnabledChanged,
  };
}

async function applyConfigChanges(changeFlags) {
  if (changeFlags.userAgentChanged) {
    await applyUserAgentSpoofing(currentConfig);
  }

  if (changeFlags.webrtcChanged) {
    await applyWebRTCPolicy(currentConfig);
  }

  if (changeFlags.proxyChanged) {
    await applyProxySettings(currentConfig);
  }
}

async function saveConfigWithRollback(previousConfig, nextConfig) {
  const changeFlags = getConfigChangeFlags(previousConfig, nextConfig);

  await saveConfig(nextConfig);
  setCurrentConfig(nextConfig);

  try {
    await applyConfigChanges(changeFlags);
  } catch (error) {
    await saveConfig(previousConfig);
    setCurrentConfig(previousConfig);

    try {
      await applyConfigChanges(changeFlags);
      await broadcastConfigUpdated(previousConfig);
    } catch (rollbackError) {
      debugError(
        "[Background] Failed to roll back config after apply failure:",
        rollbackError,
      );
    }

    throw error;
  }

  await broadcastConfigUpdated(nextConfig);
}

function enqueueConfigMutation(operation) {
  const queuedOperation = configMutationQueue.then(operation, operation);
  configMutationQueue = queuedOperation.catch(() => {});
  return queuedOperation;
}

async function handleUpdateConfigMessage(request) {
  return enqueueConfigMutation(async () => {
    if (
      !request ||
      !request.config ||
      typeof request.config !== "object" ||
      Array.isArray(request.config)
    ) {
      throw new Error("Invalid configuration payload");
    }

    const previousConfig = cloneConfig(await getConfig());
    const nextConfig = normalizeConfig(request.config);
    const configChanged =
      serializeConfigValue(previousConfig) !== serializeConfigValue(nextConfig);

    if (!configChanged) {
      return { success: true };
    }

    await saveConfigWithRollback(previousConfig, nextConfig);

    return { success: true };
  });
}

async function updateGlobalWhitelist(request, mutator) {
  return enqueueConfigMutation(async () => {
    const previousConfig = cloneConfig(await getConfig());
    const nextConfig = cloneConfig(previousConfig);
    const filter = new DomainFilter(nextConfig);
    const domain = normalizeDomainPattern(request && request.domain);
    if (!domain || domain.includes("*")) {
      throw new Error("Invalid domain");
    }

    nextConfig.globalWhitelist = mutator(
      filter,
      domain,
      nextConfig.globalWhitelist,
    );
    const changed =
      serializeConfigValue(previousConfig) !== serializeConfigValue(nextConfig);

    if (changed) {
      await saveConfigWithRollback(previousConfig, nextConfig);
    }

    return { success: true, whitelist: nextConfig.globalWhitelist, changed };
  });
}

async function handleAddToWhitelistMessage(request) {
  return updateGlobalWhitelist(request, (filter, domain, whitelist) => {
    return filter.addDomainToAllowlist(domain, whitelist);
  });
}

async function handleRemoveFromWhitelistMessage(request) {
  return updateGlobalWhitelist(request, (filter, domain, whitelist) => {
    return filter.removeDomainFromAllowlist(domain, whitelist);
  });
}

async function handleResetConfigMessage() {
  return enqueueConfigMutation(async () => {
    const previousConfig = cloneConfig(await getConfig());
    const nextConfig = cloneConfig(DEFAULT_CONFIG);

    if (
      serializeConfigValue(previousConfig) !== serializeConfigValue(nextConfig)
    ) {
      await saveConfigWithRollback(previousConfig, nextConfig);
    }

    return { success: true };
  });
}

function handleGetTriggeredFeaturesMessage(request) {
  const tabData = triggeredFeaturesPerTab.get(request.tabId);
  return {
    features: tabData && tabData.features ? Array.from(tabData.features) : [],
  };
}

async function handlePrepareProxyProfileMessage(request) {
  return {
    success: true,
    profile: await prepareProxyProfile(request && request.profile),
  };
}

function resolveSessionTabId(request, sender) {
  if (sender && sender.tab && typeof sender.tab.id === "number") {
    return sender.tab.id;
  }

  if (request && typeof request.tabId === "number") {
    return request.tabId;
  }

  return null;
}

async function handleGetSessionsMessage(request, sender) {
  const hostname = resolveSessionHostname(request, sender);
  if (!hostname) {
    return {
      success: false,
      error: "Missing hostname",
      sessions: [],
      activeSessionId: null,
    };
  }

  const { sessions, activeSessions } = await readSessionState();
  return {
    success: true,
    sessions: sortSessionsForHostname(sessions, hostname),
    activeSessionId: activeSessions[hostname] || null,
  };
}

async function handleSaveSessionMessage(request, sender) {
  const target = await resolveVerifiedSessionTarget(request, sender);
  if (target.error) {
    return { success: false, error: target.error };
  }
  const { hostname, tabId } = target;

  const [cookies, storageSnapshot] = await Promise.all([
    getCookiesForHostname(hostname, tabId),
    readTabStorageSnapshot(tabId),
  ]);

  const { sessions, activeSessions } = await readSessionState();
  const now = Date.now();

  const session = {
    id: createSessionId(),
    name: sanitizeSessionName(request && request.name),
    domain: hostname,
    createdAt: now,
    lastUsed: now,
    cookies,
    localStorage: storageSnapshot.localStorage || {},
    sessionStorage: storageSnapshot.sessionStorage || {},
  };

  const nextSessions = cleanupSessionLimits(
    [...sessions, session],
    activeSessions,
    hostname,
  );
  activeSessions[hostname] = session.id;
  await writeSessionState(nextSessions, activeSessions);

  return { success: true, session };
}

async function handleSwitchSessionMessage(request, sender) {
  const sessionId = request && request.sessionId;

  if (!sessionId) {
    return { success: false, error: "Missing session id" };
  }

  const { sessions, activeSessions } = await readSessionState();
  const session = sessions.find((entry) => entry.id === sessionId);
  if (!session) {
    return { success: false, error: "Session not found" };
  }

  const target = await resolveVerifiedSessionTarget(request, sender);
  if (target.error) {
    return { success: false, error: target.error };
  }
  if (target.hostname !== session.domain) {
    return {
      success: false,
      error: "This session belongs to a different site",
    };
  }
  const { tabId } = target;

  await Promise.all([
    clearCookiesForHostname(session.domain, tabId),
    clearTabStorage(tabId),
  ]);

  await Promise.all([
    restoreCookies(session.cookies, session.domain),
    restoreTabStorage(tabId, {
      localStorage: session.localStorage || {},
      sessionStorage: session.sessionStorage || {},
    }),
  ]);

  session.lastUsed = Date.now();
  activeSessions[session.domain] = session.id;

  await writeSessionState(sessions, activeSessions);
  await reloadTab(tabId);

  return { success: true };
}

async function handleDeleteSessionMessage(request) {
  const sessionId = request && request.sessionId;
  if (!sessionId) {
    return { success: false, error: "Missing session id" };
  }

  const { sessions, activeSessions } = await readSessionState();
  const targetSession = sessions.find((entry) => entry.id === sessionId);

  const nextSessions = sessions.filter((entry) => entry.id !== sessionId);
  if (targetSession && activeSessions[targetSession.domain] === sessionId) {
    delete activeSessions[targetSession.domain];
  }

  await writeSessionState(nextSessions, activeSessions);
  return { success: true };
}

async function handleRenameSessionMessage(request) {
  const sessionId = request && request.sessionId;
  if (!sessionId) {
    return { success: false, error: "Missing session id" };
  }

  const { sessions, activeSessions } = await readSessionState();
  const session = sessions.find((entry) => entry.id === sessionId);
  if (!session) {
    return { success: false, error: "Session not found" };
  }

  session.name = sanitizeSessionName(request && request.name);
  await writeSessionState(sessions, activeSessions);
  return { success: true, session };
}

async function handleClearCurrentSessionMessage(request, sender) {
  const target = await resolveVerifiedSessionTarget(request, sender);
  if (target.error) {
    return { success: false, error: target.error };
  }
  const { hostname, tabId } = target;

  await Promise.all([
    clearCookiesForHostname(hostname, tabId),
    clearTabStorage(tabId),
  ]);

  const { sessions, activeSessions } = await readSessionState();
  delete activeSessions[hostname];
  await writeSessionState(sessions, activeSessions);
  await reloadTab(tabId);

  return { success: true };
}

const messageHandlers = {
  "fingerprint-detected": handleFingerprintDetectedMessage,
  "get-config": handleGetConfigMessage,
  "update-config": handleUpdateConfigMessage,
  "add-to-whitelist": handleAddToWhitelistMessage,
  "remove-from-whitelist": handleRemoveFromWhitelistMessage,
  "reset-config": handleResetConfigMessage,
  "get-triggered-features": handleGetTriggeredFeaturesMessage,
  "prepare-proxy-profile": handlePrepareProxyProfileMessage,
  "get-sessions": handleGetSessionsMessage,
  "save-session": handleSaveSessionMessage,
  "switch-session": handleSwitchSessionMessage,
  "delete-session": handleDeleteSessionMessage,
  "rename-session": handleRenameSessionMessage,
  "clear-current-session": handleClearCurrentSessionMessage,
};

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const messageType = request && request.type;
  debugLog(
    "Received message:",
    messageType,
    "from:",
    sender.tab ? "tab" : "popup/options",
  );

  const handler = messageHandlers[messageType];
  if (!handler) {
    return;
  }

  try {
    const result = handler(request, sender);
    if (result && typeof result.then === "function") {
      result
        .then((payload) => {
          sendResponse(payload === undefined ? { success: true } : payload);
        })
        .catch((error) => {
          debugError(
            `[Background] Handler failed for "${messageType}":`,
            error,
          );
          sendResponse({ success: false, error: error.message });
        });
      return true;
    }

    sendResponse(result === undefined ? { success: true } : result);
  } catch (error) {
    debugError(`[Background] Handler crashed for "${messageType}":`, error);
    sendResponse({ success: false, error: error.message });
  }
});

// ========== FINGERPRINT DETECTION HANDLING ==========

async function handleFingerprintDetection(feature, hostname) {
  debugLog(
    "[Background] handleFingerprintDetection called for:",
    feature,
    hostname,
  );
  const config = await getConfig();

  debugLog("[Background] Notifications enabled:", config.notifications.enabled);

  if (!config.notifications.enabled) {
    debugLog("[Background] Notifications disabled, skipping");
    return;
  }

  // Check if global protection is enabled
  if (!config.enabled) {
    debugLog("[Background] Global protection disabled, skipping notification");
    return;
  }

  const featureConfig =
    config[feature === "user-agent" ? "useragent" : feature];
  if (!featureConfig || !featureConfig.enabled) {
    debugLog(
      "[Background] Feature",
      feature,
      "is disabled, skipping notification",
    );
    return;
  }

  if (isHostnameOnGlobalAllowlist(hostname, config)) {
    debugLog("[Background] Domain", hostname, "is globally allowlisted");
    return;
  }

  const featureWhitelist = featureConfig.whitelist || "";
  if (isHostnameOnFeatureAllowlist(hostname, featureWhitelist, config)) {
    debugLog(
      "[Background] Domain",
      hostname,
      "is allowlisted for",
      feature,
      "- skipping notification",
    );
    return;
  }

  const key = `${feature}-${hostname}`;
  const now = Date.now();
  const lastTime = lastNotificationTime.get(key) || 0;

  debugLog("[Background] Throttle check:", {
    key: key,
    timeSinceLastNotification: now - lastTime,
    throttleLimit: NOTIFICATION_THROTTLE_MS,
  });

  if (now - lastTime < NOTIFICATION_THROTTLE_MS) {
    debugLog("[Background] Notification throttled (too soon)");
    return;
  }

  lastNotificationTime.set(key, now);

  // Show notification
  debugLog("[Background] Creating notification for:", feature, "on", hostname);
  chrome.notifications.create(
    {
      type: "basic",
      iconUrl: "icons/64.png",
      title: "Stealth Guard - Fingerprint Blocked",
      message: `${feature.toUpperCase()} fingerprinting attempt blocked on ${hostname}`,
      priority: 1,
    },
    (notificationId) => {
      if (chrome.runtime.lastError) {
        debugError(
          "[Background] Notification error:",
          chrome.runtime.lastError,
        );
      } else {
        debugLog("[Background] Notification created with ID:", notificationId);
      }
    },
  );
}
// ========== CONTEXT MENUS ==========

function setupContextMenus() {
  chrome.contextMenus.removeAll(() => {
    if (chrome.runtime.lastError) {
      debugWarn("Error removing context menus:", chrome.runtime.lastError);
    }

    createContextMenu(
      "add-to-global-whitelist",
      "Stealth Guard: Add to Allowlist",
    );
    createContextMenu(
      "remove-from-global-whitelist",
      "Stealth Guard: Remove from Allowlist",
    );
    createContextMenu("test-protection", "Stealth Guard: Test Protection");
  });
}

function createContextMenu(id, title) {
  chrome.contextMenus.create({ id, title, contexts: ["page"] }, () => {
    if (chrome.runtime.lastError) {
      debugWarn(
        "Context menu create warning:",
        chrome.runtime.lastError.message,
      );
    }
  });
}

function showContextMenuNotification(message) {
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icons/64.png",
    title: "Stealth Guard",
    message,
  });
}

function reloadTabAfterAllowlistChange(tabId) {
  chrome.tabs.reload(tabId, () => {
    if (chrome.runtime.lastError) {
      debugWarn(
        "Failed to reload tab after allowlist change:",
        chrome.runtime.lastError.message,
      );
    }
  });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab || !tab.url) return;

  try {
    const url = new URL(tab.url);
    const hostname = url.hostname;

    if (info.menuItemId === "add-to-global-whitelist") {
      const result = await handleAddToWhitelistMessage({ domain: hostname });
      showContextMenuNotification(
        result.changed
          ? `Added *.${hostname} to allowlist`
          : `${hostname} is already allowlisted`,
      );
      reloadTabAfterAllowlistChange(tab.id);
    } else if (info.menuItemId === "remove-from-global-whitelist") {
      const result = await handleRemoveFromWhitelistMessage({
        domain: hostname,
      });
      showContextMenuNotification(
        result.changed
          ? `Removed the allowlist rule covering ${hostname}`
          : `No allowlist rule covers ${hostname}`,
      );
      reloadTabAfterAllowlistChange(tab.id);
    } else if (info.menuItemId === "test-protection") {
      chrome.tabs.create({ url: "https://browserleaks.com/" });
    }
  } catch (e) {
    debugError("Context menu error:", e);
  }
});

// ========== PROXY ERROR HANDLING ==========

chrome.proxy.onProxyError.addListener((details) => {
  debugError("[Proxy] Error detected:", details.error);
  debugError("[Proxy] Error details:", details.details);

  // If we have a fatal proxy error, we could consider notifying the user
  if (details.fatal) {
    console.error("[Proxy] Fatal error, proxy settings may be invalid");

    // Optional: Notify user via notification
    if (
      currentConfig &&
      currentConfig.notifications &&
      currentConfig.notifications.enabled
    ) {
      chrome.notifications.create({
        type: "basic",
        iconUrl: "icons/64.png",
        title: "Stealth Guard - Proxy Error",
        message: "Proxy connection failed. Check your proxy settings.",
        priority: 2,
      });
    }
  }
});

// ========== CONFIG HELPER ==========

async function getConfig() {
  await ensureBackgroundInitialized();
  return currentConfig;
}

debugLog("Stealth Guard background script loaded");
