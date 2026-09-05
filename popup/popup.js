let currentConfig = null;
let currentTab = null;
let currentSessionHostname = "";
let currentSessions = [];
let activeSessionId = null;
let pendingReloadTimeout = null;
let currentProxyRuntimeStatus = null;
let currentBlockedCount = 0;
let currentBlockedEntries = [];
let curlProfileCatalog = normalizeCurlProfileCatalog(null);
let bundledGpuProfiles = [];

const POPUP_RELOAD_DEBOUNCE_MS = 250;
const TIMEZONE_LABEL_REFRESH_MS = 60 * 1000;

document.addEventListener("DOMContentLoaded", initializePopup);
setInterval(() => {
  updateTimeZoneSelectLabels(
    document.getElementById("timezone-quick-select"),
  );
}, TIMEZONE_LABEL_REFRESH_MS);

async function initializePopup() {
  try {
    const auxiliaryLoads = Promise.all([
      loadCurlProfileCatalog(),
      loadBundledGpuProfileIndex().then((profiles) => {
        bundledGpuProfiles = profiles;
      }),
    ]);
    const [config, tab, proxyStatus] = await Promise.all([
      loadRuntimeConfig(),
      queryCurrentTab(),
      loadProxyRuntimeStatus(),
    ]);
    await auxiliaryLoads;
    currentConfig = config;
    currentTab = tab;
    currentProxyRuntimeStatus = proxyStatus;
    currentSessionHostname = getTabHostname(currentTab);
    renderPopup();
    setupEventListeners();
    await Promise.all([updateTriggeredFeatures(), refreshSessionList()]);
  } catch (error) {
    console.error("Failed to initialize popup:", error);
    document.body.textContent =
      "Failed to load settings. Reload the extension and try again.";
  }
}

async function loadCurlProfileCatalog() {
  try {
    const response = await sendRuntimeMessage({
      type: "get-curl-profile-status",
    });
    assertRuntimeResponse(response, "Failed to load browser/API profiles");
    curlProfileCatalog = normalizeCurlProfileCatalog(response.catalog);
  } catch (error) {
    curlProfileCatalog = normalizeCurlProfileCatalog(null);
  }
}

async function loadProxyRuntimeStatus() {
  try {
    const response = await sendRuntimeMessage({
      type: "get-proxy-runtime-status",
    });
    assertRuntimeResponse(response, "Failed to load proxy status");
    return response.status;
  } catch (error) {
    console.warn("Proxy runtime status is unavailable:", error);
    return null;
  }
}

function queryCurrentTab() {
  return callChromeApi(chrome.tabs, "query", {
    active: true,
    currentWindow: true,
  }).then((tabs) => (tabs && tabs[0] ? tabs[0] : null));
}

function getTabHostname(tab) {
  if (!tab || !tab.url) {
    return "";
  }

  try {
    const url = new URL(tab.url);
    return url.protocol === "http:" || url.protocol === "https:"
      ? normalizeHostname(url.hostname).replace(/^www\./, "")
      : "";
  } catch (error) {
    return "";
  }
}

function setSelectValue(select, value) {
  select.value = value;
  if (select.selectedIndex < 0) {
    select.selectedIndex = 0;
  }
}

function renderPopup() {
  document.getElementById("global-enabled").checked = currentConfig.enabled;
  document.getElementById("notifications-enabled").checked =
    currentConfig.notifications.enabled;

  for (const row of document.querySelectorAll(".feature-row")) {
    const featureName = row.dataset.feature;
    const featureConfig = currentConfig[featureName];
    const toggle = row.querySelector("[data-feature-toggle]");
    if (toggle && featureConfig) {
      toggle.checked = featureConfig.enabled;
    }
    row.classList.toggle("disabled", !currentConfig.enabled);
  }

  setSelectValue(
    document.getElementById("webgl-quick-select"),
    currentConfig.webgl.preset,
  );
  const timezoneSelect = document.getElementById("timezone-quick-select");
  updateTimeZoneSelectLabels(timezoneSelect);
  setSelectValue(timezoneSelect, currentConfig.timezone.name);
  populateUserAgentQuickSelect();
  setSelectValue(
    document.getElementById("useragent-quick-select"),
    getUserAgentSelectionValue(
      curlProfileCatalog,
      currentConfig.useragent.preset,
      currentConfig.useragent.curlProfile,
    ),
  );
  setSelectValue(
    document.getElementById("language-quick-select"),
    currentConfig.language.preset,
  );
  populateGpuProfileQuickSelect();

  renderProxyStatus();
  renderTrackerStatus();
  renderTrackerDetails();
  renderCurrentSite();
  renderAllowlistHighlighting();
  renderSessionDomain();
  renderSessionList();
}

