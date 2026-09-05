<div align="center">
  <img src="icons/128.png" alt="Stealth Guard Logo" width="128" />
  <h1>Stealth Guard</h1>
  <p><strong>Local-first fingerprinting protection for MV2-compatible browsers</strong></p>

[![CI](https://github.com/okasi/stealth-guard/actions/workflows/ci.yml/badge.svg)](https://github.com/okasi/stealth-guard/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/okasi/stealth-guard)](LICENSE)
</div>

Stealth Guard reduces passive fingerprinting and blocks ads and trackers.
Settings and saved site sessions stay in your browser. There is no account,
telemetry, analytics, or Stealth Guard server.

## Features

- Browser identity, graphics, audio, layout, locale, timezone, geolocation,
  WebRTC, and inline Worker protections.
- Bundled ClearCote GPU profiles and Apify Fingerprint Suite JSON imports.
- AdGuard-compatible network/cosmetic rules, YouTube protections, subscriptions,
  an element picker, and site allowlists for recovery.
- HTTP, HTTPS, and SOCKS proxy routing, split tunneling, HTTP(S) proxy
  authentication, location alignment, and connection diagnostics.
- Per-site cookie/storage sessions and a live identity self-test.

## Install and use

Stealth Guard requires **Manifest V2 support**. Current Google Chrome cannot
load it; the unpacked extension has been tested in Opera 135.

1. Download or clone this repository.
2. Open `opera://extensions/` and enable **Developer mode**.
3. Choose **Load unpacked** and select this directory.

Use the toolbar popup for everyday controls and sessions. **Advanced Settings**
contains subscriptions, proxy profiles, allowlists, import/export, and self-tests.
Domain controls accept exact hosts and patterns such as `*.example.com`,
`webmail.*`, and `*pattern*`. Use an allowlist if a site stops working.

Proxy routing covers supported browser traffic, not other applications. It
requires your own proxy endpoint; OpenVPN and WireGuard files are unsupported.
Browser identity settings do not change native TLS or HTTP/2 behavior.

## Development

Use Node.js 20.19.x or a supported release ≥22.12, plus Chrome/Chromium for the
browser harness (`CHROME_PATH` overrides discovery).

```sh
npm ci
npm run check
```

Architecture and change rules: [AGENTS.md](AGENTS.md).
Native Opera checks and verification limits: [BENCHMARKS.md](BENCHMARKS.md).
Contributing and security reports: [CONTRIBUTING.md](CONTRIBUTING.md),
[SECURITY.md](SECURITY.md).

## Privacy and license

Filter subscriptions and browser-profile updates contact third-party servers;
proxy tools may contact location and verification services. Details and local
storage controls are in [PRIVACY.md](PRIVACY.md).

Code is MIT licensed. Bundled ClearCote data is GPL-3.0; see
[NOTICE.md](profiles/clearcote/NOTICE.md). Release history: [CHANGELOG.md](CHANGELOG.md).
