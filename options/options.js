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
  await Promise.all([
    refreshProxyCredentialStatuses(),
    refreshProxyRuntimeStatus(),
    refreshProxyDiagnostics(),
    refreshAdblockStatus(),
  ]);
  lastSavedSnapshot = serializeConfig(currentConfig);
  saveInFlightSnapshot = null;
  populateForm();
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
  document.getElementById("canvas-noise-level").value =
    currentConfig.canvas.noiseLevel;
  const timezoneSelect = document.getElementById("timezone-select");
  updateTimeZoneSelectLabels(timezoneSelect);
  timezoneSelect.value = currentConfig.timezone.name;
  document.getElementById("useragent-preset").value =
    currentConfig.useragent.preset;
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
  const defaultIds = new Set([
    "adguard-base",
    "adguard-tracking",
    "adguard-cookies",
  ]);
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
  populateProxyProfiles();
  updateProxyRoutingModeUi();
  renderProxyRuntimeStatus();
  renderProxyDiagnostics();
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
  const bypass = document.getElementById("proxy-bypass-list");
  const help = document.getElementById("proxy-routing-mode-help");
  bypass.disabled = mode !== "bypass-selected";
  help.textContent =
    mode === "protect-selected"
      ? "Only matching per-site routes use a proxy; every unmatched site connects directly."
      : mode === "protect-all"
        ? "All public sites use the default proxy except global allowlist and required local destinations."
        : "Selected bypass destinations connect directly and expose your normal network identity.";
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
    detail.textContent = `${status.profile || "Proxy"} · exit ${status.exitIp || "verified"}`;
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
  currentConfig.canvas.noiseLevel =
    document.getElementById("canvas-noise-level").value;
  currentConfig.timezone.name =
    document.getElementById("timezone-select").value;
  currentConfig.useragent.preset =
    document.getElementById("useragent-preset").value;
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
  const preset = document.getElementById("useragent-preset").value;
  document.getElementById("useragent-string").value =
    USER_AGENT_STRINGS[preset] || "";
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

  const editor = document.querySelector("#proxy-section details");
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
    document.querySelector("#proxy-section details").open = false;
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
      input.closest(".proxy-editor") ||
      input.closest(".proxy-route-editor")
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