function populateGpuProfileQuickSelect() {
  const select = document.getElementById("gpu-profile-quick-select");
  if (!select) return;
  const selectedId = currentConfig?.gpuProfile?.id || "";
  const options = [new Option("No GPU profile", "")];
  for (const profile of bundledGpuProfiles) {
    const label = [profile.id, profile.gpuVendor, profile.gpuFamily]
      .filter(Boolean)
      .join(" · ");
    options.push(new Option(label, profile.id));
  }
  if (selectedId && !bundledGpuProfiles.some((entry) => entry.id === selectedId)) {
    options.push(new Option(`${selectedId} · Imported profile`, selectedId));
  }
  select.replaceChildren(...options);
  setSelectValue(select, selectedId);
}

function populateUserAgentQuickSelect() {
  const select = document.getElementById("useragent-quick-select");
  if (!select) return;
  const options = getUserAgentSelectionOptions(
    curlProfileCatalog,
    currentConfig.useragent,
  );
  select.replaceChildren(
    ...options.map((option) => new Option(option.label, option.value)),
  );
}

function renderTrackerStatus() {
  const trackerStatus = document.getElementById("tracker-status");
  const hostname = getTabHostname(currentTab);
  const compatibilityMode = Boolean(
    hostname && isAdblockCompatibilityHostname(hostname),
  );
  const paused = Boolean(
    hostname && isDomainAllowlisted(hostname, currentConfig.tracker.whitelist),
  );
  trackerStatus.textContent = !currentConfig.tracker.enabled
    ? "Off"
    : paused
      ? "Paused here"
      : compatibilityMode
        ? currentBlockedCount
          ? `${currentBlockedCount} blocked · Compatibility`
          : "Compatibility mode"
        : currentBlockedCount
          ? `${currentBlockedCount} blocked`
          : "Enabled";
  const cosmeticPaused = Boolean(
    hostname &&
      isDomainAllowlisted(hostname, currentConfig.tracker.cosmeticWhitelist),
  );
  const siteButton = document.getElementById("toggle-adblock-site");
  const cosmeticButton = document.getElementById("toggle-cosmetic-site");
  const pickerButton = document.getElementById("block-element");
  for (const button of [siteButton, cosmeticButton, pickerButton]) {
    button.disabled =
      !hostname ||
      !currentConfig.enabled ||
      !currentConfig.tracker.enabled;
  }
  siteButton.textContent = paused
    ? "Resume ads on this site"
    : "Pause ads on this site";
  cosmeticButton.textContent = cosmeticPaused
    ? "Hide filtered items"
    : "Show hidden items";
}

function renderTrackerDetails() {
  const summary = document.getElementById("tracker-blocked-summary");
  const empty = document.getElementById("tracker-blocked-empty");
  const list = document.getElementById("tracker-blocked-list");
  summary.textContent = `${currentBlockedCount} request${
    currentBlockedCount === 1 ? "" : "s"
  }`;
  list.textContent = "";

  const entries = currentBlockedEntries
    .filter(
      (entry) =>
        entry &&
        typeof entry.domain === "string" &&
        entry.domain &&
        Number.isInteger(entry.count) &&
        entry.count > 0,
    )
    .sort(
      (left, right) =>
        right.count - left.count || left.domain.localeCompare(right.domain),
    );

  empty.hidden = entries.length > 0;
  for (const entry of entries) {
    const item = document.createElement("li");
    const domain = document.createElement("span");
    domain.className = "tracker-blocked-domain";
    domain.textContent = entry.domain;
    const count = document.createElement("span");
    count.className = "tracker-blocked-count";
    count.textContent = `×${entry.count}`;
    item.append(domain, count);
    list.append(item);
  }
}

