let currentConfig = null;
let initializationPromise = null;
const lastNotificationTime = new Map();
const triggeredFeaturesPerTab = new Map();
const trackerActivityPerTab = new Map();
let lastAppliedWebRTCPolicy = null;
let proxyAuthListenersInstalled = false;
let proxyAuthenticationConfig = null;
let proxyRuntimeStatus = {
  state: "idle",
  profile: null,
  endpoint: null,
  verifiedAt: null,
  exitIp: null,
  error: null,
  controlLevel: null,
  changedAt: null,
};
const PROXY_CONNECTION_HISTORY_KEY = "stealth-guard-proxy-history";
const MAX_PROXY_CONNECTION_HISTORY = 100;
const PROXY_HISTORY_STATES = new Set([
  "idle",
  "connecting",
  "connected",
  "routing",
  "degraded",
  "error",
  "conflict",
]);
let proxyConnectionHistory = [];
let proxyHistoryInitialized = false;
let trackerListener = null;
let adblockCache = { version: ADBLOCK_CACHE_VERSION, lists: {} };
const adblockCompiledById = new Map();
let adblockEngine = createAdblockEngine(createEmptyCompiledRules());
let adblockUpdatePromise = null;
let curlProfileCatalog = normalizeCurlProfileCatalog(null);
let curlProfileUpdatePromise = null;
let adblockStatus = {
  updating: false,
  lastUpdate: null,
  nextUpdate: null,
  networkRules: 0,
  cosmeticRules: 0,
  error: null,
};
let curlProfileStatus = {
  updating: false,
  lastUpdate: null,
  nextUpdate: null,
  profileCount: curlProfileCatalog.profiles.length,
  error: null,
  source: CURL_PROFILE_DIRECTORY_URL,
};

const NOTIFICATION_THROTTLE_MS = 3770;
const PROXY_VERIFICATION_TIMEOUT_MS = 5000;
const PROXY_RETRY_ALARM = "stealth-guard-proxy-retry";
const PROXY_RETRY_PERIOD_MINUTES = 5;
const ADBLOCK_UPDATE_ALARM = "stealth-guard-filter-update";
const CURL_PROFILE_UPDATE_ALARM = "stealth-guard-curl-profile-update";
const YOUTUBE_FILTER_MAX_AGE_MS = 45 * 60 * 1000;
const PROXY_INDICATOR_COLORS = {
  active: "#188038",
  inactive: "#5F6368",
  warning: "#B06000",
  error: "#B3261E",
};
const CURL_PROFILE_REQUEST_TIMEOUT_MS = 15000;
const FILTER_REQUEST_TIMEOUT_MS = 30000;
const MAX_CONCURRENT_DOWNLOADS = 4;
const MAX_CONCURRENT_TAB_MESSAGES = 16;
const BLOCKED_BADGE_COLORS = {
  active: "#B3261E",
  empty: "#5F6368",
};
const TOOLBAR_ICON_SIZES = [16, 32];
const toolbarIconRenderVersions = new Map();
const toolbarIconImageDataByColor = new Map();
const toolbarProxyColorPerTab = new Map();
const toolbarHostnamePerTab = new Map();
const cloudflareChallengeByTab = new Map();
const CLOUDFLARE_CHALLENGE_SESSION_TTL_MS = 10 * 60 * 1000;
const REPORTED_FEATURES = new Set([
  ...PROTECTION_FEATURES.filter((feature) => feature !== "useragent"),
  "user-agent",
]);
const enqueueWebRTCPolicy = createSerialQueue();
const enqueueConfigMutation = createSerialQueue();
const enqueueProxyHistoryWrite = createSerialQueue();

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
    endpoint: nextStatus.endpoint || null,
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
  refreshToolbarIndicators();
}

