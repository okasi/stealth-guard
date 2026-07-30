const targetSelect = document.getElementById("target-tab");
const runButton = document.getElementById("run-test");
const summary = document.getElementById("test-summary");

document.addEventListener("DOMContentLoaded", initializeGuide);
runButton.addEventListener("click", runSelfTest);
targetSelect.addEventListener("change", runSelfTest);

function queryWebTabs() {
  return callChromeApi(chrome.tabs, "query", {
    url: ["http://*/*", "https://*/*"],
  }).then((tabs) => tabs || []);
}

function sendTabMessage(tabId, message) {
  return callChromeApi(chrome.tabs, "sendMessage", tabId, message, {
    frameId: 0,
  });
}

function requestedTabId() {
  const value = new URL(window.location.href).searchParams.get("tabId");
  const tabId = value === null ? Number.NaN : Number(value);
  return Number.isInteger(tabId) && tabId >= 0 ? tabId : null;
}

function setResult(id, value, state = "") {
  const element = document.getElementById(id);
  element.textContent = value || "—";
  element.dataset.state = state;
}

function clearResults() {
  for (const id of [
    "result-useragent",
    "result-language",
    "result-intl",
    "result-timezone",
    "result-webrtc",
    "result-proxy",
    "result-trackers",
    "result-triggered",
  ]) {
    setResult(id, "—");
  }
}

async function initializeGuide() {
  try {
    const tabs = await queryWebTabs();
    const preferredTabId = requestedTabId();
    targetSelect.replaceChildren();
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
      targetSelect.appendChild(option);
    }
    if (targetSelect.selectedIndex < 0 && targetSelect.options.length) {
      targetSelect.selectedIndex = 0;
    }
    runButton.disabled = targetSelect.options.length === 0;
    if (runButton.disabled) {
      summary.textContent = "Open an HTTP(S) page, then return and run the test.";
      summary.dataset.state = "error";
      return;
    }
    await runSelfTest();
  } catch (error) {
    showError(error);
  }
}

async function runSelfTest() {
  const tabId = Number(targetSelect.value);
  if (!Number.isInteger(tabId)) return;

  runButton.disabled = true;
  summary.textContent = "Reading extension policy and live page values…";
  summary.dataset.state = "";
  clearResults();
  try {
    const selected = targetSelect.options[targetSelect.selectedIndex];
    const targetUrl = selected ? selected.dataset.url : "";
    const hostname = new URL(targetUrl).hostname;
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
    const result = renderResults(policy, pageResult.snapshot);
    if (result.failures) {
      summary.textContent = `${result.failures} identity mismatch${result.failures === 1 ? "" : "es"} found for ${hostname}`;
      summary.dataset.state = "error";
    } else {
      summary.textContent = `Self-test passed for ${hostname}${result.warnings ? ` with ${result.warnings} informational warning${result.warnings === 1 ? "" : "s"}` : ""}`;
      summary.dataset.state = "success";
    }
  } catch (error) {
    showError(error);
  } finally {
    runButton.disabled = targetSelect.options.length === 0;
  }
}

function renderResults(policy, snapshot) {
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

  setResult(
    "result-useragent",
    snapshot.userAgent,
    check(policy.userAgent.enabled, snapshot.userAgent === policy.userAgent.value),
  );
  setResult(
    "result-language",
    `${snapshot.language} · ${(snapshot.languages || []).join(", ")}`,
    check(
      policy.language.enabled,
      snapshot.language === policy.language.locale &&
        Array.isArray(snapshot.languages) &&
        snapshot.languages[0] === policy.language.languages[0],
    ),
  );
  setResult(
    "result-intl",
    snapshot.intlLocale,
    check(
      policy.language.enabled,
      snapshot.intlLocale === policy.language.locale,
    ),
  );
  setResult(
    "result-timezone",
    `${snapshot.timeZone || "unknown"} · offset ${snapshot.timezoneOffset}`,
    check(
      policy.timezone.enabled,
      snapshot.timeZone === policy.timezone.name,
    ),
  );
  setResult(
    "result-webrtc",
    `${policy.webrtc.effectivePolicy} · ${policy.webrtc.controlLevel}`,
    check(
      policy.webrtc.enabled,
      policy.webrtc.effectivePolicy === policy.webrtc.requestedPolicy,
    ),
  );
  setResult(
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
  setResult(
    "result-trackers",
    policy.tracker.enabled
      ? `${policy.tracker.blockedCount} blocked · ${policy.tracker.builtInRules + policy.tracker.customRules} rules`
      : "Off",
    policy.tracker.enabled
      ? check(
          true,
          policy.tracker.builtInRules + policy.tracker.customRules > 0,
        )
      : "warning",
  );
  if (!policy.tracker.enabled) warnings++;
  setResult(
    "result-triggered",
    policy.triggeredFeatures.length
      ? policy.triggeredFeatures.join(", ")
      : "None yet",
    "neutral",
  );
  return { failures, warnings };
}

function showError(error) {
  summary.textContent = error && error.message ? error.message : String(error);
  summary.dataset.state = "error";
}
