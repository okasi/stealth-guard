const PROXY_CREDENTIALS_STORAGE_KEY = "stealth-guard-proxy-credentials";
const MAX_PROXY_USERNAME_LENGTH = 512;
const MAX_PROXY_PASSWORD_LENGTH = 4096;
const MAX_PROXY_AUTH_ATTEMPTS = 3;
const PROXY_AUTH_FAILURE_MAX_AGE_MS = 120000;

function normalizeProxyCredentialText(value, maxLength) {
  return typeof value === "string" ? value.slice(0, maxLength) : "";
}

function getProxyCredentialEndpoint(profile) {
  const normalized = normalizeProxyProfile(profile);
  return normalized
    ? `${normalized.host.toLowerCase()}:${normalized.port}`
    : null;
}

function normalizeStoredProxyCredential(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const username = normalizeProxyCredentialText(
    value.username,
    MAX_PROXY_USERNAME_LENGTH,
  );
  if (!username) {
    return null;
  }

  return {
    username,
    password: normalizeProxyCredentialText(
      value.password,
      MAX_PROXY_PASSWORD_LENGTH,
    ),
  };
}

function normalizeProxyCredentialStore(value) {
  const normalized = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return normalized;
  }

  for (const [endpoint, credential] of Object.entries(value)) {
    const record = normalizeStoredProxyCredential(credential);
    if (record && /^[^\s:]+:\d{1,5}$/.test(endpoint)) {
      normalized[endpoint.toLowerCase()] = record;
    }
  }
  return normalized;
}

