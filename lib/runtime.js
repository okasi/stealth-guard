function getChromeError() {
  const error = chrome.runtime && chrome.runtime.lastError;
  return error
    ? new Error(error.message || String(error))
    : null;
}

function callChromeApi(api, methodName, ...args) {
  return new Promise((resolve, reject) => {
    api[methodName](...args, (result) => {
      const error = getChromeError();
      if (error) {
        reject(error);
        return;
      }
      resolve(result);
    });
  });
}

function sendRuntimeMessage(message) {
  return callChromeApi(chrome.runtime, "sendMessage", message);
}

function assertRuntimeResponse(response, fallbackMessage) {
  if (!response || response.success === false) {
    throw new Error((response && response.error) || fallbackMessage);
  }
  return response;
}

function getTimeZoneGmtOffsetLabel(timeZone, date = new Date()) {
  try {
    const zonePart = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "longOffset",
      hour: "2-digit",
    })
      .formatToParts(new Date(date))
      .find((part) => part.type === "timeZoneName");
    const normalized = zonePart.value.replace(/−/g, "-").replace(/^UTC/, "GMT");
    if (normalized === "GMT") {
      return "GMT+0";
    }
    return normalized
      .replace(/^GMT([+-])0(\d)(?=:|$)/, "GMT$1$2")
      .replace(/:00$/, "");
  } catch (error) {
    return null;
  }
}

function getTimeZoneShortName(timeZone, date = new Date()) {
  try {
    const zonePart = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      timeZoneName: "short",
      hour: "2-digit",
    })
      .formatToParts(new Date(date))
      .find((part) => part.type === "timeZoneName");
    const shortName = zonePart.value.replace(/−/g, "-");
    return /^GMT[+-]/.test(shortName) ? null : shortName;
  } catch (error) {
    return null;
  }
}

function updateTimeZoneSelectLabels(select, date = new Date()) {
  if (!select) return;
  for (const option of select.options) {
    const baseLabel =
      option.dataset.timeZoneLabel || option.textContent.trim();
    option.dataset.timeZoneLabel = baseLabel;
    const offsetLabel = getTimeZoneGmtOffsetLabel(option.value, date);
    const shortName =
      getTimeZoneShortName(option.value, date) ||
      option.dataset.timeZoneAbbreviation;
    const regionalLabel = shortName
      ? `${shortName}/${baseLabel}`
      : baseLabel;
    option.textContent = offsetLabel
      ? `${regionalLabel} (${offsetLabel})`
      : regionalLabel;
  }
}

async function loadRuntimeConfig(retries = 1) {
  let response = null;
  let requestError = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      response = await sendRuntimeMessage({ type: "get-config" });
      requestError = null;
    } catch (error) {
      requestError = error;
    }
    if (response && response.config) {
      return response.config;
    }
    if (attempt < retries) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  throw (
    requestError ||
    new Error((response && response.error) || "Invalid config response")
  );
}

/* c8 ignore next 3 */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    getChromeError,
    callChromeApi,
    sendRuntimeMessage,
    assertRuntimeResponse,
    getTimeZoneGmtOffsetLabel,
    getTimeZoneShortName,
    updateTimeZoneSelectLabels,
    loadRuntimeConfig,
  };
}
