# Privacy Policy

**Stealth Guard by okasi**

*Last updated: January 2026*

## Overview

Stealth Guard is a privacy-focused browser extension designed to protect users from browser fingerprinting. We are committed to protecting your privacy and being transparent about our practices.

## Data Collection

**Stealth Guard does not collect telemetry, analytics, browsing history, or personal profile data.** Optional proxy tools can transmit the proxy host/IP to third-party lookup services as described below.

### What We Don't Collect

- No browsing history
- No personal information
- No usage statistics
- No analytics or telemetry
- No remote collection of cookies or tracking data

### Local Extension Storage

Extension settings and configurations are stored locally in your browser using the Chrome Storage API. Optional proxy lookup/test actions can send the proxy host/IP to the third-party services listed below; other locally stored settings are not sent to Stealth Guard servers.

- Your protection preferences (enabled/disabled features)
- Custom allowlists (domains you've whitelisted)
- Proxy configurations (if configured)
- Saved per-site session snapshots (cookies, localStorage, and sessionStorage) only when you use the Session Switcher feature

## Network Requests

Stealth Guard may make the following optional network requests:

### Proxy Location Check (Optional)

When using the proxy feature, the extension may query `ipinfo.io` or `ipapi.co` to display your proxy's apparent location. This is:
- Only triggered when you explicitly use the proxy feature
- Used solely to display location information to you
- Stored locally with the proxy profile so the UI can show the saved proxy location
- Never sent to any Stealth Guard server

### Proxy Connection Test (Optional)

When testing a proxy configuration, the extension may connect to `api.ipify.org` to verify the proxy is working. This is:
- Only triggered when you explicitly test a proxy
- Used solely to verify connectivity
- Not logged or stored by the extension

## Permissions

The extension requests certain browser permissions to function. Here's why each is needed:

| Permission | Purpose |
|------------|---------|
| `storage` | Store your settings locally |
| `cookies` | Save and restore per-site sessions locally |
| `privacy` | Control WebRTC IP handling |
| `proxy` | Configure proxy settings |
| `webRequest` / `webRequestBlocking` | Modify HTTP headers for User-Agent spoofing |
| `webNavigation` | Reapply browser-global WebRTC policy during navigation |
| `declarativeNetRequest` | Clean up legacy User-Agent spoofing rules |
| `tabs` | Access current tab URL for context menu features |
| `contextMenus` | Provide right-click menu options |
| `notifications` | Show optional fingerprint detection alerts |
| `<all_urls>` | Apply protections to all websites |

## Third-Party Services

Stealth Guard does not integrate with any third-party analytics, advertising, or tracking services. If you use proxy location or proxy test features, the extension may contact `ipinfo.io`, `ipapi.co`, or `api.ipify.org` to look up the proxy endpoint you entered or verify the active outbound IP.

## Data Sharing

We do not sell or share telemetry. Optional proxy tools may disclose the proxy host/IP being checked to the lookup services listed above.

## Children's Privacy

Stealth Guard does not knowingly collect any information from anyone, including children under 13 years of age.

## Changes to This Policy

If we make changes to this privacy policy, we will update the "Last updated" date at the top of this document.

## Open Source

Stealth Guard is open source. You can review the complete source code to verify our privacy practices:

- GitHub: <https://github.com/okasi/stealth-guard>

## Contact

If you have questions about this privacy policy, please contact:

- Website: [okasi.me](https://okasi.me)
- GitHub: [github.com/okasi](https://github.com/okasi)

## Your Rights

Since we don't collect any personal data, there is no data to access, correct, or delete. Your extension settings can be cleared at any time by:

1. Opening the extension options
2. Clicking "Reset to Defaults"

Or by removing the extension from your browser.
