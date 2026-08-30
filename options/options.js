let currentConfig = null;
let saveTimeout = null;
let lastSavedSnapshot = null;
let saveInFlightSnapshot = null;
let editingProxyProfileName = null;
let toastTimeout = null;
let proxyCredentialStatuses = new Map();
let proxyRuntimeStatus = null;
let proxyDiagnostics = null;
let adblockStatus = null;
let curlProfileStatus = null;
let curlProfileCatalog = normalizeCurlProfileCatalog(null);
let bundledGpuProfiles = [];

const AUTO_SAVE_DELAY_MS = 1000;
const MAX_CONFIG_FILE_SIZE = 1024 * 1024;
const TIMEZONE_LABEL_REFRESH_MS = 60 * 1000;

document.addEventListener("DOMContentLoaded", initializeOptions);
document.addEventListener("visibilitychange", saveWhenHidden);
setInterval(() => {
  updateTimeZoneSelectLabels(document.getElementById("timezone-select"));
}, TIMEZONE_LABEL_REFRESH_MS);

async function initializeOptions() {
  try {
    await loadOptionsConfig();
    setupEventListeners();
    await initializeSelfTest();
    if (window.location.hash) {
      setTimeout(() => scrollToSection(window.location.hash.slice(1)), 300);
    }
  } catch (error) {
    console.error("Failed to initialize options:", error);
    showToast(
      "Failed to load settings. Reload the extension and try again.",
      "error",
    );
  }
}

function serializeConfig(config) {
  return JSON.stringify(config);
}

async function loadOptionsConfig() {
  currentConfig = await loadRuntimeConfig();
  await loadBundledGpuProfiles();
  await refreshStoredProxyProfiles();
  await Promise.all([
    refreshProxyCredentialStatuses(),
    refreshProxyRuntimeStatus(),
    refreshProxyDiagnostics(),
    refreshAdblockStatus(),
    refreshCurlProfileStatus(),
  ]);
  lastSavedSnapshot = serializeConfig(currentConfig);
  saveInFlightSnapshot = null;
  populateForm();
}

async function loadBundledGpuProfiles() {
  try {
    const response = await fetch(
      chrome.runtime.getURL(`${GPU_PROFILE_BUNDLE_PATH}/index.json`),
    );
    if (!response.ok) throw new Error("Bundled GPU profile index unavailable");
    bundledGpuProfiles = normalizeGpuProfileIndex(await response.json()).filter(
      (profile) => profile.webgpuAvailable,
    );
  } catch (error) {
    console.warn("Failed to load bundled GPU profiles:", error);
    bundledGpuProfiles = [];
  }
}

async function refreshStoredProxyProfiles() {
  const profiles = currentConfig?.proxy?.profiles;
  if (!Array.isArray(profiles) || profiles.length === 0) {
    return false;
  }

  const nextConfig = normalizeConfig(JSON.parse(JSON.stringify(currentConfig)));
  const refreshedProfiles = [];
  const renames = new Map();

  for (const profile of profiles) {
    try {
      const response = await sendRuntimeMessage({
        type: "prepare-proxy-profile",
        profile,
      });
      const prepared = assertRuntimeResponse(
        response,
        "Invalid proxy profile",
      ).profile;
      if (!prepared || typeof prepared !== "object") {
        throw new Error("Invalid proxy profile");
      }
      refreshedProfiles.push(prepared);
      if (profile.name && prepared.name && profile.name !== prepared.name) {
        renames.set(profile.name, prepared.name);
      }
    } catch (error) {
      console.warn("Failed to refresh proxy profile metadata:", error);
      refreshedProfiles.push(profile);
    }
  }

  nextConfig.proxy.profiles = refreshedProfiles;
  const renameProfile = (name) => renames.get(name) || name;
  nextConfig.proxy.activeProfile = renameProfile(nextConfig.proxy.activeProfile);
  nextConfig.proxy.fallbackProfiles = nextConfig.proxy.fallbackProfiles.map(
    renameProfile,
  );
  nextConfig.proxy.domainRoutes = nextConfig.proxy.domainRoutes.map((route) => ({
    ...route,
    profile: renameProfile(route.profile),
  }));

  const normalizedNextConfig = normalizeConfig(nextConfig);
  if (serializeConfig(normalizedNextConfig) === serializeConfig(currentConfig)) {
    return false;
  }

  try {
    const response = await sendRuntimeMessage({
      type: "update-config",
      config: normalizedNextConfig,
    });
    assertRuntimeResponse(response, "Failed to save proxy profile metadata");
    currentConfig = normalizedNextConfig;
    return true;
  } catch (error) {
    console.warn("Failed to save refreshed proxy profile metadata:", error);
    return false;
  }
}

function populateForm() {
  document.getElementById("global-enabled").checked = currentConfig.enabled;
  document.getElementById("global-whitelist").value =
    currentConfig.globalWhitelist;
  document.getElementById("notifications-enabled").checked =
    currentConfig.notifications.enabled;

  for (const featureName of PROTECTION_FEATURES) {
    document.getElementById(`${featureName}-enabled`).checked =
      currentConfig[featureName].enabled;
    document.getElementById(`${featureName}-whitelist`).value =
      currentConfig[featureName].whitelist;
  }

  document.getElementById("webgl-preset").value = currentConfig.webgl.preset;
  document.getElementById("webgl-mode").value = currentConfig.webgl.mode;
  document.getElementById("webgl-compatibility-whitelist").value =
    currentConfig.webgl.compatibilityWhitelist;
  document.getElementById("webgl-strict-whitelist").value =
    currentConfig.webgl.strictWhitelist;
  populateGpuProfileOptions();
  renderGpuProfileStatus();
  document.getElementById("canvas-noise-level").value =
    currentConfig.canvas.noiseLevel;
  const timezoneSelect = document.getElementById("timezone-select");
  updateTimeZoneSelectLabels(timezoneSelect);
  timezoneSelect.value = currentConfig.timezone.name;
  populateUserAgentOptions();
  document.getElementById("language-preset").value =
    currentConfig.language.preset;
  document.getElementById("webrtc-policy").value = currentConfig.webrtc.policy;
  document.getElementById("tracker-enabled").checked =
    currentConfig.tracker.enabled;
  document.getElementById("tracker-whitelist").value =
    currentConfig.tracker.whitelist;
  document.getElementById("tracker-use-built-in").checked =
    currentConfig.tracker.useBuiltIn;
  document.getElementById("tracker-custom-domains").value =
    currentConfig.tracker.customDomains;
  document.getElementById("tracker-auto-update").checked =
    currentConfig.tracker.autoUpdate;
  document.getElementById("tracker-update-interval").value =
    currentConfig.tracker.updateIntervalHours;
  document.getElementById("tracker-cosmetic-filtering").checked =
    currentConfig.tracker.cosmeticFiltering;
  document.getElementById("tracker-cosmetic-whitelist").value =
    currentConfig.tracker.cosmeticWhitelist;
  document.getElementById("tracker-youtube-enhancements").checked =
    currentConfig.tracker.youtubeEnhancements;
  document.getElementById("tracker-custom-filters").value =
    currentConfig.tracker.customFilters;
  const defaultIds = new Set(
    DEFAULT_TRACKER_FILTER_LISTS.map((entry) => entry.id),
  );
  for (const input of document.querySelectorAll("[data-filter-list-id]")) {
    const list = currentConfig.tracker.filterLists.find(
      (entry) => entry.id === input.dataset.filterListId,
    );
    input.checked = Boolean(list && list.enabled);
  }
  document.getElementById("tracker-custom-subscriptions").value =
    currentConfig.tracker.filterLists
      .filter((entry) => !defaultIds.has(entry.id))
      .map((entry) => entry.url)
      .join("\n");
  renderAdblockStatus();
  document.getElementById("proxy-enabled").checked =
    currentConfig.proxy.enabled;
  document.getElementById("proxy-routing-mode").value =
    currentConfig.proxy.routingMode;
  document.getElementById("proxy-bypass-list").value =
    currentConfig.proxy.bypassList.join(", ");
  document.getElementById("proxy-sync-timezone").checked =
    currentConfig.proxy.syncTimezone;
  document.getElementById("proxy-sync-geolocation").checked =
    currentConfig.proxy.syncGeolocation;
  document.getElementById("proxy-sync-language").checked =
    currentConfig.proxy.syncLanguage;

  updateUserAgentString();
  renderCurlProfileStatus();
  populateProxyProfiles();
  updateProxyRoutingModeUi();
  renderProxyRuntimeStatus();
  renderProxyDiagnostics();
}

