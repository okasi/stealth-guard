let currentConfig = null;
let initializationPromise = null;
const lastNotificationTime = new Map();
const triggeredFeaturesPerTab = new Map();
let lastAppliedWebRTCPolicy = null;
let webRTCPolicyQueue = Promise.resolve();
let configMutationQueue = Promise.resolve();
let proxyAuthListenersInstalled = false;
let proxyAuthenticationConfig = null;
let proxyRuntimeStatus = {
  state: "idle",
  profile: null,
  verifiedAt: null,
  exitIp: null,
  error: null,
  controlLevel: null,
  changedAt: null,
};
const PROXY_CONNECTION_HISTORY_KEY = "stealth-guard-proxy-history";
const MAX_PROXY_CONNECTION_HISTORY = 100;
let proxyConnectionHistory = [];
let proxyHistoryInitialized = false;
let proxyHistoryWriteQueue = Promise.resolve();

const NOTIFICATION_THROTTLE_MS = 3770;
const REPORTED_FEATURES = new Set([
  ...PROTECTION_FEATURES.filter((feature) => feature !== "useragent"),
  "user-agent",
]);

function debug(method, ...args) {
  if (currentConfig && currentConfig.notifications.enabled) {
    console[method](...args);
  }
}

const debugLog = (...args) => debug("log", ...args);
const debugWarn = (...args) => debug("warn", ...args);
const debugError = (...args) => console.error(...args);

const sessionManager = createSessionManager({
  storageApi: storage,
  browserApi: chrome,
  callApi: callChromeApi,
  warn: debugWarn,
});

const proxyCredentialManager = createProxyCredentialManager({
  storageApi: storage,
  getConfig: () => proxyAuthenticationConfig || currentConfig,
});

function setProxyRuntimeStatus(nextStatus) {
  const next = {
    state: nextStatus.state || "idle",
    profile: nextStatus.profile || null,
    verifiedAt: nextStatus.verifiedAt || null,
    exitIp: nextStatus.exitIp || null,
    error: nextStatus.error || null,
    controlLevel: nextStatus.controlLevel || null,
    changedAt: Date.now(),
  };
  const previousComparable = { ...proxyRuntimeStatus, changedAt: null };
  const nextComparable = { ...next, changedAt: null };
  if (JSON.stringify(previousComparable) === JSON.stringify(nextComparable)) {
    return;
  }
  proxyRuntimeStatus = next;
  recordProxyConnectionEvent(next);
}

function normalizeProxyHistoryEntry(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const timestamp = Number(value.timestamp);
  const allowedStates = new Set([
    "idle",
    "connecting",
    "connected",
    "routing",
    "degraded",
    "error",
    "conflict",
  ]);
  if (!Number.isFinite(timestamp) || !allowedStates.has(value.state)) {
    return null;
  }
  return {
    timestamp,
    state: value.state,
    profile:
      typeof value.profile === "string" ? value.profile.slice(0, 128) : null,
    exitIp:
      typeof value.exitIp === "string" ? value.exitIp.slice(0, 64) : null,
    error:
      typeof value.error === "string" ? value.error.slice(0, 512) : null,
    controlLevel:
      typeof value.controlLevel === "string"
        ? value.controlLevel.slice(0, 128)
        : null,
  };
}

async function initializeProxyConnectionHistory() {
  const stored = await storage.read(PROXY_CONNECTION_HISTORY_KEY);
  proxyConnectionHistory = Array.isArray(stored[PROXY_CONNECTION_HISTORY_KEY])
    ? stored[PROXY_CONNECTION_HISTORY_KEY]
        .map(normalizeProxyHistoryEntry)
        .filter(Boolean)
        .slice(-MAX_PROXY_CONNECTION_HISTORY)
    : [];
  proxyHistoryInitialized = true;
}

function persistProxyConnectionHistory() {
  const snapshot = proxyConnectionHistory.map((entry) => ({ ...entry }));
  const operation = () =>
    storage.write({ [PROXY_CONNECTION_HISTORY_KEY]: snapshot });
  proxyHistoryWriteQueue = proxyHistoryWriteQueue.then(operation, operation);
  proxyHistoryWriteQueue.catch((error) => {
    debugWarn("[Proxy] Failed to persist connection history:", error);
  });
}

