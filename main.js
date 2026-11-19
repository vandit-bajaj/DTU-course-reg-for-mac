// main.js

const { app, BrowserWindow, ipcMain, session } = require('electron');

// Prevent Chromium automation flags from exposing webdriver to Cloudflare Turnstile
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');

const path = require('path');
const { execFile } = require('child_process');
const notifier = require('node-notifier');
const { startAutomation, stopAutomation, loginOnlyWithRetry } = require('./automation');

const CHROME_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
app.userAgentFallback = CHROME_USER_AGENT;

let win;
let automationRunning = false;
let activeManualLoginCancel = null;
let soundAlertsEnabled = true;
let manualFillCredentialsTrigger = null;

function playSound(type) {
  if (!soundAlertsEnabled) return;

  // macOS system sound files (bells, chimes, fanfares, and alerts)
  const soundMap = {
    start: '/System/Library/Sounds/Tink.aiff',      // crisp bell ding when automation starts
    login: '/System/Library/Sounds/Glass.aiff',     // resonant crystal bell on login success
    success: '/System/Library/Sounds/Hero.aiff',    // victorious fanfare on course registered
    error: '/System/Library/Sounds/Basso.aiff',     // deep tone when stopped by error
    alert: '/System/Library/Sounds/Sosumi.aiff',    // alert chime on CAPTCHA / action required
    stop: '/System/Library/Sounds/Pop.aiff',        // clean pop on user stop
  };

  const soundFile = soundMap[type] || soundMap.start;

  if (process.platform === 'darwin') {
    execFile('/usr/bin/afplay', [soundFile], () => {});
  } else {
    try {
      const { shell } = require('electron');
      shell.beep();
    } catch (_) {}
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 900,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    icon: path.join(__dirname, 'assets', 'dtulogo.png'),
  });

  win.loadFile('index.html');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

ipcMain.handle('start-automation', async (event, data) => {
  if (automationRunning) {
    return { success: false, error: 'Automation is already running.' };
  }

  const { creds, courses, autoLogin, soundAlerts, targetHost: customHost } = data;
  if (typeof soundAlerts === 'boolean') {
    soundAlertsEnabled = soundAlerts;
  }
  const targetHost = customHost || 'exam-setu.dtu.ac.in';
  automationRunning = true;
  playSound('start');

  try {
    startAutomation(creds, targetHost, courses, autoLogin, {
      onLoginSuccess: () => {
        playSound('login');
      },
      onStatusUpdate: (message) => win.webContents.send('status-update', message),
      onCourseRegistered: (course) => {
        playSound('success');
        win.webContents.send('course-registered', course);
      },
      onCourseBlocked: (course) => {
        playSound('alert');
        win.webContents.send('course-blocked', course);
      },
      onError: (error) => {
        playSound('error');
        win.webContents.send('automation-error', error);
      },
      onStop: () => {
        automationRunning = false;
        win.webContents.send('status-update', 'Automation stopped.');
      },
    });
    return { success: true };
  } catch (error) {
    playSound('error');
    automationRunning = false;
    return { success: false, error: error.message };
  }
});

ipcMain.handle('fill-credentials-manual', async () => {
  if (manualFillCredentialsTrigger) {
    return await manualFillCredentialsTrigger(true);
  }
  return { success: false, error: 'Portal window not active' };
});

