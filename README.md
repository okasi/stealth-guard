<div align="center">
  <img src="icons/128.png" alt="Stealth Guard Logo" width="128" />
  <h1>🛡️ Stealth Guard</h1>
  <p><strong>Advanced browser fingerprinting protection for MV2-compatible browsers (Opera, Brave, Vivaldi, Edge)</strong></p>
</div>

Stealth Guard is a privacy-focused browser extension that protects against various fingerprinting techniques used to track users across the web. It provides comprehensive defense against canvas, WebGL, font, audio, and other fingerprinting methods while maintaining website compatibility.

## ✨ Features

### 🔒 Fingerprinting Protection

| Protection | Description |
|------------|-------------|
| **🌍 Proxy** | Masks your IP address by routing traffic through SOCKS4/5 or HTTP/HTTPS proxy servers |
| **🌐 User-Agent** | Spoofs browser User-Agent string in both HTTP headers and JavaScript |
| **🕐 Timezone** | Spoofs timezone information (configurable, default: UTC+1) |
| **📡 WebRTC** | Prevents IP address leaks through WebRTC connections |
| **🎨 Canvas** | Adds imperceptible noise to canvas data exports, preventing canvas fingerprinting |
| **📐 ClientRects** | Adds noise to element bounding rectangle measurements |
| **🔤 Font** | Randomizes font measurement values to prevent font enumeration |
| **🔊 AudioContext** | Injects noise into audio frequency data to prevent audio fingerprinting |
| **🕹️ WebGL** | Spoofs GPU vendor/renderer information and adds noise to WebGL buffers |
| **🎮 WebGPU** | Spoofs WebGPU adapter limits and buffer operations |

### 🚀 Additional Features

- **🔌 SOCKS5/HTTP/HTTPS Proxy Support** - Route traffic through proxy servers with per-profile configuration
- **🔄 Per-Site Session Switcher** - Save, rename, delete, clear, and switch login sessions (cookies + local/session storage) from the popup
- **🗺️ Domain-based Routing Engine** - PAC-based domain routing is supported in core proxy logic (UI route editor is not currently exposed)
- **✅ Global & Per-Feature Allowlists** - Whitelist sites globally or per protection feature
- **🎯 Wildcard Domain Patterns** - Support for `*.example.com` and `webmail.*` patterns
- **☁️ Cloudflare Challenge Compatibility** - Leaves Cloudflare-owned challenge frames unmodified without granting the embedding page a UA bypass
- **🔔 Real-time Notifications** - Optional alerts when fingerprinting attempts are blocked
- **💾 Export/Import Settings** - Backup and restore your configuration
- **📦 No Build System Required** - Pure vanilla JavaScript, ready to use

## 📥 Installation

### 🔧 Manual Installation (Developer Mode)

1. Download or clone this repository
2. Open your browser's extension page:
   - **Opera**: Navigate to `opera://extensions/`
   - **Brave**: Navigate to `brave://extensions/`
   - **Vivaldi**: Navigate to `vivaldi://extensions/`
   - **Edge**: Navigate to `edge://extensions/`
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

| Pattern | Matches |
|---------|---------|
| `example.com` | `example.com` and `www.example.com` |
| `*.example.com` | All subdomains (`sub.example.com`, `deep.sub.example.com`) |
| `webmail.*` | Any domain starting with `webmail.` (`webmail.company.com`) |
| `*pattern*` | Generic wildcard matching (`foo-localhost-bar`) |

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
- UTC+1 (Paris) - *Default*
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

Use Node.js 20.19+ or 22.12+. Install the dev dependencies once:

```bash
npm install
```

Run the local quality gate:

```bash
npm run check
```

This runs syntax validation for extension source JavaScript files and a Vitest suite with 100% statements, branches, functions, and lines coverage enforced for the deterministic library layer in `lib/`. Browser lifecycle code in `background.js`, `content-scripts/`, `popup/`, and `options/` is syntax-checked here and should still be manually validated in an MV2-compatible browser.

The content script installs wrappers immediately at `document_start` with embedded safe defaults, then applies trusted `chrome.storage.local` config through a private authenticated MAIN-world update channel. This fail-closed design avoids a pre-patch fingerprinting window; if storage is slow, default protections may apply briefly before stored disables or allowlists take effect.

## 🏗️ Technical Details

### 📁 Architecture

```
background.js              → Runtime orchestrator (webRequest UA spoofing, WebRTC policy, proxy lifecycle, message hub)
    ↓
content-scripts/
  injector.js              → Fail-closed MAIN-world injection + trusted dynamic config update
    ↓
lib/
  config.js                → Config defaults + merge/persistence helpers
  domainFilter.js          → Domain extraction + wildcard allowlist matching
  proxy.js                 → Proxy mode/PAC generation and profile helpers
  storage.js               → Promise wrapper for chrome.storage.local
```

### 📋 Manifest Version

This extension intentionally uses **Manifest V2** for maximum API compatibility. Key features like `webRequestBlocking` and synchronous header modification require MV2 and are restricted or impossible in Manifest V3.

> [!WARNING]
> Because of Manifest V2, **this extension will no longer work on standard versions of Google Chrome** due to the MV2 phase-out. It is designed for browsers that maintain support for Manifest V2 extensions (such as Opera, Brave, Vivaldi, and potentially Enterprise Edge).

### 🔐 Permissions

| Permission | Purpose |
|------------|---------|
| `storage` | Save user settings |
| `cookies` | Save and restore per-site login sessions |
| `privacy` | Control WebRTC IP handling policy |
| `proxy` | Configure SOCKS5/HTTP proxy |
| `webRequest` / `webRequestBlocking` | Modify User-Agent headers |
| `webNavigation` | Reapply browser-global WebRTC policy during navigation |
| `declarativeNetRequest` | Legacy compatibility cleanup for prior UA rule path |
| `tabs` | Identify active tabs, reload updated tabs, and track per-tab protection state |
| `contextMenus` | Right-click menu integration |
| `notifications` | Fingerprint detection alerts |
| `<all_urls>` | Apply protections, header spoofing, proxy rules, and session tools across websites |

## 🔒 Privacy

Stealth Guard:
- **Does not collect telemetry, analytics, or browsing history**
- **Makes no background service calls** except optional proxy location checks via `ipinfo.io`/`ipapi.co` and proxy test checks via `api.ipify.org`
- **Stores all settings locally** in browser storage
- **Is fully open source** - audit the code yourself

## 🌐 Browser Compatibility

| Browser | Support | Notes |
|---------|---------|-------|
| Opera | ✅ Full support | Built-in functionality maintains MV2 support |
| Brave | ✅ Full support | Built-in functionality maintains MV2 support |
| Vivaldi | ✅ Full support | Built-in functionality maintains MV2 support |
| Microsoft Edge | ⚠️ Limited | Supported via enterprise policies (until phase-out) |
| Google Chrome | ❌ Unsupported | Standard Chrome has phased out Manifest V2 |

*Note: Firefox uses a different extension format and is not currently supported.*

## 🤝 Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 👤 Author

**okasi** - [okasi.me](https://okasi.me) - [GitHub](https://github.com/okasi)

## 🙏 Acknowledgments

- Inspired by the need for better privacy tools in an increasingly tracked web
- Thanks to the browser fingerprinting research community for documenting these techniques