function recordProxyConnectionEvent(status) {
  if (!proxyHistoryInitialized) {
    return;
  }
  const entry = normalizeProxyHistoryEntry({
    timestamp: status.changedAt || Date.now(),
    ...status,
  });
  if (!entry) {
    return;
  }
  proxyConnectionHistory.push(entry);
  proxyConnectionHistory = proxyConnectionHistory.slice(
    -MAX_PROXY_CONNECTION_HISTORY,
  );
  persistProxyConnectionHistory();
}

async function getProxySettingsDetails() {
  try {
    return (
      (await callChromeApi(chrome.proxy.settings, "get", {
        incognito: false,
      })) || {}
    );
  } catch (error) {
    debugWarn("[Proxy] Could not inspect proxy ownership:", error);
    return {};
  }
}

function isConflictingProxyControl(levelOfControl) {
  return (
    levelOfControl === "not_controllable" ||
    levelOfControl === "controlled_by_other_extensions"
  );
}

async function verifyProxyExit() {
  const data = await fetchJson(PROXY_VERIFICATION_URL, 5000);
  const ip = data && typeof data.ip === "string" ? data.ip.trim() : "";
  if (!ip || ip.length > 64 || !/^[0-9a-f:.]+$/i.test(ip)) {
    throw new Error("Exit IP verification failed");
  }
  return ip;
}

async function applyProxyPolicy(config) {
  proxyAuthenticationConfig = config;
  const proxyEnabled = Boolean(
    config && config.enabled && config.proxy && config.proxy.enabled,
  );
  const before = await getProxySettingsDetails();
  const controlLevel = before.levelOfControl || null;

  if (isConflictingProxyControl(controlLevel)) {
    setProxyRuntimeStatus({
      state: proxyEnabled ? "conflict" : "idle",
      error: proxyEnabled
        ? "Proxy settings are controlled by another extension or policy"
        : null,
      controlLevel,
    });
    return;
  }

  if (!proxyEnabled) {
    await applyProxySettings(config);
    setProxyRuntimeStatus({ state: "idle", controlLevel });
    return;
  }

  const activeProfile = (config.proxy.profiles || []).find(
    (profile) => profile.name === config.proxy.activeProfile,
  );
  setProxyRuntimeStatus({
    state: "connecting",
    profile: activeProfile ? activeProfile.name : null,
    controlLevel,
  });

  try {
    await applyProxySettings(config);
  } catch (error) {
    setProxyRuntimeStatus({
      state: "error",
      profile: activeProfile ? activeProfile.name : null,
      error: error.message,
      controlLevel,
    });
    throw error;
  }

  const effective = await getProxySettingsDetails();
  const effectiveControlLevel = effective.levelOfControl || controlLevel;
  if (isConflictingProxyControl(effectiveControlLevel)) {
    setProxyRuntimeStatus({
      state: "conflict",
      profile: activeProfile ? activeProfile.name : null,
      error: "Proxy settings were overridden by another extension or policy",
      controlLevel: effectiveControlLevel,
    });
    return;
  }

  if (!activeProfile) {
    setProxyRuntimeStatus({
      state: "routing",
      controlLevel: effectiveControlLevel,
    });
    return;
  }

  try {
    const exitIp = await verifyProxyExit();
    setProxyRuntimeStatus({
      state:
        config.proxy.routingMode === "protect-selected"
          ? "routing"
          : "connected",
      profile: activeProfile.name,
      exitIp,
      verifiedAt: Date.now(),
      controlLevel: effectiveControlLevel,
    });
  } catch (error) {
    setProxyRuntimeStatus({
      state: "degraded",
      profile: activeProfile.name,
      error: error.message,
      controlLevel: effectiveControlLevel,
    });
  }
}

function setupProxyAuthentication() {
  if (proxyAuthListenersInstalled) {
    return;
  }

  if (
    !chrome.webRequest.onAuthRequired ||
    !chrome.webRequest.onCompleted ||
    !chrome.webRequest.onErrorOccurred
  ) {
    debugWarn("[Proxy] Proxy authentication events are unavailable");
    return;
  }

  chrome.webRequest.onAuthRequired.addListener(
    proxyCredentialManager.handleAuthRequired,
    { urls: ["<all_urls>"] },
    ["blocking"],
  );
  chrome.webRequest.onCompleted.addListener(
    proxyCredentialManager.clearRequest,
    { urls: ["<all_urls>"] },
  );
  chrome.webRequest.onErrorOccurred.addListener(
    proxyCredentialManager.clearRequest,
    { urls: ["<all_urls>"] },
  );
  proxyAuthListenersInstalled = true;
}

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
    initializationPromise = initializeBackground();
    await initializationPromise;
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