function toggleTrackerDetails() {
  const toggle = document.getElementById("tracker-details-toggle");
  const panel = document.getElementById("tracker-blocked-panel");
  const expanded = toggle.getAttribute("aria-expanded") !== "true";
  toggle.setAttribute("aria-expanded", String(expanded));
  toggle.setAttribute(
    "aria-label",
    `${expanded ? "Hide" : "Show"} blocked ads and trackers`,
  );
  panel.hidden = !expanded;
}

function renderProxyStatus() {
  const proxy = currentConfig.proxy;
  const status = document.getElementById("proxy-status");
  const activeProfile = proxy.profiles.find(
    (profile) => profile.name === proxy.activeProfile,
  );
  status.title = "";

  if (!proxy.enabled) {
    status.textContent = "No proxy";
    status.dataset.state = "disabled";
  } else if (
    currentProxyRuntimeStatus &&
    currentProxyRuntimeStatus.state === "connected"
  ) {
    status.textContent = `Protected · ${currentProxyRuntimeStatus.profile || activeProfile?.name || "Proxy"}`;
    status.dataset.state = "connected";
  } else if (
    currentProxyRuntimeStatus &&
    currentProxyRuntimeStatus.state === "conflict"
  ) {
    status.textContent = "Proxy conflict";
    status.dataset.state = "error";
  } else if (
    currentProxyRuntimeStatus &&
    ["error", "degraded"].includes(currentProxyRuntimeStatus.state)
  ) {
    const failingProfile =
      currentProxyRuntimeStatus.profile || activeProfile?.name;
    const label =
      currentProxyRuntimeStatus.state === "error"
        ? "Proxy error"
        : "Not verified";
    status.textContent = failingProfile
      ? `${label} · ${failingProfile}`
      : label;
    status.title = currentProxyRuntimeStatus.error || "";
    status.dataset.state = "warning";
  } else if (
    currentProxyRuntimeStatus &&
    currentProxyRuntimeStatus.state === "connecting"
  ) {
    status.textContent = "Connecting…";
    status.dataset.state = "configured";
  } else if (proxy.domainRoutes.length > 0) {
    status.textContent = `${proxy.domainRoutes.length} route(s)`;
    status.dataset.state = "active";
  } else if (activeProfile) {
    status.textContent = activeProfile.name;
    status.dataset.state = "active";
  } else if (proxy.profiles.length > 0) {
    status.textContent = `${proxy.profiles.length} profile(s)`;
    status.dataset.state = "configured";
  } else {
    status.textContent = "Not configured";
    status.dataset.state = "warning";
  }
}

function renderCurrentSite() {
  const hostname = getTabHostname(currentTab);
  const urlElement = document.getElementById("current-url");
  const button = document.getElementById("toggle-current-site");

  urlElement.textContent = hostname || "No HTTP(S) site";
  button.disabled = !hostname;
  if (!hostname) {
    button.textContent = "Add to Allowlist";
    button.classList.remove("danger");
    return;
  }

  const allowlisted = isDomainAllowlisted(
    hostname,
    currentConfig.globalWhitelist,
  );
  button.textContent = allowlisted
    ? "Remove from Allowlist"
    : "Add to Allowlist";
  button.classList.toggle("danger", allowlisted);
}

function renderAllowlistHighlighting() {
  const hostname = getTabHostname(currentTab);
  const rows = document.querySelectorAll(".feature-row");
  for (const row of rows) {
    row.classList.remove("allowlisted-feature", "allowlisted-global");
  }
  if (!hostname) {
    return;
  }

  if (isDomainAllowlisted(hostname, currentConfig.globalWhitelist)) {
    for (const row of rows) {
      row.classList.add("allowlisted-global");
    }
    return;
  }

  for (const row of rows) {
    const featureName = row.dataset.feature;
    const featureConfig = currentConfig[featureName];
    const allowlist =
      featureName === "proxy"
        ? featureConfig.bypassList.join(",")
        : featureConfig.whitelist;
    row.classList.toggle(
      "allowlisted-feature",
      isDomainAllowlisted(hostname, allowlist || ""),
    );
  }
}

