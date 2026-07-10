// Pure helpers for per-site session snapshots.

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
  const host = typeof rawHost === "string" ? rawHost.replace(/^\./, "").trim() : "";

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

  if (cookieDomain === normalizedHostname || cookieDomain === "www." + normalizedHostname) {
    return true;
  }

  return cookie.hostOnly !== true && normalizedHostname.endsWith("." + cookieDomain);
}

/* c8 ignore next 3 */
if (typeof module !== "undefined" && module.exports) {
  module.exports = { normalizeSessionHostname, sanitizeSessionName, buildCookieUrl, cookieMatchesHostname };
}
