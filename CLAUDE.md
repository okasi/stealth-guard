# Stealth Guard Chrome Extension

Privacy-focused extension protecting against browser fingerprinting. Manifest V2, vanilla JS, no build system.

## Quick Start

Load unpacked in `chrome://extensions/` with Developer mode enabled. No build step needed.

## Architecture

```
background.js              → Orchestrator (chrome.privacy, proxy, declarativeNetRequest)
    ↓
content-scripts/
  injector.js              → ISOLATED world, requests config, injects inline MAIN world code
    ↓
lib/
  config.js                → Config schema, defaults, and storage management
  domainFilter.js          → Wildcard domain matching and whitelist logic
  proxy.js                 → SOCKS5 proxy management, PAC generation, location fetching
  storage.js               → Chrome storage wrapper
```

## Key Files

| File | Purpose |
|------|---------|
| `manifest.json` | Permissions, entry points (MV2, v1.9) |
| `background.js` | Main orchestrator, UA spoofing (DNR), WebRTC policy, Proxy settings |
| `lib/config.js` | Config schema, defaults, storage key: `stealth-guard-config` |
| `lib/domainFilter.js` | Wildcard domain matching (`*.domain.com`, `webmail.*`) |
| `lib/proxy.js` | SOCKS5 proxy profiles, PAC script generation, IP location fetching |
| `lib/storage.js` | Chrome storage wrapper |
| `content-scripts/injector.js` | Injects inline protections into MAIN world, handles config caching |
| `popup/` | Browser action UI with quick toggles and status |
| `options/` | Full settings page |

## Message Passing

```javascript
// Content (ISOLATED) → Background
{ type: "get-injection-config", url }      // Request config for current page
{ type: "fingerprint-detected", feature }   // Notify of blocked attempt
{ type: "turnstile-detected", hostname }    // Notify of Cloudflare Turnstile

// Background → Content
{ type: "config-updated", config }          // Push new config to tabs

// Popup/Options → Background
{ type: "get-config" }
{ type: "update-config", config }
{ type: "add-to-whitelist", domain }
{ type: "get-triggered-features", tabId }   // Get alerts for current tab
{ type: "check-turnstile-status", hostname } // Check if UA spoofing should be skipped
```

## Config Hierarchy

1. **Global `enabled`** → Master switch
2. **Global `globalWhitelist`** → Disables ALL protections for domain
3. **Per-feature `enabled`** → Individual feature control
4. **Per-feature `whitelist`** → Feature-specific exemptions

## Domain Patterns

- `example.com` → matches `example.com` and `www.example.com`
- `*.example.com` → matches all subdomains (`sub.example.com`)
- `webmail.*` → matches any domain starting with `webmail.` (`webmail.company.com`)

## Protection Modules

1. **Canvas**: Adds noise to `toBlob`, `toDataURL`, `getImageData`.
2. **WebGL**: Spoofs parameters (`getParameter`), adds noise to buffers, presets (Apple, Pixel 4, etc.).
3. **Font**: Adds noise to `offsetWidth`/`offsetHeight` and `measureText`.
4. **ClientRects**: Adds noise to `DOMRect` and `DOMRectReadOnly` properties.
5. **WebGPU**: Spoofs `limits`, `beginRenderPass`, `writeBuffer`.
6. **AudioContext**: Adds noise to `getChannelData` and `getFloatFrequencyData`.
7. **Timezone**: Spoofs `Date` and `Intl` objects to fixed timezone (default: UTC+1).
8. **User-Agent**: Spoofs HTTP headers via `declarativeNetRequest` and JS via `navigator` overrides.
9. **WebRTC**: Intercepts `RTCPeerConnection` (JS) and sets IP handling policy (Chrome Privacy API).

## Special Behaviors

- **Turnstile Detection**:
  - Detects Cloudflare Turnstile challenges via URL patterns, page title, or DOM elements.
  - Auto-disables UA spoofing for the domain for **3 minutes**.
  - Clears `sessionStorage` and reloads the page upon detection.
- **Proxy Bypass**:
  - Intercepts `main_frame` requests to globally whitelisted domains.
  - Temporarily disables proxy (sets to `system` mode) before navigation proceeds.
- **Config Caching**:
  - `injector.js` caches config in `sessionStorage` (`__STEALTH_GUARD_CONFIG_CACHE__`) for synchronous access.
  - Version tagged (`_version`) to force refreshes when internal structure changes.
- **Sandboxing**:
  - Protections sync to iframes via `postMessage` and `documentElement` attributes.

## Debugging

- **Background**: `chrome://extensions/` → Inspect background page.
- **Content**: DevTools → Sources → Content Scripts (`injector.js`).
- **Logs**: Enable "Debug" toggle in popup (or "Show notification when fingerprinting is detected" in options) for verbose console logs (`[Stealth Guard] ...`). All non-error logging is disabled when Debug mode is off.
- **Tests**: Use context menu "Test Protection" or visit `browserleaks.com`.