function createProxyCredentialManager({ storageApi, getConfig }) {
  let persistentCredentials = {};
  let sessionCredentials = {};
  const authAttempts = new Map();
  const authFailures = new Map();

  function recordAuthFailure(endpoint, reason) {
    authFailures.set(endpoint, { reason, at: Date.now() });
  }

  function getAuthFailure(profile) {
    const endpoint = getProxyCredentialEndpoint(profile);
    const failure = endpoint ? authFailures.get(endpoint) : null;
    return failure &&
      Date.now() - failure.at <= PROXY_AUTH_FAILURE_MAX_AGE_MS
      ? failure
      : null;
  }

  async function initialize() {
    const stored = await storageApi.read(PROXY_CREDENTIALS_STORAGE_KEY);
    persistentCredentials = normalizeProxyCredentialStore(
      stored[PROXY_CREDENTIALS_STORAGE_KEY],
    );
  }

  function getCredential(profile) {
    const endpoint = getProxyCredentialEndpoint(profile);
    return endpoint
      ? sessionCredentials[endpoint] || persistentCredentials[endpoint] || null
      : null;
  }

  function getStatus(profile) {
    const endpoint = getProxyCredentialEndpoint(profile);
    const credential = getCredential(profile);
    return {
      endpoint,
      configured: Boolean(credential),
      username: credential ? credential.username : "",
      persisted: Boolean(endpoint && persistentCredentials[endpoint]),
    };
  }

  async function writePersistentCredentials() {
    await storageApi.write({
      [PROXY_CREDENTIALS_STORAGE_KEY]: persistentCredentials,
    });
  }

  async function setCredential(profile, input = {}) {
    const endpoint = getProxyCredentialEndpoint(profile);
    if (!endpoint) {
      throw new Error("Invalid proxy profile for credentials");
    }

    const username = normalizeProxyCredentialText(
      input.username,
      MAX_PROXY_USERNAME_LENGTH,
    );
    if (!username) {
      throw new Error("Proxy username is required");
    }

    const existing =
      getCredential(profile) || getCredential(input.sourceProfile);
    const password =
      input.keepPassword === true && input.password === "" && existing
        ? existing.password
        : normalizeProxyCredentialText(
            input.password,
            MAX_PROXY_PASSWORD_LENGTH,
          );
    const credential = { username, password };
    authFailures.delete(endpoint);

    if (input.persist === false) {
      sessionCredentials[endpoint] = credential;
      const changed = Boolean(persistentCredentials[endpoint]);
      delete persistentCredentials[endpoint];
      if (changed) {
        await writePersistentCredentials();
      }
    } else {
      persistentCredentials[endpoint] = credential;
      delete sessionCredentials[endpoint];
      await writePersistentCredentials();
    }

    return getStatus(profile);
  }

  async function removeCredential(profile) {
    const endpoint = getProxyCredentialEndpoint(profile);
    if (!endpoint) {
      throw new Error("Invalid proxy profile for credentials");
    }

    const persistentChanged = Boolean(persistentCredentials[endpoint]);
    delete persistentCredentials[endpoint];
    delete sessionCredentials[endpoint];
    authFailures.delete(endpoint);
    if (persistentChanged) {
      await writePersistentCredentials();
    }
    return getStatus(profile);
  }

  async function clearAll() {
    persistentCredentials = {};
    sessionCredentials = {};
    authAttempts.clear();
    authFailures.clear();
    await writePersistentCredentials();
  }

  async function prune(profiles) {
    const allowed = new Set(
      (profiles || []).map(getProxyCredentialEndpoint).filter(Boolean),
    );
    let persistentChanged = false;

    for (const endpoint of Object.keys(persistentCredentials)) {
      if (!allowed.has(endpoint)) {
        delete persistentCredentials[endpoint];
        persistentChanged = true;
      }
    }
    for (const endpoint of Object.keys(sessionCredentials)) {
      if (!allowed.has(endpoint)) {
        delete sessionCredentials[endpoint];
      }
    }
    for (const endpoint of authFailures.keys()) {
      if (!allowed.has(endpoint)) {
        authFailures.delete(endpoint);
      }
    }
    if (persistentChanged) {
      await writePersistentCredentials();
    }
  }

  function getActiveProfiles() {
    const config = getConfig();
    if (!config || !config.enabled || !config.proxy || !config.proxy.enabled) {
      return [];
    }

    const activeNames = new Set(
      (config.proxy.domainRoutes || []).map((route) => route.profile),
    );
    if (config.proxy.activeProfile) {
      activeNames.add(config.proxy.activeProfile);
    }
    for (const profileName of config.proxy.fallbackProfiles || []) {
      activeNames.add(profileName);
    }
    return (config.proxy.profiles || []).filter((profile) =>
      activeNames.has(profile.name),
    );
  }

  function handleAuthRequired(details) {
    if (!details || details.isProxy !== true) {
      return {};
    }

    const challenger = details.challenger || {};
    const endpoint = `${String(challenger.host || "").toLowerCase()}:${Number(
      challenger.port,
    )}`;
    const profile = getActiveProfiles().find(
      (entry) => getProxyCredentialEndpoint(entry) === endpoint,
    );
    const credential = profile && getCredential(profile);
    if (!profile || !credential) {
      recordAuthFailure(
        endpoint,
        profile
          ? `${endpoint} requires a username and password, but no proxy ` +
              "credentials are saved for it"
          : `${endpoint} asked for proxy credentials but no active profile ` +
              "uses that endpoint",
      );
      return { cancel: true };
    }

    const requestId = String(details.requestId || "");
    const attemptCount = authAttempts.get(requestId) || 0;
    if (!requestId || attemptCount >= MAX_PROXY_AUTH_ATTEMPTS) {
      recordAuthFailure(
        endpoint,
        requestId
          ? `${endpoint} rejected the saved credentials for ` +
              `"${credential.username}" after ${MAX_PROXY_AUTH_ATTEMPTS} attempts`
          : `${endpoint} challenged a request that carried no id, so the ` +
              "credentials could not be replayed safely",
      );
      return { cancel: true };
    }
    authAttempts.set(requestId, attemptCount + 1);
    return {
      authCredentials: {
        username: credential.username,
        password: credential.password,
      },
    };
  }

  function clearRequest(details) {
    if (details && details.requestId !== undefined) {
      authAttempts.delete(String(details.requestId));
    }
  }

  return {
    initialize,
    getStatus,
    getAuthFailure,
    setCredential,
    removeCredential,
    clearAll,
    prune,
    handleAuthRequired,
    clearRequest,
  };
}

/* c8 ignore next 3 */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    PROXY_CREDENTIALS_STORAGE_KEY,
    MAX_PROXY_AUTH_ATTEMPTS,
    PROXY_AUTH_FAILURE_MAX_AGE_MS,
    normalizeProxyCredentialText,
    getProxyCredentialEndpoint,
    normalizeStoredProxyCredential,
    normalizeProxyCredentialStore,
    createProxyCredentialManager,
  };
}
