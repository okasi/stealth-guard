# Privacy Policy

**Stealth Guard by okasi**

_Last updated: September 2026_

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
- Custom allowlists (domains you've allowlisted)
- Downloaded ad-blocking filter lists, user rules, and allowlists
- Per-tab blocked-domain counts kept only in memory
- Proxy configurations (if configured)
- Proxy credentials, either in background memory for the browser session or in
  local extension storage when you choose to save them; normal settings exports
  exclude credentials
- Up to 100 recent proxy connection state changes, including timestamps, profile names, verified exit IPs, ownership state, and connection errors
- Saved per-site session snapshots (cookies, localStorage, and sessionStorage) only when you use the Session Switcher feature

## Network Requests

Stealth Guard makes browser-profile update requests automatically. Filter
subscriptions and proxy services are contacted as described below.

### Ad-Blocking Filter Updates

When ad and tracker blocking and automatic updates are enabled, Stealth Guard
downloads the enabled filter subscriptions. Manual updates remain available
when automatic downloads are off. The defaults are AdGuard Base, AdGuard
Tracking Protection, and AdGuard Cookie Notices from `filters.adtidy.org`.
Downloads use no cookies or browser-history data and contain no page URL. Lists
are parsed and stored locally. You can disable automatic updates, disable an
individual list, change the interval, or add a custom HTTPS subscription in
Settings. A custom subscription provider will receive the ordinary network
metadata associated with requesting its URL, such as your IP address.

### Browser/API Profile Updates

Every four hours, and when you request an update in Settings, Stealth Guard
checks the public `lexiforest/curl-impersonate` GitHub API listing and downloads
the selected wrapper files from GitHub's raw-content host. Only public profile
metadata and wrapper files are requested; browsing data, cookies, and extension
settings are not sent. There is currently no separate switch for these
profile updates; disabling protection does not cancel their schedule.

### Proxy Location Check (Optional)

When using the proxy feature, the extension may query `ipinfo.io`, `ipapi.co`,
`ipwho.is`, `api.ip.sb`, or `ip-api.com` to display your proxy's apparent
location. Providers are tried as fallbacks. This is:

- Only triggered when you explicitly use the proxy feature
- Used solely to display location information to you
- Stored locally with the proxy profile so the UI can show the saved proxy location
- Never sent to any Stealth Guard server

### Proxy Exit Verification (Optional)

When a proxy is enabled or you click Verify Connection, Stealth Guard may request `api.ipify.org` through the effective proxy. The returned exit IP is used to distinguish an applied browser setting from a verified connection and may appear in the local diagnostics history. It is never sent to a Stealth Guard server.

Proxy-synchronized HTML geolocation keeps the website's normal permission flow. After permission succeeds, Stealth Guard replaces the returned coordinates with locally stored, coarse coordinates associated with the effective proxy profile. Language synchronization uses the locally stored proxy country to choose a matching preset. Proxy endpoints, route tables, and credentials are not exposed to page scripts.

## Permissions

The extension requests certain browser permissions to function. Here's why each is needed:

| Permission                          | Purpose                                          |
| ----------------------------------- | ------------------------------------------------ |
| `storage`                           | Store your settings locally                      |
| `unlimitedStorage`                  | Store downloaded filter subscriptions locally   |
| `alarms`                            | Schedule automatic filter-list updates           |
| `cookies`                           | Save and restore per-site sessions locally       |
| `privacy`                           | Control WebRTC IP handling                       |
| `proxy`                             | Configure proxy settings                         |
| `webRequest` / `webRequestBlocking` | Align identity headers and apply ad-blocking rules |
| `tabs`                              | Validate session targets, broadcast settings, and reload changed tabs |
| `contextMenus`                      | Provide right-click menu options                 |
| `notifications`                     | Show optional fingerprint detection alerts       |
| `<all_urls>`                        | Apply protections to all websites                |

## Third-Party Services

Stealth Guard does not integrate with any third-party analytics, advertising,
or tracking services. Filter updates contact `filters.adtidy.org` by default or
the HTTPS subscription URLs you configure. If you use automatic proxy location
naming, the extension may contact the five location providers listed above with
the proxy endpoint you entered. Proxy verification may contact `api.ipify.org`
through the configured proxy. Automatic browser/API profile updates contact
GitHub as described above.

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

Saved sessions can be deleted individually or cleared for the current site from the popup. Proxy connection history can be cleared independently in Settings. Removing the extension clears all extension-owned local data.
