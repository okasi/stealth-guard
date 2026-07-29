function getChromeApiCaller() {
  if (typeof callChromeApi === "function") {
    return callChromeApi;
  }
  /* c8 ignore next 3 */
  if (typeof module !== "undefined" && module.exports) {
    return require("./runtime.js").callChromeApi;
  }
  /* c8 ignore next */
  throw new Error("Stealth Guard runtime API is unavailable");
}

const storage = {
  read(keys) {
    return getChromeApiCaller()(chrome.storage.local, "get", keys);
  },
  write(items) {
    return getChromeApiCaller()(chrome.storage.local, "set", items);
  },
};

/* c8 ignore next 3 */
if (typeof module !== "undefined" && module.exports) {
  module.exports = { storage };
}
