/**
 * ==============================================================================
 *  DTU ExamSetu — In-Browser Seat Sniper (Console Edition)
 *  Target: https://exam-setu.dtu.ac.in/register/
 * ==============================================================================
 *  Instructions:
 *  1. Open Chrome and navigate to: https://exam-setu.dtu.ac.in/register/
 *  2. Press Cmd + Option + J (Mac) or Ctrl + Shift + J (Win) to open Console.
 *  3. Paste this entire script and press Enter.
 *  4. Configure your Target Course and Slot in the floating HUD.
 *  5. Click [▶ Start Sniper] and leave the tab open!
 * ==============================================================================
 */

(function DTU_IN_BROWSER_SNIPER() {
  'use strict';

  // 1. Singleton Check: If HUD already exists, remove or re-focus it
  const EXISTING_HUD = document.getElementById('dtu-sniper-hud');
  if (EXISTING_HUD) {
    EXISTING_HUD.remove();
  }
  const EXISTING_STYLE = document.getElementById('dtu-sniper-styles');
  if (EXISTING_STYLE) {
    EXISTING_STYLE.remove();
  }

  // 2. State Management
  const STORAGE_KEY = 'dtu_sniper_config_v1';
  let savedConfig = {};
  try {
    savedConfig = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '{}');
  } catch (_) {}

  const state = {
    mode: savedConfig.mode || 'direct', // 'direct' | 'swap'
    targetCode: (savedConfig.targetCode || '').trim().toUpperCase(),
    targetSlot: (savedConfig.targetSlot || 'E1').trim().toUpperCase(),
    dropCode: (savedConfig.dropCode || '').trim().toUpperCase(),
    dropSlot: (savedConfig.dropSlot || 'E1').trim().toUpperCase(),
    intervalSec: parseFloat(savedConfig.intervalSec) || 1.5,
    isRunning: false,
    timer: null,
    checkCount: 0,
    logs: [],
  };

  const saveState = () => {
    try {
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          mode: state.mode,
          targetCode: state.targetCode,
          targetSlot: state.targetSlot,
          dropCode: state.dropCode,
          dropSlot: state.dropSlot,
          intervalSec: state.intervalSec,
        })
      );
    } catch (_) {}
  };

  // 3. Audio Engine (Web Audio API Synthesizer - 0 external files)
  let audioCtx = null;
  const getAudioContext = () => {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) audioCtx = new AudioContextClass();
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    return audioCtx;
  };

  const playTone = (freq, duration, type = 'sine', gainVal = 0.2) => {
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      gain.gain.setValueAtTime(gainVal, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + duration);
    } catch (_) {}
  };

  const sounds = {
    beep: () => playTone(880, 0.12, 'square', 0.15),
    click: () => playTone(440, 0.08, 'sine', 0.1),
    foundSeat: () => {
      // Rapid piercing dual-tone alert
      let t = 0;
      for (let i = 0; i < 6; i++) {
        setTimeout(() => playTone(1200, 0.12, 'square', 0.3), t);
        setTimeout(() => playTone(880, 0.12, 'square', 0.3), t + 140);
        t += 280;
      }
    },
    victory: () => {
      // Ascending major fanfare
      const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
      notes.forEach((f, idx) => {
        setTimeout(() => playTone(f, 0.3, 'triangle', 0.4), idx * 160);
      });
    },
    error: () => {
      playTone(220, 0.4, 'sawtooth', 0.3);
      setTimeout(() => playTone(180, 0.5, 'sawtooth', 0.3), 300);
    },
  };

  // 4. Inject HUD Stylesheet
  const styleEl = document.createElement('style');
  styleEl.id = 'dtu-sniper-styles';
  styleEl.textContent = `
    #dtu-sniper-hud {
      position: fixed;
      top: 18px;
      right: 18px;
      width: 360px;
      background: #14171c;
      color: #e5e7eb;
      border: 1px solid #2d333b;
      border-radius: 12px;
      box-shadow: 0 16px 36px rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(255, 255, 255, 0.07);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 13px;
      z-index: 9999999;
      user-select: none;
      transition: box-shadow 0.2s, height 0.2s;
      overflow: hidden;
    }
    #dtu-sniper-hud * { box-sizing: border-box; }
    .dtu-sniper-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 14px;
      background: #1c2128;
      border-bottom: 1px solid #2d333b;
      cursor: move;
    }
    .dtu-sniper-title {
      font-weight: 700;
      font-size: 13.5px;
      display: flex;
      align-items: center;
      gap: 7px;
      color: #f6c034;
      letter-spacing: 0.3px;
    }
    .dtu-sniper-badge {
      background: #373e47;
      color: #adbac7;
      font-size: 10px;
      font-weight: 600;
      padding: 2px 6px;
      border-radius: 6px;
    }
    .dtu-sniper-actions {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .dtu-sniper-icon-btn {
      background: transparent;
      border: none;
      color: #768390;
      cursor: pointer;
      font-size: 14px;
      padding: 3px 6px;
      border-radius: 4px;
      line-height: 1;
      transition: all 0.15s;
    }
    .dtu-sniper-icon-btn:hover {
      background: #2d333b;
      color: #f0f6fc;
    }
    .dtu-sniper-body {
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      max-height: 580px;
      overflow-y: auto;
    }
    .dtu-sniper-collapsed .dtu-sniper-body {
      display: none;
    }
    .dtu-sniper-mode-selector {
      display: flex;
      gap: 6px;
      background: #1c2128;
      padding: 3px;
      border-radius: 8px;
      border: 1px solid #2d333b;
    }
    .dtu-sniper-mode-btn {
      flex: 1;
      padding: 6px 10px;
      border: none;
      border-radius: 6px;
      background: transparent;
      color: #768390;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s;
    }
    .dtu-sniper-mode-btn.active {
      background: #f6c034;
      color: #14171c;
      box-shadow: 0 2px 6px rgba(246, 192, 52, 0.3);
    }
    .dtu-sniper-box {
      background: #1c2128;
      border: 1px solid #2d333b;
      border-radius: 8px;
      padding: 10px 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .dtu-sniper-box-label {
      font-size: 10.5px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #768390;
    }
    .dtu-sniper-row {
      display: flex;
      gap: 8px;
    }
    .dtu-sniper-field {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .dtu-sniper-field label {
      font-size: 10px;
      color: #adbac7;
    }
    .dtu-sniper-input, .dtu-sniper-select {
      background: #22272e;
      border: 1px solid #373e47;
      color: #f0f6fc;
      border-radius: 6px;
      padding: 7px 9px;
      font-size: 12.5px;
      font-family: inherit;
      outline: none;
      transition: border-color 0.15s;
    }
    .dtu-sniper-input:focus, .dtu-sniper-select:focus {
      border-color: #f6c034;
    }
    .dtu-sniper-status-card {
      background: #1c2128;
      border: 1px solid #2d333b;
      border-radius: 8px;
      padding: 10px 12px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .dtu-sniper-status-line {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 12px;
    }
    .dtu-sniper-status-tag {
      display: flex;
      align-items: center;
      gap: 5px;
      font-weight: 600;
    }
    .dtu-sniper-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #768390;
    }
    .dtu-sniper-dot.active {
      background: #2ecc71;
      box-shadow: 0 0 8px #2ecc71;
      animation: dtu-sniper-pulse 1.2s infinite;
    }
    @keyframes dtu-sniper-pulse {
      0% { opacity: 1; }
      50% { opacity: 0.4; }
      100% { opacity: 1; }
    }
    .dtu-sniper-main-btn {
      padding: 11px;
      border: none;
      border-radius: 8px;
      font-size: 13.5px;
      font-weight: 700;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      transition: all 0.2s;
    }
    .dtu-sniper-start {
      background: #f6c034;
      color: #14171c;
    }
    .dtu-sniper-start:hover {
      background: #e5b028;
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(246, 192, 52, 0.35);
    }
    .dtu-sniper-stop {
      background: #da3633;
      color: #ffffff;
    }
    .dtu-sniper-stop:hover {
      background: #b62324;
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(218, 54, 51, 0.35);
    }
    .dtu-sniper-log-area {
      background: #0d1117;
      border: 1px solid #21262d;
      border-radius: 6px;
      padding: 8px;
      max-height: 120px;
      overflow-y: auto;
      font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
      font-size: 11px;
      color: #8b949e;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .dtu-sniper-log-entry {
      line-height: 1.4;
      word-break: break-all;
    }
    .dtu-sniper-log-entry.success { color: #3fb950; font-weight: 600; }
    .dtu-sniper-log-entry.warn { color: #f6c034; }
    .dtu-sniper-log-entry.error { color: #f85149; }
  `;
  document.head.appendChild(styleEl);

  // 5. Build HUD Container
  const hud = document.createElement('div');
  hud.id = 'dtu-sniper-hud';
  hud.innerHTML = `
    <div class="dtu-sniper-header" id="dtu-sniper-header">
      <div class="dtu-sniper-title">
        <span>🎯 DTU Seat Sniper</span>
        <span class="dtu-sniper-badge" id="dtu-sniper-badge">READY</span>
      </div>
      <div class="dtu-sniper-actions">
        <button class="dtu-sniper-icon-btn" id="dtu-sound-btn" title="Test Alert Sound">🔊</button>
        <button class="dtu-sniper-icon-btn" id="dtu-collapse-btn" title="Collapse / Expand">─</button>
        <button class="dtu-sniper-icon-btn" id="dtu-close-btn" title="Close">✕</button>
      </div>
    </div>

    <div class="dtu-sniper-body">
      <!-- Mode Selection -->
      <div class="dtu-sniper-mode-selector">
        <button class="dtu-sniper-mode-btn ${state.mode === 'direct' ? 'active' : ''}" id="mode-direct-btn">Direct Add (Empty Slot)</button>
        <button class="dtu-sniper-mode-btn ${state.mode === 'swap' ? 'active' : ''}" id="mode-swap-btn">Auto-Swap (Drop & Add)</button>
      </div>

      <!-- Target Course Box -->
      <div class="dtu-sniper-box">
        <div class="dtu-sniper-box-label">🎯 Target Course (To Snipe)</div>
        <div class="dtu-sniper-row">
          <div class="dtu-sniper-field" style="flex: 2;">
            <label>Course Code</label>
            <input type="text" class="dtu-sniper-input" id="target-code-input" placeholder="e.g. EP322n, HU328" value="${state.targetCode}" />
          </div>
          <div class="dtu-sniper-field" style="flex: 1.2;">
            <label>Slot</label>
            <select class="dtu-sniper-select" id="target-slot-select">
              ${['E1', 'E2', 'E3', 'E4', 'E5'].map(s => `<option value="${s}" ${state.targetSlot === s ? 'selected' : ''}>Slot ${s}</option>`).join('')}
            </select>
          </div>
        </div>
      </div>

      <!-- Swap From Box (Visible only in Swap mode) -->
      <div class="dtu-sniper-box" id="swap-box" style="display: ${state.mode === 'swap' ? 'flex' : 'none'};">
        <div class="dtu-sniper-box-label" style="color: #f85149;">🔄 Swap From (Course to Drop)</div>
        <div class="dtu-sniper-row">
          <div class="dtu-sniper-field" style="flex: 2;">
            <label>Drop Course Code</label>
            <input type="text" class="dtu-sniper-input" id="drop-code-input" placeholder="e.g. HU318, IT310" value="${state.dropCode}" />
          </div>
          <div class="dtu-sniper-field" style="flex: 1.2;">
            <label>Drop Slot</label>
            <select class="dtu-sniper-select" id="drop-slot-select">
              ${['E1', 'E2', 'E3', 'E4', 'E5'].map(s => `<option value="${s}" ${state.dropSlot === s ? 'selected' : ''}>Slot ${s}</option>`).join('')}
            </select>
          </div>
        </div>
      </div>

      <!-- Settings & Controls -->
      <div class="dtu-sniper-row" style="align-items: center; justify-content: space-between;">
        <div style="font-size: 11px; color: #8b949e;">Check Interval:</div>
        <div style="display: flex; align-items: center; gap: 4px;">
          <input type="number" step="0.2" min="0.5" max="10" class="dtu-sniper-input" id="interval-input" value="${state.intervalSec}" style="width: 65px; padding: 4px 6px; text-align: center;" />
          <span style="font-size: 11px; color: #8b949e;">sec</span>
        </div>
      </div>

      <!-- Main Action Button -->
      <button class="dtu-sniper-main-btn dtu-sniper-start" id="dtu-toggle-btn">
        <span>▶ Start Sniper</span>
      </button>

      <!-- Live Status Card -->
      <div class="dtu-sniper-status-card">
        <div class="dtu-sniper-status-line">
          <span class="dtu-sniper-status-tag">
            <span class="dtu-sniper-dot" id="dtu-status-dot"></span>
            <span id="dtu-status-text">Idle</span>
          </span>
          <span id="dtu-check-counter" style="color: #768390; font-size: 11px;">0 checks</span>
        </div>
        <div id="dtu-target-info" style="font-size: 11.5px; color: #adbac7; line-height: 1.3;">
          Target: Set course code above
        </div>
      </div>

      <!-- Activity Logs -->
      <div class="dtu-sniper-box-label" style="margin-top: 2px;">📋 Activity Log</div>
      <div class="dtu-sniper-log-area" id="dtu-log-area">
        <div class="dtu-sniper-log-entry">Sniper initialized. Configure target & press Start.</div>
      </div>
    </div>
  `;
  document.body.appendChild(hud);

  // 6. DOM Element References
  const headerEl = document.getElementById('dtu-sniper-header');
  const badgeEl = document.getElementById('dtu-sniper-badge');
  const soundBtn = document.getElementById('dtu-sound-btn');
  const collapseBtn = document.getElementById('dtu-collapse-btn');
  const closeBtn = document.getElementById('dtu-close-btn');
  const modeDirectBtn = document.getElementById('mode-direct-btn');
  const modeSwapBtn = document.getElementById('mode-swap-btn');
  const swapBox = document.getElementById('swap-box');
  const targetCodeInput = document.getElementById('target-code-input');
  const targetSlotSelect = document.getElementById('target-slot-select');
  const dropCodeInput = document.getElementById('drop-code-input');
  const dropSlotSelect = document.getElementById('drop-slot-select');
  const intervalInput = document.getElementById('interval-input');
  const toggleBtn = document.getElementById('dtu-toggle-btn');
  const statusDot = document.getElementById('dtu-status-dot');
  const statusText = document.getElementById('dtu-status-text');
  const checkCounter = document.getElementById('dtu-check-counter');
  const targetInfo = document.getElementById('dtu-target-info');
  const logArea = document.getElementById('dtu-log-area');

  // 7. Logger Helper
  const addLog = (msg, type = 'info') => {
    const time = new Date().toLocaleTimeString('en-IN', { hour12: false });
    const entry = document.createElement('div');
    entry.className = `dtu-sniper-log-entry ${type}`;
    entry.textContent = `[${time}] ${msg}`;
    logArea.prepend(entry);
    if (logArea.children.length > 30) {
      logArea.lastElementChild.remove();
    }
  };

  // 8. Draggable HUD Implementation
  let isDragging = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;

  headerEl.addEventListener('mousedown', (e) => {
    if (e.target.closest('.dtu-sniper-actions')) return;
    isDragging = true;
    dragOffsetX = e.clientX - hud.offsetLeft;
    dragOffsetY = e.clientY - hud.offsetTop;
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    e.preventDefault();
    const newX = Math.max(10, Math.min(window.innerWidth - hud.offsetWidth - 10, e.clientX - dragOffsetX));
    const newY = Math.max(10, Math.min(window.innerHeight - hud.offsetHeight - 10, e.clientY - dragOffsetY));
    hud.style.left = `${newX}px`;
    hud.style.top = `${newY}px`;
    hud.style.right = 'auto';
  });

  window.addEventListener('mouseup', () => {
    isDragging = false;
  });

  // 9. UI Controls & Listeners
  collapseBtn.addEventListener('click', () => {
    hud.classList.toggle('dtu-sniper-collapsed');
    collapseBtn.textContent = hud.classList.contains('dtu-sniper-collapsed') ? '□' : '─';
  });

  closeBtn.addEventListener('click', () => {
    stopSniper();
    hud.remove();
    styleEl.remove();
  });

  soundBtn.addEventListener('click', () => {
    sounds.beep();
    setTimeout(() => sounds.victory(), 200);
  });

  modeDirectBtn.addEventListener('click', () => {
    state.mode = 'direct';
    modeDirectBtn.classList.add('active');
    modeSwapBtn.classList.remove('active');
    swapBox.style.display = 'none';
    saveState();
  });

  modeSwapBtn.addEventListener('click', () => {
    state.mode = 'swap';
    modeSwapBtn.classList.add('active');
    modeDirectBtn.classList.remove('active');
    swapBox.style.display = 'flex';
    saveState();
  });

  targetCodeInput.addEventListener('input', (e) => {
    state.targetCode = e.target.value.trim().toUpperCase();
    saveState();
  });

  targetSlotSelect.addEventListener('change', (e) => {
    state.targetSlot = e.target.value;
    saveState();
  });

  dropCodeInput.addEventListener('input', (e) => {
    state.dropCode = e.target.value.trim().toUpperCase();
    saveState();
  });

  dropSlotSelect.addEventListener('change', (e) => {
    state.dropSlot = e.target.value;
    saveState();
  });

  intervalInput.addEventListener('change', (e) => {
    let val = parseFloat(e.target.value);
    if (isNaN(val) || val < 0.5) val = 0.5;
    state.intervalSec = val;
    intervalInput.value = val;
    saveState();
  });

  // 10. Resilient DOM Traversal & Selector Engine
  const normalize = (str) => (str || '').replace(/\s+/g, ' ').trim().toUpperCase();

  // Find slot section accordion (e.g. "SLOT E3")
  const findSlotSection = (slotName) => {
    const slotTarget = `SLOT ${slotName.toUpperCase()}`;
    const allHeaders = Array.from(document.querySelectorAll('div, button, section, header'));
    for (const el of allHeaders) {
      if (normalize(el.innerText).includes(slotTarget)) {
        // Find container wrapping this slot
        const container = el.closest('div[class*="slot"], section, div.border, div.rounded') || el.parentElement;
        return { header: el, container: container || el };
      }
    }
    return null;
  };

  // Ensure slot accordion is opened
  const ensureSlotOpen = (slotName) => {
    const slotInfo = findSlotSection(slotName);
    if (!slotInfo) return false;
    // Check if collapsed (chevron pointing down or container child count minimal)
    const text = slotInfo.container.innerText;
    if (!text.includes('credits') && !text.includes('left') && !text.includes('Full')) {
      // Looks collapsed, click header to open
      const clickable = slotInfo.header.querySelector('button') || slotInfo.header;
      clickable.click();
      return true;
    }
    return true;
  };

  // Find course row by code inside page
  const findCourseRow = (courseCode) => {
    const targetCode = normalize(courseCode);
    const allDivs = Array.from(document.querySelectorAll('div, li, tr'));
    for (const el of allDivs) {
      // Look for leaf-like row that contains the exact course code token
      const text = el.innerText || '';
      if (text.includes(courseCode) && (text.includes('credits') || text.includes('left') || text.includes('Full'))) {
        // Verify this element has children and isn't the whole page
        if (el.children.length >= 2 && el.children.length <= 12) {
          // Check if it has the exact code token
          const tokens = normalize(text).split(/[\s,]+/);
          if (tokens.includes(targetCode)) {
            return el;
          }
        }
      }
    }
    return null;
  };

  // Extract seat details from course row element
  const inspectRow = (rowEl) => {
    if (!rowEl) return { status: 'not_found', seats: 0, addBtn: null, dropBtn: null };

    const text = rowEl.innerText || '';

    // Seat count matching: "X left" or "Full"
    let seats = 0;
    let isFull = /Full/i.test(text);
    const leftMatch = text.match(/(\d+)\s+left/i);
    if (leftMatch) {
      seats = parseInt(leftMatch[1], 10);
      isFull = false;
    }

    // Action button detection
    const buttons = Array.from(rowEl.querySelectorAll('button, a, input[type="button"], input[type="submit"]'));
    let addBtn = null;
    let dropBtn = null;

    buttons.forEach((btn) => {
      const btnText = normalize(btn.innerText || btn.value);
      if (btnText.includes('+ ADD') || btnText === 'ADD' || btnText.includes('SELECT')) {
        addBtn = btn;
      }
      if (btnText.includes('DROP') || btnText.includes('REMOVE')) {
        dropBtn = btn;
      }
    });

    const isAdded = /Added/i.test(text) || !!dropBtn;

    return {
      text,
      seats,
      isFull,
      isAdded,
      addBtn,
      dropBtn,
    };
  };

  // Find drop button on left sidebar (e.g. "HU318 ... E3 4 cr ✕")
  const findSidebarDropButton = (courseCode) => {
    const targetCode = normalize(courseCode);
    const sidebar = document.querySelector('div.sidebar, aside') || document.body;
    const items = Array.from(sidebar.querySelectorAll('div, li'));

    for (const el of items) {
      const text = normalize(el.innerText || '');
      if (text.includes(targetCode) && (text.includes('CR') || text.includes('CREDITS'))) {
        // Look for ✕ button inside
        const btn = el.querySelector('button, span[class*="close"], svg, a');
        if (btn) return btn;
      }
    }
    return null;
  };

  // 11. Core Sniping Execution Logic
  let isExecutingAction = false;

  const performCheck = async () => {
    if (!state.isRunning || isExecutingAction) return;

    state.checkCount++;
    checkCounter.textContent = `${state.checkCount} checks`;

    // Ensure target slot is visible
    ensureSlotOpen(state.targetSlot);

    // Locate target course row
    const targetRow = findCourseRow(state.targetCode);
    if (!targetRow) {
      targetInfo.innerHTML = `<span style="color:#f85149;">❌ Row not found for ${state.targetCode}</span><br>Check slot & code spelling.`;
      addLog(`Row not found for ${state.targetCode} in Slot ${state.targetSlot}`, 'warn');
      return;
    }

    const info = inspectRow(targetRow);

    // If target course is already added
    if (info.isAdded) {
      targetInfo.innerHTML = `<span style="color:#3fb950; font-weight:700;">🎉 ${state.targetCode} is ALREADY Added!</span>`;
      addLog(`Success! ${state.targetCode} is registered!`, 'success');
      sounds.victory();
      stopSniper();
      return;
    }

    // Update Live Status Box
    if (info.isFull || info.seats === 0) {
      targetInfo.innerHTML = `Target: <strong>${state.targetCode}</strong> (${state.targetSlot})<br><span style="color:#f6c034;">● Status: Full (0 seats)</span>`;
      if (state.checkCount % 10 === 0) {
        addLog(`Checked: ${state.targetCode} is still Full. Watching...`);
      }
      return;
    }

    // SEAT DETECTED!
    if (info.seats > 0 || info.addBtn) {
      isExecutingAction = true;
      sounds.foundSeat();
      addLog(`🔥 SEAT FOUND for ${state.targetCode}! (${info.seats} left). Firing action...`, 'success');
      targetInfo.innerHTML = `<span style="color:#3fb950; font-weight:700;">🔥 SEAT OPEN! Registering ${state.targetCode}...</span>`;

      if (state.mode === 'direct') {
        // Mode 1: Direct Add
        if (info.addBtn) {
          info.addBtn.click();
          addLog(`Clicked [+ Add] on ${state.targetCode}. Verifying...`, 'info');
          await handlePostAddVerification(state.targetCode);
        } else {
          addLog(`Seat open but [+ Add] button missing. Slot might be occupied! Switch to Auto-Swap?`, 'error');
          sounds.error();
          isExecutingAction = false;
        }
      } else {
        // Mode 2: Auto-Swap
        addLog(`Auto-Swap initiated: Dropping backup [${state.dropCode}] in Slot ${state.dropSlot}...`, 'warn');

        // Step A: Drop backup course
        let dropSuccess = false;
        ensureSlotOpen(state.dropSlot);
        const dropRow = findCourseRow(state.dropCode);
        const dropInfo = inspectRow(dropRow);

        if (dropInfo.dropBtn) {
          dropInfo.dropBtn.click();
          dropSuccess = true;
          addLog(`Clicked [Drop] button on ${state.dropCode} in slot row.`, 'info');
        } else {
          // Fallback to sidebar ✕ button
          const sidebarBtn = findSidebarDropButton(state.dropCode);
          if (sidebarBtn) {
            sidebarBtn.click();
            dropSuccess = true;
            addLog(`Clicked [✕] on ${state.dropCode} in sidebar.`, 'info');
          }
        }

        if (!dropSuccess) {
          addLog(`Failed to find drop button for ${state.dropCode}. Aborting swap!`, 'error');
          sounds.error();
          isExecutingAction = false;
          return;
        }

        // Wait 350ms for slot to open & DOM to re-render +Add button
        await new Promise((r) => setTimeout(r, 350));

        // Step B: Re-query target course row for the newly rendered [+ Add] button
        ensureSlotOpen(state.targetSlot);
        const refreshedTargetRow = findCourseRow(state.targetCode);
        const refreshedInfo = inspectRow(refreshedTargetRow);

        if (refreshedInfo.addBtn) {
          refreshedInfo.addBtn.click();
          addLog(`Slot vacant! Clicked [+ Add] on target [${state.targetCode}]. Verifying...`, 'success');
          await handlePostAddVerification(state.targetCode, state.dropCode);
        } else {
          // Seat might have been taken during drop gap — Rollback!
          addLog(`Target [+ Add] not available after drop! Executing EMERGENCY RESTORE on [${state.dropCode}]...`, 'error');
          sounds.error();
          await executeRollback(state.dropCode, state.dropSlot);
        }
      }
    }
  };

  // Verify successful addition
  const handlePostAddVerification = async (targetCode, backupCodeToRestore = null) => {
    let verified = false;
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, 400));
      const row = findCourseRow(targetCode);
      const rowInfo = inspectRow(row);
      if (rowInfo.isAdded) {
        verified = true;
        break;
      }
    }

    if (verified) {
      sounds.victory();
      addLog(`🎉 SUCCESS! Course ${targetCode} has been LOCKED IN!`, 'success');
      targetInfo.innerHTML = `<span style="color:#3fb950; font-weight:700;">🎉 SUCCESS! ${targetCode} Registered!</span>`;
      stopSniper();
      alert(`🎉 DTU Seat Sniper Success!\n\nCourse ${targetCode} has been registered successfully!`);
    } else {
      addLog(`Verification pending or timed out for ${targetCode}.`, 'warn');
      if (backupCodeToRestore) {
        addLog(`Attempting rollback to restore backup [${backupCodeToRestore}]...`, 'warn');
        await executeRollback(backupCodeToRestore, state.dropSlot);
      }
      isExecutingAction = false;
    }
  };

  // Rollback safety helper
  const executeRollback = async (backupCode, backupSlot) => {
    ensureSlotOpen(backupSlot);
    await new Promise((r) => setTimeout(r, 300));
    const backupRow = findCourseRow(backupCode);
    const backupInfo = inspectRow(backupRow);
    if (backupInfo.addBtn) {
      backupInfo.addBtn.click();
      addLog(`Safety restore complete: Re-added [${backupCode}]. Slot protected!`, 'warn');
    } else {
      addLog(`CRITICAL: Could not auto-restore [${backupCode}]. Please check manually!`, 'error');
      sounds.error();
    }
    isExecutingAction = false;
  };

  // 12. Start / Stop Engine
  const startSniper = () => {
    if (!state.targetCode) {
      alert('Please enter a target Course Code (e.g. EP322n)');
      targetCodeInput.focus();
      return;
    }
    if (state.mode === 'swap' && !state.dropCode) {
      alert('In Auto-Swap mode, please enter the backup Course Code to drop (e.g. HU318)');
      dropCodeInput.focus();
      return;
    }

    state.isRunning = true;
    state.checkCount = 0;
    saveState();

    toggleBtn.className = 'dtu-sniper-main-btn dtu-sniper-stop';
    toggleBtn.innerHTML = '<span>⏹ Stop Sniper</span>';
    badgeEl.textContent = 'SNIPING';
    badgeEl.style.background = '#238636';
    badgeEl.style.color = '#fff';
    statusDot.className = 'dtu-sniper-dot active';
    statusText.textContent = 'Active (Sniping...)';

    sounds.click();
    addLog(`Sniper started on ${state.targetCode} (${state.targetSlot}) | Mode: ${state.mode}`, 'info');

    // Run first check immediately, then schedule
    performCheck();
    state.timer = setInterval(performCheck, Math.max(500, state.intervalSec * 1000));
  };

  const stopSniper = () => {
    state.isRunning = false;
    if (state.timer) {
      clearInterval(state.timer);
      state.timer = null;
    }
    isExecutingAction = false;

    toggleBtn.className = 'dtu-sniper-main-btn dtu-sniper-start';
    toggleBtn.innerHTML = '<span>▶ Start Sniper</span>';
    badgeEl.textContent = 'IDLE';
    badgeEl.style.background = '#373e47';
    badgeEl.style.color = '#adbac7';
    statusDot.className = 'dtu-sniper-dot';
    statusText.textContent = 'Idle';

    addLog('Sniper stopped by user.', 'warn');
  };

  toggleBtn.addEventListener('click', () => {
    if (state.isRunning) {
      stopSniper();
    } else {
      startSniper();
    }
  });

  // Welcome Announcement
  sounds.beep();
  console.log(
    '%c🎯 DTU ExamSetu Seat Sniper Loaded! %c\nFloating HUD is attached to the top-right corner of your page.',
    'background: #f6c034; color: #14171c; font-weight: bold; font-size: 14px; padding: 4px 8px; border-radius: 4px;',
    'color: #adbac7; font-size: 12px;'
  );
})();
