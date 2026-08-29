const DEFAULT_FILTER_LISTS = Object.freeze([
  Object.freeze({
    id: "adguard-base",
    name: "AdGuard Base filter",
    url: "https://filters.adtidy.org/extension/chromium/filters/2.txt",
    enabled: true,
  }),
  Object.freeze({
    id: "adguard-tracking",
    name: "AdGuard Tracking Protection filter",
    url: "https://filters.adtidy.org/extension/chromium/filters/3.txt",
    enabled: true,
  }),
  Object.freeze({
    id: "adguard-cookies",
    name: "AdGuard Cookie Notices filter",
    url: "https://filters.adtidy.org/extension/chromium/filters/18.txt",
    enabled: true,
  }),
]);

function normalizeFilterListEntries(value, useDefaultNames = true) {
  const defaultsById = new Map(
    DEFAULT_FILTER_LISTS.map((entry) => [entry.id, entry]),
  );
  const source = Array.isArray(value) ? value : DEFAULT_FILTER_LISTS;
  const seen = new Set();
  const result = [];

  for (const entry of source) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const id =
      typeof entry.id === "string"
        ? entry.id.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 64)
        : "";
    const url = typeof entry.url === "string" ? entry.url.trim() : "";
    let parsedUrl = null;
    try {
      parsedUrl = new URL(url);
    } catch (error) {
      parsedUrl = null;
    }
    if (!id || seen.has(id) || !parsedUrl || parsedUrl.protocol !== "https:") {
      continue;
    }

    const defaultEntry = defaultsById.get(id);
    result.push({
      id,
      name:
        typeof entry.name === "string" && entry.name.trim()
          ? entry.name.trim().slice(0, 128)
          : useDefaultNames
            ? defaultEntry?.name || id
            : id,
      url: parsedUrl.href,
      enabled:
        typeof entry.enabled === "boolean"
          ? entry.enabled
          : defaultEntry?.enabled ?? true,
    });
    seen.add(id);
  }

  return result.length
    ? result
    : DEFAULT_FILTER_LISTS.map((entry) => ({ ...entry }));
}

/* c8 ignore next 3 */
if (typeof module !== "undefined" && module.exports) {
  module.exports = { DEFAULT_FILTER_LISTS, normalizeFilterListEntries };
}
