# 🛡️ Stealth Guard

**Advanced browser fingerprinting protection for Chrome and Opera**

Stealth Guard is a privacy-focused browser extension that protects against various fingerprinting techniques used to track users across the web. It provides comprehensive defense against canvas, WebGL, font, audio, and other fingerprinting methods while maintaining website compatibility.

## ✨ Features

### 🔒 Fingerprinting Protection

| Protection | Description |
|------------|-------------|
| **🎨 Canvas** | Adds imperceptible noise to canvas data exports, preventing canvas fingerprinting |
| **🖥️ WebGL** | Spoofs GPU vendor/renderer information and adds noise to WebGL buffers |
| **🔤 Font** | Randomizes font measurement values to prevent font enumeration |
| **📐 ClientRects** | Adds noise to element bounding rectangle measurements |
| **⚡ WebGPU** | Spoofs WebGPU adapter limits and buffer operations |
| **🔊 AudioContext** | Injects noise into audio frequency data to prevent audio fingerprinting |
| **🌍 Timezone** | Spoofs timezone information (configurable, default: UTC+1) |
| **🌐 User-Agent** | Spoofs browser User-Agent string in both HTTP headers and JavaScript |
| **📡 WebRTC** | Prevents IP address leaks through WebRTC connections |

### 🚀 Additional Features

- **🔌 SOCKS5/HTTP/HTTPS Proxy Support** - Route traffic through proxy servers with per-profile configuration
- **🗺️ Domain-based Routing** - Configure different proxies for different domains using PAC scripts
- **✅ Global & Per-Feature Allowlists** - Whitelist sites globally or per protection feature
- **🎯 Wildcard Domain Patterns** - Support for `*.example.com` and `webmail.*` patterns
- **☁️ Cloudflare Turnstile Compatibility** - Auto-detects Turnstile challenges and temporarily disables User-Agent spoofing
- **🔔 Real-time Notifications** - Optional alerts when fingerprinting attempts are blocked
- **💾 Export/Import Settings** - Backup and restore your configuration
- **📦 No Build System Required** - Pure vanilla JavaScript, ready to use

## 📥 Installation

### Opera Add-ons
<https://addons.opera.com/extensions/details/stealth-guard>

### 🔧 Manual Installation (Developer Mode)

1. Download or clone this repository
2. Open your browser's extension page:
   - **Chrome**: Navigate to `chrome://extensions/`
   - **Opera**: Navigate to `opera://extensions/`
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

Right-click the extension icon and select **Options** (or click "Advanced Settings" in the popup) to access:
- Per-feature allowlists
- Proxy profile management
- Domain routing rules
- WebGL presets (Apple M1, Pixel 4, Surface Pro 7)
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

### 🌐 User-Agent Presets

Choose from predefined User-Agent strings:
- macOS Safari 18.0
- macOS Chrome 131
- Windows Edge 131
- iPhone Safari 18.0
- Android Chrome 131

### 🕐 Timezone Presets

Available timezones:
- UTC-8 (Los Angeles)
- UTC-5 (New York)
- UTC+0 (London)
- UTC+1 (Paris) - *Default*
- UTC+2 (Cairo)
- UTC+3 (Moscow)
- UTC+5:30 (Mumbai)
- UTC+7 (Bangkok)
- UTC+8 (Singapore)
- UTC+9 (Tokyo)
- UTC+10 (Sydney)
- UTC+12 (Auckland)

## 🧪 Testing Your Protection

Visit these sites to verify your fingerprinting protection:

- <https://browserleaks.com/> - Comprehensive fingerprint testing
- <https://webbrowsertools.com/> - AudioContext testing
- <https://amiunique.org/> - Browser uniqueness analysis
- <https://dnscheck.tools/> - WebRTC and DNS leak testing

## 🏗️ Technical Details

### 📁 Architecture

```
background.js              → Main orchestrator (privacy APIs, proxy, DNR)
    ↓
content-scripts/
  injector.js              → Injects protection code into page context
    ↓
lib/
  config.js                → Configuration management
  domainFilter.js          → Domain matching logic
  proxy.js                 → Proxy management
  storage.js               → Chrome storage wrapper
```

### 📋 Manifest Version

This extension uses **Manifest V2** for maximum API compatibility. Key features like `webRequestBlocking` and synchronous header modification require MV2.

### 🔐 Permissions

| Permission | Purpose |
|------------|---------|
| `storage` | Save user settings |
| `privacy` | Control WebRTC IP handling policy |
| `proxy` | Configure SOCKS5/HTTP proxy |
| `webRequest` / `webRequestBlocking` | Modify User-Agent headers |
| `declarativeNetRequest` | Declarative header rules |
| `tabs` | Detect active tab for context menu |
| `contextMenus` | Right-click menu integration |
| `notifications` | Fingerprint detection alerts |

## 🔒 Privacy

Stealth Guard:
- **Does not collect any user data**
- **Does not phone home** (except for optional proxy location checks via ipinfo.io)
- **Stores all settings locally** in browser storage
- **Is fully open source** - audit the code yourself

## 🌐 Browser Compatibility

| Browser | Support |
|---------|---------|
| Google Chrome | Full support |
| Opera | Full support |
| Brave | Full support |
| Microsoft Edge | Full support |
| Vivaldi | Full support |

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
