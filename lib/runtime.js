function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(
          new Error(
            chrome.runtime.lastError.message ||
              String(chrome.runtime.lastError),
          ),
        );
        return;
      }
      resolve(response);
    });
  });
}

function wait(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function loadRuntimeConfig(retries = 1) {
  let response = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    response = await sendRuntimeMessage({ type: "get-config" });
    if (response && response.config) {
      return response.config;
    }
    if (attempt < retries) {
      await wait(100);
    }
  }

  throw new Error((response && response.error) || "Invalid config response");
}

/* c8 ignore next 3 */
if (typeof module !== "undefined" && module.exports) {
  module.exports = { sendRuntimeMessage, wait, loadRuntimeConfig };
}
