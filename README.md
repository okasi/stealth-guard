<div align="center">
  <img src="icons/128.png" alt="Stealth Guard Logo" width="128" />
  <h1>Stealth Guard</h1>
  <p><strong>Local-first browser fingerprinting protection for MV2-compatible Chromium browsers</strong></p>

[![CI](https://github.com/okasi/stealth-guard/actions/workflows/ci.yml/badge.svg)](https://github.com/okasi/stealth-guard/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/okasi/stealth-guard)](https://github.com/okasi/stealth-guard/releases)
[![License](https://img.shields.io/github/license/okasi/stealth-guard)](LICENSE)
![Core coverage](https://img.shields.io/badge/deterministic_core-100%25_coverage-16a34a)

</div>

Stealth Guard reduces passive browser fingerprinting across Canvas, WebGL, fonts, AudioContext, ClientRects, WebGPU, timezone, User-Agent, and WebRTC surfaces. Settings and optional saved site sessions stay in local extension storage; there is no telemetry or analytics.

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
| **🌐 User-Agent**   | Spoofs browser User-Agent string in both HTTP headers and JavaScript                  |
| **🕐 Timezone**     | Spoofs timezone information (configurable, default: UTC+1)                            |
| **📡 WebRTC**       | Prevents IP address leaks through WebRTC connections                                  |
| **🎨 Canvas**       | Adds imperceptible noise to canvas data exports, preventing canvas fingerprinting     |
| **📐 ClientRects**  | Adds noise to element bounding rectangle measurements                                 |
| **🔤 Font**         | Randomizes font measurement values to prevent font enumeration                        |
| **🔊 AudioContext** | Injects noise into audio frequency data to prevent audio fingerprinting               |
| **🕹️ WebGL**        | Spoofs GPU vendor/renderer information and adds noise to WebGL buffers                |
| **🎮 WebGPU**       | Spoofs WebGPU adapter limits and buffer operations                                    |

### 🚀 Additional Features

- **🔌 SOCKS5/HTTP/HTTPS Proxy Support** - Route traffic through proxy servers with per-profile configuration
- **🔄 Per-Site Session Switcher** - Save, rename, delete, clear, and switch login sessions (cookies + local/session storage) from the popup
- **🗺️ Domain-based Routing Engine** - PAC-based domain routing is supported in core proxy logic (UI route editor is not currently exposed)
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
- Choose timezone presets
- View proxy status
- See which protections were triggered on the current page

### ⚙️ Advanced Settings

Open **Advanced Settings** from the popup to access:

- Per-feature allowlists
- Proxy profile management
- Proxy active profile + bypass list
- WebGL presets (Apple, Pixel 4, Surface Pro 7)
- Export/import configuration
- WebRTC policy settings

### 🖱️ Context Menu

Right-click on any webpage to quickly add or remove the current domain from allowlists.

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

Available timezones:

- UTC-8 (Los Angeles)
- UTC-7 (Denver)
- UTC-6 (Chicago)
- UTC-5 (New York)
- UTC+0 (London)
- UTC+1 (Paris) - _Default_
- UTC+2 (Athens)
- UTC+3 (Istanbul)
- UTC+4 (Dubai)
- UTC+7 (Jakarta)
- UTC+8 (Shanghai)
- UTC+9 (Tokyo)

## 🧪 Testing Your Protection

Visit these sites to verify your fingerprinting protection:

- <https://browserleaks.com/> - Comprehensive fingerprint testing
- <https://webbrowsertools.com/> - AudioContext testing
- <https://amiunique.org/> - Browser uniqueness analysis
- <https://dnscheck.tools/> - WebRTC and DNS leak testing

## 🧑‍💻 Development Checks

Use Node.js 20.19+ or 22.12+ and install Chrome/Chromium for the browser harness. Set `CHROME_PATH` when it is not in a standard location. Install the dev dependencies once:

```bash
npm ci
```

Run the local quality gate:

```bash
npm run check
```

This validates source syntax and manifest integrity, enforces 100% statements, branches, functions, and lines coverage for deterministic core modules, runs background integration tests, and drives Chrome through every protection plus popup/options workflows.

The content script installs wrappers immediately at `document_start` with embedded safe defaults, then applies trusted `chrome.storage.local` config through a private authenticated MAIN-world update channel. This fail-closed design avoids a pre-patch fingerprinting window; if storage is slow, default protections may apply briefly before stored disables or allowlists take effect.

## 🏗️ Technical Details

### 📁 Architecture

```
background.js              → Runtime orchestrator (UA headers, WebRTC, proxy, messages, sessions)
    ↓
content-scripts/
  injector.js              → Isolated bootstrap, trusted config updates, authenticated alerts
  main.js                  → Testable MAIN-world browser API protections
    ↓
lib/
  config.js                → Defaults, normalization, persistence, UA presets, content projection
  domainFilter.js          → Canonical domain and wildcard allowlist matching
  proxy.js                 → Proxy validation, location lookup, PAC generation, browser settings
  runtime.js               → Promise-based popup/options messaging
  session.js               → Session hostname and cookie-scope helpers
  storage.js               → Promise wrapper for chrome.storage.local
```

### 📋 Manifest Version

This extension intentionally uses **Manifest V2** for maximum API compatibility. Key features like `webRequestBlocking` and synchronous header modification require MV2 and are restricted or impossible in Manifest V3.

> [!WARNING]
> Because of Manifest V2, **this extension does not work on current standard versions of Google Chrome**. A separate Manifest V3 architecture is required for broad Chrome, Brave, Vivaldi, and Edge support.

### 🔐 Permissions

| Permission                          | Purpose                                                                            |
| ----------------------------------- | ---------------------------------------------------------------------------------- |
| `storage`                           | Save user settings                                                                 |
| `cookies`                           | Save and restore per-site login sessions                                           |
| `privacy`                           | Control WebRTC IP handling policy                                                  |
| `proxy`                             | Configure SOCKS5/HTTP proxy                                                        |
| `webRequest` / `webRequestBlocking` | Modify User-Agent headers                                                          |
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
- Thanks to the browser fingerprinting research community for documenting these techniques