async function updateTriggeredFeatures() {
  if (!currentTab || typeof currentTab.id !== "number") {
    return;
  }

  try {
    const response = await sendRuntimeMessage({
      type: "get-triggered-features",
      tabId: currentTab.id,
    });
    const triggered = new Set(
      ((response && response.features) || []).map((feature) =>
        feature === "user-agent" ? "useragent" : feature,
      ),
    );
    currentBlockedCount = Number(response && response.tracker && response.tracker.count) || 0;
    currentBlockedEntries = Array.isArray(
      response && response.tracker && response.tracker.entries,
    )
      ? response.tracker.entries
      : [];
    renderTrackerStatus();
    renderTrackerDetails();

    for (const row of document.querySelectorAll(".feature-row")) {
      row.classList.toggle("triggered", triggered.has(row.dataset.feature));
    }
  } catch (error) {
    console.error("Failed to load triggered features:", error);
  }
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatSessionTime(timestamp) {
  if (!timestamp) {
    return "Never";
  }
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString();
}

function setSessionStatus(message, type = "") {
  const status = document.getElementById("session-status");
  status.textContent = message || "";
  status.className = `session-status${type ? ` ${type}` : ""}`;
}

function renderSessionDomain() {
  document.getElementById("session-domain").textContent =
    currentSessionHostname || "No active site";
}

function renderSessionList() {
  const list = document.getElementById("session-list");
  if (!currentSessionHostname) {
    list.innerHTML =
      '<div class="session-list-empty">Open an HTTP(S) site to manage sessions.</div>';
    return;
  }
  if (currentSessions.length === 0) {
    list.innerHTML =
      '<div class="session-list-empty">No saved sessions for this site.</div>';
    return;
  }

  list.innerHTML = currentSessions
    .map((session) => {
      const isActive = session.id === activeSessionId;
      return `
      <div class="session-entry ${isActive ? "active" : ""}">
        <div class="session-entry-name">${escapeHtml(session.name || "Unnamed Session")}</div>
        <div class="session-entry-meta">Last used: ${escapeHtml(formatSessionTime(session.lastUsed))}</div>
        <div class="session-entry-actions">
          <button class="session-action-btn switch" data-action="switch" data-session-id="${escapeHtml(session.id)}">
            <span aria-hidden="true">🔄</span><span>${isActive ? "Re-Switch" : "Switch"}</span>
          </button>
          <button class="session-action-btn" data-action="rename" data-session-id="${escapeHtml(session.id)}">
            <span aria-hidden="true">✏️</span><span>Rename</span>
          </button>
          <button class="session-action-btn" data-action="delete" data-session-id="${escapeHtml(session.id)}">
            <span aria-hidden="true">🗑️</span><span>Delete</span>
          </button>
        </div>
      </div>
    `;
    })
    .join("");
}

async function refreshSessionList() {
  currentSessionHostname = getTabHostname(currentTab);
  renderSessionDomain();
  if (!currentSessionHostname) {
    currentSessions = [];
    activeSessionId = null;
    renderSessionList();
    return;
  }

  try {
    const response = await sendRuntimeMessage({
      type: "get-sessions",
      hostname: currentSessionHostname,
    });
    assertRuntimeResponse(response, "Failed to load sessions");
    currentSessions = Array.isArray(response.sessions) ? response.sessions : [];
    activeSessionId = response.activeSessionId || null;
    renderSessionList();
  } catch (error) {
    console.error("Failed to load sessions:", error);
    setSessionStatus(error.message, "error");
  }
}

async function saveCurrentConfig() {
  try {
    const response = await sendRuntimeMessage({
      type: "update-config",
      config: currentConfig,
    });
    assertRuntimeResponse(response, "Failed to save settings");
    currentProxyRuntimeStatus = await loadProxyRuntimeStatus();
    renderProxyStatus();
    renderTrackerStatus();
    scheduleCurrentTabReload();
  } catch (error) {
    console.error("Failed to save settings:", error);
    currentConfig = await loadRuntimeConfig();
    currentProxyRuntimeStatus = await loadProxyRuntimeStatus();
    renderPopup();
  }
}

function scheduleCurrentTabReload() {
  if (!currentTab || typeof currentTab.id !== "number") {
    return;
  }
  clearTimeout(pendingReloadTimeout);
  pendingReloadTimeout = setTimeout(async () => {
    pendingReloadTimeout = null;
    try {
      await callChromeApi(chrome.tabs, "reload", currentTab.id);
    } catch (error) {
      console.error("Failed to reload current tab:", error);
    }
  }, POPUP_RELOAD_DEBOUNCE_MS);
}

function setupEventListeners() {
  document
    .getElementById("global-enabled")
    .addEventListener("change", async (event) => {
      currentConfig.enabled = event.target.checked;
      renderPopup();
      await saveCurrentConfig();
    });

  document
    .getElementById("notifications-enabled")
    .addEventListener("change", async (event) => {
      currentConfig.notifications.enabled = event.target.checked;
      await saveCurrentConfig();
    });

  for (const toggle of document.querySelectorAll("[data-feature-toggle]")) {
    toggle.addEventListener("change", async (event) => {
      currentConfig[toggle.dataset.featureToggle].enabled =
        event.target.checked;
      renderProxyStatus();
      renderTrackerStatus();
      await saveCurrentConfig();
    });
  }

  document
    .getElementById("webgl-quick-select")
    .addEventListener("change", async (event) => {
      currentConfig.webgl.preset = event.target.value;
      await saveCurrentConfig();
    });

  document
    .getElementById("gpu-profile-quick-select")
    .addEventListener("change", selectBundledGpuProfile);

  document
    .getElementById("useragent-quick-select")
    .addEventListener("change", async (event) => {
      const selectedUserAgent = parseUserAgentSelection(event.target.value);
      currentConfig.useragent.preset = selectedUserAgent.preset;
      currentConfig.useragent.curlProfile = selectedUserAgent.curlProfile;
      await saveCurrentConfig();
    });

  document
    .getElementById("language-quick-select")
    .addEventListener("change", async (event) => {
      currentConfig.language.preset = event.target.value;
      await saveCurrentConfig();
    });

  document
    .getElementById("timezone-quick-select")
    .addEventListener("change", async (event) => {
      currentConfig.timezone.name = event.target.value;
      await saveCurrentConfig();
    });

  document
    .getElementById("toggle-current-site")
    .addEventListener("click", toggleCurrentSiteAllowlist);
  document
    .getElementById("toggle-adblock-site")
    .addEventListener("click", toggleCurrentSiteAdblock);
  document
    .getElementById("toggle-cosmetic-site")
    .addEventListener("click", toggleCurrentSiteCosmeticFiltering);
  document
    .getElementById("block-element")
    .addEventListener("click", startElementPicker);
  document
    .getElementById("tracker-details-toggle")
    .addEventListener("click", toggleTrackerDetails);

  for (const row of document.querySelectorAll(".feature-row")) {
    row.addEventListener("click", (event) => {
      if (event.target.closest("input, select, button, .switch")) {
        return;
      }
      chrome.tabs.create({
        url: chrome.runtime.getURL(
          `options/options.html#${row.dataset.section}`,
        ),
      });
    });
  }

  document.getElementById("open-options").addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });
  document.getElementById("open-selftest").addEventListener("click", () => {
    const optionsUrl = chrome.runtime.getURL("options/options.html");
    chrome.tabs.create({
      url:
        currentTab && Number.isInteger(currentTab.id)
          ? `${optionsUrl}?tabId=${currentTab.id}#selftest-section`
          : `${optionsUrl}#selftest-section`,
    });
  });
  document.getElementById("test-webrtc").addEventListener("click", () => {
    chrome.tabs.create({ url: "https://dnscheck.tools/" });
  });
  document
    .getElementById("save-session")
    .addEventListener("click", saveSession);
  document
    .getElementById("clear-current-session")
    .addEventListener("click", clearCurrentSession);
  document
    .getElementById("session-list")
    .addEventListener("click", handleSessionAction);
}

