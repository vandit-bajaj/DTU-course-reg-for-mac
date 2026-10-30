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

- ⚡ **Sub-100ms Sniping**: Fires registration POST requests within milliseconds of detecting an open seat.
- 🌐 **Direct IP Routing**: Connects directly to server IP (`14.139.251.105`) to eliminate DNS lookup latency.
- 🔁 **ETag-Aware Polling**: Polls every ~900ms and leverages HTTP 304 Not Modified headers to minimize network overhead and server strain.
- 🔄 **Session Recovery**: Automatically re-authenticates if the DTU portal invalidates your session cookie.
- 🔔 **Native macOS Notifications**: Sends alerts via Apple Notification Center the moment your courses are secured.
- 📝 **Dual Course Input**: Add courses individually through interactive inputs or paste full batches using the built-in JSON editor.
- 🛡️ **Zero Disk Footprint**: Credentials and session tokens are strictly kept in volatile memory and are never written to disk or transmitted to third parties.

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
3. **Auto Login**: Toggle **Auto Login on Session Expiry** on to ensure seamless re-authentication if the session drops.
4. **Start Automation**: Click **Start Automation**. The application will continuously monitor vacancies and register courses automatically.

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
├── main.js          # Electron main process (window lifecycle & IPC handlers)
├── preload.js       # Secure context bridge between renderer and Node.js
├── renderer.js      # UI controller (form handling, JSON modal, event listeners)
├── automation.js    # Core automation engine (auth, polling, scraping, sniping)
├── index.html       # Application interface layout
├── styles.css       # macOS dark-themed UI styling
├── assets/
│   ├── dtulogo.png  # Application icon (PNG format)
│   └── dtulogo.icns # macOS bundle icon (ICNS format)
└── package.json     # Project dependencies, scripts, and build configuration
```

<br>

## 🛠️ Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Desktop Framework** | [Electron 34](https://www.electronjs.org/) | Cross-platform desktop runtime on Chromium & Node.js |
| **HTTP Client** | [got v14](https://github.com/sindresorhus/got) | High-performance, lightweight HTTP requests with HTTP/2 & custom agent support |
| **HTML Parser** | [Cheerio](https://cheerio.js.org/) | Fast server-side DOM parsing and selector extraction |
| **Notifications** | [node-notifier](https://github.com/mikaelbr/node-notifier) | Native Apple Notification Center integration |
| **Code Editor** | [CodeMirror 5](https://codemirror.net/) | Syntax-highlighted JSON batch editor |

<br>

## 🔒 Security & Privacy Notes

- **Direct IP Connection**: The client connects directly to `14.139.251.105` to bypass local DNS resolution latency.
- **In-Memory Only**: Your credentials and authentication cookies remain strictly in memory during the execution lifecycle. No secrets are ever stored in `localStorage`, cache, or on-disk databases.
- **TLS/SSL Behavior**: SSL verification is configured to accommodate direct IP requests to the university server.

<br>

## 👤 Author

**Vandit Bajaj**  
GitHub: [@vandit-bajaj](https://github.com/vandit-bajaj)

<br>

## 📄 License

This project is open-source and licensed under the [MIT License](LICENSE).
