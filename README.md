<div align="center">
  <img src="icons/128.png" alt="Stealth Guard Logo" width="128" />
  <h1>Stealth Guard</h1>
  <p><strong>Local-first browser fingerprinting protection for MV2-compatible Chromium browsers</strong></p>

[![CI](https://github.com/okasi/stealth-guard/actions/workflows/ci.yml/badge.svg)](https://github.com/okasi/stealth-guard/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/okasi/stealth-guard)](https://github.com/okasi/stealth-guard/releases)
[![License](https://img.shields.io/github/license/okasi/stealth-guard)](LICENSE)
![Core coverage](https://img.shields.io/badge/deterministic_core-100%25_coverage-16a34a)

</div>

Stealth Guard reduces passive browser fingerprinting across Canvas, WebGL,
fonts, audio, ClientRects, WebGPU, timezone, language, geolocation,
User-Agent, and WebRTC surfaces. It also blocks selected ads and trackers,
supports proxy routing and split tunneling, and can save per-site sessions.

Settings, filter rules, proxy history, and sessions stay in local extension
storage. There is no account, telemetry, analytics, or Stealth Guard server.

> [!IMPORTANT]
> Stealth Guard intentionally uses Manifest V2. Current standard Google Chrome
> releases do not support it; Opera is the primary current target. Use an
> unpacked installation in a browser that still supports MV2.

## Features

- Fingerprinting protection for browser identity, graphics, media, layout,
  locale, timezone, geolocation, and WebRTC surfaces.
- SOCKS4/5 and HTTP/HTTPS proxy profiles with credentials, fallback order,
  split tunneling, location synchronization, and local diagnostics.
- AdGuard-compatible subscription lists with request blocking, cosmetic rules,
  element picking, and YouTube ad-response sanitization.
- Global and per-feature domain allowlists, pause controls, and Cloudflare
  challenge-frame compatibility.
- Strict WebGL identity/readback protection by default, with a curated
  compatibility allowlist for graphics editors and interactive WebGL apps.
- Optional ClearCote combined GPU-profile import for matching WebGL 1/2 and
  WebGPU adapter data; only the graphics sections are retained locally.
- Bundled curated ClearCote profile set with 72 GPL-licensed real-device
  profiles, selectable from the popup or Advanced Settings.
- Apify Fingerprint Suite import support for generated browser/OS fingerprints
  covering Windows Edge, macOS Chrome/Safari, iOS Safari, and Android Chrome.
- Per-site cookie and storage sessions that can be saved, renamed, switched,
  cleared, or deleted.
- Combined User-Agent/browser profiles, locale presets, timezone presets,
  WebGL presets, combined GPU-profile import, export/import, notifications,
  and an identity self-test.

## Installation

1. Download or clone this repository.
2. Open `opera://extensions/` or the equivalent page in an MV2-compatible
   Chromium browser.
3. Enable Developer mode, choose **Load unpacked**, and select this folder.

The extension has no production build step. Reload the unpacked extension after
changing source files.

### Automatic updates from GitHub

GitHub Releases publish a signed `.crx` package and the update manifest used by
MV2-compatible browsers that support self-hosted extension updates. Install the
`.crx` release asset for browser-managed updates; unpacked developer installs
must still be reloaded manually.

The release workflow signs every package with the same private key. Before the
first release, generate a key once and store its base64 contents as the
`STEALTH_GUARD_EXTENSION_KEY_B64` GitHub Actions repository secret. Keep the
private key safe and reuse it for every release:

```bash
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out release-key.pem
base64 < release-key.pem | tr -d '\n' | gh secret set STEALTH_GUARD_EXTENSION_KEY_B64
```

The workflow runs for `v*` tags and publishes the signed CRX, its update XML,
and a source ZIP. The browser checks the update URL in `manifest.json` on its
normal extension-update schedule.

The bundled GPU profiles are derived from
[clearcote-profiles](https://github.com/clearcotelabs/clearcote-profiles) and
remain under GNU GPL-3.0; see
[profiles/clearcote/NOTICE.md](/Users/osim/Developer/wiz/Stealth-Guard-by-okasi/profiles/clearcote/NOTICE.md)
and the included license file.

Apify's `fingerprint-generator` output can be generated with
`node tools/generate-apify-profile.mjs <preset>` after installing the package,
then imported from Advanced Settings. The extension maps the generator's
`videoCard` data into WebGL identity surfaces. Apify does not provide WebGPU
adapter captures, so no sourced WebGPU adapter profile is applied unless the
JSON also contains an explicit WebGPU section; the existing generic WebGPU
protection can still apply.

## Usage

Use the toolbar popup for quick protection, identity, timezone, proxy, and
current-page controls. Open **Advanced Settings** for allowlists, proxy
profiles, filters, sessions, diagnostics, import/export, and self-test.

Right-click a page to manage its global allowlist or open the self-test section.

Domain controls accept exact domains and wildcards such as `*.example.com`,
`webmail.*`, and `*pattern*`. User-Agent settings select one aligned browser/API
profile; they do not replace the browser's native TLS or HTTP/2 stack.

## Development

Requirements: Node.js 20.19+ or 22.12+, plus Chrome/Chromium for the browser
harness. Set `CHROME_PATH` if the browser is not installed in a standard path.

```bash
npm ci
npm run check
```

`npm run check` validates syntax and manifest order, runs deterministic-core
coverage, exercises background integration, and runs the browser-driven
protection, popup, options, and failure-path checks. The harness uses the same
classic-script bundles with mocked extension APIs because current Chrome cannot
load MV2. Release validation should also include an unpacked smoke test in an
MV2-capable Opera build.

For repeatable manual detector checks, see
[BENCHMARKS.md](BENCHMARKS.md). Project structure and runtime contracts are
documented for coding agents in [AGENTS.md](AGENTS.md).

## Privacy and permissions

Stealth Guard does not collect browsing history or send telemetry. Optional
background requests are limited to proxy location services and the configured
curl-impersonate profile source. All user settings remain local.

The extension requests storage, cookies, privacy, proxy, webRequest,
webRequestBlocking, alarms, unlimitedStorage, tabs, contextMenus,
notifications, and `<all_urls>` for its protection and session features.

## Browser compatibility

Opera is the primary supported browser. Current Google Chrome is unsupported
because MV2 is disabled. Brave, Vivaldi, and Edge are not currently validated
as MV2 targets; Firefox uses a different extension format.

See the vendor references for [Chrome](https://developer.chrome.com/docs/extensions/develop/migrate/mv2-deprecation-timeline),
[Opera](https://blogs.opera.com/news/2025/09/mv2-extensions-opera/),
[Brave](https://brave.com/blog/brave-shields-manifest-v3/), and
[Vivaldi](https://vivaldi.com/blog/manifest-v3-update-vivaldi-is-future-proofed-with-its-built-in-functionality/).

## Contributing and license

Read [CONTRIBUTING.md](CONTRIBUTING.md) for development and pull-request
expectations. Report vulnerabilities privately according to [SECURITY.md](SECURITY.md).
Release changes are tracked in [CHANGELOG.md](CHANGELOG.md).

Stealth Guard is licensed under the MIT License; see [LICENSE](LICENSE).
