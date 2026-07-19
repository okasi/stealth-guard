function callLocalStorage(method, argument) {
  return new Promise((resolve, reject) => {
    const callback = (result) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      resolve(result);
    };

    if (argument === undefined) {
      chrome.storage.local[method](callback);
    } else {
      chrome.storage.local[method](argument, callback);
    }
  });
}

const storage = {
  read(keys) {
    return callLocalStorage("get", keys);
  },
  write(items) {
    return callLocalStorage("set", items);
  },
  remove(keys) {
    return callLocalStorage("remove", keys);
  },
  clear() {
    return callLocalStorage("clear");
  },
};

/* c8 ignore next 3 */
if (typeof module !== "undefined" && module.exports) {
  module.exports = { storage };
}