async function applyCurrentConfig(config) {
  await applyUserAgentSpoofing(config);
  await applyWebRTCPolicy(config);
  await applyProxyPolicy(config);
  currentConfig = config;
}

async function initializeBackground() {
  try {
    await proxyCredentialManager.initialize();
    setupProxyAuthentication();
  } catch (error) {
    debugWarn("[Proxy] Credential support failed to initialize:", error);
  }
  try {
    await initializeProxyConnectionHistory();
  } catch (error) {
    proxyHistoryInitialized = true;
    debugWarn("[Proxy] Connection history failed to initialize:", error);
  }
  await applyCurrentConfig(await loadConfig());
  setupContextMenus();
  debugLog("Stealth Guard initialized");
}

initializationPromise = initializeBackground().catch((error) => {
  debugError("Failed to initialize Stealth Guard:", error);
});

chrome.runtime.onInstalled.addListener(async (details) => {
  try {
    await ensureBackgroundInitialized();
    if (details.reason === "install") {
      chrome.tabs.create({ url: "options/options.html" });
    }
  } catch (error) {
    debugError("Failed to finish install handling:", error);
  }
});

let uaListener = null;

function quoteClientHint(value) {
  return `"${String(value).replace(/(["\\])/g, "\\$1")}"`;
}

function getUserAgentClientHintHeaders(preset, userAgent) {
  const hints = USER_AGENT_CLIENT_HINTS[preset];
  if (!hints) return null;
  const versionToken = hints.brand === "Microsoft Edge" ? "Edg" : "Chrome";
  const versionMatch = userAgent.match(
    new RegExp(`${versionToken}\\/([\\d.]+)`),
  );
  const fullVersion = versionMatch ? versionMatch[1] : "0.0.0.0";
  const majorVersion = fullVersion.split(".")[0];
  const brands = [
    ["Not_A Brand", "99"],
    ["Chromium", majorVersion],
    [hints.brand, majorVersion],
  ];
  const fullVersionList = [
    ["Not_A Brand", "99.0.0.0"],
    ["Chromium", fullVersion],
    [hints.brand, fullVersion],
  ];
  const formatBrands = (values) =>
    values
      .map(
        ([brand, version]) =>
          `${quoteClientHint(brand)};v=${quoteClientHint(version)}`,
      )
      .join(", ");

  return {
    "sec-ch-ua": formatBrands(brands),
    "sec-ch-ua-arch": quoteClientHint(hints.architecture),
    "sec-ch-ua-bitness": quoteClientHint(hints.bitness),
    "sec-ch-ua-form-factors": hints.formFactors
      .map(quoteClientHint)
      .join(", "),
    "sec-ch-ua-full-version": quoteClientHint(fullVersion),
    "sec-ch-ua-full-version-list": formatBrands(fullVersionList),
    "sec-ch-ua-mobile": hints.mobile ? "?1" : "?0",
    "sec-ch-ua-model": quoteClientHint(hints.model),
    "sec-ch-ua-platform": quoteClientHint(hints.platform),
    "sec-ch-ua-platform-version": quoteClientHint(hints.platformVersion),
    "sec-ch-ua-wow64": hints.wow64 ? "?1" : "?0",
  };
}