function normalizeProxyHistoryEntry(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const timestamp = Number(value.timestamp);
  if (!Number.isFinite(timestamp) || !PROXY_HISTORY_STATES.has(value.state)) {
    return null;
  }
  return {
    timestamp,
    state: value.state,
    profile:
      typeof value.profile === "string" ? value.profile.slice(0, 128) : null,
    endpoint:
      typeof value.endpoint === "string" ? value.endpoint.slice(0, 256) : null,
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
  enqueueProxyHistoryWrite(() =>
    storage.write({ [PROXY_CONNECTION_HISTORY_KEY]: snapshot }),
  ).catch((error) => {
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

function describeProxyVerificationFailure(chainProfiles, cause) {
  const authFailure = chainProfiles
    .map((profile) => proxyCredentialManager.getAuthFailure(profile))
    .find(Boolean);
  return [
    `${describeProxyChain(chainProfiles)}: ${cause}`,
    authFailure ? ` — ${authFailure.reason}` : "",
  ].join("");
}

async function verifyProxyExit(chainProfiles = []) {
  let data;
  try {
    data = await fetchJson(PROXY_VERIFICATION_URL, PROXY_VERIFICATION_TIMEOUT_MS);
  } catch (error) {
    throw new Error(
      describeProxyVerificationFailure(
        chainProfiles,
        describeProxyFetchError(error, PROXY_VERIFICATION_TIMEOUT_MS),
      ),
    );
  }

  const ip = data && typeof data.ip === "string" ? data.ip.trim() : "";
  if (!ip || ip.length > 64 || !/^[0-9a-f:.]+$/i.test(ip)) {
    throw new Error(
      describeProxyVerificationFailure(
        chainProfiles,
        `${PROXY_VERIFICATION_HOST} returned no usable exit IP, so the ` +
          "request probably did not reach it through the proxy",
      ),
    );
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

  const findProfile = (profileName) =>
    (config.proxy.profiles || []).find(
      (profile) => profile.name === profileName,
    );
  const activeProfile = findProfile(config.proxy.activeProfile);
  const activeEndpoint = formatProxyEndpoint(activeProfile);
  const verificationChain = [
    activeProfile,
    ...(config.proxy.fallbackProfiles || [])
      .filter((profileName) => profileName !== config.proxy.activeProfile)
      .map(findProfile),
  ].filter(Boolean);
  setProxyRuntimeStatus({
    state: "connecting",
    profile: activeProfile ? activeProfile.name : null,
    endpoint: activeEndpoint,
    controlLevel,
  });

  try {
    await applyProxySettings(config);
  } catch (error) {
    setProxyRuntimeStatus({
      state: "error",
      profile: activeProfile ? activeProfile.name : null,
      endpoint: activeEndpoint,
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
      endpoint: activeEndpoint,
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
    const exitIp = await verifyProxyExit(verificationChain);
    setProxyRuntimeStatus({
      state:
        config.proxy.routingMode === "protect-selected"
          ? "routing"
          : "connected",
      profile: activeProfile.name,
      endpoint: activeEndpoint,
      exitIp,
      verifiedAt: Date.now(),
      controlLevel: effectiveControlLevel,
    });
  } catch (error) {
    setProxyRuntimeStatus({
      state: "degraded",
      profile: activeProfile.name,
      endpoint: activeEndpoint,
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

  if (!initializationPromise) {
    initializationPromise = (async () => {
      try {
        await initializeBackground();
      } finally {
        initializationPromise = null;
      }
    })();
  }
  await initializationPromise;
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

function getRequestContextHostname(details) {
  if (details && details.type === "main_frame") {
    return getHostnameFromUrl(details.url);
  }
  for (const candidate of [
    details && details.initiator,
    details && details.documentUrl,
    details && details.originUrl,
  ]) {
    const hostname = getHostnameFromUrl(candidate);
    if (hostname) {
      return hostname;
    }
  }
  return null;
}

function isExtensionInitiatedRequest(details) {
  const extensionRoot = chrome.runtime.getURL("");
  return [details?.initiator, details?.documentUrl, details?.originUrl].some(
    (value) => typeof value === "string" && value.startsWith(extensionRoot),
  );
}

function isSameSiteHostname(left, right) {
  const first = normalizeHostname(left);
  const second = normalizeHostname(right);
  return Boolean(
    first &&
      second &&
      (first === second ||
        first.endsWith(`.${second}`) ||
        second.endsWith(`.${first}`)),
  );
}

function markTrackerBlocked(tabId, pageHostname, requestHostname) {
  if (typeof tabId !== "number" || tabId < 0 || !pageHostname) {
    return;
  }
  const current = trackerActivityPerTab.get(tabId);
  if (!current || current.hostname !== pageHostname) {
    trackerActivityPerTab.set(tabId, {
      hostname: pageHostname,
      count: 0,
      domains: new Set(),
      domainCounts: new Map(),
    });
  }
  const activity = trackerActivityPerTab.get(tabId);
  activity.count += 1;
  if (activity.domains.has(requestHostname) || activity.domains.size < 50) {
    activity.domains.add(requestHostname);
    activity.domainCounts.set(
      requestHostname,
      (activity.domainCounts.get(requestHostname) || 0) + 1,
    );
  }
  markTriggeredFeatureForTab(tabId, pageHostname, "tracker");
  updateToolbarIndicator(tabId, pageHostname);
}

function isProxyBypassedForHostname(config, hostname) {
  return Boolean(
    config?.enabled &&
      config.proxy?.enabled &&
      hostname &&
      !resolveProxyProfile(config, hostname),
  );
}

function getToolbarProxyStatus(hostname = "") {
  if (
    proxyRuntimeStatus.state === "conflict" ||
    proxyRuntimeStatus.state === "error"
  ) {
    return proxyRuntimeStatus.state === "conflict"
      ? {
          color: PROXY_INDICATOR_COLORS.error,
          label: "inactive due to a settings conflict",
        }
      : {
          color: PROXY_INDICATOR_COLORS.error,
          label: "inactive due to an error",
        };
  }

  if (isProxyBypassedForHostname(currentConfig, hostname)) {
    return {
      color: PROXY_INDICATOR_COLORS.warning,
      label: "bypassed for this site",
    };
  }

  switch (proxyRuntimeStatus.state) {
    case "connected":
    case "routing":
      return {
        color: PROXY_INDICATOR_COLORS.active,
        label: proxyRuntimeStatus.profile
          ? `active (${proxyRuntimeStatus.profile})`
          : "active",
      };
    case "connecting":
      return {
        color: PROXY_INDICATOR_COLORS.warning,
        label: "connecting",
      };
    case "degraded":
      return {
        color: PROXY_INDICATOR_COLORS.warning,
        label: "active, but not verified",
      };
    default:
      return {
        color: PROXY_INDICATOR_COLORS.inactive,
        label: "inactive",
      };
  }
}

function formatToolbarBlockedCount(count) {
  return count > 99 ? "99+" : String(count);
}

function updateToolbarIndicator(tabId, hostname = "") {
  if (
    !chrome.browserAction ||
    typeof chrome.browserAction.setBadgeText !== "function" ||
    typeof tabId !== "number"
  ) {
    return;
  }

  const normalizedHostname = normalizeHostname(hostname);
  if (normalizedHostname) {
    toolbarHostnamePerTab.set(tabId, normalizedHostname);
  }
  const effectiveHostname =
    normalizedHostname ||
    toolbarHostnamePerTab.get(tabId) ||
    trackerActivityPerTab.get(tabId)?.hostname ||
    "";
  const activity = trackerActivityPerTab.get(tabId);
  const blockedCount = activity ? activity.count : 0;
  const proxy = getToolbarProxyStatus(effectiveHostname);
  const blockedLabel = `${blockedCount} ad/tracker request${
    blockedCount === 1 ? "" : "s"
  } blocked`;

  try {
    chrome.browserAction.setBadgeText({
      tabId,
      text: formatToolbarBlockedCount(blockedCount),
    });
    chrome.browserAction.setBadgeBackgroundColor({
      tabId,
      color:
        blockedCount > 0
          ? BLOCKED_BADGE_COLORS.active
          : BLOCKED_BADGE_COLORS.empty,
    });
    chrome.browserAction.setTitle({
      tabId,
      title: `Stealth Guard — ${blockedLabel} — Proxy ${proxy.label}`,
    });
    if (toolbarProxyColorPerTab.get(tabId) !== proxy.color) {
      toolbarProxyColorPerTab.set(tabId, proxy.color);
      refreshToolbarProxyIcon(tabId, proxy.color);
    }
  } catch (error) {
    debugWarn("[Toolbar] Failed to update indicator:", error);
  }
}

function refreshToolbarIndicators() {
  if (!chrome.browserAction) {
    return;
  }
  queryTabs({})
    .then((tabs) => {
      for (const tab of tabs) {
        if (typeof tab.id === "number") {
          updateToolbarIndicator(tab.id, getHostnameFromUrl(tab.url));
        }
      }
    })
    .catch((error) => {
      debugWarn("[Toolbar] Failed to refresh indicators:", error);
    });
}

function renderToolbarIconWithProxyIndicator(size, color) {
  return new Promise((resolve, reject) => {
    const image = document.createElement("img");
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext("2d");
        if (!context) {
          throw new Error("Canvas rendering is unavailable");
        }

        context.drawImage(image, 0, 0, size, size);
        const radius = Math.max(2, size * 0.15);
        const centerX = size - radius - 1;
        const centerY = radius + 1;
        context.beginPath();
        context.arc(
          centerX,
          centerY,
          radius + Math.max(1, size * 0.04),
          0,
          Math.PI * 2,
        );
        context.fillStyle = "#FFFFFF";
        context.fill();
        context.beginPath();
        context.arc(centerX, centerY, radius, 0, Math.PI * 2);
        context.fillStyle = color;
        context.fill();
        resolve(context.getImageData(0, 0, size, size));
      } catch (error) {
        reject(error);
      }
    };
    image.onerror = () =>
      reject(new Error(`Could not load ${size}px toolbar icon`));
    image.src = chrome.runtime.getURL(`icons/${size}.png`);
  });
}

function getToolbarIconImageData(color) {
  if (!toolbarIconImageDataByColor.has(color)) {
    toolbarIconImageDataByColor.set(
      color,
      Promise.all(
        TOOLBAR_ICON_SIZES.map(async (size) => [
          size,
          await renderToolbarIconWithProxyIndicator(size, color),
        ]),
      ).then((entries) => Object.fromEntries(entries)),
    );
  }
  return toolbarIconImageDataByColor.get(color);
}

function refreshToolbarProxyIcon(tabId, color) {
  if (
    !chrome.browserAction ||
    typeof chrome.browserAction.setIcon !== "function" ||
    typeof document === "undefined" ||
    typeof tabId !== "number"
  ) {
    return;
  }

  const renderVersion = (toolbarIconRenderVersions.get(tabId) || 0) + 1;
  toolbarIconRenderVersions.set(tabId, renderVersion);
  getToolbarIconImageData(color)
    .then((imageData) => {
      if (renderVersion === toolbarIconRenderVersions.get(tabId)) {
        chrome.browserAction.setIcon({ tabId, imageData });
      }
    })
    .catch((error) => {
      debugWarn("[Toolbar] Failed to render proxy indicator:", error);
    });
}

function normalizeAdblockCache(value) {
  adblockCompiledById.clear();
  if (!value || value.version !== ADBLOCK_CACHE_VERSION || !value.lists) {
    return { version: ADBLOCK_CACHE_VERSION, lists: {} };
  }
  const lists = {};
  for (const [id, entry] of Object.entries(value.lists)) {
    if (
      entry &&
      typeof entry === "object" &&
      typeof entry.text === "string" &&
      entry.text.length <= MAX_FILTER_TEXT_LENGTH &&
      typeof entry.url === "string"
    ) {
      const compiled = parseFilterList(entry.text);
      adblockCompiledById.set(id, compiled);
      lists[id] = {
        name: typeof entry.name === "string" ? entry.name : id,
        url: entry.url,
        updatedAt: Number(entry.updatedAt) || 0,
        stats: compiled.stats,
      };
    }
  }
  return { version: ADBLOCK_CACHE_VERSION, lists };
}

async function loadAdblockCache() {
  const stored = await storage.read(ADBLOCK_CACHE_KEY);
  adblockCache = normalizeAdblockCache(stored[ADBLOCK_CACHE_KEY]);
}

async function loadCurlProfileCache() {
  const stored = await storage.read(CURL_PROFILE_CACHE_KEY);
  curlProfileCatalog = normalizeCurlProfileCatalog(
    stored[CURL_PROFILE_CACHE_KEY],
  );
  curlProfileStatus = {
    ...curlProfileStatus,
    lastUpdate: curlProfileCatalog.updatedAt || null,
    profileCount: curlProfileCatalog.profiles.length,
  };
}

function scheduleCurlProfileUpdates() {
  if (!chrome.alarms) return;
  chrome.alarms.create(CURL_PROFILE_UPDATE_ALARM, {
    delayInMinutes: CURL_PROFILE_UPDATE_PERIOD_MINUTES,
    periodInMinutes: CURL_PROFILE_UPDATE_PERIOD_MINUTES,
  });
  curlProfileStatus.nextUpdate =
    Date.now() + CURL_PROFILE_UPDATE_PERIOD_MINUTES * 60000;
}

async function fetchWithTimeout(url, options, timeoutMs, consume) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return await consume(response);
  } finally {
    clearTimeout(timeoutId);
  }
}

function isCurlProfileWrapperName(name) {
  const target = String(name || "").replace(/^curl_/, "");
  return /^curl_(?:chrome\d+(?:_android)?|edge\d+|safari\d+(?:_ios)?)$/.test(String(name || "")) &&
    isModernCurlProfileTarget(target);
}

async function downloadCurlProfileWrapper(entry) {
  const target = String(entry.name || "");
  const url = `${CURL_PROFILE_RAW_BASE_URL}${encodeURIComponent(target)}`;
  return fetchWithTimeout(
    url,
    {
      cache: "no-cache",
      credentials: "omit",
      redirect: "follow",
    },
    CURL_PROFILE_REQUEST_TIMEOUT_MS,
    async (response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status || "error"}`);
      const text = await response.text();
      if (text.length > CURL_PROFILE_MAX_SOURCE_LENGTH) {
        throw new Error("curl-impersonate wrapper exceeds the safety limit");
      }
      return text;
    },
  );
}

async function fetchCurlProfileCatalog() {
  const entries = await fetchWithTimeout(
    CURL_PROFILE_UPDATE_SOURCE,
    {
      cache: "no-cache",
      credentials: "omit",
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
    CURL_PROFILE_REQUEST_TIMEOUT_MS,
    async (response) => {
      if (!response.ok) throw new Error(`GitHub API returned HTTP ${response.status || "error"}`);
      const result = await response.json();
      if (!Array.isArray(result)) throw new Error("GitHub bin listing was not an array");
      return result;
    },
  );

  const candidates = entries
    .filter(
      (entry) =>
        entry &&
        entry.type === "file" &&
        isCurlProfileWrapperName(entry.name),
    )
    .sort((a, b) => String(a.name).localeCompare(String(b.name)))
    .slice(0, CURL_PROFILE_MAX_COUNT);
  const profiles = (
    await mapWithConcurrency(
      candidates,
      MAX_CONCURRENT_DOWNLOADS,
      async (entry) => {
        try {
          const source = await downloadCurlProfileWrapper(entry);
          return createCurlProfileFromWrapper(entry.name, source);
        } catch (error) {
          debugWarn(`[curl-impersonate] Could not load ${entry.name}:`, error);
          return null;
        }
      },
    )
  ).filter(Boolean);
  if (!profiles.length) throw new Error("No supported browser profiles were found in bin");
  return normalizeCurlProfileCatalog({
    version: CURL_PROFILE_CACHE_VERSION,
    updatedAt: Date.now(),
    profiles,
  });
}

function getCurlProfileStatus() {
  return {
    ...curlProfileStatus,
    profileCount: curlProfileCatalog.profiles.length,
  };
}

function refreshCurlProfiles(force = false) {
  if (curlProfileUpdatePromise) return curlProfileUpdatePromise;
  if (!force && !isCurlProfileCatalogStale(curlProfileCatalog)) {
    return Promise.resolve({ success: true, updated: false, status: getCurlProfileStatus() });
  }
  curlProfileUpdatePromise = (async () => {
    curlProfileStatus = { ...curlProfileStatus, updating: true, error: null };
    try {
      const nextCatalog = await fetchCurlProfileCatalog();
      await enqueueConfigMutation(async () => {
        await storage.write({ [CURL_PROFILE_CACHE_KEY]: nextCatalog });
        curlProfileCatalog = nextCatalog;
        if (currentConfig) await broadcastConfigUpdated(currentConfig);
      });
      curlProfileStatus = {
        ...curlProfileStatus,
        updating: false,
        lastUpdate: nextCatalog.updatedAt,
        profileCount: nextCatalog.profiles.length,
        error: null,
      };
      return { success: true, updated: true, status: getCurlProfileStatus() };
    } catch (error) {
      curlProfileStatus = {
        ...curlProfileStatus,
        updating: false,
        error: error.message || String(error),
      };
      return { success: false, updated: false, error: curlProfileStatus.error, status: getCurlProfileStatus() };
    } finally {
      curlProfileUpdatePromise = null;
    }
  })();
  return curlProfileUpdatePromise;
}

function createLocalAdblockRules(config) {
  const sources = [];
  sources.push(parseFilterList(BUILTIN_ADBLOCK_COMPATIBILITY_FILTERS.join("\n")));
  if (config.tracker.useBuiltIn) {
    sources.push(
      parseFilterList(
        BUILTIN_TRACKER_DOMAINS.map((domain) =>
          `||${domain.replace(/^\*\./, "")}^$third-party`,
        ).join("\n"),
      ),
    );
  }
  if (config.tracker.customDomains) {
    sources.push(
      parseFilterList(
        parseDomainPatterns(config.tracker.customDomains)
          .map((domain) => `||${domain.replace(/^\*\./, "")}^`)
          .join("\n"),
      ),
    );
  }
  if (config.tracker.customFilters) {
    sources.push(parseFilterList(config.tracker.customFilters));
  }
  return sources;
}

function rebuildAdblockEngine(config) {
  const subscriptions = normalizeFilterSubscriptions(config.tracker.filterLists);
  const subscriptionIds = new Set(
    subscriptions.map((subscription) => subscription.id),
  );
  for (const id of adblockCompiledById.keys()) {
    if (!subscriptionIds.has(id)) {
      adblockCompiledById.delete(id);
    }
  }
  const compiled = [];
  for (const subscription of subscriptions) {
    const cached = adblockCache.lists[subscription.id];
    if (
      subscription.enabled &&
      cached &&
      cached.url === subscription.url &&
      adblockCompiledById.has(subscription.id)
    ) {
      compiled.push(adblockCompiledById.get(subscription.id));
    }
  }
  compiled.push(...createLocalAdblockRules(config));
  const merged = mergeCompiledRules(compiled);
  adblockEngine = createAdblockEngine(merged);
  adblockStatus = {
    ...adblockStatus,
    networkRules: merged.stats.network,
    cosmeticRules: merged.stats.cosmetic,
  };
}

function getOldestEnabledFilterUpdate(config) {
  const timestamps = normalizeFilterSubscriptions(config.tracker.filterLists)
    .filter((entry) => entry.enabled)
    .map((entry) => Number(adblockCache.lists[entry.id]?.updatedAt) || 0);
  return timestamps.length ? Math.min(...timestamps) : Date.now();
}

function isYoutubeUrl(url) {
  const hostname = getHostnameFromUrl(url);
  return Boolean(
    hostname &&
      (hostname === "youtube.com" || hostname.endsWith(".youtube.com")),
  );
}

function refreshStaleFiltersForYoutube(url) {
  const config = currentConfig;
  if (
    !isYoutubeUrl(url) ||
    !config ||
    !config.enabled ||
    !config.tracker.enabled ||
    !config.tracker.autoUpdate
  ) {
    return;
  }
  const lastUpdate = getOldestEnabledFilterUpdate(config);
  if (lastUpdate && Date.now() - lastUpdate < YOUTUBE_FILTER_MAX_AGE_MS) {
    return;
  }
  refreshAdblockFilters(config, true).catch((error) => {
    adblockStatus = { ...adblockStatus, updating: false, error: error.message };
    debugWarn("[Adblock] YouTube freshness update failed:", error);
  });
}

function scheduleAdblockUpdates(config) {
  if (!chrome.alarms) return;
  if (!config.enabled || !config.tracker.enabled || !config.tracker.autoUpdate) {
    chrome.alarms.clear(ADBLOCK_UPDATE_ALARM);
    adblockStatus.nextUpdate = null;
    return;
  }
  const intervalMinutes = config.tracker.updateIntervalHours * 60;
  chrome.alarms.create(ADBLOCK_UPDATE_ALARM, {
    delayInMinutes: Math.min(5, intervalMinutes),
    periodInMinutes: intervalMinutes,
  });
  adblockStatus.nextUpdate = Date.now() + Math.min(5, intervalMinutes) * 60000;
}

function scheduleProxyRetries(config) {
  if (!chrome.alarms) return;
  if (!config || !config.enabled || !config.proxy || !config.proxy.enabled) {
    chrome.alarms.clear(PROXY_RETRY_ALARM);
    return;
  }
  chrome.alarms.create(PROXY_RETRY_ALARM, {
    delayInMinutes: PROXY_RETRY_PERIOD_MINUTES,
    periodInMinutes: PROXY_RETRY_PERIOD_MINUTES,
  });
}

async function downloadFilterSubscription(subscription) {
  return fetchWithTimeout(
    subscription.url,
    {
      cache: "no-cache",
      credentials: "omit",
      redirect: "follow",
    },
    FILTER_REQUEST_TIMEOUT_MS,
    async (response) => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status || "error"}`);
      }
      const declaredLength = Number(response.headers?.get?.("content-length"));
      if (declaredLength > MAX_FILTER_TEXT_LENGTH) {
        throw new Error("Filter list exceeds the 16 MB safety limit");
      }
      const text = await response.text();
      if (text.length > MAX_FILTER_TEXT_LENGTH) {
        throw new Error("Filter list exceeds the 16 MB safety limit");
      }
      const compiled = parseFilterList(text);
      if (compiled.stats.network + compiled.stats.cosmetic === 0) {
        throw new Error("Filter list contained no supported rules");
      }
      return {
        name: subscription.name,
        url: subscription.url,
        updatedAt: Date.now(),
        text,
        compiled,
      };
    },
  );
}

function refreshAdblockFilters(configOverride, force = false) {
  if (adblockUpdatePromise) {
    return adblockUpdatePromise.then(() =>
      refreshAdblockFilters(currentConfig || configOverride, force),
    );
  }
  adblockUpdatePromise = (async () => {
    const config = configOverride || (await getConfig());
    const enabled = normalizeFilterSubscriptions(config.tracker.filterLists).filter(
      (entry) => entry.enabled,
    );
    if (!config.enabled || !config.tracker.enabled || !enabled.length ||
        (!force && !config.tracker.autoUpdate)) {
      return { success: true, updated: 0 };
    }
    const maxAge = config.tracker.updateIntervalHours * 60 * 60 * 1000;
    adblockStatus = { ...adblockStatus, updating: true, error: null };
    let updated = 0;
    const errors = [];
    const persistentUpdates = {};
    const pendingSubscriptions = enabled.filter((subscription) => {
      const cached = adblockCache.lists[subscription.id];
      return (
        force ||
        !cached ||
        cached.url !== subscription.url ||
        Date.now() - Number(cached.updatedAt || 0) >= maxAge
      );
    });
    const downloads = await mapWithConcurrency(
      pendingSubscriptions,
      MAX_CONCURRENT_DOWNLOADS,
      async (subscription) => {
        try {
          return {
            subscription,
            downloaded: await downloadFilterSubscription(subscription),
          };
        } catch (error) {
          return { subscription, error };
        }
      },
    );
    return enqueueConfigMutation(async () => {
      // Downloads can finish after a settings change. Commit against the
      // current configuration so disabled filters stay disabled.
      const effectiveConfig = currentConfig || config;
      const subscriptions = normalizeFilterSubscriptions(effectiveConfig.tracker.filterLists);
      const accepted = downloads.filter(({ subscription }) =>
        subscriptions.some((entry) =>
          entry.id === subscription.id && entry.url === subscription.url,
        ),
      );
      for (const { subscription, downloaded, error } of accepted) {
        if (downloaded) {
          const { compiled, ...entry } = downloaded;
          persistentUpdates[subscription.id] = entry;
          updated++;
        } else {
          errors.push(`${subscription.name}: ${error.message}`);
        }
      }
      if (updated) {
        const stored = await storage.read(ADBLOCK_CACHE_KEY);
        const previous = stored[ADBLOCK_CACHE_KEY];
        const persistentLists = previous?.version === ADBLOCK_CACHE_VERSION
          ? previous.lists || {}
          : {};
        const lists = {};
        for (const subscription of subscriptions) {
          const entry = persistentUpdates[subscription.id] || persistentLists[subscription.id];
          if (entry?.url === subscription.url) lists[subscription.id] = entry;
        }
        await storage.write({
          [ADBLOCK_CACHE_KEY]: { version: ADBLOCK_CACHE_VERSION, lists },
        });
        for (const { subscription, downloaded } of accepted) {
          if (!downloaded) continue;
          const { compiled, text, ...entry } = downloaded;
          adblockCompiledById.set(subscription.id, compiled);
          adblockCache.lists[subscription.id] = { ...entry, stats: compiled.stats };
        }
        rebuildAdblockEngine(effectiveConfig);
        applyTrackerBlocking(effectiveConfig, { rebuild: false });
        await broadcastCosmeticRulesUpdated();
      }
      adblockStatus = {
        ...adblockStatus,
        lastUpdate: getOldestEnabledFilterUpdate(effectiveConfig) || null,
        nextUpdate: effectiveConfig.enabled && effectiveConfig.tracker.enabled &&
          effectiveConfig.tracker.autoUpdate
          ? Date.now() + effectiveConfig.tracker.updateIntervalHours * 60 * 60 * 1000
          : null,
        error: errors.length ? errors.join("; ") : null,
      };
      return { success: errors.length === 0, updated, error: adblockStatus.error };
    });
  })().catch((error) => {
    adblockStatus.error = error.message;
    throw error;
  }).finally(() => {
    adblockStatus.updating = false;
    adblockUpdatePromise = null;
  });
  return adblockUpdatePromise;
}

function applyTrackerBlocking(config, { rebuild = true } = {}) {
  if (trackerListener) {
    chrome.webRequest.onBeforeRequest.removeListener(trackerListener);
    trackerListener = null;
  }

  if (!config.enabled || !config.tracker.enabled) {
    return;
  }
  if (!chrome.webRequest.onBeforeRequest) {
    throw new Error("Tracker blocking is unavailable in this browser");
  }

  if (rebuild) {
    rebuildAdblockEngine(config);
  }
  // Compatibility exceptions are network rules too, but they do not require
  // a blocking listener when no block rules are active.
  if (!adblockEngine.compiled.network.block.length) {
    return;
  }

  trackerListener = function (details) {
    const requestHostname = getHostnameFromUrl(details && details.url);
    const pageHostname = getRequestContextHostname(details);
    if (
      isExtensionInitiatedRequest(details) ||
      !requestHostname ||
      !pageHostname ||
      !isAdblockFeatureActiveForHostname(config, pageHostname) ||
      !shouldBlockRequest(
        adblockEngine,
        details,
        pageHostname,
        requestHostname,
      )
    ) {
      return {};
    }

    markTrackerBlocked(details.tabId, pageHostname, requestHostname);
    return { cancel: true };
  };

  chrome.webRequest.onBeforeRequest.addListener(
    trackerListener,
    {
      urls: ["<all_urls>"],
      types: [
        "main_frame",
        "font",
        "image",
        "media",
        "object",
        "other",
        "ping",
        "script",
        "stylesheet",
        "sub_frame",
        "websocket",
        "xmlhttprequest",
      ],
    },
    ["blocking"],
  );
}

async function broadcastCosmeticRulesUpdated() {
  return broadcastToHttpTabs({ type: "adblock-rules-updated" });
}

async function broadcastToHttpTabs(message) {
  const tabs = await queryTabs({ url: ["http://*/*", "https://*/*"] });
  await mapWithConcurrency(
    tabs.filter((tab) => typeof tab.id === "number"),
    MAX_CONCURRENT_TAB_MESSAGES,
    (tab) => sendMessageToTabIgnoringErrors(tab.id, message),
  );
}

async function queryTabs(queryInfo) {
  try {
    return (await callChromeApi(chrome.tabs, "query", queryInfo)) || [];
  } catch (error) {
    debugWarn("[Background] Failed to query tabs for broadcast:", error.message);
    return [];
  }
}

function sendMessageToTabIgnoringErrors(tabId, message) {
  return callChromeApi(chrome.tabs, "sendMessage", tabId, message).catch(
    (error) => {
      const messageText = error.message || "";
      const expected =
        messageText.includes(
          "Could not establish connection. Receiving end does not exist.",
        ) ||
        messageText.includes(
          "The message port closed before a response was received.",
        );
      if (!expected) {
        debugWarn(
          "[Background] tabs.sendMessage warning for tab",
          tabId + ":",
          messageText,
        );
      }
    },
  );
}

async function broadcastConfigUpdated(config, profileCatalog = curlProfileCatalog) {
  return broadcastToHttpTabs({ type: "config-updated", config, profileCatalog });
}

async function applyCurrentConfig(config) {
  await applyUserAgentSpoofing(config);
  applyTrackerBlocking(config);
  await applyWebRTCPolicy(config);
  await applyProxyPolicy(config);
  currentConfig = config;
  refreshToolbarIndicators();
}

async function initializeProxyCredentialSupport() {
  try {
    await proxyCredentialManager.initialize();
    setupProxyAuthentication();
  } catch (error) {
    debugWarn("[Proxy] Credential support failed to initialize:", error);
  }
}

async function initializeProxyHistoryCache() {
  try {
    await initializeProxyConnectionHistory();
  } catch (error) {
    proxyHistoryInitialized = true;
    debugWarn("[Proxy] Connection history failed to initialize:", error);
  }
}

async function initializeAdblockCache() {
  try {
    await loadAdblockCache();
  } catch (error) {
    adblockCache = { version: ADBLOCK_CACHE_VERSION, lists: {} };
    debugWarn("[Adblock] Filter cache failed to load:", error);
  }
}

async function initializeCurlProfileCache() {
  try {
    await loadCurlProfileCache();
  } catch (error) {
    curlProfileCatalog = normalizeCurlProfileCatalog(null);
    curlProfileStatus = {
      ...curlProfileStatus,
      profileCount: curlProfileCatalog.profiles.length,
      error: error.message || String(error),
    };
    debugWarn("[curl-impersonate] Profile cache failed to load:", error);
  }
}

async function initializeBackground() {
  // These storage-backed bootstrap tasks have no dependency on one another.
  // Start them together so slow storage reads do not add up during startup.
  const [config] = await Promise.all([
    loadConfig(),
    initializeProxyCredentialSupport(),
    initializeProxyHistoryCache(),
    initializeAdblockCache(),
    initializeCurlProfileCache(),
  ]);
  scheduleProxyRetries(config);
  scheduleCurlProfileUpdates();
  await applyCurrentConfig(config);
  scheduleAdblockUpdates(config);
  refreshAdblockFilters(config).catch((error) => {
    adblockStatus = { ...adblockStatus, updating: false, error: error.message };
    debugWarn("[Adblock] Automatic filter update failed:", error);
  });
  setupContextMenus();
  debugLog("Stealth Guard initialized");
}

ensureBackgroundInitialized().catch((error) => {
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

function isCloudflareChallengeSessionActive(details, hostname) {
  const tabId = Number(details && details.tabId);
  if (!Number.isInteger(tabId) || tabId < 0 || !hostname) {
    return false;
  }

  const now = Date.now();
  const directChallenge = isCloudflareChallengeUrl(details.url);
  if (directChallenge && !isCloudflareChallengeHostname(hostname)) {
    cloudflareChallengeByTab.set(tabId, {
      hostname,
      expiresAt: now + CLOUDFLARE_CHALLENGE_SESSION_TTL_MS,
    });
  }

  const challenge = cloudflareChallengeByTab.get(tabId);
  if (!challenge) return false;
  if (challenge.expiresAt <= now) {
    cloudflareChallengeByTab.delete(tabId);
    return false;
  }
  return challenge.hostname === hostname;
}

async function applyUserAgentSpoofing(configOverride) {
  const config = configOverride || (await getConfig());

  if (uaListener) {
    chrome.webRequest.onBeforeSendHeaders.removeListener(uaListener);
    uaListener = null;
  }

  if (
    !config.enabled ||
    (!config.useragent.enabled && !config.language.enabled)
  ) {
    return;
  }

  let appliedCatalog = curlProfileCatalog;
  let curlProfile = config.useragent.enabled
    ? getCurlProfileForConfig(config, appliedCatalog)
    : null;
  if (config.useragent.enabled && !curlProfile?.userAgent) {
    throw new Error(`Invalid User-Agent preset: ${config.useragent.preset}`);
  }
  const languageCache = new Map();

  uaListener = function (details) {
    const originalHeaders = details.requestHeaders || [];
    const hostname = getHostnameFromUrl(details.url);
    const userAgentActive = Boolean(
      hostname && isFeatureActiveForHostname(config, "useragent", hostname),
    );
    const languageActive = Boolean(
      hostname && isFeatureActiveForHostname(config, "language", hostname),
    );
    const challengeSessionActive = isCloudflareChallengeSessionActive(
      details,
      hostname,
    );
    if (
      !hostname ||
      isCloudflareChallengeUrl(details.url) ||
      challengeSessionActive ||
      isDataDomeChallengeHostname(hostname) ||
      (!userAgentActive && !languageActive)
    ) {
      return { requestHeaders: originalHeaders };
    }

    const requestHeaders = originalHeaders.map((header) => ({ ...header }));
    if (userAgentActive) {
      if (appliedCatalog !== curlProfileCatalog) {
        appliedCatalog = curlProfileCatalog;
        curlProfile = getCurlProfileForConfig(config, appliedCatalog);
      }
      const userAgent = curlProfile.userAgent;
      const clientHintHeaders = curlProfile.httpHeaders;
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
    }

    if (languageActive) {
      if (!languageCache.has(hostname)) {
        if (languageCache.size >= 256) {
          languageCache.delete(languageCache.keys().next().value);
        }
        languageCache.set(hostname, resolveLanguageIdentity(config, hostname));
      }
      const identity = languageCache.get(hostname);
      const header = requestHeaders.find(
        (entry) => entry.name.toLowerCase() === "accept-language",
      );
      if (header) {
        header.value = identity.acceptLanguage;
      } else {
        requestHeaders.push({
          name: "Accept-Language",
          value: identity.acceptLanguage,
        });
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
  return enqueueWebRTCPolicy(async () => {
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

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "loading") {
    trackerActivityPerTab.delete(tabId);
  }
  if (changeInfo.url) {
    const newHostname = getHostnameFromUrl(changeInfo.url);
    const challenge = cloudflareChallengeByTab.get(tabId);
    if (!newHostname || (challenge && challenge.hostname !== newHostname)) {
      cloudflareChallengeByTab.delete(tabId);
    }
    if (newHostname) {
      toolbarHostnamePerTab.set(tabId, newHostname);
    } else {
      toolbarHostnamePerTab.delete(tabId);
    }
    const tabData = triggeredFeaturesPerTab.get(tabId);
    if (!newHostname || (tabData && tabData.hostname !== newHostname)) {
      triggeredFeaturesPerTab.delete(tabId);
    }
    const trackerData = trackerActivityPerTab.get(tabId);
    if (!newHostname || (trackerData && trackerData.hostname !== newHostname)) {
      trackerActivityPerTab.delete(tabId);
    }
  }
  if (changeInfo.url || changeInfo.status === "loading") {
    refreshStaleFiltersForYoutube(changeInfo.url || (tab && tab.url));
    updateToolbarIndicator(
      tabId,
      getHostnameFromUrl(changeInfo.url || (tab && tab.url)),
    );
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  triggeredFeaturesPerTab.delete(tabId);
  trackerActivityPerTab.delete(tabId);
  toolbarHostnamePerTab.delete(tabId);
  cloudflareChallengeByTab.delete(tabId);
  toolbarProxyColorPerTab.delete(tabId);
  toolbarIconRenderVersions.delete(tabId);
});

if (chrome.alarms && chrome.alarms.onAlarm) {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (!alarm) return;
    if (alarm.name === PROXY_RETRY_ALARM) {
      enqueueConfigMutation(async () => {
        await ensureBackgroundInitialized();
        const config = currentConfig;
        if (
          !config ||
          !config.enabled ||
          !config.proxy ||
          !config.proxy.enabled ||
          !["error", "degraded"].includes(proxyRuntimeStatus.state)
        ) {
          return;
        }
        try {
          await applyProxyPolicy(config);
        } catch (error) {
          debugWarn("[Proxy] Scheduled retry failed:", error);
        }
      }).catch((error) => {
        debugWarn("[Proxy] Scheduled retry could not run:", error);
      });
      return;
    }
    if (alarm.name === CURL_PROFILE_UPDATE_ALARM) {
      ensureBackgroundInitialized()
        .then(() => refreshCurlProfiles(true))
        .catch((error) => {
          debugWarn("[curl-impersonate] Scheduled profile update failed:", error);
        });
      return;
    }
    if (alarm.name !== ADBLOCK_UPDATE_ALARM) return;
    ensureBackgroundInitialized()
      .then(() => refreshAdblockFilters(currentConfig))
      .catch((error) => {
        adblockStatus = { ...adblockStatus, updating: false, error: error.message };
        debugWarn("[Adblock] Scheduled filter update failed:", error);
      });
  });
}

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
  return { config: cloneConfig(await getConfig()) };
}

function areConfigValuesEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function didConfigSectionChange(previousConfig, nextConfig, key) {
  return !areConfigValuesEqual(
    previousConfig ? previousConfig[key] : undefined,
    nextConfig ? nextConfig[key] : undefined,
  );
}

function getConfigChangeFlags(previousConfig, nextConfig) {
  const changed = (key) => didConfigSectionChange(previousConfig, nextConfig, key);
  const globalEnabledChanged = changed("enabled");
  const globalWhitelistChanged = changed("globalWhitelist");

  return {
    userAgentChanged:
      changed("useragent") ||
      changed("language") ||
      changed("proxy") ||
      globalWhitelistChanged ||
      globalEnabledChanged,
    trackerChanged:
      changed("tracker") ||
      globalWhitelistChanged ||
      globalEnabledChanged,
    webrtcChanged:
      changed("webrtc") ||
      globalEnabledChanged,
    proxyChanged:
      changed("proxy") ||
      globalWhitelistChanged ||
      globalEnabledChanged,
  };
}

async function applyConfigChanges(changeFlags, config) {
  if (changeFlags.userAgentChanged) {
    await applyUserAgentSpoofing(config);
  }

  if (changeFlags.trackerChanged) {
    applyTrackerBlocking(config);
    scheduleAdblockUpdates(config);
  }

  if (changeFlags.webrtcChanged) {
    await applyWebRTCPolicy(config);
  }

  if (changeFlags.proxyChanged) {
    scheduleProxyRetries(config);
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
  if (changeFlags.trackerChanged) {
    refreshAdblockFilters(nextConfig).catch((error) => {
      adblockStatus = { ...adblockStatus, updating: false, error: error.message };
      debugWarn("[Adblock] Filter refresh failed:", error);
    });
    await broadcastCosmeticRulesUpdated();
  }
  await broadcastConfigUpdated(nextConfig);
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
      areConfigValuesEqual(previousConfig, nextConfig)
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
    const changed = !areConfigValuesEqual(previousConfig, nextConfig);

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
      !areConfigValuesEqual(previousConfig, nextConfig)
    ) {
      await saveConfigWithRollback(previousConfig, nextConfig);
    }

    await proxyCredentialManager.clearAll();

    return { success: true };
  });
}

function handleGetTriggeredFeaturesMessage(request) {
  const tabData = triggeredFeaturesPerTab.get(request.tabId);
  const trackerData = trackerActivityPerTab.get(request.tabId);
  return {
    features: tabData && tabData.features ? Array.from(tabData.features) : [],
    tracker: {
      count: trackerData ? trackerData.count : 0,
      domains: trackerData ? Array.from(trackerData.domains) : [],
      entries: trackerData
        ? Array.from(trackerData.domainCounts, ([domain, count]) => ({
            domain,
            count,
          }))
        : [],
    },
  };
}

function handleGetAdblockStatusMessage(request, sender) {
  assertExtensionPageSender(sender);
  const lists = currentConfig
    ? normalizeFilterSubscriptions(currentConfig.tracker.filterLists)
    : [];
  return {
    success: true,
    status: {
      ...adblockStatus,
      lists: lists.map((list) => ({
        id: list.id,
        name: list.name,
        enabled: list.enabled,
        updatedAt: adblockCache.lists[list.id]?.updatedAt || null,
        networkRules:
          adblockCache.lists[list.id]?.stats?.network || 0,
        cosmeticRules:
          adblockCache.lists[list.id]?.stats?.cosmetic || 0,
      })),
    },
  };
}

async function handleUpdateAdblockFiltersMessage(request, sender) {
  assertExtensionPageSender(sender);
  const result = await refreshAdblockFilters(await getConfig(), true);
  return { ...result, status: { ...adblockStatus } };
}

function handleGetCurlProfileStatusMessage(request, sender) {
  assertExtensionPageSender(sender);
  return {
    success: true,
    status: getCurlProfileStatus(),
    catalog: curlProfileCatalog,
  };
}

async function handleUpdateCurlProfilesMessage(request, sender) {
  assertExtensionPageSender(sender);
  const result = await refreshCurlProfiles(true);
  return { ...result, catalog: curlProfileCatalog };
}

async function handleRepairWindowGeometryMessage(request, sender) {
  const windowId = Number(sender && sender.tab && sender.tab.windowId);
  const width = Number(request && request.width);
  const height = Number(request && request.height);
  if (
    !Number.isInteger(windowId) ||
    windowId < 0 ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < 1 ||
    height < 1 ||
    !chrome.windows
  ) {
    return { success: false, error: "Native window geometry is unavailable" };
  }

  try {
    const current = await callChromeApi(chrome.windows, "get", windowId);
    const update = {
      width: Math.max(
        Math.round(width),
        Number.isFinite(Number(current && current.width))
          ? Number(current.width)
          : 0,
      ),
      height: Math.max(
        Math.round(height),
        Number.isFinite(Number(current && current.height))
          ? Number(current.height)
          : 0,
      ),
    };
    await callChromeApi(chrome.windows, "update", windowId, update);
    return { success: true };
  } catch (error) {
    debugWarn("[Window] Could not repair native geometry:", error);
    return { success: false, error: error.message || String(error) };
  }
}

async function handleGetCosmeticRulesMessage(request, sender) {
  await ensureBackgroundInitialized();
  const hostname = resolveTabHostname(sender, request && request.hostname);
  const config = currentConfig;
  if (
    !config ||
    !hostname ||
    !isAdblockFeatureActiveForHostname(config, hostname) ||
    !config.tracker.cosmeticFiltering ||
    isDomainAllowlisted(hostname, config.tracker.cosmeticWhitelist)
  ) {
    return { success: true, enabled: false, selectors: [] };
  }
  const tokens = Array.isArray(request && request.tokens)
    ? request.tokens
        .filter((token) => typeof token === "string" && /^[a-z0-9_-]{1,128}$/i.test(token))
        .slice(0, 3000)
    : [];
  return {
    success: true,
    enabled: true,
    selectors: getCosmeticSelectors(adblockEngine, hostname, tokens),
    youtubeEnhancements: Boolean(
      config.tracker.youtubeEnhancements &&
        (hostname === "youtube.com" || hostname.endsWith(".youtube.com")),
    ),
  };
}

function handleAddCosmeticRuleMessage(request, sender) {
  return enqueueConfigMutation(async () => {
    const hostname = resolveTabHostname(sender, null);
    const requestedHostname = normalizeHostname(request && request.hostname);
    const selector =
      request && typeof request.selector === "string"
        ? request.selector.trim()
        : "";
    const candidate = `${hostname || ""}##${selector}`;
    const parsed = parseFilterList(candidate);
    if (
      !hostname ||
      requestedHostname !== hostname ||
      !selector ||
      parsed.cosmetic.hide.length !== 1 ||
      parsed.cosmetic.hide[0].selector !== selector
    ) {
      throw new Error("Invalid cosmetic filter");
    }
    const previousConfig = cloneConfig(await getConfig());
    const nextConfig = cloneConfig(previousConfig);
    const existing = nextConfig.tracker.customFilters
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (!existing.includes(candidate)) existing.push(candidate);
    nextConfig.tracker.customFilters = existing.join("\n");
    const normalized = normalizeConfig(nextConfig);
    if (!normalized.tracker.customFilters.includes(candidate)) {
      throw new Error("Custom filter limit reached");
    }
    await saveConfigWithRollback(previousConfig, normalized);
    return { success: true, rule: candidate };
  });
}

async function handlePrepareProxyProfileMessage(request) {
  return {
    success: true,
    profile: await prepareProxyProfile(request && request.profile),
  };
}

function assertExtensionPageSender(sender) {
  const senderUrl = sender && typeof sender.url === "string" ? sender.url : "";
  if (sender && sender.tab && !senderUrl.startsWith(chrome.runtime.getURL(""))) {
    throw new Error("This request is available only to extension pages");
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

async function handleGetIdentityDiagnosticsMessage(request, sender) {
  assertExtensionPageSender(sender);
  const config = await getConfig();
  const curlProfile = getCurlProfileForConfig(config, curlProfileCatalog);
  const hostname = normalizeHostname(request && request.hostname);
  const tabId = Number(request && request.tabId);
  const identity = resolveContentIdentity(config, hostname);
  const vpnLocation = identity.vpnLocation;
  const languageIdentity = identity.language;
  const trackerData = Number.isInteger(tabId)
    ? trackerActivityPerTab.get(tabId)
    : null;
  const triggeredData = Number.isInteger(tabId)
    ? triggeredFeaturesPerTab.get(tabId)
    : null;
  const activeForSite = (featureName) =>
    hostname
      ? isFeatureActiveForHostname(config, featureName, hostname)
      : Boolean(config.enabled && config[featureName].enabled);
  const effectiveWebRtc = await getWebRTCPolicySetting();
  const timezoneFromProxy = Boolean(
    vpnLocation && vpnLocation.syncTimezone && vpnLocation.timezone,
  );
  const geolocationFromProxy = Boolean(
    vpnLocation &&
      vpnLocation.syncGeolocation &&
      Number.isFinite(vpnLocation.latitude) &&
      Number.isFinite(vpnLocation.longitude),
  );

  return {
    success: true,
    diagnostics: {
      generatedAt: Date.now(),
      hostname: hostname || null,
      protectionEnabled: config.enabled,
      globallyAllowlisted: Boolean(
        hostname && isDomainAllowlisted(hostname, config.globalWhitelist),
      ),
      userAgent: {
        enabled: activeForSite("useragent"),
        preset: config.useragent.preset,
        curlProfile: curlProfile ? curlProfile.target : null,
        value: curlProfile?.userAgent || null,
      },
      language: {
        enabled: activeForSite("language"),
        preset: config.language.preset,
        ...languageIdentity,
      },
      timezone: {
        enabled: activeForSite("timezone"),
        name: timezoneFromProxy
          ? vpnLocation.timezone
          : config.timezone.name,
        source: timezoneFromProxy ? "proxy" : "preset",
      },
      geolocation: {
        enabled: activeForSite("geolocation"),
        synchronized: geolocationFromProxy,
        coordinates: geolocationFromProxy
          ? {
              latitude: vpnLocation.latitude,
              longitude: vpnLocation.longitude,
            }
          : null,
      },
      webrtc: {
        enabled: Boolean(config.enabled && config.webrtc.enabled),
        requestedPolicy:
          config.enabled && config.webrtc.enabled
            ? config.webrtc.policy
            : "default",
        effectivePolicy: effectiveWebRtc.value || "unknown",
        controlLevel: effectiveWebRtc.levelOfControl || "unknown",
      },
      proxy: {
        enabled: Boolean(config.enabled && config.proxy.enabled),
        state: proxyRuntimeStatus.state,
        profile: proxyRuntimeStatus.profile,
        exitIp: proxyRuntimeStatus.exitIp,
        location: vpnLocation
          ? {
              city: vpnLocation.city,
              country: vpnLocation.country,
              countryCode: vpnLocation.countryCode,
            }
          : null,
      },
      tracker: {
        enabled: activeForSite("tracker"),
        totalRules: adblockEngine.compiled.stats.network + adblockEngine.compiled.stats.cosmetic,
        builtInRules: config.tracker.useBuiltIn
          ? BUILTIN_TRACKER_DOMAINS.length
          : 0,
        customRules: parseDomainPatterns(
          config.tracker.customDomains,
        ).length,
        blockedCount:
          trackerData &&
          (!hostname || isSameSiteHostname(trackerData.hostname, hostname))
            ? trackerData.count
            : 0,
        blockedDomains:
          trackerData &&
          (!hostname || isSameSiteHostname(trackerData.hostname, hostname))
            ? Array.from(trackerData.domains)
            : [],
      },
      triggeredFeatures:
        triggeredData &&
        (!hostname || isSameSiteHostname(triggeredData.hostname, hostname))
          ? Array.from(triggeredData.features)
          : [],
    },
  };
}

function handleVerifyProxyConnectionMessage(request, sender) {
  assertExtensionPageSender(sender);
  return enqueueConfigMutation(async () => {
    await applyProxyPolicy(await getConfig());
    return { success: true, status: { ...proxyRuntimeStatus } };
  });
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
  await enqueueProxyHistoryWrite(() =>
    storage.write({ [PROXY_CONNECTION_HISTORY_KEY]: [] }),
  );
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
  "get-adblock-status": handleGetAdblockStatusMessage,
  "update-adblock-filters": handleUpdateAdblockFiltersMessage,
  "get-curl-profile-status": handleGetCurlProfileStatusMessage,
  "update-curl-profiles": handleUpdateCurlProfilesMessage,
  "repair-window-geometry": handleRepairWindowGeometryMessage,
  "get-cosmetic-rules": handleGetCosmeticRulesMessage,
  "add-cosmetic-rule": handleAddCosmeticRuleMessage,
  "prepare-proxy-profile": handlePrepareProxyProfileMessage,
  "get-proxy-credential-status": handleGetProxyCredentialStatusMessage,
  "set-proxy-credentials": handleSetProxyCredentialsMessage,
  "clear-proxy-credentials": handleClearProxyCredentialsMessage,
  "get-proxy-runtime-status": handleGetProxyRuntimeStatusMessage,
  "get-identity-diagnostics": handleGetIdentityDiagnosticsMessage,
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
  // Extension pages opened in tabs still target the requested website tab.
  if (sender?.url?.startsWith(chrome.runtime.getURL(""))) {
    sender = { ...sender, tab: undefined };
  }
  const messageType = request && request.type;
  debugLog(
    "Received message:",
    messageType,
    "from:",
    sender && sender.tab ? "tab" : "popup/options",
  );

  const handler = Object.hasOwn(messageHandlers, messageType) && messageHandlers[messageType];
  if (!handler) {
    return;
  }

  ensureBackgroundInitialized()
    .then(() => handler(request, sender))
    .then((payload) => sendResponse(payload === undefined ? { success: true } : payload))
    .catch((error) => {
      debugError(`[Background] Handler failed for "${messageType}":`, error);
      sendResponse({ success: false, error: error.message });
    });
  return true;
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
  callChromeApi(chrome.tabs, "reload", tabId).catch((error) => {
    debugWarn("Failed to reload tab after allowlist change:", error.message);
  });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab || !tab.url) return;

  try {
    const hostname = getHostnameFromUrl(tab.url)?.replace(/^www\./, "");
    if (!hostname) throw new Error("Invalid tab URL");

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
      chrome.tabs.create({
        url: `${chrome.runtime.getURL("options/options.html")}?tabId=${tab.id}#selftest-section`,
      });
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