async function selectBundledGpuProfile(event) {
  const profileId = event.target.value;
  if (!profileId) {
    currentConfig.gpuProfile = null;
    renderPopup();
    await saveCurrentConfig();
    return;
  }
  try {
    currentConfig.gpuProfile = await loadBundledGpuProfile(profileId);
    renderPopup();
    await saveCurrentConfig();
  } catch (error) {
    console.error("Failed to select GPU profile:", error);
    renderPopup();
  }
}

async function toggleCurrentSiteAllowlist() {
  if (!currentSessionHostname) {
    return;
  }

  const allowlisted = isDomainAllowlisted(
    currentSessionHostname,
    currentConfig.globalWhitelist,
  );

  try {
    const response = await sendRuntimeMessage({
      type: allowlisted ? "remove-from-whitelist" : "add-to-whitelist",
      domain: currentSessionHostname,
    });
    assertRuntimeResponse(response, "Failed to update allowlist");
    currentConfig.globalWhitelist = response.whitelist;
    renderPopup();
    scheduleCurrentTabReload();
  } catch (error) {
    console.error("Failed to update allowlist:", error);
  }
}

async function toggleCurrentSiteAdblock() {
  if (!currentSessionHostname) return;
  currentConfig.tracker.whitelist = toggleDomainAllowlist(
    currentSessionHostname,
    currentConfig.tracker.whitelist,
  );
  renderPopup();
  await saveCurrentConfig();
}

