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
    loadRuntimeConfig,
  };
}
