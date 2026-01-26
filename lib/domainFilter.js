// Domain filtering logic with wildcard support

class DomainFilter {
  /**
   * Create a DomainFilter instance
   * @param {Object} config - Configuration object
   */
  constructor(config) {
    this.config = config;
  }

  /**
   * Check if a feature should be active on a given URL
   * @param {string} url - The URL to check
   * @param {string} featureName - Feature name (canvas, webgl, font, timezone, useragent, webrtc)
   * @returns {boolean} True if feature should activate
   */
  shouldActivateFeature(url, featureName) {
    // 1. Check global enabled flag
    if (!this.config.enabled) {
      return false;
    }

    // 2. Check feature enabled flag
    if (!this.config[featureName] || !this.config[featureName].enabled) {
      return false;
    }

    // 3. Extract hostname from URL
    const hostname = this.extractHostname(url);
    if (!hostname) {
      return false;
    }

    // 4. Check global whitelist/allowlist (applies to ALL features)
    if (this.isWhitelisted(hostname, this.config.globalWhitelist)) {
      return false;  // Protection OFF on this domain
    }

    // 5. Check per-feature whitelist/allowlist
    const featureWhitelist = this.config[featureName].whitelist || "";
    if (this.isWhitelisted(hostname, featureWhitelist)) {
      return false;  // Protection OFF for this feature on this domain
    }

    // 6. Not on whitelist/allowlist = activate protection
    return true;
  }

  /**
   * Check if hostname matches any pattern in whitelist/allowlist
   * @param {string} hostname - Hostname to check
   * @param {string} whitelistString - Comma-separated whitelist/allowlist patterns
   * @returns {boolean} True if hostname is on whitelist/allowlist
   */
  isWhitelisted(hostname, whitelistString) {
    if (!whitelistString || whitelistString.trim() === "") {
      return false;
    }

    // Parse comma-separated list and remove whitespace
    const patterns = whitelistString
      .split(",")
      .map(s => s.trim())
      .filter(Boolean);

    // Check each pattern
    for (const pattern of patterns) {
      if (this.matchesPattern(hostname, pattern)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Match hostname against pattern with wildcard support
   * Wildcard rules:
   * - "example.com" matches:
   *   - "example.com" (exact match)
   *   - "www.example.com" (www variant)
   * - "*.example.com" or "*example.com" matches:
   *   - "example.com" (root domain)
   *   - "www.example.com" (subdomain)
   *   - "sub.www.example.com" (nested subdomain)
   * - "webmail.*" matches:
   *   - "webmail.company.com" (any domain starting with "webmail.")
   *
   * @param {string} hostname - Hostname to match
   * @param {string} pattern - Pattern to match against
   * @returns {boolean} True if hostname matches pattern
   */
  matchesPattern(hostname, pattern) {
    // Normalize to lowercase
    hostname = hostname.toLowerCase();
    pattern = pattern.toLowerCase();

    // Exact match
    if (hostname === pattern) {
      return true;
    }

    // Prefix wildcard matching: webmail.*
    if (pattern.endsWith(".*")) {
      const prefix = pattern.slice(0, -2);  // Remove ".*"
      // Match any hostname that starts with "prefix."
      if (hostname.startsWith(prefix + ".")) {
        return true;
      }
    }

    // Suffix wildcard matching: *.example.com OR *example.com (without dot)
    if (pattern.startsWith("*.")) {
      const domain = pattern.substring(2);  // Remove "*."

      // Match exact domain: example.com
      if (hostname === domain) {
        return true;
      }

      // Match subdomains: www.example.com, a.b.example.com
      if (hostname.endsWith("." + domain)) {
        return true;
      }
    } else if (pattern.startsWith("*") && !pattern.startsWith("*.")) {
      // Handle *example.com format (no dot after asterisk)
      const domain = pattern.substring(1);  // Remove "*"

      // Match exact domain: example.com
      if (hostname === domain) {
        return true;
      }

      // Match subdomains: www.example.com, a.b.example.com
      if (hostname.endsWith("." + domain)) {
        return true;
      }
    }

    // Plain domain pattern (no wildcard): also match www. variant
    if (!pattern.includes("*")) {
      // "example.com" should match "www.example.com"
      if (hostname === "www." + pattern) {
        return true;
      }
    }

    return false;
  }

  /**
   * Extract hostname from URL
   * @param {string} url - URL to extract hostname from
   * @returns {string|null} Hostname or null if invalid
   */
  extractHostname(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname;
    } catch (e) {
      // Invalid URL
      return null;
    }
  }

  /**
   * Check if a domain should be added to whitelist/allowlist (helper for UI)
   * @param {string} domain - Domain to check
   * @param {string} whitelistString - Current whitelist/allowlist string
   * @returns {boolean} True if domain is already in whitelist/allowlist
   */
  isDomainInWhitelist(domain, whitelistString) {
    if (!whitelistString || !domain) {
      return false;
    }

    const domains = whitelistString
      .split(",")
      .map(s => s.trim())
      .filter(Boolean);

    return domains.some(d => d.toLowerCase() === domain.toLowerCase());
  }

  /**
   * Add domain to whitelist/allowlist string
   * @param {string} domain - Domain to add
   * @param {string} whitelistString - Current whitelist/allowlist string
   * @returns {string} Updated whitelist/allowlist string
   */
  addDomainToWhitelist(domain, whitelistString) {
    if (!domain) {
      return whitelistString;
    }

    // Check if already exists
    if (this.isDomainInWhitelist(domain, whitelistString)) {
      return whitelistString;
    }

    // Add with wildcard for subdomain matching
    const entry = `*.${domain}`;

    if (!whitelistString || whitelistString.trim() === "") {
      return entry;
    }

    return `${whitelistString.trim()}, ${entry}`;
  }

  /**
   * Remove domain from whitelist/allowlist string
   * @param {string} domain - Domain to remove
   * @param {string} whitelistString - Current whitelist/allowlist string
   * @returns {string} Updated whitelist/allowlist string
   */
  removeDomainFromWhitelist(domain, whitelistString) {
    if (!domain || !whitelistString) {
      return whitelistString;
    }

    const domains = whitelistString
      .split(",")
      .map(s => s.trim())
      .filter(Boolean);

    // Remove exact match and wildcard versions
    const filtered = domains.filter(d => {
      const normalized = d.toLowerCase();
      const targetDomain = domain.toLowerCase();
      return normalized !== targetDomain && normalized !== `*.${targetDomain}`;
    });

    return filtered.join(", ");
  }
}
