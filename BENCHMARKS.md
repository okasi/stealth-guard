# Browser Privacy Benchmarks

Use these checks for native, unpacked-extension validation in an MV2-capable
Opera build. Automated Chrome results without the extension loaded are useful
only as environment baselines and must not be reported as Stealth Guard results.

## Audit and verification: 2026-09-05

Tested the 1.0.73 working tree based on `a5b1b9c`, including changes already
present when this audit began. Environment: macOS 15.7.2 arm64, Opera
135.0.5973.92, clean temporary profiles. No release was published.

Completed priorities, in execution order:

1. Reviewed every tracked source, test, tool, workflow, document, manifest,
   dependency record, and profile asset; checked icons and profile normalization.
   Traced startup, page configuration, message dispatch, global policy, catalog
   updates, credentials, sessions, and UI interactions before changing boundaries.
2. Fixed behavior exposed by that review: duplicate page-config projection,
   stale startup/cosmetic replies, non-atomic credential/catalog publication,
   stale request identity after catalog refresh, substring filter indexing,
   malformed rule scopes, proxy response-body timeouts, Worker live toggles,
   WebGL readback boundaries, picker interception, session tab targeting, and
   subscription-only self-test reporting. Added regression coverage.
3. Consolidated descriptor patches, inline/nested Worker bootstrap, WebGL noise,
   locale construction, browser-profile defaults, credential mutations, message
   dispatch, filter indexing, and repeated settings styles. Retained the existing
   directory/module boundaries and classic-script loading model.
4. Removed unused capture metadata from all 54 bundled GPU profiles. Deep equality
   of normalized old/new profiles confirmed unchanged runtime values. This saved
   1,525,845 bytes and about 57,000 lines relative to the initial working tree;
   runtime JavaScript and styles lost 247 lines. Test code grew to cover real browser
   integration and the discovered regressions.
5. Updated AGENTS, README, privacy, contribution, attribution, and release notes;
   checked all four version fields and included the root license in CRX packaging.

| Verification | Result and scope |
| --- | --- |
| `npm run check` | Passed: syntax/bundle compilation, manifest/assets/versions, 119 tests across 11 files, and Chromium E2E. Deterministic libraries have 100% measured statements, branches, functions, and lines; this is not whole-extension coverage. |
| Chromium protection harness | Passed identity/client hints, locale/timezone/geolocation, canvas/audio/layout/fonts, real WebGL readbacks, simulated WebGPU, frames, allowlists, WebRTC wrappers, classic/module inline and nested Workers, native URL Workers, YouTube fixtures, cosmetic filtering, picker, popup/options controls, imports/exports, sessions, and failure paths. |
| `OPERA_PATH=… npm run e2e:extension` | Passed with the unpacked MV2 extension loaded: actual headers and privacy policy, downloaded network/cosmetic rules, live settings and Worker updates, allowlist recovery, picker persistence, cookie/local/session-storage CRUD and switching, HTTP/HTTPS proxy authentication, SOCKS4/SOCKS5 transport, split routing, cached rules after HTTP 503, options self-test, popup initialization, and no extension runtime errors. |
| Real upstream integrations | Native catalog refresh returned 8 profiles. Three AdGuard subscriptions updated successfully (401,801 network and 59,627 cosmetic rules at test time). |
| Apify imports | Fingerprint Generator 2.1.88 produced valid imports for all five presets: Windows Edge, macOS Chrome/Safari, iOS Safari, and Android Chrome. Missing dependency and unknown preset errors checked. |
| Release tooling | Disposable-key CRX packaging and update XML generation passed, including version, extension ID, and URL escaping; missing arguments and insecure update URL rejected. |
| Dependencies and assets | npm audit against the HTTPS public registry reported zero vulnerabilities; GPU normalization equivalence, icon dimensions, and whitespace checks passed. |

