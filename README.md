# DTU Course Registrar (macOS)

An Electron app that monitors the DTU course registration portal and **automatically registers elective courses** the moment a seat opens.

---

## Requirements
- macOS (Apple Silicon / Intel)
- Node.js ≥ 18 ([Homebrew](https://brew.sh/): `brew install node`)

---

## Run in Dev Mode

```bash
npm install
npm start
```

---

## Build a distributable `.dmg`

```bash
npm run dist:mac
```

Output will be in the `dist/` folder — a `.dmg` and a `.zip` for arm64 Mac.

### ⚠️ Gatekeeper Warning (Unsigned App)

Since this app is not signed with an Apple Developer certificate, macOS will block it on first open.

**To bypass:**
1. Try to open the app → you'll see *"Apple could not verify..."*
2. Open **System Settings → Privacy & Security**
3. Scroll down to find the security warning for `CourseRegistrar`
4. Click **"Open Anyway"**

Or run this command on the built `.app` to strip the quarantine flag:
```bash
xattr -cr dist/mac-arm64/CourseRegistrar.app
```

---

## How to Use

1. Enter your **Roll Number** and **Password**
2. Add courses you want to register — enter the **Course Code** (e.g. `HU317`) and **Slot** (e.g. `E2`)
   - Or click the `</>` button to paste a JSON list:
     ```json
     [
       { "code": "HU317", "slot": "E2" },
       { "code": "SE427", "slot": "E1" }
     ]
     ```
3. Optionally check **Auto Login on Session Expiry**
4. Click **Start Automation**

The bot will poll the portal every ~900ms. When a seat opens, it instantly registers you and sends a **macOS desktop notification**.

---

## How It Works

1. Logs in to `reg.exam.dtu.ac.in` via form POST (direct IP to skip DNS)
2. Scrapes the elective course table with Cheerio to find your target courses
3. Polls the registration page, using **ETag caching** to skip parsing when content is unchanged
4. Fires a registration POST the instant seats > 0
5. Detects session expiry and auto re-logs if enabled

---

## License
MIT