async function toggleCurrentSiteCosmeticFiltering() {
  if (!currentSessionHostname) return;
  currentConfig.tracker.cosmeticWhitelist = toggleDomainAllowlist(
    currentSessionHostname,
    currentConfig.tracker.cosmeticWhitelist,
  );
  renderPopup();
  await saveCurrentConfig();
}

function toggleDomainAllowlist(hostname, allowlist) {
  return isDomainAllowlisted(hostname, allowlist)
    ? removeDomainFromAllowlist(hostname, allowlist)
    : addDomainToAllowlist(hostname, allowlist);
}

async function startElementPicker() {
  if (!currentTab || typeof currentTab.id !== "number") return;
  try {
    await callChromeApi(chrome.tabs, "sendMessage", currentTab.id, {
      type: "start-element-picker",
    });
    window.close();
  } catch (error) {
    console.error("Failed to start element picker:", error);
  }
}

async function saveSession() {
  if (
    !currentTab ||
    typeof currentTab.id !== "number" ||
    !currentSessionHostname
  ) {
    setSessionStatus("Open an HTTP(S) tab first.", "error");
    return;
  }

  const input = document.getElementById("session-name-input");
  setSessionStatus("Saving session...");
  try {
    const response = await sendRuntimeMessage({
      type: "save-session",
      hostname: currentSessionHostname,
      tabId: currentTab.id,
      name: input.value,
    });
    assertRuntimeResponse(response, "Failed to save session");
    input.value = "";
    setSessionStatus("Session saved.", "success");
    await refreshSessionList();
  } catch (error) {
    setSessionStatus(error.message, "error");
  }
}

async function clearCurrentSession() {
  if (
    !currentTab ||
    typeof currentTab.id !== "number" ||
    !currentSessionHostname
  ) {
    setSessionStatus("Open an HTTP(S) tab first.", "error");
    return;
  }
  if (!confirm("Clear cookies and storage for this site in the current tab?")) {
    return;
  }

  setSessionStatus("Clearing current session...");
  try {
    const response = await sendRuntimeMessage({
      type: "clear-current-session",
      hostname: currentSessionHostname,
      tabId: currentTab.id,
    });
    assertRuntimeResponse(response, "Failed to clear current session");
    setSessionStatus("Current session cleared.", "success");
    await refreshSessionList();
  } catch (error) {
    setSessionStatus(error.message, "error");
  }
}

async function handleSessionAction(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) {
    return;
  }

  const action = button.dataset.action;
  const sessionId = button.dataset.sessionId;
  if (action === "delete" && !confirm("Delete this saved session?")) {
    return;
  }

  let request = { type: `${action}-session`, sessionId };
  if (action === "switch") {
    if (!currentTab || typeof currentTab.id !== "number") {
      setSessionStatus("No active tab found.", "error");
      return;
    }
    request.tabId = currentTab.id;
    setSessionStatus("Switching session...");
  } else if (action === "rename") {
    const session = currentSessions.find((entry) => entry.id === sessionId);
    const name = prompt("Session name", (session && session.name) || "");
    if (name === null) {
      return;
    }
    request.name = name;
  }

  try {
    const response = await sendRuntimeMessage(request);
    assertRuntimeResponse(response, `Failed to ${action} session`);
    setSessionStatus(
      `Session ${action === "switch" ? "switched" : `${action}d`}.`,
      "success",
    );
    await refreshSessionList();
  } catch (error) {
    setSessionStatus(error.message, "error");
  }
}
