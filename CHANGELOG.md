# Changelog

All notable changes are documented here. This project follows [Semantic Versioning](https://semver.org/).

## Unreleased

### Added

- Toolbar icons with a per-tab proxy-state corner dot (including amber for PAC-bypassed sites), per-tab blocked-count badges, and a detailed hover summary, plus an expandable popup breakdown with per-domain hit counts.
- OffscreenCanvas read/export protection, WebGL debug-extension monitoring, expanded Web Audio readout noise, and coherent Navigator hardware/client-hint profiles informed by public anti-bot detector coverage.
- Language and locale alignment across Navigator, default Intl constructors, Accept-Language, and optional proxy-country synchronization.
- Automatic AdGuard-compatible Base, Tracking Protection, and Cookie Notices subscriptions with local caching, network/cosmetic filtering, user rules, per-site recovery controls, an element picker, and per-tab counts.
- Eight-hour scheduled filter refreshes plus a YouTube freshness check when enabled lists are more than 45 minutes old.
- A local Guide & Self-Test page with live identity diagnostics and the repeatable detector suite; CreepJS remains the recurring reference benchmark.
- Explicit protect-all, bypass-selected, and protect-selected split-tunneling modes with per-site PAC routing.
- Proxy-location synchronized timezone and permission-preserving coarse HTML geolocation protection.
- Local proxy diagnostics with effective-setting details and a bounded, exportable, clearable 100-event connection history.
- Pull-request CI for syntax, manifest integrity, and 100% deterministic-core coverage.
- Dependabot, contribution guidance, security policy, and structured issue templates.
- Manifest consistency validation and test coverage for session/cookie helpers.

### Changed

- Method hooks now install from their property descriptors so writable, enumerable, and configurable flags remain intact across the expanded protection surface.
- Split isolated-world injection from a directly testable MAIN-world protection runtime.
- Replaced permissive deep merging with explicit-schema config normalization.
- Consolidated browser callback errors, allowlist operations, proxy profile indexing, and the serialized session lifecycle.
- Reduced background and MAIN-world protection code while preserving direct classic-script loading.
- Browser patches now preserve property descriptors and avoid mutating caller-owned WebGL/WebGPU inputs.
- WebGL profiles now keep WebGL 1/2 versions, generic GPU identity, capability caps, and shader precision internally consistent while applying stable per-page readback and canvas-export noise.
- Expanded `npm run check` across startup recovery, rollback, browser hooks, every protection surface, and popup/options success and failure flows.
- Configuration loads, saves, and imports now normalize malformed values to the safe schema.
- Popup and options surfaces have improved focus visibility, responsive styling, and assistive-technology labels.
- Popup diagnostics now summarize effective User-Agent, language, timezone, WebRTC, proxy, and tracker state for the current site.
- Session operations verify the target tab before mutating cookies or web storage.

### Fixed

- YouTube player responses now remove first-party video-ad payloads before playback, with a server-side ad-segment skip fallback that still respects site and tracker allowlists.
- Shared Chrome API calls preserve their owning object, preventing `Illegal invocation` failures from storage, tabs, proxy, privacy, cookies, and runtime methods.
- MAIN-world config no longer receives proxy profiles or unknown imported fields.
- Fingerprint alerts now use private per-frame channels instead of page-forgeable public strings.
- Canvas noise levels now affect the applied noise range.
- Allowlisted or disabled User-Agent protection now preserves the native `navigator.userAgentData` value.
- Session snapshots no longer collect host-only cookies from unrelated sibling subdomains or cross browser cookie-store boundaries.
- Concurrent session saves retain the newest 20 entries without producing a dangling active-session ID.
- Failed background startup retries cleanly, and failed browser-policy updates restore persisted and live configuration.
- Timezone spoofing now handles DST offsets, seconds/milliseconds setters, live timezone changes, and leaves `Date.prototype` free of extension-only properties.
- WebGL no longer corrupts application upload buffers with per-call randomness; readback protection is repeatable within a page and covered in both WebGL versions.
- Apple profiles no longer claim a specific processor model, and WebGL report hashes rotate across page loads without changing between repeated reads in one page.
- Editing a proxy host no longer retains stale location metadata.
- Malformed settings imports no longer crash the options page before background validation.

### Removed

- Unused storage/config APIs, the stateful domain-filter wrapper, proxy comment generation, remote-DNS UI state, legacy DNR cleanup, and redundant WebRTC navigation listeners.

## 1.0.10 - 2026-01-23

- Hardened document-start config delivery and browser policy application.
- Added quality gates and capped saved sessions per domain.