function renderGpuProfileStatus() {
  const status = document.getElementById("gpu-profile-status");
  const clearButton = document.getElementById("clear-gpu-profile");
  if (!status || !clearButton) return;
  const summary = getGpuProfileSummary(currentConfig && currentConfig.gpuProfile);
  clearButton.disabled = !summary;
  if (!summary) {
    status.textContent = "No combined profile loaded.";
    return;
  }
  const surfaceText =
    summary.webgpuAvailable === null
      ? `${summary.webglSurfaces} WebGL surface(s), WebGPU not included`
      : `${summary.webglSurfaces} WebGL surface(s), ${summary.webgpuLimits} WebGPU limits`;
  status.textContent = `${summary.id} · ${summary.vendor}${summary.family ? ` ${summary.family}` : ""} · ${surfaceText}`;
}

function populateGpuProfileOptions() {
  const select = document.getElementById("gpu-profile-preset");
  if (!select) return;
  const selectedId = currentConfig?.gpuProfile?.id || "";
  const options = [new Option("No bundled profile", "")];
  for (const profile of bundledGpuProfiles) {
    const label = [
      profile.id,
      profile.gpuVendor,
      profile.gpuFamily,
      profile.screen,
    ]
      .filter(Boolean)
      .join(" · ");
    options.push(new Option(label, profile.id, false, profile.id === selectedId));
  }
  if (selectedId && !bundledGpuProfiles.some((entry) => entry.id === selectedId)) {
    options.push(new Option(`${selectedId} · Imported profile`, selectedId, true, true));
  }
  select.replaceChildren(...options);
}

function getProxyEndpoint(profile) {
  return profile && profile.host && profile.port
    ? `${String(profile.host).toLowerCase()}:${Number(profile.port)}`
    : null;
}

function getProxyCredentialStatus(profile) {
  return (
    proxyCredentialStatuses.get(getProxyEndpoint(profile)) || {
      configured: false,
      username: "",
      persisted: false,
    }
  );
}

async function refreshProxyCredentialStatuses() {
  try {
    const response = await sendRuntimeMessage({
      type: "get-proxy-credential-status",
      profiles: currentConfig.proxy.profiles,
    });
    assertRuntimeResponse(response, "Failed to load proxy credentials");
    proxyCredentialStatuses = new Map(
      (response.credentials || []).map((entry) => [entry.endpoint, entry]),
    );
    return true;
  } catch (error) {
    console.warn("Proxy credential status is unavailable:", error);
    proxyCredentialStatuses = new Map();
    return false;
  }
}

async function refreshProxyRuntimeStatus() {
  try {
    const response = await sendRuntimeMessage({
      type: "get-proxy-runtime-status",
    });
    assertRuntimeResponse(response, "Failed to load proxy connection status");
    proxyRuntimeStatus = response.status;
    return true;
  } catch (error) {
    console.warn("Proxy connection status is unavailable:", error);
    proxyRuntimeStatus = {
      state: currentConfig.proxy.enabled ? "configured" : "idle",
    };
    return false;
  }
}

async function refreshProxyDiagnostics() {
  try {
    const response = await sendRuntimeMessage({
      type: "get-proxy-diagnostics",
    });
    assertRuntimeResponse(response, "Failed to load proxy diagnostics");
    proxyDiagnostics = response.diagnostics;
    return true;
  } catch (error) {
    console.warn("Proxy diagnostics are unavailable:", error);
    proxyDiagnostics = null;
    return false;
  }
}

function updateProxyRoutingModeUi() {
  const mode = document.getElementById("proxy-routing-mode").value;
  const routesOnly = mode === "protect-selected";
  const routesGroup = document.getElementById("proxy-routes-group");

  // The default proxy is ignored in protect-selected mode — each rule carries
  // its own server — so hide the control instead of letting it look effective.
  document.getElementById("proxy-default-field").hidden = routesOnly;
  document.getElementById("proxy-bypass-field").hidden =
    mode !== "bypass-selected";
  if (routesOnly) {
    routesGroup.open = true;
  }

  // Step 2 disappears in this mode, so the last step keeps the count honest.
  document.getElementById("proxy-step-coverage").textContent = routesOnly
    ? "Step 2 · Which sites use it"
    : "Step 3 · Which sites use it";
  document.getElementById("proxy-routes-summary").textContent = routesOnly
    ? "Per-site proxy rules (required for this mode)"
    : "Per-site proxy rules";
  document.getElementById("proxy-routes-help").textContent = routesOnly
    ? "Only sites matching a rule use a proxy, and each rule picks its own server. Everything else connects directly."
    : "Each rule sends matching sites through the server you pick here, overriding the default proxy.";
  document.getElementById("proxy-routing-mode-help").textContent = routesOnly
    ? "Add a rule below for every site you want proxied; unmatched sites connect directly."
    : mode === "protect-all"
      ? "Every public site uses the default proxy, except your global allowlist and required local addresses."
      : "Sites you list below connect directly and expose your normal network identity.";
}