async function applyUserAgentSpoofing(configOverride) {
  const config = configOverride || (await getConfig());

  if (uaListener) {
    chrome.webRequest.onBeforeSendHeaders.removeListener(uaListener);
    uaListener = null;
  }

  if (!config.enabled || !config.useragent.enabled) {
    return;
  }

  const userAgent = getUserAgentString(config.useragent.preset);
  if (!userAgent) {
    throw new Error(`Invalid User-Agent preset: ${config.useragent.preset}`);
  }
  const clientHintHeaders = getUserAgentClientHintHeaders(
    config.useragent.preset,
    userAgent,
  );

  uaListener = function (details) {
    const requestHeaders = details.requestHeaders || [];
    const hostname = getHostnameFromUrl(details.url);
    if (
      !hostname ||
      isCloudflareChallengeHostname(hostname) ||
      !isFeatureActiveForHostname(config, "useragent", hostname)
    ) {
      return { requestHeaders };
    }

    const header = requestHeaders.find(
      (entry) => entry.name.toLowerCase() === "user-agent",
    );
    if (header) {
      header.value = userAgent;
    } else {
      requestHeaders.push({ name: "User-Agent", value: userAgent });
    }
    for (let index = requestHeaders.length - 1; index >= 0; index--) {
      const requestHeader = requestHeaders[index];
      const name = requestHeader.name.toLowerCase();
      if (!name.startsWith("sec-ch-ua")) continue;
      const spoofedValue = clientHintHeaders && clientHintHeaders[name];
      if (spoofedValue === undefined || spoofedValue === null) {
        requestHeaders.splice(index, 1);
      } else {
        requestHeader.value = spoofedValue;
      }
    }
    return { requestHeaders };
  };

  chrome.webRequest.onBeforeSendHeaders.addListener(
    uaListener,
    { urls: ["<all_urls>"] },
    ["blocking", "requestHeaders", "extraHeaders"],
  );
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
  return callChromeApi(
    chrome.privacy.network.webRTCIPHandlingPolicy,
    "set",
    { value: policy },
  );
}

function getWebRTCPolicySetting() {
  return callChromeApi(
    chrome.privacy.network.webRTCIPHandlingPolicy,
    "get",
    {},
  ).then((details) => details || {});
}

async function applyWebRTCPolicy(configOverride) {
  const config = configOverride || (await getConfig());
  const policy =
    config.enabled && config.webrtc.enabled ? config.webrtc.policy : "default";
  await applyWebRTCPolicyValue(policy);
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
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
  return { config: await getConfig() };
}

function serializeConfigValue(value) {
  return JSON.stringify(value);
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

async function applyConfigChanges(changeFlags, config) {
  if (changeFlags.userAgentChanged) {
    await applyUserAgentSpoofing(config);
  }

  if (changeFlags.webrtcChanged) {
    await applyWebRTCPolicy(config);
  }

  if (changeFlags.proxyChanged) {
    await applyProxyPolicy(config);
  }
}

async function saveConfigWithRollback(previousConfig, nextConfig) {
  const changeFlags = getConfigChangeFlags(previousConfig, nextConfig);

  await saveConfig(nextConfig);

  try {
    await applyConfigChanges(changeFlags, nextConfig);
  } catch (error) {
    await saveConfig(previousConfig);

    try {
      await applyConfigChanges(changeFlags, previousConfig);
      await broadcastConfigUpdated(previousConfig);
    } catch (rollbackError) {
      debugError(
        "[Background] Failed to roll back config after apply failure:",
        rollbackError,
      );
    }

    throw error;
  }

  currentConfig = nextConfig;
  proxyCredentialManager.prune(nextConfig.proxy.profiles).catch((error) => {
    debugError("[Proxy] Failed to prune unused credentials:", error);
  });
  await broadcastConfigUpdated(nextConfig);
}

function enqueueConfigMutation(operation) {
  const queuedOperation = configMutationQueue.then(operation, operation);
  configMutationQueue = queuedOperation.catch(() => {});
  return queuedOperation;
}

function handleUpdateConfigMessage(request) {
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
    if (
      serializeConfigValue(previousConfig) === serializeConfigValue(nextConfig)
    ) {
      return { success: true };
    }

    await saveConfigWithRollback(previousConfig, nextConfig);

    return { success: true };
  });
}

function updateGlobalWhitelist(request, mutator) {
  return enqueueConfigMutation(async () => {
    const previousConfig = cloneConfig(await getConfig());
    const nextConfig = cloneConfig(previousConfig);
    const domain = normalizeDomainPattern(request && request.domain);
    if (!domain || domain.includes("*")) {
      throw new Error("Invalid domain");
    }

    nextConfig.globalWhitelist = mutator(domain, nextConfig.globalWhitelist);
    const changed =
      serializeConfigValue(previousConfig) !== serializeConfigValue(nextConfig);

    if (changed) {
      await saveConfigWithRollback(previousConfig, nextConfig);
    }

    return { success: true, whitelist: nextConfig.globalWhitelist, changed };
  });
}

