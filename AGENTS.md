# Stealth Guard Architecture (Code-Verified, Current)

This document is the canonical architecture summary for this repository as of the current source tree.

## Runtime Model

- Manifest: MV2 (`manifest.json`) with a persistent background page.
- No build step: plain JavaScript files are loaded directly by the browser.
- Execution contexts:
1. Background page (`background.js` + `lib/*`) for policy orchestration and shared state.
2. Content script (`content-scripts/injector.js`) at `document_start` in all frames.
3. Injected MAIN-world inline script (built by `injector.js`) that patches browser APIs.
4. UI pages (`popup/*`, `options/*`) that read/write config through runtime messages.

## Essential Modules

| Path | Responsibility |
| --- | --- |
| `manifest.json` | Extension entry points, permissions, script order, content script registration. |
| `background.js` | Startup orchestration, runtime message hub, UA header spoofing, WebRTC policy control, proxy lifecycle, per-site session save/switch handlers (cookies + tab storage), context menus, notifications. |
| `content-scripts/injector.js` | Fail-closed document-start bootstrap, authenticated trusted config updates, challenge-frame exclusions, MAIN-world injection, fingerprint alert forwarding. |
| `lib/config.js` | Config defaults/schema, safe normalization, and deep merge with persisted data. Storage key: `stealth-guard-config`. |
| `lib/storage.js` | Promise wrapper over `chrome.storage.local` (`read/write/remove/clear`). |
| `lib/domainFilter.js` | Hostname extraction + wildcard allowlist matching (`example.com`, `*.example.com`, `webmail.*`, generic `*pattern*`) with parse/regex caches. |
| `lib/proxy.js` | Proxy profile/routing helpers, bypass normalization, PAC generation, proxy mode application (`system`, `fixed_servers`, `pac_script`). |
| `lib/session.js` | Pure session hostname, name, cookie URL, and cookie-scope helpers. |
| `popup/popup.js` | Quick toggles, per-tab triggered-feature highlighting, current-site allowlist actions, per-site session switcher controls, debounced current-tab reload after config updates. |
| `options/options.js` | Full settings UI, autosave/save/reset/import/export, proxy profile CRUD, duplicate-save suppression for unchanged configs. |

## Initialization Sequence

1. Browser loads background scripts in manifest order:
   `lib/storage.js` -> `lib/config.js` -> `lib/domainFilter.js` -> `lib/proxy.js` -> `lib/session.js` -> `background.js`.
2. `background.js` immediately runs `initializeBackground()`:
   - `loadConfig()` and sets in-memory `currentConfig` + cached `DomainFilter`.
   - Applies UA header spoofing listener (`webRequest.onBeforeSendHeaders`).
   - Applies base WebRTC policy (`chrome.privacy.network.webRTCIPHandlingPolicy`), deduped by last/pending policy.
   - Applies proxy settings (`chrome.proxy.settings`).
   - Rebuilds context menus.
3. `chrome.runtime.onInstalled` and `chrome.runtime.onStartup` re-apply UA/WebRTC/proxy (install also opens options page on first install).
4. For each frame at `document_start`, `injector.js`:
   - Injects MAIN-world protections immediately with embedded safe defaults to avoid a pre-patch fingerprinting window.
   - Loads trusted config from `chrome.storage.local` and delivers it through an authenticated MAIN-world update channel; installed wrappers consult mutable config at call time.
   - If extension storage is slow, default protections can apply briefly before stored disables or allowlists take effect.
   - Does not trust page-origin `sessionStorage`/`localStorage` for config or bypass decisions.
   - Exits early on challenge domains; global disables and allowlists are enforced by call-time wrapper gates after trusted config is loaded.
   - Skips protection inside Cloudflare-owned challenge frames without granting the embedding page a UA bypass.
   - Injects MAIN-world protection script and registers message bridges.
5. Popup/options request config via runtime messages and persist updates through `update-config`.

## State Ownership and Data Flow

- Persistent source of truth:
  - `chrome.storage.local["stealth-guard-config"]`
  - `chrome.storage.local["stealth-guard-sessions"]`
  - `chrome.storage.local["stealth-guard-active-sessions"]`
- Background in-memory state:
  - `currentConfig`, `currentDomainFilter`, `configLoaded`, `initializationPromise`
  - `triggeredFeaturesPerTab` (tabId -> hostname + `Set` of triggered features)
  - WebRTC state: `lastAppliedWebRTCPolicy`, `webRTCPolicyQueue`
  - Notification throttle map: `lastNotificationTime`
- Content-script session state:
  - Immediate embedded safe-default config for fail-closed MAIN-world injection.
  - Trusted config loaded from `chrome.storage.local` and delivered through an authenticated MAIN-world update channel into mutable MAIN-world config.
  - Runtime `config-updated` messages update isolated and MAIN-world config without writing to page-origin storage.
- UI transient state:
  - Popup: debounced reload timer for rapid toggles.
  - Options: serialized snapshot dedupe (`lastSavedConfigSerialized`, `saveInFlightSerialized`).

## Interaction Points

### Runtime Message Contract (`chrome.runtime.sendMessage`)