function renderProxyDiagnostics() {
  const summary = document.getElementById("proxy-diagnostics-summary");
  const history = document.getElementById("proxy-connection-history");
  summary.replaceChildren();
  history.replaceChildren();
  if (!proxyDiagnostics) {
    summary.textContent = "Diagnostics unavailable until the background page is reloaded.";
    return;
  }

  const status = proxyDiagnostics.status || {};
  const configuration = proxyDiagnostics.configuration || {};
  const effective = proxyDiagnostics.effectiveSettings || {};
  const details = [
    ["State", status.state || "unknown"],
    ["Effective mode", effective.mode || "system/direct"],
    ["Control", effective.controlLevel || "unknown"],
    ["Routing", configuration.routingMode || "unknown"],
    ["Endpoint", status.endpoint || "none"],
    ["Exit IP", status.exitIp || "not verified"],
    ["Profiles with credentials", String(configuration.credentialProfileCount || 0)],
  ];
  for (const [label, value] of details) {
    const item = document.createElement("div");
    const term = document.createElement("strong");
    const description = document.createElement("span");
    term.textContent = label;
    description.textContent = value;
    item.append(term, description);
    summary.appendChild(item);
  }

  for (const entry of proxyDiagnostics.history || []) {
    const item = document.createElement("li");
    const when = new Date(entry.timestamp).toLocaleString();
    const parts = [when, entry.state];
    if (entry.profile) parts.push(entry.profile);
    if (entry.endpoint) parts.push(entry.endpoint);
    if (entry.exitIp) parts.push(`exit ${entry.exitIp}`);
    if (entry.error) parts.push(entry.error);
    item.textContent = parts.join(" · ");
    history.appendChild(item);
  }
  if (!history.children.length) {
    const empty = document.createElement("li");
    empty.className = "empty-state";
    empty.textContent = "No connection events recorded yet";
    history.appendChild(empty);
  }
}

function renderProxyRuntimeStatus() {
  const card = document.getElementById("proxy-runtime-card");
  const state = document.getElementById("proxy-runtime-state");
  const detail = document.getElementById("proxy-runtime-detail");
  const verify = document.getElementById("verify-proxy-connection");
  const status = proxyRuntimeStatus || { state: "idle" };
  const labels = {
    idle: "Not connected",
    connecting: "Connecting…",
    configured: "Proxy configured",
    connected: "Protected",
    routing: "Site routes active",
    degraded: "Protection not verified",
    error: "Proxy error",
    conflict: "Proxy conflict",
  };

  card.dataset.state = status.state;
  state.textContent = labels[status.state] || "Unknown proxy state";
  if (status.state === "connected") {
    detail.textContent = [
      status.profile || "Proxy",
      status.endpoint,
      `exit ${status.exitIp || "verified"}`,
    ]
      .filter(Boolean)
      .join(" · ");
  } else if (status.error) {
    detail.textContent = status.error;
  } else if (status.state === "routing") {
    detail.textContent = "Domain-specific proxy routes are installed.";
  } else {
    detail.textContent = "Enable a configured profile to protect browser traffic.";
  }
  verify.disabled = !currentConfig.proxy.enabled;
}

function collectForm(options = {}) {
  const showErrors = options.showErrors !== false;
  if (!currentConfig) {
    return false;
  }

  currentConfig.enabled = document.getElementById("global-enabled").checked;
  currentConfig.globalWhitelist =
    document.getElementById("global-whitelist").value;
  currentConfig.notifications.enabled = document.getElementById(
    "notifications-enabled",
  ).checked;

  for (const featureName of PROTECTION_FEATURES) {
    currentConfig[featureName].enabled = document.getElementById(
      `${featureName}-enabled`,
    ).checked;
    currentConfig[featureName].whitelist = document.getElementById(
      `${featureName}-whitelist`,
    ).value;
  }

  currentConfig.webgl.preset = document.getElementById("webgl-preset").value;
  currentConfig.webgl.mode = document.getElementById("webgl-mode").value;
  currentConfig.webgl.compatibilityWhitelist = document.getElementById(
    "webgl-compatibility-whitelist",
  ).value;
  currentConfig.webgl.strictWhitelist = document.getElementById(
    "webgl-strict-whitelist",
  ).value;
  currentConfig.canvas.noiseLevel =
    document.getElementById("canvas-noise-level").value;
  currentConfig.timezone.name =
    document.getElementById("timezone-select").value;
  const selectedUserAgent = parseUserAgentSelection(
    document.getElementById("useragent-preset").value,
  );
  currentConfig.useragent.preset = selectedUserAgent.preset;
  currentConfig.useragent.curlProfile = selectedUserAgent.curlProfile;
  currentConfig.language.preset =
    document.getElementById("language-preset").value;
  currentConfig.webrtc.policy = document.getElementById("webrtc-policy").value;
  currentConfig.tracker.enabled =
    document.getElementById("tracker-enabled").checked;
  currentConfig.tracker.whitelist =
    document.getElementById("tracker-whitelist").value;
  currentConfig.tracker.useBuiltIn = document.getElementById(
    "tracker-use-built-in",
  ).checked;
  currentConfig.tracker.customDomains = document.getElementById(
    "tracker-custom-domains",
  ).value;
  currentConfig.tracker.autoUpdate = document.getElementById(
    "tracker-auto-update",
  ).checked;
  currentConfig.tracker.updateIntervalHours = Number.parseInt(
    document.getElementById("tracker-update-interval").value,
    10,
  );
  currentConfig.tracker.cosmeticFiltering = document.getElementById(
    "tracker-cosmetic-filtering",
  ).checked;
  currentConfig.tracker.cosmeticWhitelist = document.getElementById(
    "tracker-cosmetic-whitelist",
  ).value;
  currentConfig.tracker.youtubeEnhancements = document.getElementById(
    "tracker-youtube-enhancements",
  ).checked;
  currentConfig.tracker.customFilters = document.getElementById(
    "tracker-custom-filters",
  ).value;
  const existingDefaults = DEFAULT_TRACKER_FILTER_LISTS.map((defaultEntry) => ({
    ...defaultEntry,
    ...(currentConfig.tracker.filterLists.find(
      (entry) => entry.id === defaultEntry.id,
    ) || {}),
  }));
  for (const entry of existingDefaults) {
    const input = document.querySelector(`[data-filter-list-id="${entry.id}"]`);
    entry.enabled = Boolean(input && input.checked);
  }
  const customSubscriptions = document
    .getElementById("tracker-custom-subscriptions")
    .value.split(/\r?\n/)
    .map((url) => url.trim())
    .filter(Boolean)
    .slice(0, 20)
    .map((url, index) => ({
      id: `custom-${index + 1}`,
      name: `Custom list ${index + 1}`,
      url,
      enabled: true,
    }));
  currentConfig.tracker.filterLists = [
    ...existingDefaults,
    ...customSubscriptions,
  ];

  currentConfig.proxy.enabled =
    document.getElementById("proxy-enabled").checked;
  currentConfig.proxy.routingMode =
    document.getElementById("proxy-routing-mode").value;
  currentConfig.proxy.activeProfile =
    document.getElementById("proxy-active-profile").value || null;
  currentConfig.proxy.fallbackProfiles = Array.from(
    document.getElementById("proxy-fallback-profiles").selectedOptions,
    (option) => option.value,
  ).filter((profileName) => profileName !== currentConfig.proxy.activeProfile);
  currentConfig.proxy.bypassList = document
    .getElementById("proxy-bypass-list")
    .value.split(",")
    .map((pattern) => pattern.trim())
    .filter(Boolean);
  currentConfig.proxy.syncTimezone =
    document.getElementById("proxy-sync-timezone").checked;
  currentConfig.proxy.syncGeolocation = document.getElementById(
    "proxy-sync-geolocation",
  ).checked;
  currentConfig.proxy.syncLanguage =
    document.getElementById("proxy-sync-language").checked;

  if (
    currentConfig.proxy.enabled &&
    ((currentConfig.proxy.routingMode === "protect-selected" &&
      currentConfig.proxy.domainRoutes.length === 0) ||
      (currentConfig.proxy.routingMode !== "protect-selected" &&
        !currentConfig.proxy.activeProfile))
  ) {
    if (showErrors) {
      showToast(
        currentConfig.proxy.routingMode === "protect-selected"
          ? "Add at least one per-site proxy route before enabling protect-selected mode."
          : "Select a default proxy profile before enabling the proxy.",
        "error",
      );
    }
    return false;
  }

  return true;
}

