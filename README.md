# DTU Course Registrar (macOS)

> **Automated elective seat sniper for Delhi Technological University students.**  
> Monitors the DTU course registration portal and registers your courses **the instant a seat opens** — faster than any human can click.

<br>

## How It Works

1. Logs into `reg.exam.dtu.ac.in` using your roll number and password
2. Scrapes the elective courses table to track your target courses
3. Polls the registration page every **~900ms**, using ETag caching to avoid unnecessary parsing
4. The moment a seat opens → fires a registration POST in **under 100ms**
5. Sends a **macOS desktop notification** when a course is registered
6. Auto re-logs if your session expires (optional)

<br>

## Requirements

- macOS (Apple Silicon or Intel)
- [Node.js](https://nodejs.org/) ≥ 18  
  Install via Homebrew: `brew install node`

<br>

## Setup

```bash
git clone https://github.com/vandit-bajaj/DTU-course-reg-for-mac.git
cd DTU-course-reg-for-mac
npm install
npm start
```

<br>

## Usage

1. **Enter your credentials** — Roll Number and Password
2. **Add courses** you want to register:
   - Click **Add Course** and type the course code + slot
   - Or click the **`</>`** button to paste a JSON list:
     ```json
     [
       { "code": "HU317", "slot": "E2" },
       { "code": "SE427", "slot": "E1" }
     ]
     ```
3. Optionally check **Auto Login on Session Expiry**
4. Click **Start Automation** — the bot takes over from here

Status updates appear live in the app. Registered courses are listed with timestamps.

<br>

## Build a Distributable `.dmg`

```bash
npm run dist:mac
```

Output will be in `dist/` — a `.dmg` and `.zip` for arm64 Mac.

### ⚠️ Opening the Unsigned App (Gatekeeper)

macOS blocks unsigned apps by default. After installing the `.dmg`:

**Option A** — Strip the quarantine flag (recommended):
```bash
xattr -cr /Applications/DTU\ Course\ Registrar.app
```

**Option B** — Open via System Settings:
1. Try to open the app → *"Apple could not verify..."*
2. Go to **System Settings → Privacy & Security**
3. Scroll down → click **Open Anyway**

<br>

## Project Structure

```
DTU-course-reg-for-mac/
├── main.js          # Electron main process — window + IPC handlers
├── preload.js       # Secure bridge between renderer and main (contextBridge)
├── renderer.js      # UI logic — form handling, status updates, events
├── automation.js    # Core engine — login, scraping, polling, registration
├── index.html       # App UI structure
├── styles.css       # App styling
├── assets/
│   ├── dtulogo.png  # App icon (PNG)
│   └── dtulogo.icns # App icon (macOS bundle format)
└── package.json
```

<br>

## Tech Stack

| Component | Technology |
|---|---|
| Desktop shell | [Electron 34](https://www.electronjs.org/) |
| HTTP requests | [got v14](https://github.com/sindresorhus/got) |
| HTML parsing | [Cheerio](https://cheerio.js.org/) |
| Desktop notifications | [node-notifier](https://github.com/mikaelbr/node-notifier) |
| JSON editor | [CodeMirror 5](https://codemirror.net/) |

<br>

## Notes

- The app connects **directly to the server IP** (`14.139.251.105`) to bypass DNS lookup delay
- SSL certificate verification is disabled for direct IP connections (expected for this server)
- Credentials are only held in memory during the session — never written to disk

<br>

## Author

**Vandit Bajaj** — [github.com/vandit-bajaj](https://github.com/vandit-bajaj)

## License

MIT
