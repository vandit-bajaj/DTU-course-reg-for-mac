# DTU Course Registrar (macOS)

<p align="center">
  <img src="assets/dtulogo.png" alt="DTU Course Registrar Logo" width="110" height="110" />
</p>

<p align="center">
  <b>High-speed automated elective course seat sniper & registrar for Delhi Technological University students.</b>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Platform-macOS-black?style=flat-square&logo=apple&logoColor=white" alt="Platform macOS" />
  <img src="https://img.shields.io/badge/Architecture-Apple%20Silicon%20%7C%20Intel-007ACC?style=flat-square" alt="Architecture" />
  <img src="https://img.shields.io/badge/Node.js-≥18.0.0-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/Electron-v34-47848F?style=flat-square&logo=electron&logoColor=white" alt="Electron" />
  <img src="https://img.shields.io/badge/Response%20Time-~43ms-orange?style=flat-square" alt="Speed" />
  <img src="https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square" alt="License MIT" />
</p>

---

## 📖 About the Project

**DTU Course Registrar** is an automated desktop application built specifically for **Delhi Technological University (DTU)** students running macOS. It continuously monitors the official DTU ExamSetu course registration portal (`exam-setu.dtu.ac.in`) and automatically snipes target elective courses the millisecond a seat becomes vacant.

### The Problem
During DTU course registration windows (DEC, GEC, SEC, VAC electives), thousands of students attempt to register simultaneously:
- Popular elective seats vanish within seconds.
- The university server experiences heavy load, leading to slow page loads, gateway timeouts, and broken sessions.
- In-browser manual refreshing and clicking is humanly too slow to compete when only 1 or 2 dropped seats open up.

### The Solution
DTU Course Registrar bypasses the browser rendering pipeline entirely. It directly communicates with the registration backend over optimized HTTP connections, polling seat availability with ETag validation and firing registration payloads in **under 100ms** — faster than any human can react.

### ✨ Key Features

- 🪟 **Auto-Login & Open Portal (Manual Mode) — *New in v1.1.0***: Opens an isolated Chromium window directly on `exam-setu.dtu.ac.in/student/login`, retries login automatically until you reach your dashboard, then hands full manual control over to you for course CAPTCHAs and selection.
- 🔁 **502/504 Host Error Auto-Retry**: Automatically reloads Cloudflare / DTU origin error pages (`502`, `503`, `504`, `520–524`) every 4 seconds without dropping your session.
- 🛡️ **CAPTCHA & Invalid Credential Guard**: Stops auto-login immediately if a security challenge/CAPTCHA or invalid-credential alert appears, letting you complete it manually.
- ⚡ **Sub-100ms Seat Polling**: Connects directly to `exam-setu.dtu.ac.in` over persistent Keep-Alive HTTPS connections with MD5/ETag content caching to minimize overhead.
- 🔄 **Session Recovery**: Automatically re-authenticates if the DTU portal invalidates your session cookie.
- 🔔 **Native macOS Bell & Audio Alerts — *New in v1.2.0***: Plays distinct native macOS audio chimes:
  - 🔔 **Start**: Crisp bell ding (`Tink`) when automation or auto-login starts.
  - 🛎️ **Login Success**: Resonant crystal bell (`Glass`) the instant the bot logs into DTU ExamSetu.
  - 🎉 **Course Registered**: Triumphant fanfare (`Hero`) when a seat is successfully secured.
  - ⚠️ **Error Stopped**: Alert tone (`Basso`) if an error or connection failure stops the bot.
  - ✋ **Prompt / CAPTCHA**: Prompt chime (`Sosumi`) if manual action or CAPTCHA is needed.
  - *Includes an in-app toggle to easily enable or mute audio alerts.*
- 📝 **Dual Course Input**: Add courses individually through interactive inputs or paste full batches using the built-in JSON editor.
- 🔒 **Zero Disk Footprint**: Credentials and session tokens are strictly kept in volatile memory and are never written to disk or transmitted to third parties.

<br>

## ⚙️ How It Works

1. **Authentication**: Authenticates directly with `exam-setu.dtu.ac.in` using your Roll Number and Password to establish a secure session (`connect.sid`).
2. **Table Scraping**: Parses elective tables and course hashes required for registration.
3. **High-Frequency Polling**: Periodically requests seat counts (~900ms interval).
4. **Instant Registration**: When a seat opens (`available > 0`), it immediately dispatches the registration payload.
5. **Confirmation & Alert**: Validates registration success, logs the confirmation timestamp, and triggers a native macOS notification.

<br>

## 💻 Requirements

