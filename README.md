<div align="center">
  <img src="icons/128.png" alt="Stealth Guard Logo" width="128" />
  <h1>Stealth Guard</h1>
  <p><strong>Local-first browser fingerprinting protection for MV2-compatible Chromium browsers</strong></p>

[![CI](https://github.com/okasi/stealth-guard/actions/workflows/ci.yml/badge.svg)](https://github.com/okasi/stealth-guard/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/okasi/stealth-guard)](https://github.com/okasi/stealth-guard/releases)
[![License](https://img.shields.io/github/license/okasi/stealth-guard)](LICENSE)

</div>

Stealth Guard reduces passive fingerprinting across browser identity,
graphics, media, layout, locale, timezone, geolocation, and WebRTC surfaces.
It also provides tracker blocking, proxy routing, split tunneling, and
per-site sessions.

Settings, rules, proxy history, and sessions remain in local extension storage.
There is no account, telemetry, analytics, or Stealth Guard server.

> [!IMPORTANT]
> Stealth Guard intentionally uses Manifest V2. Current Google Chrome releases
> do not support it; Opera is the primary current target. Use an unpacked
> installation in a browser that still supports MV2.

## Highlights

- Fingerprinting protection with aligned browser identity, locale, graphics,
  WebRTC, and optional ClearCote GPU profiles.
- AdGuard-compatible network and cosmetic filtering with YouTube protections,
  recovery controls, and an element picker.
- HTTP, HTTPS, and SOCKS proxy profiles with credentials, split tunneling,
  location synchronization, verification, and local diagnostics.
- Importable Apify browser fingerprints and curated curl-impersonate browser
  profiles.
- Per-site cookie and storage sessions, allowlists, pause controls, and an
  identity self-test.

## Installation

1. Download or clone this repository.
2. Open `opera://extensions/` or the equivalent page in an MV2-compatible
   Chromium browser.
3. Enable Developer mode, choose **Load unpacked**, and select this folder.

Stable releases include a signed CRX and update manifest where supported.
Unpacked developer installations must be reloaded after source changes.

## Usage

Use the toolbar popup for common protection, identity, proxy, and current-page
controls. Open **Advanced Settings** for filters, allowlists, proxy profiles,
sessions, diagnostics, import/export, and self-tests.

Domain controls accept exact domains and patterns such as `*.example.com`,
`webmail.*`, and `*pattern*`.

## Development

Requirements: Node.js 20.19+ or 22.12+, plus Chrome/Chromium for the browser
harness. Set `CHROME_PATH` when the browser is installed elsewhere.

```bash
npm ci
npm run check
```

The check command validates source and manifest integrity, deterministic-core
coverage, background integration, and browser-driven UI and failure paths.
Project architecture is documented in [AGENTS.md](AGENTS.md); repeatable
manual detector checks are in [BENCHMARKS.md](BENCHMARKS.md).

## Privacy and license

Optional network requests are limited to configured filter subscriptions,
proxy location/verification services, and the configured curl-impersonate
profile source. See [PRIVACY.md](PRIVACY.md) for the complete list.

Stealth Guard is licensed under the MIT License. The bundled ClearCote profile
data remains under GPL-3.0; see [profiles/clearcote/NOTICE.md](profiles/clearcote/NOTICE.md).

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and
[CHANGELOG.md](CHANGELOG.md) for project policies and release history.
