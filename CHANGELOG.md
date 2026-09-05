# Changelog

All notable changes are documented here. This project follows [Semantic Versioning](https://semver.org/).

## Unreleased

### Added

- Toolbar icons with a per-tab proxy-state corner dot (including amber for PAC-bypassed sites), per-tab blocked-count badges, and a detailed hover summary, plus an expandable popup breakdown with per-domain hit counts.
- OffscreenCanvas read/export protection, WebGL debug-extension monitoring, expanded Web Audio readout noise, and coherent Navigator hardware/client-hint profiles informed by public anti-bot detector coverage.
- Language and locale alignment across Navigator, default Intl constructors, Accept-Language, and optional proxy-country synchronization.
- Automatic AdGuard-compatible Base, Tracking Protection, and Cookie Notices subscriptions with local caching, network/cosmetic filtering, user rules, per-site recovery controls, an element picker, and per-tab counts.
- Eight-hour scheduled filter refreshes plus a YouTube freshness check when enabled lists are more than 45 minutes old.
- Curated Chrome desktop 131/latest, Android Chrome 131, Edge 101, and Safari 18.4/26 browser/API profiles from curl-impersonate wrappers, cached locally and refreshed from GitHub every four hours; the Firefox target is not surfaced because its wrapper does not provide a User-Agent header.
- A local Guide & Self-Test page with live identity diagnostics and the repeatable detector suite; CreepJS remains the recurring reference benchmark.
- Explicit protect-all, bypass-selected, and protect-selected split-tunneling modes with per-site PAC routing.
- Proxy-location synchronized timezone and permission-preserving coarse HTML geolocation protection.
- Local proxy diagnostics with effective-setting details and a bounded, exportable, clearable 100-event connection history.
- Pull-request CI for syntax, manifest integrity, and 100% deterministic-core coverage.
- Dependabot, contribution guidance, security policy, and structured issue templates.
- Manifest consistency validation and test coverage for session/cookie helpers.
- Dedicated and shared worker identity bootstrapping for consistent Navigator, locale, timezone, and WebGL values.
- Worker identity protection now has its own enable toggle and editable compatibility allowlist, with Telegram Web kept safe by default.
- Expanded the default Worker compatibility allowlist for major real-time, collaborative, graphics, and media web apps, while preserving custom user allowlists.
- ClearCote-profile import for one coherent WebGL/WebGPU device profile, with native-capability clamping and compatibility-site bypass.
- Apify Fingerprint Suite JSON import support, including generator presets for Windows Edge, macOS Chrome/Safari, iOS Safari, and Android Chrome.
- GitHub Release packaging for signed CRX updates, a stable browser update manifest, and a source ZIP download.

### Changed

- Shared page/Worker WebGL noise and Worker bootstrap factories, descriptor
  patching, locale identity generation, and staged credential writes.
- Compact runtime GPU assets omit 1.5 MB of unused capture data.
- Added repeatable unpacked Opera integration checks with local HTTPS and
  authenticated proxy fixtures (`npm run e2e:extension`).

- Shared GPU asset loading, User-Agent/profile compatibility, configuration
  form bindings, serial queues, browser API calls, and bounded concurrent
  downloads now use single reusable implementations.
- Configuration and filter-list imports now cap collection and text sizes, and
  the manifest check validates every bundled GPU asset against its index.
- Deterministic-library coverage now includes the adblock and GPU-profile
  libraries at the existing 100% statements, branches, functions, and lines
  threshold.
- Adblock request matching now reuses normalized request context and scans block candidates once, reducing repeated per-request tokenization and hostname work.
- Method hooks now install from their property descriptors so writable, enumerable, and configurable flags remain intact across the expanded protection surface.
- Split isolated-world injection from a directly testable MAIN-world protection runtime.
- Replaced permissive deep merging with explicit-schema config normalization.
- Consolidated browser callback errors, allowlist operations, proxy profile indexing, and the serialized session lifecycle.
- Reduced background and MAIN-world protection code while preserving direct classic-script loading.
- Browser patches now preserve property descriptors and avoid mutating caller-owned WebGL/WebGPU inputs.
- WebGL protection now defaults to strict deterministic readback, export, and extension-order noise, with a curated per-site compatibility allowlist.
- Bundled ClearCote GPL profiles and imported combined GPU profiles now supply WebGL parameter/precision/extension data and WebGPU adapter metadata/limits only on strict sites.
- WebGL masked vendor values now share the unmasked vendor family, avoiding false mismatch reports from CreepJS-style consistency checks across Chromium and Safari profiles.
- Font measurements now remain consistent across reads and suppress OS-incompatible font probes so User-Agent and font analysis stay aligned.
- Expanded `npm run check` across startup recovery, rollback, browser hooks, every protection surface, and popup/options success and failure flows.
- Configuration loads, saves, and imports now normalize malformed values to the safe schema.
- Popup and options surfaces have improved focus visibility, responsive styling, and assistive-technology labels.
- Popup diagnostics now summarize effective User-Agent, language, timezone, WebRTC, proxy, and tracker state for the current site.
- User-Agent headers and MAIN-world navigator/client-hint values can share the selected modern curl-impersonate profile, while native TLS and HTTP/2 remain browser-owned.
- User-Agent and modern browser/API choices now use one combined identity selector.
- The validated curl-profile catalog is now the single source for request-header,
  Navigator, client-hint, Worker, and diagnostic browser identity.
- Session operations verify the target tab before mutating cookies or web storage.
- Session cookie mutation and tab broadcasts now use bounded concurrency.

### Fixed

- Startup config projection and late storage reads no longer discard proxy
  locale settings or overwrite newer broadcasts.
- Filter/catalog commits use current settings, persist before publication,
  and refresh new subscriptions after older downloads finish. Automatic filter
  downloads now honor their switch.
- Substring filter indexing no longer misses matches inside longer URL tokens;
  malformed scopes cannot turn into global rules.
- WebGL readback respects pixel-pack layout and untouched destination regions.
- Cosmetic filtering ignores stale responses, notices changed classes/IDs, and
  lets the picker reach elements underneath its instruction banner.
- Worker toggles apply to subsequent Workers without a page reload.
- Proxy verification times out stalled response bodies; credential persistence
  failures leave active credentials intact.
- Extension pages opened in tabs target the requested website session, and
  self-test counts downloaded/custom filtering rules.

- URL-backed application Workers now retain native script-location, CSP,
  module-loading, and SharedWorker identity semantics; identity bootstrapping
  is limited to inline Worker URLs used by fingerprint probes.
- Content-script cosmetic filtering now loads its shared runtime helpers in
  the production manifest bundle and waits for background initialization.
- WebGPU command descriptors and upload buffers now remain native so active
  WebGPU applications such as vgpu.sh keep rendering correctly while adapter
  fingerprint surfaces remain protected.
- X Chat now keeps native Worker and SharedWorker bootstrapping so its real-time
  conversation state can load and synchronize normally.
- Facebook pages now keep native Worker and SharedWorker bootstrapping so feed,
  video-prefetch, and other background page features continue loading normally.
- Telegram Web now keeps its native Worker and SharedWorker URL/sharing semantics so live message state can synchronize normally.
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
- Compatibility-mode WebGL no longer changes application rendering output, canvas exports, capability detection, or readback buffers, preventing compatibility failures in graphics editors such as Figma.
- Apple profiles no longer claim a specific processor model, and WebGL profiles keep masked and unmasked GPU identity families coherent.
- Editing a proxy host no longer retains stale location metadata.
- Malformed settings imports no longer crash the options page before background validation.
- DataDome CAPTCHA delivery frames now remain native like Cloudflare challenge frames.
- Invalid native browser window dimensions now get a bounded top-level resize request, while valid geometry remains native and untouched; this prevents CreepJS zero/outer-smaller-than-inner consistency failures where the browser permits resizing.
- AdGuard rules with trailing wildcard domain scopes no longer lose their scope and block first-party application bundles such as Prisjakt and Blocket's `/index.js` resources.

### Removed

- Eighteen invalid or behaviorally duplicate indexed ClearCote captures, plus
  unused multi-bundle catalog metadata.
- Unused storage/config APIs, the stateful domain-filter wrapper, proxy comment generation, remote-DNS UI state, legacy DNR cleanup, and redundant WebRTC navigation listeners.

## 1.0.10 - 2026-01-23

- Hardened document-start config delivery and browser policy application.
- Added quality gates and capped saved sessions per domain.