- **Operating System**: macOS (Apple Silicon M1/M2/M3/M4 or Intel)
- **Node.js**: [Node.js](https://nodejs.org/) ≥ 18  
  *Install via Homebrew:*
  ```bash
  brew install node
  ```

<br>

## 🚀 Setup & Launch

```bash
# 1. Clone the repository
git clone https://github.com/vandit-bajaj/DTU-course-reg-for-mac.git
cd DTU-course-reg-for-mac

# 2. Install dependencies
npm install

# 3. Start the application
npm start
```

<br>

## 📋 Usage Guide

### Mode A: Auto-Login & Open Portal (Recommended when CAPTCHA is enabled)
1. **Enter Credentials**: Fill in your DTU Roll Number and Password (no courses required).
2. Click **`Auto-Login & Open Portal (Manual Mode)`**.
3. The app opens `exam-setu.dtu.ac.in/student/login` in a fresh browser window, logs in automatically (retrying `502`/`504` errors every 4s), notifies you with a sound once your dashboard opens, and hands full manual control over to you for clicking **Course Registration** and completing course CAPTCHAs.

### Mode B: Automated Course Seat Monitoring
1. **Enter Credentials**: Fill in your DTU Roll Number and Password.
2. **Add Courses to Track**:
   - Click **Add Course** to manually enter Course Code (e.g. `HU317`) and Slot (e.g. `E2`).
   - Or click the **`</>`** button to paste a JSON batch:
     ```json
     [
       { "code": "HU317", "slot": "E2" },
       { "code": "SE427", "slot": "E1" }
     ]
     ```
3. **Auto Login**: Keep **Auto Login on Session Expiry** enabled for seamless re-authentication if the session drops.
4. **Start Automation**: Click **Start Automation**.

<br>

## 📦 Build Distributable `.dmg`

To package the application as a standalone macOS `.dmg` and `.zip`:

```bash
npm run dist:mac
```

Output binaries will be generated inside the `dist/` directory.

### ⚠️ macOS Gatekeeper Notice (Unsigned App)

Because the app is built locally without an expensive Apple Developer ID certificate, macOS Gatekeeper may show a warning on first launch.

**Option A — Terminal (Recommended):**
```bash
xattr -cr /Applications/DTU\ Course\ Registrar.app
```

**Option B — System Settings:**
1. Open the app and dismiss the prompt.
2. Navigate to **System Settings → Privacy & Security**.
3. Scroll down to the security section and click **Open Anyway**.

<br>

## 📂 Project Structure

```
DTU-course-reg-for-mac/
├── main.js              # Electron main process (window lifecycle, portal handoff & IPC)
├── preload.js           # Secure context bridge between renderer and Node.js
├── renderer.js          # UI controller (form handling, JSON modal, event listeners)
├── automation.js        # Core automation engine (auth, polling, scraping, diagnostics)
├── index.html           # Application interface layout
├── styles.css           # macOS UI styling
├── scripts/
│   └── afterPack.js     # Automated macOS Apple Silicon ad-hoc codesigning hook
├── assets/
│   ├── dtulogo.png      # Application icon (PNG format)
│   └── dtulogo.icns     # macOS bundle icon (ICNS format)
└── package.json         # Project dependencies, scripts, and build configuration
```

<br>

## 🛠️ Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Desktop Framework** | [Electron 34](https://www.electronjs.org/) | Cross-platform desktop runtime on Chromium & Node.js |
| **HTTP Client** | [got v14](https://github.com/sindresorhus/got) | High-performance, lightweight HTTP requests with Keep-Alive & timeout control |
| **HTML Parser** | [Cheerio](https://cheerio.js.org/) | Fast server-side DOM parsing and selector extraction |
| **Notifications** | [node-notifier](https://github.com/mikaelbr/node-notifier) | Native Apple Notification Center integration |
| **Code Editor** | [CodeMirror 5](https://codemirror.net/) | Syntax-highlighted JSON batch editor |

<br>

## 🔒 Security & Privacy Notes

- **Official Portal Domain**: Connects directly to `https://exam-setu.dtu.ac.in` over HTTPS.
- **In-Memory Only**: Your credentials and authentication cookies remain strictly in memory during the execution lifecycle. No secrets are ever stored in `localStorage`, cache, or on-disk databases.
- **Respects CAPTCHAs**: Never attempts to solve or bypass CAPTCHAs or Cloudflare security verifications — automatically pauses and hands control to you in the visible portal window.

<br>

## 👤 Author

**Vandit Bajaj**  
GitHub: [@vandit-bajaj](https://github.com/vandit-bajaj)

<br>

## 📄 License

This project is open-source and licensed under the [MIT License](LICENSE).