| Direction | Type | Payload | Response |
| --- | --- | --- | --- |
| Popup/Options -> Background | `get-config` | none | `{ config }` or `{ config: null, error }` |
| Popup/Options -> Background | `update-config` | `{ config }` | `{ success: true }` or `{ success: false, error }` |
| Popup/Options -> Background | `reset-config` | none | `{ success: true }` |
| Popup/Options -> Background | `add-to-whitelist` | `{ domain }` | `{ success, whitelist }` |
| Popup/Options -> Background | `remove-from-whitelist` | `{ domain }` | `{ success, whitelist }` |
| Popup -> Background | `get-triggered-features` | `{ tabId }` | `{ features: string[] }` |
| Popup -> Background | `get-sessions` | `{ hostname }` | `{ success, sessions, activeSessionId }` |
| Popup -> Background | `save-session` | `{ hostname, tabId, name }` | `{ success, session }` |
| Popup -> Background | `switch-session` | `{ sessionId, tabId }` | `{ success }` |
| Popup -> Background | `rename-session` | `{ sessionId, name }` | `{ success, session? }` |
| Popup -> Background | `delete-session` | `{ sessionId }` | `{ success }` |
| Popup -> Background | `clear-current-session` | `{ hostname, tabId }` | `{ success }` |
| Injector -> Background | `fingerprint-detected` | `{ feature, hostname, url, timestamp }` | `{ success: true }` |
| Legacy (available) | `get-injection-config` | `{ url }` | `{ config }` |
| Background -> Injector | `config-updated` | `{ config }` | none |

Implementation note:
- Background uses a `messageHandlers` map plus a unified async normalization path (`Promise` -> `sendResponse`) for consistent handler behavior.

### MAIN <-> ISOLATED Window Bridge

- MAIN -> injector fingerprint alerts:
  - `stealth-guard-canvas-alert`
  - `stealth-guard-webgl-alert`
  - `stealth-guard-font-alert`
  - `stealth-guard-clientrects-alert`
  - `stealth-guard-webgpu-alert`
  - `stealth-guard-audiocontext-alert`
  - `stealth-guard-timezone-alert`
  - `stealth-guard-useragent-alert`
  - `stealth-guard-webrtc-alert`
### Browser Event Hooks

- WebRequest:
  - `onBeforeSendHeaders` for HTTP User-Agent spoofing.
- WebNavigation:
  - `onBeforeNavigate` / `onCommitted` for WebRTC policy maintenance.
- Tabs:
  - `onUpdated`, `onActivated`, `onRemoved` for policy maintenance + tab feature tracking cleanup.
- Runtime lifecycle:
  - `onInstalled`, `onStartup`.

## Core Runtime Flows

1. Config update path:
   - UI sends `update-config`; background validates the payload shape and normalizes it against safe defaults.
   - Background diffs relevant sections (`enabled`, `globalWhitelist`, `useragent`, `webrtc`, `proxy`), saves config, reapplies only changed subsystems, and broadcasts `config-updated` to HTTP/HTTPS tabs.
   - Injector keeps runtime config private and forwards it through the authenticated MAIN-world update channel when `config-updated` is received.

2. Fingerprint detection path:
   - MAIN-world hook posts alert string.
   - Injector maps alert -> feature and sends `fingerprint-detected`.
   - Background tracks per-tab features and conditionally emits notifications (throttled, allowlist-aware).

3. Challenge-frame path:
   - Injector exits early inside Cloudflare-owned challenge frames so those frames see an unmodified browser environment.
   - The embedding page does not receive a host-level UA bypass.

4. Proxy allowlist bypass path:
   - `lib/proxy.js` emits PAC rules that return `DIRECT` for global-allowlisted hosts.
   - Background does not toggle `chrome.proxy.settings` per active tab because that setting is browser-global.

5. WebRTC policy path:
   - Background applies the configured `chrome.privacy.network.webRTCIPHandlingPolicy` globally while WebRTC protection is enabled.
   - Per-site WebRTC allowlists affect the content-script API patch only; they do not relax the browser-global privacy setting.
   - Repeated identical policy sets are deduped.

6. Session switch path:
   - Popup requests/saves sessions keyed by normalized current hostname.
   - Background verifies the target tab still belongs to that hostname, snapshots only its cookie store plus current-tab `localStorage`/`sessionStorage`, and persists locally.
   - On switch/clear, background clears current site state, restores selected snapshot (for switch), and reloads tab.

## Current Behavior Notes (Non-Stale)

- UA HTTP header spoofing uses `webRequest` blocking listener; DNR cleanup exists only for legacy rule removal.
- `get-injection-config` is retained for compatibility; the active injector path uses fail-closed defaults plus trusted extension storage updates.
- `lib/domainFilter.js` includes bounded caches for parsed whitelist strings and wildcard regexes; matching semantics remain unchanged.
- Proxy behavior uses:
  - `fixed_servers` when only one active profile is needed and no global allowlist requires PAC.
  - `pac_script` when routes/global allowlist logic is required.
- Options UI does not currently expose domain-route editing even though `lib/proxy.js` supports domain routes.
- Saved session retention is capped per domain (`MAX_SAVED_SESSIONS_PER_DOMAIN = 20`) to avoid unbounded growth.