function handleAddToWhitelistMessage(request) {
  return updateGlobalWhitelist(request, addDomainToAllowlist);
}

function handleRemoveFromWhitelistMessage(request) {
  return updateGlobalWhitelist(request, removeDomainFromAllowlist);
}

function handleResetConfigMessage() {
  return enqueueConfigMutation(async () => {
    const previousConfig = cloneConfig(await getConfig());
    const nextConfig = cloneConfig(DEFAULT_CONFIG);

    if (
      serializeConfigValue(previousConfig) !== serializeConfigValue(nextConfig)
    ) {
      await saveConfigWithRollback(previousConfig, nextConfig);
    }

    await proxyCredentialManager.clearAll();

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

function assertExtensionPageSender(sender) {
  if (sender && sender.tab) {
    throw new Error("Proxy credentials are available only to extension pages");
  }
}

function handleGetProxyCredentialStatusMessage(request, sender) {
  assertExtensionPageSender(sender);
  const profiles = Array.isArray(request && request.profiles)
    ? request.profiles
    : [request && request.profile];
  return {
    success: true,
    credentials: profiles
      .filter(Boolean)
      .map((profile) => proxyCredentialManager.getStatus(profile)),
  };
}

async function handleSetProxyCredentialsMessage(request, sender) {
  assertExtensionPageSender(sender);
  return {
    success: true,
    credential: await proxyCredentialManager.setCredential(
      request && request.profile,
      request && request.credentials,
    ),
  };
}

async function handleClearProxyCredentialsMessage(request, sender) {
  assertExtensionPageSender(sender);
  return {
    success: true,
    credential: await proxyCredentialManager.removeCredential(
      request && request.profile,
    ),
  };
}

function handleGetProxyRuntimeStatusMessage(request, sender) {
  assertExtensionPageSender(sender);
  return { success: true, status: { ...proxyRuntimeStatus } };
}

async function handleVerifyProxyConnectionMessage(request, sender) {
  assertExtensionPageSender(sender);
  await applyProxyPolicy(await getConfig());
  return { success: true, status: { ...proxyRuntimeStatus } };
}

async function handleGetProxyDiagnosticsMessage(request, sender) {
  assertExtensionPageSender(sender);
  const config = await getConfig();
  const proxy = config.proxy;
  const effective = await getProxySettingsDetails();
  const activeProfile = proxy.profiles.find(
    (profile) => profile.name === proxy.activeProfile,
  );
  return {
    success: true,
    diagnostics: {
      generatedAt: Date.now(),
      status: { ...proxyRuntimeStatus },
      effectiveSettings: {
        mode:
          effective && effective.value && typeof effective.value.mode === "string"
            ? effective.value.mode
            : null,
        controlLevel: effective.levelOfControl || null,
      },
      configuration: {
        enabled: Boolean(config.enabled && proxy.enabled),
        routingMode: proxy.routingMode,
        activeProfile: proxy.activeProfile,
        profileCount: proxy.profiles.length,
        fallbackCount: proxy.fallbackProfiles.length,
        routeCount: proxy.domainRoutes.length,
        bypassCount: proxy.bypassList.length,
        syncTimezone: proxy.syncTimezone,
        syncGeolocation: proxy.syncGeolocation,
        credentialProfileCount: proxy.profiles.filter(
          (profile) => proxyCredentialManager.getStatus(profile).configured,
        ).length,
        location:
          activeProfile && activeProfile.location
            ? {
                city: activeProfile.location.city || "",
                country: activeProfile.location.country || "",
                countryCode: activeProfile.location.countryCode || "",
                timezone: activeProfile.location.timezone || "",
              }
            : null,
      },
      history: proxyConnectionHistory
        .slice()
        .reverse()
        .map((entry) => ({ ...entry })),
    },
  };
}

async function handleClearProxyHistoryMessage(request, sender) {
  assertExtensionPageSender(sender);
  proxyConnectionHistory = [];
  await proxyHistoryWriteQueue.catch(() => {});
  await storage.write({ [PROXY_CONNECTION_HISTORY_KEY]: [] });
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
  "get-proxy-credential-status": handleGetProxyCredentialStatusMessage,
  "set-proxy-credentials": handleSetProxyCredentialsMessage,
  "clear-proxy-credentials": handleClearProxyCredentialsMessage,
  "get-proxy-runtime-status": handleGetProxyRuntimeStatusMessage,
  "verify-proxy-connection": handleVerifyProxyConnectionMessage,
  "get-proxy-diagnostics": handleGetProxyDiagnosticsMessage,
  "clear-proxy-history": handleClearProxyHistoryMessage,
  "get-sessions": sessionManager.getSessions,
  "save-session": sessionManager.saveSession,
  "switch-session": sessionManager.switchSession,
  "delete-session": sessionManager.deleteSession,
  "rename-session": sessionManager.renameSession,
  "clear-current-session": sessionManager.clearCurrentSession,
};

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const messageType = request && request.type;
  debugLog(
    "Received message:",
    messageType,
    "from:",
    sender && sender.tab ? "tab" : "popup/options",
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

async function handleFingerprintDetection(feature, hostname) {
  const config = await getConfig();
  const configFeature = feature === "user-agent" ? "useragent" : feature;
  if (
    !config.notifications.enabled ||
    !isFeatureActiveForHostname(config, configFeature, hostname)
  ) {
    return;
  }

  const key = `${feature}-${hostname}`;
  const now = Date.now();
  if (now - (lastNotificationTime.get(key) || 0) < NOTIFICATION_THROTTLE_MS) {
    return;
  }
  if (!lastNotificationTime.has(key) && lastNotificationTime.size >= 512) {
    lastNotificationTime.delete(lastNotificationTime.keys().next().value);
  }
  lastNotificationTime.set(key, now);

  chrome.notifications.create(
    {
      type: "basic",
      iconUrl: "icons/64.png",
      title: "Stealth Guard - Fingerprint Blocked",
      message: `${feature.toUpperCase()} fingerprinting attempt blocked on ${hostname}`,
      priority: 1,
    },
    () => {
      const error = chrome.runtime.lastError;
      if (error) {
        debugError("[Background] Notification error:", error);
      }
    },
  );
}

function setupContextMenus() {
  chrome.contextMenus.removeAll(() => {
    if (chrome.runtime.lastError) {
      debugWarn("Error removing context menus:", chrome.runtime.lastError);
    }

    const menus = [
      ["add-to-global-whitelist", "Stealth Guard: Add to Allowlist"],
      ["remove-from-global-whitelist", "Stealth Guard: Remove from Allowlist"],
      ["test-protection", "Stealth Guard: Test Protection"],
    ];
    for (const [id, title] of menus) {
      chrome.contextMenus.create({ id, title, contexts: ["page"] }, () => {
        if (chrome.runtime.lastError) {
          debugWarn(
            "Context menu create warning:",
            chrome.runtime.lastError.message,
          );
        }
      });
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
    const hostname = normalizeHostname(url.hostname).replace(/^www\./, "");

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

chrome.proxy.onProxyError.addListener((details) => {
  debugError("[Proxy] Error:", details.error, details.details || "");
  if (currentConfig && currentConfig.proxy.enabled) {
    setProxyRuntimeStatus({
      state: details.fatal ? "error" : "degraded",
      profile: proxyRuntimeStatus.profile,
      error: details.error || details.details || "Proxy connection failed",
      controlLevel: proxyRuntimeStatus.controlLevel,
    });
  }
  if (details.fatal && currentConfig && currentConfig.notifications.enabled) {
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/64.png",
      title: "Stealth Guard - Proxy Error",
      message: "Proxy connection failed. Check your proxy settings.",
      priority: 2,
    });
  }
});

if (chrome.proxy.settings.onChange) {
  chrome.proxy.settings.onChange.addListener((details) => {
    const controlLevel = details && details.levelOfControl;
    if (
      currentConfig &&
      currentConfig.proxy.enabled &&
      isConflictingProxyControl(controlLevel)
    ) {
      setProxyRuntimeStatus({
        state: "conflict",
        profile: proxyRuntimeStatus.profile,
        error: "Proxy settings are controlled by another extension or policy",
        controlLevel,
      });
    }
  });
}

async function getConfig() {
  await ensureBackgroundInitialized();
  return currentConfig;
}

debugLog("Stealth Guard background script loaded");
