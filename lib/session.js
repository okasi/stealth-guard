const SESSION_STORAGE_KEY = "stealth-guard-sessions";
const ACTIVE_SESSIONS_STORAGE_KEY = "stealth-guard-active-sessions";
const MAX_SAVED_SESSIONS_PER_DOMAIN = 20;

function normalizeSessionHostname(hostname) {
  if (typeof hostname !== "string") {
    return "";
  }

  const trimmed = hostname.trim().toLowerCase();
  if (!trimmed || /[\s/?#\\]/.test(trimmed)) {
    return "";
  }

  try {
    const parsed = new URL("http://" + trimmed);
    return parsed.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  } catch (error) {
    return "";
  }
}

function sanitizeSessionName(name, now = new Date()) {
  const trimmed = typeof name === "string" ? name.trim() : "";
  return trimmed ? trimmed.slice(0, 64) : "Session " + now.toLocaleString();
}

function buildCookieUrl(cookie, fallbackHostname) {
  const protocol = cookie && cookie.secure ? "https" : "http";
  const rawHost = cookie && cookie.domain ? cookie.domain : fallbackHostname;
  const host =
    typeof rawHost === "string" ? rawHost.replace(/^\./, "").trim() : "";

  if (!host) {
    throw new Error("Invalid cookie host");
  }

  const rawPath = cookie && typeof cookie.path === "string" ? cookie.path : "/";
  const path = rawPath.startsWith("/") ? rawPath : "/" + rawPath;
  return protocol + "://" + host + path;
}

function cookieMatchesHostname(cookie, hostname) {
  if (!cookie || typeof cookie.domain !== "string" || !hostname) {
    return false;
  }

  const normalizedHostname = normalizeSessionHostname(hostname);
  const cookieDomain = cookie.domain.replace(/^\./, "").trim().toLowerCase();
  if (!normalizedHostname || !cookieDomain) {
    return false;
  }

  if (
    cookieDomain === normalizedHostname ||
    cookieDomain === "www." + normalizedHostname
  ) {
    return true;
  }

  return (
    cookie.hostOnly !== true && normalizedHostname.endsWith("." + cookieDomain)
  );
}

/* c8 ignore start */
function createSessionManager({ storageApi, browserApi, callApi, warn = () => {} }) {
  let mutationQueue = Promise.resolve();

  function enqueue(operation) {
    const queued = mutationQueue.then(operation, operation);
    mutationQueue = queued.catch(() => {});
    return queued;
  }

  async function readState() {
    const stored = await storageApi.read([
      SESSION_STORAGE_KEY,
      ACTIVE_SESSIONS_STORAGE_KEY,
    ]);
    const storedActiveSessions = stored[ACTIVE_SESSIONS_STORAGE_KEY];
    return {
      sessions: Array.isArray(stored[SESSION_STORAGE_KEY])
        ? stored[SESSION_STORAGE_KEY]
        : [],
      activeSessions: Object.assign(
        Object.create(null),
        storedActiveSessions &&
          typeof storedActiveSessions === "object" &&
          !Array.isArray(storedActiveSessions)
          ? storedActiveSessions
          : {},
      ),
    };
  }

  function writeState(sessions, activeSessions) {
    return storageApi.write({
      [SESSION_STORAGE_KEY]: sessions,
      [ACTIVE_SESSIONS_STORAGE_KEY]: activeSessions,
    });
  }

  function getRequestHostname(request, sender) {
    const explicit = normalizeSessionHostname(
      request && (request.hostname || request.domain),
    );
    if (explicit) {
      return explicit;
    }
    return normalizeSessionHostname(
      sender && sender.tab && sender.tab.url ? getHostname(sender.tab.url) : "",
    );
  }

  function getHostname(url) {
    try {
      return new URL(url).hostname;
    } catch (error) {
      return "";
    }
  }

  function getTabId(request, sender) {
    if (sender && sender.tab && typeof sender.tab.id === "number") {
      return sender.tab.id;
    }
    return request && typeof request.tabId === "number" ? request.tabId : null;
  }

  async function resolveTarget(request, sender) {
    const tabId = getTabId(request, sender);
    if (tabId === null) {
      return { error: "Missing tab id" };
    }

    const tab = await callApi(browserApi.tabs, "get", tabId);
    let url;
    try {
      url = tab && tab.url ? new URL(tab.url) : null;
    } catch (error) {
      url = null;
    }
    const isHttp = url && (url.protocol === "http:" || url.protocol === "https:");
    const hostname = normalizeSessionHostname(isHttp ? url.hostname : "");
    if (!hostname) {
      return { error: "The target tab is not an HTTP(S) site" };
    }

    const requestedHostname = normalizeSessionHostname(
      request && (request.hostname || request.domain),
    );
    return requestedHostname && requestedHostname !== hostname
      ? { error: "The target tab changed sites; reopen the popup and try again" }
      : { tabId, hostname };
  }

  function revalidateTarget(target) {
    return resolveTarget(
      { tabId: target.tabId, hostname: target.hostname },
      null,
    );
  }

  async function getCookies(hostname, tabId) {
    if (!browserApi.cookies || !browserApi.cookies.getAllCookieStores) {
      return [];
    }

    const stores =
      (await callApi(browserApi.cookies, "getAllCookieStores")) || [];
    const tabStores = stores.filter(
      (store) => Array.isArray(store.tabIds) && store.tabIds.includes(tabId),
    );
    const cookieGroups = await Promise.all(
      tabStores.map(async (store) => {
        const cookies =
          (await callApi(browserApi.cookies, "getAll", {
            domain: hostname,
            storeId: store.id,
          })) || [];
        return cookies.filter((cookie) => cookieMatchesHostname(cookie, hostname));
      }),
    );
    return cookieGroups.flat();
  }

  function copyPartitionKey(details, cookie) {
    if (cookie && cookie.partitionKey) {
      details.partitionKey = cookie.partitionKey;
    }
    return details;
  }

  async function clearCookies(hostname, tabId) {
    const cookies = await getCookies(hostname, tabId);
    await Promise.all(
      cookies.map(async (cookie) => {
        try {
          await callApi(
            browserApi.cookies,
            "remove",
            copyPartitionKey(
              {
                url: buildCookieUrl(cookie, hostname),
                name: cookie.name,
                storeId: cookie.storeId,
              },
              cookie,
            ),
          );
        } catch (error) {
          warn("[Session] Failed to remove cookie:", cookie.name, error);
        }
      }),
    );
  }

  async function restoreCookies(cookies, hostname) {
    await Promise.all(
      (Array.isArray(cookies) ? cookies : []).map(async (cookie) => {
        try {
          const details = copyPartitionKey(
            {
              url: buildCookieUrl(cookie, hostname),
              name: cookie.name,
              value: cookie.value,
              path: cookie.path,
              secure: cookie.secure,
              httpOnly: cookie.httpOnly,
              storeId: cookie.storeId,
            },
            cookie,
          );
          if (cookie.domain && cookie.domain.startsWith(".")) {
            details.domain = cookie.domain;
          }
          if (!cookie.session && typeof cookie.expirationDate === "number") {
            details.expirationDate = cookie.expirationDate;
          }
          if (cookie.sameSite && cookie.sameSite !== "unspecified") {
            details.sameSite = cookie.sameSite;
          }
          if (typeof cookie.sameParty === "boolean") {
            details.sameParty = cookie.sameParty;
          }
          await callApi(browserApi.cookies, "set", details);
        } catch (error) {
          warn("[Session] Failed to restore cookie:", cookie && cookie.name, error);
        }
      }),
    );
  }

  function executeScript(tabId, code) {
    return callApi(browserApi.tabs, "executeScript", tabId, {
      code,
      runAt: "document_idle",
    });
  }

  async function readTabStorage(tabId) {
    const code = `(() => {
      const read = (area) => {
        const values = {};
        try {
          for (let index = 0; index < area.length; index++) {
            const key = area.key(index);
            if (key !== null) values[key] = area.getItem(key);
          }
        } catch (error) {}
        return values;
      };
      return { localStorage: read(localStorage), sessionStorage: read(sessionStorage) };
    })();`;

    try {
      const results = await executeScript(tabId, code);
      return (results && results[0]) || { localStorage: {}, sessionStorage: {} };
    } catch (error) {
      warn("[Session] Failed to read storage snapshot:", error);
      return { localStorage: {}, sessionStorage: {} };
    }
  }

  function clearTabStorage(tabId) {
    return executeScript(
      tabId,
      `(() => {
        try { localStorage.clear(); } catch {}
        try { sessionStorage.clear(); } catch {}
        return true;
      })();`,
    );
  }

  function restoreTabStorage(tabId, session) {
    const snapshot = JSON.stringify({
      localStorage: session.localStorage || {},
      sessionStorage: session.sessionStorage || {},
    });
    return executeScript(
      tabId,
      `((snapshot) => {
        const restore = (area, values) => {
          try {
            area.clear();
            Object.keys(values || {}).forEach((key) => {
              const value = values[key];
              area.setItem(key, value == null ? "" : String(value));
            });
          } catch (error) {}
        };
        restore(localStorage, snapshot.localStorage);
        restore(sessionStorage, snapshot.sessionStorage);
        return true;
      })(${snapshot});`,
    );
  }

  function sessionsForHostname(sessions, hostname) {
    return sessions
      .filter((session) => session.domain === hostname)
      .sort(
        (left, right) =>
          (right.lastUsed || right.createdAt || 0) -
          (left.lastUsed || left.createdAt || 0),
      );
  }

  function enforceSessionLimit(sessions, activeSessions, hostname) {
    const domainSessions = sessionsForHostname(sessions, hostname);
    if (domainSessions.length <= MAX_SAVED_SESSIONS_PER_DOMAIN) {
      return sessions;
    }
    const keep = new Set(
      domainSessions
        .slice(0, MAX_SAVED_SESSIONS_PER_DOMAIN)
        .map((session) => session.id),
    );
    if (activeSessions[hostname] && !keep.has(activeSessions[hostname])) {
      delete activeSessions[hostname];
    }
    return sessions.filter(
      (session) => session.domain !== hostname || keep.has(session.id),
    );
  }

  function createSessionId() {
    return `session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function nextSessionTimestamp(sessions) {
    return sessions.reduce(
      (timestamp, session) =>
        Math.max(timestamp, (session.lastUsed || session.createdAt || 0) + 1),
      Date.now(),
    );
  }

  async function getSessions(request, sender) {
    const hostname = getRequestHostname(request, sender);
    if (!hostname) {
      return {
        success: false,
        error: "Missing hostname",
        sessions: [],
        activeSessionId: null,
      };
    }
    const { sessions, activeSessions } = await readState();
    return {
      success: true,
      sessions: sessionsForHostname(sessions, hostname),
      activeSessionId: activeSessions[hostname] || null,
    };
  }

  function saveSession(request, sender) {
    return enqueue(async () => {
      const target = await resolveTarget(request, sender);
      if (target.error) {
        return { success: false, error: target.error };
      }
      const [cookies, storageSnapshot] = await Promise.all([
        getCookies(target.hostname, target.tabId),
        readTabStorage(target.tabId),
      ]);
      const currentTarget = await revalidateTarget(target);
      if (currentTarget.error) {
        return { success: false, error: currentTarget.error };
      }
      const { sessions, activeSessions } = await readState();
      const now = nextSessionTimestamp(sessions);
      const session = {
        id: createSessionId(),
        name: sanitizeSessionName(request && request.name),
        domain: target.hostname,
        createdAt: now,
        lastUsed: now,
        cookies,
        localStorage: storageSnapshot.localStorage || {},
        sessionStorage: storageSnapshot.sessionStorage || {},
      };
      const nextSessions = enforceSessionLimit(
        [...sessions, session],
        activeSessions,
        target.hostname,
      );
      activeSessions[target.hostname] = session.id;
      await writeState(nextSessions, activeSessions);
      return { success: true, session };
    });
  }

  function switchSession(request, sender) {
    return enqueue(async () => {
      const sessionId = request && request.sessionId;
      if (!sessionId) {
        return { success: false, error: "Missing session id" };
      }
      const { sessions, activeSessions } = await readState();
      const session = sessions.find((entry) => entry.id === sessionId);
      if (!session) {
        return { success: false, error: "Session not found" };
      }
      const target = await resolveTarget(request, sender);
      if (target.error) {
        return { success: false, error: target.error };
      }
      if (target.hostname !== session.domain) {
        return {
          success: false,
          error: "This session belongs to a different site",
        };
      }

      let currentTarget = await revalidateTarget(target);
      if (currentTarget.error) {
        return { success: false, error: currentTarget.error };
      }
      await Promise.all([
        clearCookies(session.domain, currentTarget.tabId),
        clearTabStorage(currentTarget.tabId),
      ]);

      currentTarget = await revalidateTarget(currentTarget);
      if (currentTarget.error) {
        return { success: false, error: currentTarget.error };
      }
      await Promise.all([
        restoreCookies(session.cookies, session.domain),
        restoreTabStorage(currentTarget.tabId, session),
      ]);
      currentTarget = await revalidateTarget(currentTarget);
      if (currentTarget.error) {
        return { success: false, error: currentTarget.error };
      }
      session.lastUsed = nextSessionTimestamp(sessions);
      activeSessions[session.domain] = session.id;
      await writeState(sessions, activeSessions);
      await callApi(browserApi.tabs, "reload", currentTarget.tabId, {
        bypassCache: true,
      });
      return { success: true };
    });
  }

  function deleteSession(request) {
    return enqueue(async () => {
      const sessionId = request && request.sessionId;
      if (!sessionId) {
        return { success: false, error: "Missing session id" };
      }
      const { sessions, activeSessions } = await readState();
      const target = sessions.find((session) => session.id === sessionId);
      const nextSessions = sessions.filter((session) => session.id !== sessionId);
      if (target && activeSessions[target.domain] === sessionId) {
        delete activeSessions[target.domain];
      }
      await writeState(nextSessions, activeSessions);
      return { success: true };
    });
  }

  function renameSession(request) {
    return enqueue(async () => {
      const sessionId = request && request.sessionId;
      if (!sessionId) {
        return { success: false, error: "Missing session id" };
      }
      const { sessions, activeSessions } = await readState();
      const session = sessions.find((entry) => entry.id === sessionId);
      if (!session) {
        return { success: false, error: "Session not found" };
      }
      session.name = sanitizeSessionName(request && request.name);
      await writeState(sessions, activeSessions);
      return { success: true, session };
    });
  }

  function clearCurrentSession(request, sender) {
    return enqueue(async () => {
      let target = await resolveTarget(request, sender);
      if (target.error) {
        return { success: false, error: target.error };
      }
      target = await revalidateTarget(target);
      if (target.error) {
        return { success: false, error: target.error };
      }
      await Promise.all([
        clearCookies(target.hostname, target.tabId),
        clearTabStorage(target.tabId),
      ]);
      target = await revalidateTarget(target);
      if (target.error) {
        return { success: false, error: target.error };
      }
      const { sessions, activeSessions } = await readState();
      delete activeSessions[target.hostname];
      await writeState(sessions, activeSessions);
      await callApi(browserApi.tabs, "reload", target.tabId, {
        bypassCache: true,
      });
      return { success: true };
    });
  }

  return {
    getSessions,
    saveSession,
    switchSession,
    deleteSession,
    renameSession,
    clearCurrentSession,
  };
}
/* c8 ignore stop */

/* c8 ignore next 3 */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    normalizeSessionHostname,
    sanitizeSessionName,
    buildCookieUrl,
    cookieMatchesHostname,
    createSessionManager,
  };
}