function scheduleAutoSave() {
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(async () => {
    saveTimeout = null;
    if (collectForm()) {
      await saveOptionsConfig();
    }
  }, AUTO_SAVE_DELAY_MS);
}

async function saveOptionsConfig(refreshTabs = false) {
  const snapshot = serializeConfig(currentConfig);
  if (snapshot === lastSavedSnapshot || snapshot === saveInFlightSnapshot) {
    if (refreshTabs) {
      await refreshAllHttpTabs();
    }
    return true;
  }

  saveInFlightSnapshot = snapshot;
  try {
    const response = await sendRuntimeMessage({
      type: "update-config",
      config: currentConfig,
    });
    assertRuntimeResponse(response, "Failed to save settings");
    lastSavedSnapshot = snapshot;
    await refreshProxyRuntimeStatus();
    await refreshProxyDiagnostics();
    renderProxyRuntimeStatus();
    renderProxyDiagnostics();
    if (refreshTabs) {
      await refreshAllHttpTabs();
    } else {
      showToast("Settings saved", "success");
    }
    return true;
  } catch (error) {
    console.error("Failed to save settings:", error);
    showToast(error.message, "error");
    await loadOptionsConfig();
    return false;
  } finally {
    if (saveInFlightSnapshot === snapshot) {
      saveInFlightSnapshot = null;
    }
  }
}

async function saveWhenHidden() {
  if (document.visibilityState !== "hidden" || !currentConfig) {
    return;
  }
  clearTimeout(saveTimeout);
  saveTimeout = null;
  if (collectForm({ showErrors: false })) {
    await saveOptionsConfig();
  }
}

function queryTabs() {
  return callChromeApi(chrome.tabs, "query", {
    url: ["http://*/*", "https://*/*"],
  }).then((tabs) => tabs || []);
}

function reloadTab(tabId) {
  return callChromeApi(chrome.tabs, "reload", tabId, {}).then(
    () => true,
    () => false,
  );
}

async function refreshAllHttpTabs() {
  try {
    const tabs = await queryTabs();
    const reloads = tabs
      .filter((tab) => typeof tab.id === "number")
      .map((tab) => reloadTab(tab.id));
    const results = await Promise.all(reloads);
    const reloadCount = results.filter(Boolean).length;
    showToast(
      reloadCount
        ? `Settings saved. ${reloadCount} tab(s) refreshed.`
        : "Settings saved.",
      "success",
    );
  } catch (error) {
    console.error("Failed to refresh tabs:", error);
    showToast("Settings saved. Reload open pages manually.", "success");
  }
}

function scrollToSection(sectionId) {
  const section = document.getElementById(sectionId);
  if (!section) {
    return;
  }
  section.scrollIntoView({ behavior: "smooth", block: "start" });
  section.classList.add("highlight");
  setTimeout(() => section.classList.remove("highlight"), 1000);
}

function updateUserAgentString() {
  const selectedUserAgent = parseUserAgentSelection(
    document.getElementById("useragent-preset").value,
  );
  const previewConfig = {
    useragent: selectedUserAgent,
  };
  const curlProfile = getCurlProfileForConfig(
    previewConfig,
    curlProfileCatalog,
  );
  document.getElementById("useragent-string").value =
    curlProfile?.userAgent || USER_AGENT_STRINGS[selectedUserAgent.preset] || "";
}

function populateProxyProfiles() {
  const profiles = currentConfig.proxy.profiles;
  const activeSelect = document.getElementById("proxy-active-profile");
  const fallbackSelect = document.getElementById("proxy-fallback-profiles");
  activeSelect.replaceChildren(new Option("None (Direct)", ""));
  fallbackSelect.replaceChildren();

  for (const profile of profiles) {
    const option = new Option(
      profile.name,
      profile.name,
      false,
      profile.name === currentConfig.proxy.activeProfile,
    );
    activeSelect.appendChild(option);
    fallbackSelect.appendChild(
      new Option(
        profile.name,
        profile.name,
        false,
        currentConfig.proxy.fallbackProfiles.includes(profile.name),
      ),
    );
  }

  populateProxyRoutes();

  const list = document.getElementById("proxy-profiles-list");
  list.replaceChildren();
  if (profiles.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No proxy profiles configured";
    list.appendChild(empty);
    return;
  }

  for (const profile of profiles) {
    const card = document.createElement("div");
    card.className = "proxy-profile-card";

    const info = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = profile.name;
    const details = document.createElement("div");
    details.className = "proxy-profile-details";
    details.textContent = `${profile.scheme.toUpperCase()} ${profile.host}:${profile.port}`;
    if (profile.location) {
      const location = document.createElement("div");
      location.className = "proxy-profile-location";
      const city = profile.location.city || "Unknown";
      const country = profile.location.country || "Unknown";
      location.textContent = `${city}, ${country}`;
      details.appendChild(location);
    }
    const credentialStatus = getProxyCredentialStatus(profile);
    if (credentialStatus.configured) {
      const credentialBadge = document.createElement("span");
      credentialBadge.className = "proxy-credential-badge";
      credentialBadge.textContent = credentialStatus.persisted
        ? "Credentials saved"
        : "Session credentials";
      details.appendChild(credentialBadge);
    }
    info.append(name, details);

    const actions = document.createElement("div");
    actions.className = "proxy-profile-actions";
    actions.append(
      createProfileButton("Edit", "btn-secondary", () =>
        editProxyProfile(profile.name),
      ),
      createProfileButton("Remove", "btn-danger", () =>
        removeProxyProfile(profile.name),
      ),
    );
    card.append(info, actions);
    list.appendChild(card);
  }
}

function populateProxyRoutes() {
  const profileSelect = document.getElementById("new-proxy-route-profile");
  profileSelect.replaceChildren();
  for (const profile of currentConfig.proxy.profiles) {
    profileSelect.appendChild(new Option(profile.name, profile.name));
  }
  profileSelect.disabled = currentConfig.proxy.profiles.length === 0;
  document.getElementById("add-proxy-route").disabled =
    currentConfig.proxy.profiles.length === 0;

  const list = document.getElementById("proxy-routes-list");
  list.replaceChildren();
  if (currentConfig.proxy.domainRoutes.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No per-site routes configured";
    list.appendChild(empty);
    return;
  }

  currentConfig.proxy.domainRoutes.forEach((route, index) => {
    const card = document.createElement("div");
    card.className = "proxy-route-card";
    const description = document.createElement("div");
    const pattern = document.createElement("code");
    pattern.textContent = route.pattern;
    const destination = document.createElement("small");
    destination.textContent = ` via ${route.profile}`;
    description.append(pattern, destination);
    card.append(
      description,
      createProfileButton("Remove", "btn-danger", () =>
        removeProxyRoute(index),
      ),
    );
    list.appendChild(card);
  });
}

