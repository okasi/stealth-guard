<div align="center">
  <img src="icons/128.png" alt="Stealth Guard Logo" width="128" />
  <h1>Stealth Guard</h1>
  <p><strong>Local-first browser fingerprinting protection for MV2-compatible Chromium browsers</strong></p>

[![CI](https://github.com/okasi/stealth-guard/actions/workflows/ci.yml/badge.svg)](https://github.com/okasi/stealth-guard/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/okasi/stealth-guard)](https://github.com/okasi/stealth-guard/releases)
[![License](https://img.shields.io/github/license/okasi/stealth-guard)](LICENSE)
![Core coverage](https://img.shields.io/badge/deterministic_core-100%25_coverage-16a34a)

</div>

Stealth Guard reduces passive browser fingerprinting across Canvas, WebGL, fonts, AudioContext, ClientRects, WebGPU, timezone, language, geolocation, User-Agent, and WebRTC surfaces. Settings, tracker rules, bounded proxy connection history, and optional saved site sessions stay in local extension storage; there is no telemetry or analytics.

> [!IMPORTANT]
> Stealth Guard currently uses Manifest V2. Standard Google Chrome releases have disabled MV2, and most Chromium forks followed upstream. Opera is the primary current target because it still supports existing MV2 extensions. See [Browser compatibility](#-browser-compatibility) before installing.

## Why Stealth Guard?

- **Fail-closed startup:** browser API wrappers install at `document_start` with safe defaults, then receive trusted local configuration.
- **Compatibility controls:** global and per-feature allowlists make protection practical on complex web apps.
- **Local-first operation:** no accounts, telemetry, analytics, or Stealth Guard servers.
- **Auditable source:** plain JavaScript with no production dependencies and no opaque build artifacts.
- **Quality gates:** manifest validation, syntax checks, 100% deterministic-core coverage, background integration tests, and Chrome-driven end-to-end checks.

## ✨ Features

### 🔒 Fingerprinting Protection

| Protection          | Description                                                                           |
| ------------------- | ------------------------------------------------------------------------------------- |
| **🌍 Proxy**        | Masks your IP address by routing traffic through SOCKS4/5 or HTTP/HTTPS proxy servers |
| **🌐 User-Agent**   | Keeps HTTP/JavaScript UA, client hints, touch, CPU, and memory claims aligned          |
| **🗣️ Language**    | Aligns Navigator, default Intl locale, and the HTTP Accept-Language header             |
| **🕐 Timezone**     | Spoofs timezone information using automatic regional DST rules (default: Paris)       |
| **📍 Geolocation**  | Replaces permitted HTML geolocation results with coarse proxy-location coordinates   |
| **📡 WebRTC**       | Prevents IP address leaks through WebRTC connections                                  |
| **🎨 Canvas**       | Adds imperceptible noise to HTML and OffscreenCanvas reads and exports                 |
| **📐 ClientRects**  | Adds noise to element bounding rectangle measurements                                 |
| **🔤 Font**         | Randomizes font measurement values to prevent font enumeration                        |
| **🔊 AudioContext** | Injects noise into buffer copies and float/byte analyser readouts                      |
| **🕹️ WebGL**       | Hides GPU identity and protects extension, capability, pixel, and export probes        |
| **🎮 WebGPU**       | Spoofs WebGPU adapter limits and buffer operations                                    |
| **🛑 Ads & trackers** | Updates AdGuard-compatible lists, blocks requests, hides filtered elements, and sanitizes YouTube player ad responses |

### 🚀 Additional Features

- **🔌 SOCKS5/HTTP/HTTPS Proxy Support** - Route browser traffic through raw proxy endpoints with optional credentials and ordered fallback profiles
- **🔄 Per-Site Session Switcher** - Save, rename, delete, clear, and switch login sessions (cookies + local/session storage) from the popup
- **🗺️ Split Tunneling** - Choose protect-all, bypass-selected, or protect-selected behavior with deterministic PAC-based per-site routes
- **📍 Location Synchronization** - Match timezone and permission-approved HTML geolocation to each site's effective proxy profile
- **📊 Local Diagnostics** - Inspect, export, or clear a bounded 100-event proxy connection history without exposing passwords
- **🧭 Identity Self-Test** - Compare configured identity policy with live protected-page values and open the repeatable detector suite
- **✅ Global & Per-Feature Allowlists** - Allow sites globally or per protection feature
- **🎯 Wildcard Domain Patterns** - Support for `*.example.com` and `webmail.*` patterns
- **☁️ Cloudflare Challenge Compatibility** - Leaves Cloudflare-owned challenge frames unmodified without granting the embedding page a UA bypass
- **🔔 Real-time Notifications** - Optional alerts when fingerprinting attempts are blocked
- **💾 Export/Import Settings** - Backup and restore your configuration
- **📦 No Build System Required** - Pure vanilla JavaScript, ready to use

## 📥 Installation

### 🔧 Manual Installation (Developer Mode)

1. Download or clone this repository
2. In Opera, navigate to `opera://extensions/` (or open the equivalent extensions page in another explicitly MV2-enabled Chromium build)
3. Enable **Developer mode** (toggle in top-right corner)
4. Click **Load unpacked**
5. Select the extension folder

## 📖 Usage

### ⚡ Quick Access (Popup)

Click the Stealth Guard icon in your browser toolbar to:

- Toggle protection on/off globally
- Enable/disable individual protection features
- Select User-Agent presets (macOS Safari, Chrome, Windows Edge, iPhone, Android)
- Select language/locale presets and view identity diagnostics
- Choose timezone presets
- View proxy status
- See which protections were triggered on the current page

### ⚙️ Advanced Settings

Open **Advanced Settings** from the popup to access:

- Per-feature allowlists
- Proxy profile management
- Proxy profiles, credentials, fallback order, and split-tunneling modes
- Proxy-location timezone/geolocation synchronization
- Proxy-country language synchronization and local tracker rules
- Automatic AdGuard Base, Tracking Protection, and Cookie Notices subscriptions
- Network exceptions, cosmetic filtering, per-site pause controls, and an element picker
- Connection diagnostics and local history
- WebGL presets (Apple, Pixel 4, Surface Pro 7)
- Export/import configuration
- WebRTC policy settings

### 🖱️ Context Menu

Right-click on any webpage to quickly add or remove the current domain from the global allowlist, or open the local Guide & Self-Test for that tab.

## 🔧 Configuration

### 🎯 Domain Patterns

Stealth Guard supports flexible domain matching:

| Pattern         | Matches                                                     |
| --------------- | ----------------------------------------------------------- |
| `example.com`   | `example.com` and `www.example.com`                         |
| `*.example.com` | All subdomains (`sub.example.com`, `deep.sub.example.com`)  |
| `webmail.*`     | Any domain starting with `webmail.` (`webmail.company.com`) |
| `*pattern*`     | Generic wildcard matching (`foo-localhost-bar`)             |

### 🌐 User-Agent Presets

Choose from predefined User-Agent strings:

- macOS Safari
- macOS Chrome
- Windows Edge
- iPhone Safari
- Android Chrome

### 🕐 Timezone Presets

Available timezones use IANA regional rules, so their UTC offsets adjust automatically for daylight saving time and historical changes:

- Los Angeles (Pacific)
- Denver (Mountain)
- Chicago (Central)
- New York (Eastern)
- London
- Paris - _Default_
- Athens
- Istanbul
- Dubai
- Jakarta
- Shanghai
- Tokyo

## 🧪 Testing Your Protection

Visit these sites to verify your fingerprinting protection:

- <https://browserleaks.com/> - Comprehensive fingerprint testing
- <https://webbrowsertools.com/> - AudioContext testing
- <https://amiunique.org/> - Browser uniqueness analysis
- <https://dnscheck.tools/> - WebRTC and DNS leak testing

For the repeatable manual detector suite and result template, see
[Browser Privacy Benchmarks](BENCHMARKS.md). CreepJS Checker is the recurring
reference benchmark.

## 🧑‍💻 Development Checks

Use Node.js 20.19+ or 22.12+ and install Chrome/Chromium for the browser harness. Set `CHROME_PATH` when it is not in a standard location. Install the dev dependencies once:

```bash
npm ci
```

Run the local quality gate:

```bash
npm run check
```

This validates source syntax and manifest integrity, enforces 100% statements, branches, functions, and lines coverage for deterministic core modules, runs background integration tests, and drives Chrome through every protection plus popup/options workflows. Current Chrome cannot load this MV2 extension, so the harness injects the same classic-script bundles and mocked extension APIs; release validation still requires an unpacked-extension smoke test in an MV2-capable Opera build.

The content script installs wrappers immediately at `document_start` with embedded safe defaults, then applies trusted `chrome.storage.local` config through a private authenticated MAIN-world update channel. This fail-closed design avoids a pre-patch fingerprinting window; if storage is slow, default protections may apply briefly before stored disables or allowlists take effect.

## 🏗️ Technical Details

### 📁 Architecture

```
background.js              → Runtime orchestrator (config, headers, ad blocking, WebRTC, proxy, messages)
lib/adblock.js             → Safe filter parser, matcher, and cosmetic selector engine
    ↓
content-scripts/
  injector.js              → Isolated bootstrap, trusted config updates, alerts, diagnostics
  main.js                  → Testable MAIN-world browser API protections
    ↓
lib/
  config.js                → Defaults, normalization, persistence, UA presets, content projection
  domainFilter.js          → Canonical domain and wildcard allowlist matching
  proxy.js                 → Proxy validation, location lookup, PAC generation, browser settings
  runtime.js               → Promise-based popup/options messaging
  session.js               → Serialized session lifecycle and cookie/site-scope helpers
  storage.js               → Promise wrapper for chrome.storage.local
```

### 📋 Manifest Version

This extension intentionally remains on **Manifest V2** because its persistent background page and blocking header-modification architecture depend on MV2 APIs. A Manifest V3 port would require a separate runtime design.

> [!WARNING]
> Because of Manifest V2, **this extension does not work on current standard versions of Google Chrome**. A separate Manifest V3 architecture is required for broad Chrome, Brave, Vivaldi, and Edge support.

### 🔐 Permissions

| Permission                          | Purpose                                                                            |
| ----------------------------------- | ---------------------------------------------------------------------------------- |
| `storage`                           | Save user settings                                                                 |
| `cookies`                           | Save and restore per-site login sessions                                           |
| `privacy`                           | Control WebRTC IP handling policy                                                  |
| `proxy`                             | Configure SOCKS5/HTTP proxy                                                        |
| `webRequest` / `webRequestBlocking` | Align identity headers and synchronously block matched ad/tracker requests          |
| `alarms`                            | Refresh enabled filter subscriptions automatically                                  |
| `unlimitedStorage`                  | Cache downloaded filter subscriptions locally                                       |
| `tabs`                              | Identify active tabs, reload updated tabs, and track per-tab protection state      |
| `contextMenus`                      | Right-click menu integration                                                       |
| `notifications`                     | Fingerprint detection alerts                                                       |
| `<all_urls>`                        | Apply protections, header spoofing, proxy rules, and session tools across websites |

## 🔒 Privacy

Stealth Guard:

- **Does not collect telemetry, analytics, or browsing history**
- **Makes no background service calls** except optional proxy location checks via `ipinfo.io`/`ipapi.co`
- **Stores all settings locally** in browser storage
- **Is fully open source** - audit the code yourself

## 🌐 Browser Compatibility

| Browser        | Support           | Notes                                                                                                                                        |
| -------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Opera          | ✅ Primary target | Opera states that existing MV2 extensions remain supported; its store no longer accepts new MV2 uploads, so use developer-mode installation. |
| Brave          | ❌ Unsupported    | Brave limits post-phase-out MV2 support to four specifically maintained extensions; Stealth Guard is not one of them.                        |
| Vivaldi        | ❌ Unsupported    | Vivaldi announced that MV2 extensions would stop working as Chromium removed the platform.                                                   |
| Microsoft Edge | ❌ Unsupported    | Current project releases are not validated against an MV2-capable Edge channel.                                                              |
| Google Chrome  | ❌ Unsupported    | Chrome disabled MV2 everywhere starting with Chrome 138/139.                                                                                 |

_Note: Firefox uses a different extension format and is not currently supported._

Vendor references: [Chrome MV2 timeline](https://developer.chrome.com/docs/extensions/develop/migrate/mv2-deprecation-timeline), [Opera MV2 status](https://blogs.opera.com/news/2025/09/mv2-extensions-opera/), [Brave MV2 policy](https://brave.com/blog/brave-shields-manifest-v3/), and [Vivaldi MV3 update](https://vivaldi.com/blog/manifest-v3-update-vivaldi-is-future-proofed-with-its-built-in-functionality/).

## 🤝 Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) for setup, testing, privacy, and pull-request expectations. Please report vulnerabilities privately according to [SECURITY.md](SECURITY.md).

Release changes are tracked in [CHANGELOG.md](CHANGELOG.md).

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 👤 Author

**okasi** - [okasi.me](https://okasi.me) - [GitHub](https://github.com/okasi)

## 🙏 Acknowledgments

- Inspired by the need for better privacy tools in an increasingly tracked web
- Fingerprinting surface coverage was informed by the public detector definitions in [Scrapfly Anti-bot Detector](https://github.com/scrapfly/Antibot-Detector); Stealth Guard's implementation is independent to preserve this project's MIT licensing.
- Thanks to the browser fingerprinting research community for documenting these techniques