ipcMain.handle('login-and-open-portal', async (event, data) => {
  if (automationRunning) {
    return { success: false, error: 'Another task is already running.' };
  }

  const { creds, soundAlerts, targetHost: customHost } = data;
  if (typeof soundAlerts === 'boolean') {
    soundAlertsEnabled = soundAlerts;
  }
  const targetHost = customHost || 'exam-setu.dtu.ac.in';
  const loginUrl = `https://${targetHost}/student/login`;
  automationRunning = true;
  playSound('start');

  // Use persistent partition so Cloudflare clearance cookies (cf_clearance) persist
  const portalSession = session.fromPartition('persist:dtu_portal');
  portalSession.setUserAgent(CHROME_USER_AGENT);

  const portalWin = new BrowserWindow({
    width: 1200,
    height: 850,
    title: 'DTU ExamSetu — Portal (Manual Mode)',
    webPreferences: {
      session: portalSession,
      nodeIntegration: false,
      contextIsolation: true,
    },
    icon: path.join(__dirname, 'assets', 'dtulogo.png'),
  });
  portalWin.webContents.setUserAgent(CHROME_USER_AGENT);

  let autoLoginActive = true;
  let loggedIn = false;
  let attempts = 0;
  let retryTimer = null;
  let isFillingCredentials = false;
  let inVerificationMode = false;

  const sendStatus = (msg) => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('status-update', msg);
    }
  };

  const scheduleRetry = (useLoginUrl) => {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = setTimeout(() => {
      if (portalWin.isDestroyed()) return;
      if (useLoginUrl) {
        portalWin.loadURL(loginUrl);
      } else {
        portalWin.webContents.reload();
      }
    }, 4000);
  };

  activeManualLoginCancel = () => {
    autoLoginActive = false;
    manualFillCredentialsTrigger = null;
    if (retryTimer) clearTimeout(retryTimer);
  };

  portalWin.on('closed', () => {
    if (retryTimer) clearTimeout(retryTimer);
    autoLoginActive = false;
    manualFillCredentialsTrigger = null;
    activeManualLoginCancel = null;
    if (win && !win.isDestroyed()) {
      win.webContents.send('show-fill-creds-btn', false);
    }
    if (!loggedIn) {
      automationRunning = false;
      if (win && !win.isDestroyed()) {
        win.webContents.send('automation-done');
      }
    }
  });

  const attemptFillCredentials = async (isManual = false) => {
    if (isFillingCredentials || !autoLoginActive || loggedIn || portalWin.isDestroyed()) {
      return { success: false };
    }
    const currentUrl = portalWin.webContents.getURL() || '';
    const title = portalWin.getTitle() || '';

    // If still on Cloudflare verification page, NEVER touch DOM or inject scripts!
    if (/Just a moment\.\.\.|Attention Required!|Security Verification/i.test(title)) {
      if (!inVerificationMode) {
        inVerificationMode = true;
        playSound('alert');
        sendStatus("✋ Security verification required: Please click 'Verify you are human' in the portal window. Credentials will auto-fill right after.");
        portalWin.focus();
        if (win && !win.isDestroyed()) {
          win.webContents.send('show-fill-creds-btn', true);
        }
      }
      return { success: false, reason: 'captcha_pending' };
    }

    if (!currentUrl.includes('/student/login')) {
      return { success: false, reason: 'not_on_login_page' };
    }

    isFillingCredentials = true;
    try {
      const result = await portalWin.webContents.executeJavaScript(`
        (() => {
          const text = document.body ? document.body.innerText : '';
          if (
            document.querySelector('.g-recaptcha, .h-captcha, .cf-turnstile, iframe[src*="captcha"], iframe[src*="turnstile"]') ||
            /Just a moment|Verify you are human/i.test(document.title + ' ' + text)
          ) {
            return { status: 'captcha' };
          }
          const alertEl = document.querySelector('div.alert.alert-danger');
          if (alertEl && alertEl.innerText.trim()) {
            return { status: 'alert', message: alertEl.innerText.replace(/\\s+/g, ' ').replace('×', '').trim() };
          }
          const passInput = document.querySelector('input[name="password"], input[type="password"]');
          const form = passInput ? passInput.closest('form') : document.querySelector('form[action*="/student/login"]');
          const rollInput = form ? form.querySelector('input[name="roll_no"], input[type="text"]') : null;
          if (!form || !rollInput || !passInput) {
            return { status: 'no-form' };
          }
          rollInput.value = ${JSON.stringify(creds.r)};
          passInput.value = ${JSON.stringify(creds.p)};
          rollInput.dispatchEvent(new Event('input', { bubbles: true }));
          passInput.dispatchEvent(new Event('input', { bubbles: true }));
          const submitBtn = form.querySelector('button[type="submit"]') || form.querySelector('input[type="submit"]');
          if (submitBtn) {
            submitBtn.click();
          } else {
            form.submit();
          }
          return { status: 'submitted' };
        })();
      `);

      if (result.status === 'captcha') {
        if (!inVerificationMode) {
          inVerificationMode = true;
          playSound('alert');
          sendStatus("✋ Security verification required: Please click 'Verify you are human' in the portal window. Credentials will auto-fill right after.");
          portalWin.focus();
          if (win && !win.isDestroyed()) {
            win.webContents.send('show-fill-creds-btn', true);
          }
        }
        return { success: false, reason: 'captcha' };
      } else if (result.status === 'alert') {
        playSound('error');
        autoLoginActive = false;
        automationRunning = false;
        activeManualLoginCancel = null;
        manualFillCredentialsTrigger = null;
        if (win && !win.isDestroyed()) {
          win.webContents.send('show-fill-creds-btn', false);
          win.webContents.send('automation-error', `Login failed: ${result.message}`);
        }
        return { success: false, reason: 'alert', message: result.message };
      } else if (result.status === 'submitted') {
        inVerificationMode = false;
        attempts++;
        sendStatus(`Logging in inside portal window (attempt ${attempts})...`);
        if (win && !win.isDestroyed()) {
          win.webContents.send('show-fill-creds-btn', false);
        }
        return { success: true };
      } else if (result.status === 'no-form') {
        if (isManual) {
          sendStatus('Login form not detected yet. Waiting for page...');
        }
        return { success: false, reason: 'no-form' };
      }
    } catch (err) {
      return { success: false, error: err.message };
    } finally {
      isFillingCredentials = false;
    }
    return { success: false };
  };

  manualFillCredentialsTrigger = attemptFillCredentials;

  portalWin.webContents.on('did-fail-load', (e, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3 || portalWin.isDestroyed()) return;
    if (!loggedIn && !autoLoginActive) return;
    sendStatus(`Connection error (${errorDescription}). Auto-retrying in 4s...`);
    scheduleRetry(!loggedIn);
  });

  portalWin.webContents.on('did-finish-load', async () => {
    if (portalWin.isDestroyed()) return;
    const currentUrl = portalWin.webContents.getURL() || '';
    const title = portalWin.getTitle() || '';

    // Auto-retry Cloudflare / DTU origin 502-524 host errors
    if (/\b(502|503|504|520|521|522|523|524)\b/.test(title)) {
      if (!loggedIn && !autoLoginActive) return;
      sendStatus(`DTU server error (${title}). Auto-retrying in 4s...`);
      scheduleRetry(!loggedIn && currentUrl.includes('/student/login'));
      return;
    }

    // Logged in successfully — hand off completely to the user
    if (currentUrl.includes('/student/home/') || currentUrl.includes('/student/courseRegistration/')) {
      if (!loggedIn) {
        loggedIn = true;
        autoLoginActive = false;
        automationRunning = false;
        activeManualLoginCancel = null;
        manualFillCredentialsTrigger = null;

        playSound('login');

        notifier.notify({
          title: 'ExamSetu Logged In! 🎉',
          message: 'Dashboard loaded! Click Course Registration and complete CAPTCHA manually.',
          icon: path.join(__dirname, 'assets', 'dtulogo.png'),
          sound: true,
          wait: false,
        });

        sendStatus('Logged in! Continue manually in the portal window (502/504 host errors still auto-retry every 4s).');
        if (win && !win.isDestroyed()) {
          win.webContents.send('show-fill-creds-btn', false);
          win.webContents.send('automation-done');
        }
      }
      return;
    }

    // On login page: check for challenge or auto-fill credentials
    if (autoLoginActive && !loggedIn && currentUrl.includes('/student/login')) {
      if (/Just a moment\.\.\.|Attention Required!|Security Verification/i.test(title)) {
        // Cloudflare challenge page detected by title alone — ZERO SCRIPT EXECUTION
        if (!inVerificationMode) {
          inVerificationMode = true;
          playSound('alert');
          sendStatus("✋ Security verification required: Please click 'Verify you are human' in the portal window. Credentials will auto-fill right after.");
          portalWin.focus();
          if (win && !win.isDestroyed()) {
            win.webContents.send('show-fill-creds-btn', true);
          }
        }
        return;
      }

      // Real login page loaded: auto-fill credentials
      await attemptFillCredentials(false);
    }
  });

  // When Cloudflare verification succeeds, page title updates from "Just a moment..." back to "ExamSetu"
  portalWin.on('page-title-updated', async (e, title) => {
    if (portalWin.isDestroyed() || !autoLoginActive || loggedIn) return;
    const currentUrl = portalWin.webContents.getURL() || '';
    if (currentUrl.includes('/student/login') && !/Just a moment\.\.\.|Attention Required!/i.test(title)) {
      await attemptFillCredentials(false);
    }
  });

  sendStatus('Opening ExamSetu login page in portal window...');
  portalWin.loadURL(loginUrl);
  portalWin.focus();

  return { success: true };
});

ipcMain.handle('stop-automation', async () => {
  if (activeManualLoginCancel) {
    activeManualLoginCancel();
    activeManualLoginCancel = null;
  }
  if (automationRunning) {
    stopAutomation();
    automationRunning = false;
    playSound('stop');
  }
  return { success: true };
});

ipcMain.handle('set-sound-enabled', (event, enabled) => {
  soundAlertsEnabled = !!enabled;
  return { success: true };
});

ipcMain.handle('play-sound', (event, type) => {
  playSound(type);
  return { success: true };
});