async function addProxyRoute() {
  const rawPattern = document.getElementById(
    "new-proxy-route-pattern",
  ).value;
  const pattern = normalizeDomainPattern(rawPattern);
  const profile = document.getElementById("new-proxy-route-profile").value;
  if (!pattern) {
    showToast("Enter a valid domain pattern", "error");
    return;
  }
  if (!currentConfig.proxy.profiles.some((entry) => entry.name === profile)) {
    showToast("Select a valid proxy profile", "error");
    return;
  }

  const existing = currentConfig.proxy.domainRoutes.find(
    (route) => route.pattern === pattern,
  );
  if (existing) {
    existing.profile = profile;
  } else {
    currentConfig.proxy.domainRoutes.push({ pattern, profile });
  }
  document.getElementById("new-proxy-route-pattern").value = "";
  populateProxyRoutes();
  if (!(await saveOptionsConfig())) {
    return;
  }
  showToast(existing ? "Proxy route updated" : "Proxy route added", "success");
}

async function removeProxyRoute(index) {
  currentConfig.proxy.domainRoutes.splice(index, 1);
  populateProxyRoutes();
  if (!(await saveOptionsConfig())) {
    return;
  }
  showToast("Proxy route removed", "success");
}

function createProfileButton(label, className, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.className = `${className} btn-compact`;
  button.addEventListener("click", handler);
  return button;
}

function editProxyProfile(profileName) {
  const profile = currentConfig.proxy.profiles.find(
    (entry) => entry.name === profileName,
  );
  if (!profile) {
    return;
  }

  editingProxyProfileName = profileName;
  document.getElementById("new-proxy-host").value = profile.host;
  document.getElementById("new-proxy-port").value = profile.port;
  document.getElementById("new-proxy-scheme").value = profile.scheme;
  document.getElementById("new-proxy-name").value = profile.name;
  const credentialStatus = getProxyCredentialStatus(profile);
  document.getElementById("new-proxy-username").value =
    credentialStatus.username;
  document.getElementById("new-proxy-password").value = "";
  document.getElementById("persist-proxy-credentials").checked =
    credentialStatus.configured ? credentialStatus.persisted : true;
  document.getElementById("clear-proxy-credentials").disabled =
    !credentialStatus.configured;
  document.getElementById("add-proxy-profile").textContent = "Save Profile";
  document.getElementById("proxy-editor-summary").textContent =
    `Edit "${profileName}"`;

  const editor = document.querySelector("#proxy-section .proxy-editor");
  editor.open = true;
  editor.scrollIntoView({ behavior: "smooth", block: "center" });
}

function resetProxyEditor() {
  editingProxyProfileName = null;
  document.getElementById("new-proxy-host").value = "";
  document.getElementById("new-proxy-port").value = "";
  document.getElementById("new-proxy-name").value = "";
  document.getElementById("new-proxy-username").value = "";
  document.getElementById("new-proxy-password").value = "";
  document.getElementById("persist-proxy-credentials").checked = true;
  document.getElementById("clear-proxy-credentials").disabled = true;
  document.getElementById("add-proxy-profile").textContent = "Add Profile";
  document.getElementById("proxy-editor-summary").textContent =
    "Add a proxy server";
}

async function prepareProxyProfileFromForm() {
  const existing = currentConfig.proxy.profiles.find(
    (profile) => profile.name === editingProxyProfileName,
  );
  const host = document.getElementById("new-proxy-host").value;
  const response = await sendRuntimeMessage({
    type: "prepare-proxy-profile",
    profile: {
      host,
      port: document.getElementById("new-proxy-port").value,
      scheme: document.getElementById("new-proxy-scheme").value,
      name: document.getElementById("new-proxy-name").value,
      location:
        existing && existing.host === host.trim()
          ? existing.location
          : undefined,
    },
  });
  return assertRuntimeResponse(response, "Invalid proxy profile").profile;
}

async function saveProxyProfile() {
  const wasEditing = Boolean(editingProxyProfileName);
  const previousProfile = currentConfig.proxy.profiles.find(
    (entry) => entry.name === editingProxyProfileName,
  );
  try {
    showToast("Preparing proxy profile...", "success");
    const profile = await prepareProxyProfileFromForm();
    const otherProfiles = currentConfig.proxy.profiles.filter(
      (entry) => entry.name !== editingProxyProfileName,
    );

    const baseName = profile.name;
    let finalName = baseName;
    let suffix = 1;
    while (otherProfiles.some((entry) => entry.name === finalName)) {
      finalName = `${baseName} (${suffix++})`;
    }
    profile.name = finalName;

    const wasActive =
      currentConfig.proxy.activeProfile === editingProxyProfileName;
    currentConfig.proxy.profiles = [...otherProfiles, profile];
    if (editingProxyProfileName) {
      currentConfig.proxy.domainRoutes = currentConfig.proxy.domainRoutes.map(
        (route) =>
          route.profile === editingProxyProfileName
            ? { ...route, profile: finalName }
            : route,
      );
      currentConfig.proxy.fallbackProfiles =
        currentConfig.proxy.fallbackProfiles.map((profileName) =>
          profileName === editingProxyProfileName ? finalName : profileName,
        );
    }
    if (wasActive) {
      currentConfig.proxy.activeProfile = finalName;
    }

    const username = document.getElementById("new-proxy-username").value;
    const password = document.getElementById("new-proxy-password").value;
    if (username) {
      const credentialResponse = await sendRuntimeMessage({
        type: "set-proxy-credentials",
        profile,
        credentials: {
          username,
          password,
          keepPassword: wasEditing && password === "",
          sourceProfile: previousProfile,
          persist: document.getElementById("persist-proxy-credentials").checked,
        },
      });
      assertRuntimeResponse(
        credentialResponse,
        "Failed to save proxy credentials",
      );
    }

    const saved = await saveOptionsConfig();
    if (!saved) {
      if (
        username &&
        getProxyEndpoint(previousProfile) !== getProxyEndpoint(profile)
      ) {
        await sendRuntimeMessage({
          type: "clear-proxy-credentials",
          profile,
        }).catch(() => {});
      }
      return;
    }
    await refreshProxyCredentialStatuses();
    await refreshProxyRuntimeStatus();

    resetProxyEditor();
    document.querySelector("#proxy-section .proxy-editor").open = false;
    populateProxyProfiles();
    renderProxyRuntimeStatus();
    showToast(
      `Profile "${finalName}" ${wasEditing ? "updated" : "added"}.`,
      "success",
    );
  } catch (error) {
    console.error("Failed to prepare proxy profile:", error);
    showToast(error.message, "error");
  }
}