The native suite creates local HTTPS/proxy servers and synthetic site data, then
removes its temporary browser profile. HTTP(S) authentication uses a real 407
challenge. SOCKS tests cover transport without claiming authenticated SOCKS
support. Live upstream checks are recorded observations, not required network
dependencies of the deterministic suite.

### Detector comparison

All seven pages below loaded in disabled and protected runs. Protected settings:
macOS Chrome 150 identity, en-US, Europe/Paris, automatic WebGL with strict mode,
no imported GPU profile, proxy off, bundled tracker blocking on, subscriptions
off for this controlled comparison. Baseline identity was Opera 135 / Chrome
151, en-GB, Europe/Stockholm. Playwright automation remained enabled in both.
Cookies were cleared between runs; other site storage/cache was retained.

| Detector | Observed comparison |
| --- | --- |
| CreepJS Checker | Both completed 52 collectors with 0 failures and 6 skipped; no browser-consistency warnings. WebGL/audio collectors were skipped. |
| Sannysoft | WebDriver detected in both; the same two invalid-argument probe errors appeared in both. |
| Rebrowser | WebDriver and the default automated viewport were flagged in both. Probes requiring explicit instrumentation calls remained untriggered. |
| Scrapfly | One automation signal (WebDriver) in both runs. |
| Device & Browser Info | Both identified automation through WebDriver/CDP/timing; no added UA, client-hint, GPU, or Worker inconsistency flags. |
| APIVoid | Risk score 65 in both, attributed to WebDriver, its tampering check, and unavailable WebGL. |
| Infosimples | WebDriver present in both; plugins and MIME types remained consistent. Interactive mouse behavior was not exercised. |

Local screenshots, extracted reports, and identities are in the ignored
`output/audit-2026-09-05/` directory. These results do **not** establish anonymity
or universal detector evasion. WebGL was unavailable in this Opera environment
even before enabling the extension; graphics behavior was exercised separately
in Chromium with software rendering. Hardware WebGPU and real microphone/camera
permissions were not verified. YouTube behavior uses deterministic fixtures,
not a claim that every current live ad format is blocked. The first page script
can observe default protection before asynchronously loaded custom settings;
native TLS/HTTP2 identity and automation signals remain browser-controlled.

## Recurring Reference

[CreepJS Checker](https://creepjs.org/checker#scan) is the recurring reference
benchmark. Re-run it after meaningful fingerprint-protection changes and before
releases.

## Manual Test Suite

- [Sannysoft Bot Test](https://bot.sannysoft.com/)
- [Rebrowser Bot Detector](https://bot-detector.rebrowser.net/)
- [Scrapfly Automation Detector](https://scrapfly.io/web-scraping-tools/automation-detector)
- [Device & Browser Info: Are You a Bot?](https://deviceandbrowserinfo.com/are_you_a_bot)
- [APIVoid Bot Detection Test](https://www.apivoid.com/tools/bot-detection-test/)
- [Infosimples Detect Headless](https://infosimples.github.io/detect-headless/)
- [CreepJS Checker](https://creepjs.org/checker#scan)

## Test Procedure

1. Start a clean Opera profile that supports Manifest V2.
2. Load this repository as an unpacked extension and confirm Stealth Guard is
   enabled.
3. Record the Opera version, operating system, extension commit/version, active
   User-Agent/WebGL presets, allowlists, proxy state, and whether the profile is
   clean or reused.
4. Run each site once with Stealth Guard disabled to establish the same-profile
   baseline.
5. Clear site data, enable Stealth Guard, and run the site again without changing
   other browser conditions.
6. Capture screenshots and record every failed, suspicious, inconsistent, or
   blocked check. Avoid reducing a detailed report to a single pass/fail score.

## Result Template

```text
Date:
Commit/version:
Opera version:
Operating system:
Profile state:
Protection configuration:
Proxy state:

Site:
Baseline result:
Protected result:
Triggered Stealth Guard features:
Regressions or inconsistencies:
Screenshot/evidence:
Notes:
```