async function removeProxyProfile(profileName) {
  if (!confirm(`Remove proxy profile "${profileName}"?`)) {
    return;
  }

  currentConfig.proxy.profiles = currentConfig.proxy.profiles.filter(
    (profile) => profile.name !== profileName,
  );
  currentConfig.proxy.domainRoutes = currentConfig.proxy.domainRoutes.filter(
    (route) => route.profile !== profileName,
  );
  currentConfig.proxy.fallbackProfiles =
    currentConfig.proxy.fallbackProfiles.filter(
      (entry) => entry !== profileName,
    );
  if (currentConfig.proxy.activeProfile === profileName) {
    currentConfig.proxy.activeProfile = null;
    currentConfig.proxy.enabled = false;
    document.getElementById("proxy-enabled").checked = false;
  }
  if (editingProxyProfileName === profileName) {
    resetProxyEditor();
  }

  populateProxyProfiles();
  const saved = await saveOptionsConfig();
  if (!saved) {
    return;
  }
  await refreshProxyCredentialStatuses();
  await refreshProxyRuntimeStatus();
  populateProxyProfiles();
  renderProxyRuntimeStatus();
  showToast(`Profile "${profileName}" removed.`, "success");
}

async function clearEditingProxyCredentials() {
  const profile = currentConfig.proxy.profiles.find(
    (entry) => entry.name === editingProxyProfileName,
  );
  if (!profile) {
    return;
  }

  try {
    const response = await sendRuntimeMessage({
      type: "clear-proxy-credentials",
      profile,
    });
    assertRuntimeResponse(response, "Failed to clear proxy credentials");
    await refreshProxyCredentialStatuses();
    document.getElementById("new-proxy-username").value = "";
    document.getElementById("new-proxy-password").value = "";
    document.getElementById("clear-proxy-credentials").disabled = true;
    populateProxyProfiles();
    showToast("Proxy credentials cleared", "success");
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function refreshAdblockStatus() {
  try {
    const response = await sendRuntimeMessage({ type: "get-adblock-status" });
    assertRuntimeResponse(response, "Ad-blocking status is unavailable");
    adblockStatus = response.status;
  } catch (error) {
    adblockStatus = null;
  }
}

async function refreshCurlProfileStatus() {
  try {
    const response = await sendRuntimeMessage({ type: "get-curl-profile-status" });
    assertRuntimeResponse(response, "curl-impersonate profile status is unavailable");
    curlProfileStatus = response.status;
    curlProfileCatalog = normalizeCurlProfileCatalog(response.catalog);
  } catch (error) {
    curlProfileStatus = null;
    curlProfileCatalog = normalizeCurlProfileCatalog(null);
  }
}

function populateUserAgentOptions() {
  const userAgentSelect = document.getElementById("useragent-preset");
  if (!userAgentSelect) return;
  const options = getUserAgentSelectionOptions(
    curlProfileCatalog,
    currentConfig.useragent,
    USER_AGENT_STRINGS,
  );
  userAgentSelect.replaceChildren(
    ...options.map((option) => new Option(option.label, option.value)),
  );
  userAgentSelect.value = getUserAgentSelectionValue(
    curlProfileCatalog,
    currentConfig.useragent.preset,
    currentConfig.useragent.curlProfile,
  );
}

function renderCurlProfileStatus() {
  const status = document.getElementById("curl-profile-status");
  if (!status) return;
  if (!curlProfileStatus) {
    status.textContent = "Status unavailable";
    return;
  }
  const updated = curlProfileStatus.lastUpdate
    ? new Date(curlProfileStatus.lastUpdate).toLocaleString()
    : "bundled fallback profiles";
  status.textContent = `${curlProfileStatus.profileCount || 0} browser/API profiles · ${updated}${
    curlProfileStatus.error ? ` · ${curlProfileStatus.error}` : ""
  }`;
}

async function updateCurlProfilesNow() {
  const button = document.getElementById("update-curl-profiles");
  button.disabled = true;
  try {
    const response = await sendRuntimeMessage({ type: "update-curl-profiles" });
    if (!response || (!response.status && response.success === false)) {
      throw new Error((response && response.error) || "Profile update failed");
    }
    curlProfileStatus = response.status;
    if (response.status && response.status.profiles) {
      curlProfileCatalog = normalizeCurlProfileCatalog(response.catalog);
    }
    populateUserAgentOptions();
    updateUserAgentString();
    renderCurlProfileStatus();
    showToast(
      response.updated ? "Updated curl-impersonate profiles" : "Profiles are current",
      response.success === false ? "error" : "success",
    );
  } catch (error) {
    await refreshCurlProfileStatus();
    populateUserAgentOptions();
    renderCurlProfileStatus();
    showToast(error.message, "error");
  } finally {
    button.disabled = false;
  }
}

function renderAdblockStatus() {
  const status = document.getElementById("filter-update-status");
  if (!status) return;
  if (!adblockStatus) {
    status.textContent = "Status unavailable";
    return;
  }
  if (adblockStatus.updating) {
    status.textContent = "Updating filter lists…";
    return;
  }
  const ruleCount =
    Number(adblockStatus.networkRules || 0) +
    Number(adblockStatus.cosmeticRules || 0);
  const updated = adblockStatus.lastUpdate
    ? new Date(adblockStatus.lastUpdate).toLocaleString()
    : "not downloaded yet";
  status.textContent = `${ruleCount.toLocaleString()} rules · ${updated}${
    adblockStatus.error ? ` · ${adblockStatus.error}` : ""
  }`;
}

async function updateAdblockFiltersNow() {
  const button = document.getElementById("update-filter-lists");
  button.disabled = true;
  adblockStatus = { ...(adblockStatus || {}), updating: true };
  renderAdblockStatus();
  try {
    if (collectForm()) await saveOptionsConfig();
    const response = await sendRuntimeMessage({ type: "update-adblock-filters" });
    if (!response || (response.success === false && !response.status)) {
      throw new Error((response && response.error) || "Filter update failed");
    }
    adblockStatus = response.status;
    renderAdblockStatus();
    showToast(
      response.updated ? `Updated ${response.updated} filter list(s)` : "Filter lists are current",
      response.success === false ? "error" : "success",
    );
  } catch (error) {
    await refreshAdblockStatus();
    renderAdblockStatus();
    showToast(error.message, "error");
  } finally {
    button.disabled = false;
  }
}

function setupEventListeners() {
  for (const input of document.querySelectorAll("input, select, textarea")) {
    if (
      input.id === "import-file" ||
      input.id === "gpu-profile-file" ||
      input.closest(".proxy-editor") ||
      input.closest(".proxy-route-editor") ||
      input.closest("#selftest-section")
    ) {
      continue;
    }
    input.addEventListener("change", scheduleAutoSave);
    if (input.type === "text" || input.tagName === "TEXTAREA") {
      input.addEventListener("input", scheduleAutoSave);
    }
  }

  document
    .getElementById("save-settings")
    .addEventListener("click", async () => {
      clearTimeout(saveTimeout);
      saveTimeout = null;
      if (collectForm()) {
        await saveOptionsConfig(true);
      }
    });

  document
    .getElementById("reset-settings")
    .addEventListener("click", resetSettings);
  document
    .getElementById("run-selftest")
    .addEventListener("click", runSelfTest);
  document
    .getElementById("selftest-tab")
    .addEventListener("change", runSelfTest);
  document
    .getElementById("useragent-preset")
    .addEventListener("change", updateUserAgentString);
  document
    .getElementById("add-proxy-profile")
    .addEventListener("click", saveProxyProfile);
  document
    .getElementById("clear-proxy-credentials")
    .addEventListener("click", clearEditingProxyCredentials);
  document
    .getElementById("add-proxy-route")
    .addEventListener("click", addProxyRoute);
  document
    .getElementById("verify-proxy-connection")
    .addEventListener("click", verifyProxyConnection);
  document
    .getElementById("proxy-routing-mode")
    .addEventListener("change", updateProxyRoutingModeUi);
  document
    .getElementById("refresh-proxy-diagnostics")
    .addEventListener("click", async () => {
      await refreshProxyDiagnostics();
      renderProxyDiagnostics();
    });
  document
    .getElementById("export-proxy-diagnostics")
    .addEventListener("click", exportProxyDiagnostics);
  document
    .getElementById("clear-proxy-history")
    .addEventListener("click", clearProxyHistory);
  document
    .getElementById("update-filter-lists")
    .addEventListener("click", updateAdblockFiltersNow);
  document
    .getElementById("update-curl-profiles")
    .addEventListener("click", updateCurlProfilesNow);
  document
    .getElementById("export-config")
    .addEventListener("click", exportConfig);
  document.getElementById("import-config").addEventListener("click", () => {
    document.getElementById("import-file").click();
  });
  document.getElementById("import-file").addEventListener("change", (event) => {
    const file = event.target.files[0];
    event.target.value = "";
    if (file) {
      importConfig(file);
    }
  });
  document.getElementById("import-gpu-profile").addEventListener("click", () => {
    document.getElementById("gpu-profile-file").click();
  });
  document
    .getElementById("gpu-profile-file")
    .addEventListener("change", (event) => {
      const file = event.target.files[0];
      event.target.value = "";
      if (file) importGpuProfile(file);
    });
  document
    .getElementById("clear-gpu-profile")
    .addEventListener("click", clearGpuProfile);
  document
    .getElementById("gpu-profile-preset")
    .addEventListener("change", selectBundledGpuProfile);
}

async function selectBundledGpuProfile(event) {
  const profileId = event.target.value;
  if (!profileId) {
    await clearGpuProfile();
    return;
  }
  const assetPath = getGpuProfileAssetPath(profileId);
  if (!assetPath) {
    showToast("Invalid bundled GPU profile", "error");
    return;
  }
  try {
    const response = await fetch(chrome.runtime.getURL(assetPath));
    if (!response.ok) throw new Error("Bundled GPU profile unavailable");
    const profile = normalizeGpuProfile(await response.json());
    if (!profile) throw new Error("Bundled GPU profile is invalid");
    currentConfig.gpuProfile = profile;
    renderGpuProfileStatus();
    await saveOptionsConfig();
    showToast(`GPU profile ${profileId} selected`, "success");
  } catch (error) {
    showToast(error.message, "error");
    populateGpuProfileOptions();
  }
}

function importGpuProfile(file) {
  if (file.size > MAX_GPU_PROFILE_FILE_SIZE) {
    showToast("GPU profile files must be smaller than 512 KB", "error");
    return;
  }
  const reader = new FileReader();
  reader.onload = async (event) => {
    try {
      const parsed = JSON.parse(event.target.result);
      const normalized = normalizeGpuProfile(parsed);
      if (!normalized) {
        throw new Error(
          "Invalid profile. Import a ClearCote capture or an Apify Fingerprint Suite JSON export.",
        );
      }
      currentConfig.gpuProfile = normalized;
      renderGpuProfileStatus();
      if (await saveOptionsConfig()) {
        showToast(
          normalized.webgpu
            ? "WebGL/WebGPU profile imported"
            : "Apify WebGL profile imported; WebGPU remains unprofiled",
          "success",
        );
      }
    } catch (error) {
      console.error("Failed to import GPU profile:", error);
      showToast(error.message || "Failed to import GPU profile", "error");
    }
  };
  reader.onerror = () => showToast("Failed to read GPU profile", "error");
  reader.readAsText(file);
}

async function clearGpuProfile() {
  if (!currentConfig.gpuProfile) return;
  currentConfig.gpuProfile = null;
  renderGpuProfileStatus();
  if (await saveOptionsConfig()) {
    showToast("Combined GPU profile cleared", "success");
  }
}

async function resetSettings() {
  if (!confirm("Reset all settings to defaults?")) {
    return;
  }

  try {
    const response = await sendRuntimeMessage({ type: "reset-config" });
    assertRuntimeResponse(response, "Failed to reset settings");
    await loadOptionsConfig();
    showToast("Settings reset to defaults", "success");
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function verifyProxyConnection() {
  const button = document.getElementById("verify-proxy-connection");
  button.disabled = true;
  try {
    const response = await sendRuntimeMessage({
      type: "verify-proxy-connection",
    });
    assertRuntimeResponse(response, "Failed to verify proxy connection");
    proxyRuntimeStatus = response.status;
    await refreshProxyDiagnostics();
    renderProxyRuntimeStatus();
    renderProxyDiagnostics();
    showToast(
      response.status.state === "connected"
        ? "Proxy exit verified"
        : response.status.error || "Proxy settings checked",
      response.status.state === "connected" ? "success" : "error",
    );
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    button.disabled = !currentConfig.proxy.enabled;
  }
}

function downloadJson(filename, data) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function exportProxyDiagnostics() {
  await refreshProxyDiagnostics();
  renderProxyDiagnostics();
  if (!proxyDiagnostics) {
    showToast("Proxy diagnostics are unavailable", "error");
    return;
  }
  downloadJson(
    `stealth-guard-proxy-diagnostics-${new Date().toISOString().slice(0, 10)}.json`,
    { version: "1.0", diagnostics: proxyDiagnostics },
  );
  showToast("Proxy diagnostics exported", "success");
}

async function clearProxyHistory() {
  try {
    const response = await sendRuntimeMessage({ type: "clear-proxy-history" });
    assertRuntimeResponse(response, "Failed to clear proxy history");
    await refreshProxyDiagnostics();
    renderProxyDiagnostics();
    showToast("Proxy connection history cleared", "success");
  } catch (error) {
    showToast(error.message, "error");
  }
}

function showToast(message, type = "success") {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.className = `toast ${type} show`;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.className = "toast";
  }, 3000);
}

function exportConfig() {
  if (!currentConfig || !collectForm()) {
    return;
  }

  const exportData = {
    version: "1.0",
    exportedAt: new Date().toISOString(),
    config: currentConfig,
  };
  downloadJson(
    `stealth-guard-config-${new Date().toISOString().slice(0, 10)}.json`,
    exportData,
  );
  showToast("Settings exported", "success");
}

function importConfig(file) {
  if (/\.(?:ovpn|conf|wg|wireguard)$/i.test(file.name || "")) {
    showToast(
      "Tunnel configs are unsupported. Enter an HTTP(S) or SOCKS proxy endpoint instead.",
      "error",
    );
    return;
  }
  if (file.size > MAX_CONFIG_FILE_SIZE) {
    showToast("Config files must be smaller than 1 MB", "error");
    return;
  }

  const reader = new FileReader();
  reader.onload = async (event) => {
    try {
      const data = JSON.parse(event.target.result);
      if (
        !data.config ||
        typeof data.config !== "object" ||
        Array.isArray(data.config)
      ) {
        throw new Error("Invalid config file");
      }

      const response = await sendRuntimeMessage({
        type: "update-config",
        config: data.config,
      });
      assertRuntimeResponse(response, "Failed to import settings");
      await loadOptionsConfig();
      showToast("Settings imported", "success");
    } catch (error) {
      console.error("Failed to import settings:", error);
      showToast(error.message, "error");
    }
  };
  reader.onerror = () => showToast("Failed to read file", "error");
  reader.readAsText(file);
}

const SELF_TEST_RESULT_IDS = [
  "result-useragent",
  "result-language",
  "result-intl",
  "result-timezone",
  "result-webrtc",
  "result-proxy",
  "result-trackers",
  "result-triggered",
];

function sendTabMessage(tabId, message) {
  return callChromeApi(chrome.tabs, "sendMessage", tabId, message, {
    frameId: 0,
  });
}

// The popup and the "Test protection" context menu open this page with the tab
// they were invoked from, so that tab starts selected.
function requestedSelfTestTabId() {
  const value = new URL(window.location.href).searchParams.get("tabId");
  const tabId = value === null ? Number.NaN : Number(value);
  return Number.isInteger(tabId) && tabId >= 0 ? tabId : null;
}

function setSelfTestSummary(message, state = "") {
  const summary = document.getElementById("selftest-summary");
  summary.textContent = message;
  summary.dataset.state = state;
}

function setSelfTestResult(id, value, state = "") {
  const element = document.getElementById(id);
  element.textContent = value || "—";
  element.dataset.state = state;
}

function clearSelfTestResults() {
  for (const id of SELF_TEST_RESULT_IDS) {
    setSelfTestResult(id, "—");
  }
}

async function initializeSelfTest() {
  const select = document.getElementById("selftest-tab");
  const runButton = document.getElementById("run-selftest");
  try {
    const tabs = await queryTabs();
    const preferredTabId = requestedSelfTestTabId();
    select.replaceChildren();
    for (const tab of tabs) {
      if (!Number.isInteger(tab.id) || !tab.url) continue;
      const label = tab.title ? `${tab.title} — ${tab.url}` : tab.url;
      const option = new Option(
        label,
        String(tab.id),
        false,
        tab.id === preferredTabId,
      );
      option.dataset.url = tab.url;
      select.appendChild(option);
    }
    if (select.selectedIndex < 0 && select.options.length) {
      select.selectedIndex = 0;
    }
    runButton.disabled = select.options.length === 0;
    if (runButton.disabled) {
      setSelfTestSummary(
        "Open an HTTP(S) page, then return and run the test.",
        "error",
      );
      return;
    }
    await runSelfTest();
  } catch (error) {
    setSelfTestSummary(error.message || String(error), "error");
  }
}

async function runSelfTest() {
  const select = document.getElementById("selftest-tab");
  const runButton = document.getElementById("run-selftest");
  const tabId = Number(select.value);
  if (!Number.isInteger(tabId)) {
    return;
  }

  runButton.disabled = true;
  setSelfTestSummary("Reading extension policy and live page values…");
  clearSelfTestResults();
  try {
    const selected = select.options[select.selectedIndex];
    const hostname = new URL(selected ? selected.dataset.url : "").hostname;
    const [policyResponse, pageResponse] = await Promise.all([
      sendRuntimeMessage({
        type: "get-identity-diagnostics",
        hostname,
        tabId,
      }),
      sendTabMessage(tabId, { type: "run-self-test" }),
    ]);
    const policy = assertRuntimeResponse(
      policyResponse,
      "Identity diagnostics failed",
    ).diagnostics;
    const pageResult = assertRuntimeResponse(
      pageResponse,
      "The selected page did not answer the self-test",
    );
    const result = renderSelfTestResults(policy, pageResult.snapshot);
    if (!policy.protectionEnabled) {
      setSelfTestSummary(
        `Protection is disabled; live values were read for ${hostname}`,
        "warning",
      );
    } else if (policy.globallyAllowlisted) {
      setSelfTestSummary(
        `${hostname} is globally allowlisted; live values are expected to remain native`,
        "warning",
      );
    } else if (result.failures) {
      setSelfTestSummary(
        `${result.failures} identity mismatch${result.failures === 1 ? "" : "es"} found for ${hostname}`,
        "error",
      );
    } else {
      setSelfTestSummary(
        `Self-test passed for ${hostname}${result.warnings ? ` with ${result.warnings} informational warning${result.warnings === 1 ? "" : "s"}` : ""}`,
        "success",
      );
    }
  } catch (error) {
    setSelfTestSummary(error.message || String(error), "error");
  } finally {
    runButton.disabled = select.options.length === 0;
  }
}

function renderSelfTestResults(policy, snapshot) {
  let failures = 0;
  let warnings = 0;
  const check = (enabled, matches) => {
    if (!enabled) {
      warnings++;
      return "warning";
    }
    if (!matches) {
      failures++;
      return "error";
    }
    return "success";
  };

  setSelfTestResult(
    "result-useragent",
    snapshot.userAgent,
    check(
      policy.userAgent.enabled,
      snapshot.userAgent === policy.userAgent.value,
    ),
  );
  setSelfTestResult(
    "result-language",
    `${snapshot.language} · ${(snapshot.languages || []).join(", ")}`,
    check(
      policy.language.enabled,
      snapshot.language === policy.language.locale &&
        Array.isArray(snapshot.languages) &&
        snapshot.languages[0] === policy.language.languages[0],
    ),
  );
  setSelfTestResult(
    "result-intl",
    snapshot.intlLocale,
    check(policy.language.enabled, snapshot.intlLocale === policy.language.locale),
  );
  setSelfTestResult(
    "result-timezone",
    `${snapshot.timeZone || "unknown"} · offset ${snapshot.timezoneOffset}`,
    check(policy.timezone.enabled, snapshot.timeZone === policy.timezone.name),
  );
  setSelfTestResult(
    "result-webrtc",
    `${policy.webrtc.effectivePolicy} · ${policy.webrtc.controlLevel}`,
    check(
      policy.webrtc.enabled,
      policy.webrtc.effectivePolicy === policy.webrtc.requestedPolicy,
    ),
  );
  setSelfTestResult(
    "result-proxy",
    policy.proxy.enabled
      ? `${policy.proxy.state}${policy.proxy.profile ? ` · ${policy.proxy.profile}` : ""}`
      : "Direct",
    policy.proxy.enabled
      ? check(
          true,
          ["connected", "configured", "routing"].includes(policy.proxy.state),
        )
      : "warning",
  );
  if (!policy.proxy.enabled) warnings++;
  setSelfTestResult(
    "result-trackers",
    policy.tracker.enabled
      ? `${policy.tracker.blockedCount} blocked · ${policy.tracker.builtInRules + policy.tracker.customRules} rules`
      : "Off",
    policy.tracker.enabled
      ? check(true, policy.tracker.builtInRules + policy.tracker.customRules > 0)
      : "warning",
  );
  if (!policy.tracker.enabled) warnings++;
  setSelfTestResult(
    "result-triggered",
    policy.triggeredFeatures.length
      ? policy.triggeredFeatures.join(", ")
      : "None yet",
    "neutral",
  );
  return { failures, warnings };
}
