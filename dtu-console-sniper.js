/**
 * ==============================================================================
 *  DTU ExamSetu — In-Browser Multi-Target Priority Seat Sniper (Console Edition)
 *  Target: https://exam-setu.dtu.ac.in/register/
 * ==============================================================================
 *  Features:
 *  - Priority Queue: Add multiple target courses ranked #1, #2, #3, etc.
 *  - Immediate Sniping: Snipes the highest-priority target with an available seat.
 *  - Dual Modes: "Direct Add (Empty Slot)" and "Auto-Swap (Drop Backup & Add)".
 *  - Atomic Swap Safety: Rolls back to backup course if target add fails.
 *  - Integrated Web Audio API: Piercing alarm on seat found & victory fanfare.
 *  - Zero Reloads & Cloudflare-Immune: Runs directly inside your authenticated Chrome tab.
 * ==============================================================================
 */

(function DTU_IN_BROWSER_SNIPER() {
  'use strict';

  // 1. Singleton Check: Remove any pre-existing HUD and styles
  const EXISTING_HUD = document.getElementById('dtu-sniper-hud');
  if (EXISTING_HUD) EXISTING_HUD.remove();
  const EXISTING_STYLE = document.getElementById('dtu-sniper-styles');
  if (EXISTING_STYLE) EXISTING_STYLE.remove();

  // 2. State & Storage Management
  const STORAGE_KEY = 'dtu_sniper_config_v2';
  let savedConfig = {};
  try {
    savedConfig = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '{}');
  } catch (_) {}

  // Ensure default targets array
  let initialTargets = [
    { code: '', slot: 'E1' }
  ];
  if (Array.isArray(savedConfig.targets) && savedConfig.targets.length > 0) {
    initialTargets = savedConfig.targets.map(t => ({
      code: (t.code || '').trim().toUpperCase(),
      slot: (t.slot || 'E1').trim().toUpperCase(),
    }));
  } else if (savedConfig.targetCode) {
    initialTargets = [{
      code: (savedConfig.targetCode || '').trim().toUpperCase(),
      slot: (savedConfig.targetSlot || 'E1').trim().toUpperCase(),
    }];
  }

  const state = {
    mode: savedConfig.mode || 'direct', // 'direct' | 'swap'
    targets: initialTargets,
    dropCode: (savedConfig.dropCode || '').trim().toUpperCase(),
    dropSlot: (savedConfig.dropSlot || 'E1').trim().toUpperCase(),
    intervalSec: parseFloat(savedConfig.intervalSec) || 1.5,
    isRunning: false,
    timer: null,
    checkCount: 0,
  };

  const saveState = () => {
    try {
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          mode: state.mode,
          targets: state.targets,
          dropCode: state.dropCode,
          dropSlot: state.dropSlot,
          intervalSec: state.intervalSec,
        })
      );
    } catch (_) {}
  };

  // 3. Web Audio API Sound Synthesizer (0 external files)
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
      let t = 0;
      for (let i = 0; i < 6; i++) {
        setTimeout(() => playTone(1200, 0.12, 'square', 0.3), t);
        setTimeout(() => playTone(880, 0.12, 'square', 0.3), t + 140);
        t += 280;
      }
    },
    victory: () => {
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
      width: 390px;
      max-height: calc(100vh - 36px);
      background: #14171c;
      color: #e5e7eb;
      border: 1px solid #2d333b;
      border-radius: 12px;
      box-shadow: 0 16px 36px rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(255, 255, 255, 0.07);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 13px;
      z-index: 9999999;
      user-select: none;
      overflow: hidden;
      display: flex;
      flex-direction: column;
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
      flex-shrink: 0;
    }
    .dtu-sniper-title {
      font-weight: 700;
      font-size: 13.5px;
      display: flex;
      align-items: center;
      gap: 7px;
      color: #f6c034;
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
      padding: 12px 14px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      overflow-y: auto;
      flex: 1;
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
      flex-shrink: 0;
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
      flex-shrink: 0;
    }
    .dtu-sniper-box-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .dtu-sniper-box-label {
      font-size: 10.5px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #768390;
    }
    .dtu-sniper-priority-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
      max-height: 140px;
      overflow-y: auto;
      padding-right: 2px;
    }
    .dtu-sniper-priority-list::-webkit-scrollbar,
    .dtu-sniper-log-area::-webkit-scrollbar,
    .dtu-sniper-body::-webkit-scrollbar {
      width: 5px;
    }
    .dtu-sniper-priority-list::-webkit-scrollbar-thumb,
    .dtu-sniper-log-area::-webkit-scrollbar-thumb,
    .dtu-sniper-body::-webkit-scrollbar-thumb {
      background: #373e47;
      border-radius: 4px;
    }
    .dtu-sniper-priority-row {
      display: flex;
      align-items: center;
      gap: 6px;
      background: #22272e;
      padding: 5px 8px;
      border-radius: 6px;
      border: 1px solid #2d333b;
      flex-shrink: 0;
    }
    .dtu-sniper-priority-tag {
      font-size: 11px;
      font-weight: 700;
      color: #f6c034;
      min-width: 22px;
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
      background: #161b22;
      border: 1px solid #373e47;
      color: #f0f6fc;
      border-radius: 6px;
      padding: 6px 8px;
      font-size: 12px;
      font-family: inherit;
      outline: none;
      transition: border-color 0.15s;
    }
    .dtu-sniper-input:focus, .dtu-sniper-select:focus {
      border-color: #f6c034;
    }
    .dtu-sniper-add-target-btn {
      background: #22272e;
      border: 1px dashed #373e47;
      color: #adbac7;
      border-radius: 6px;
      padding: 6px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      transition: all 0.15s;
    }
    .dtu-sniper-add-target-btn:hover {
      background: #2d333b;
      color: #f0f6fc;
      border-color: #f6c034;
    }
    .dtu-sniper-row-delete-btn {
      background: transparent;
      border: none;
      color: #f85149;
      cursor: pointer;
      font-size: 14px;
      padding: 2px 4px;
      border-radius: 4px;
      line-height: 1;
      transition: all 0.15s;
    }
    .dtu-sniper-row-delete-btn:hover {
      background: rgba(248, 81, 73, 0.15);
    }
    .dtu-sniper-status-card {
      background: #1c2128;
      border: 1px solid #2d333b;
      border-radius: 8px;
      padding: 10px 12px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      flex-shrink: 0;
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
      flex-shrink: 0;
    }
    .dtu-sniper-start {
      background: #f6c034;
      color: #14171c;
    }
    .dtu-sniper-start:hover {
      background: #e5b028;
      transform: translateY(-1px);
    }
    .dtu-sniper-stop {
      background: #da3633;
      color: #ffffff;
    }
    .dtu-sniper-stop:hover {
      background: #b62324;
      transform: translateY(-1px);
    }
    .dtu-sniper-log-wrapper {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-top: 2px;
    }
    .dtu-sniper-log-area {
      background: #090d13;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 8px 10px;
      height: 140px;
      max-height: 140px;
      overflow-y: auto;
      font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
      font-size: 11.5px;
      color: #c9d1d9;
      display: flex;
      flex-direction: column;
      gap: 3px;
      transition: height 0.2s, max-height 0.2s;
    }
    .dtu-sniper-log-area.expanded {
      height: 260px;
      max-height: 260px;
    }
    .dtu-sniper-log-entry {
      line-height: 1.45;
      word-break: break-all;
      padding: 2px 5px;
      border-radius: 4px;
      border-left: 2px solid transparent;
    }
    .dtu-sniper-log-entry:hover {
      background: rgba(255, 255, 255, 0.04);
    }
    .dtu-sniper-log-entry.info {
      color: #c9d1d9;
      border-left-color: #58a6ff;
    }
    .dtu-sniper-log-entry.success {
      color: #3fb950;
      font-weight: 600;
      background: rgba(46, 160, 67, 0.12);
      border-left-color: #2ea043;
    }
    .dtu-sniper-log-entry.warn {
      color: #f6c034;
      border-left-color: #d29922;
    }
    .dtu-sniper-log-entry.error {
      color: #f85149;
      font-weight: 600;
      background: rgba(248, 81, 73, 0.12);
      border-left-color: #f85149;
    }
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

      <!-- Target Courses Priority Queue Box -->
      <div class="dtu-sniper-box">
        <div class="dtu-sniper-box-header">
          <div class="dtu-sniper-box-label">🎯 Target Courses (Priority Order)</div>
          <span style="font-size: 10px; color: #f6c034;">Ranked #1, #2...</span>
        </div>
        <div class="dtu-sniper-priority-list" id="dtu-target-list">
          <!-- Dynamically Rendered Priority Rows -->
        </div>
        <button class="dtu-sniper-add-target-btn" id="dtu-add-target-btn">
          <span>+ Add Priority Target Course</span>
        </button>
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
        <span>▶ Start Priority Sniper</span>
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
        <div id="dtu-target-info" style="font-size: 11.5px; color: #adbac7; line-height: 1.4;">
          Targets: Configure courses above
        </div>
      </div>

      <!-- Activity Logs -->
      <div class="dtu-sniper-log-wrapper">
        <div style="display: flex; align-items: center; justify-content: space-between;">
          <div class="dtu-sniper-box-label">📋 Activity Log</div>
          <div style="display: flex; gap: 5px;">
            <button class="dtu-sniper-icon-btn" id="dtu-expand-log-btn" style="font-size: 11px; padding: 2px 7px; color: #adbac7; background: #22272e; border: 1px solid #373e47; border-radius: 4px;" title="Toggle Large Log View">⤢ Expand</button>
            <button class="dtu-sniper-icon-btn" id="dtu-clear-log-btn" style="font-size: 11px; padding: 2px 7px; color: #adbac7; background: #22272e; border: 1px solid #373e47; border-radius: 4px;" title="Clear Log Entries">🗑 Clear</button>
          </div>
        </div>
        <div class="dtu-sniper-log-area" id="dtu-log-area">
          <div class="dtu-sniper-log-entry info">Priority Sniper ready. Add target courses in priority order.</div>
        </div>
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
  const targetListContainer = document.getElementById('dtu-target-list');
  const addTargetBtn = document.getElementById('dtu-add-target-btn');
  const dropCodeInput = document.getElementById('drop-code-input');
  const dropSlotSelect = document.getElementById('drop-slot-select');
  const intervalInput = document.getElementById('interval-input');
  const toggleBtn = document.getElementById('dtu-toggle-btn');
  const statusDot = document.getElementById('dtu-status-dot');
  const statusText = document.getElementById('dtu-status-text');
  const checkCounter = document.getElementById('dtu-check-counter');
  const targetInfo = document.getElementById('dtu-target-info');
  const logArea = document.getElementById('dtu-log-area');
  const expandLogBtn = document.getElementById('dtu-expand-log-btn');
  const clearLogBtn = document.getElementById('dtu-clear-log-btn');

  // 7. Render Priority Targets Rows
  const renderTargets = () => {
    targetListContainer.innerHTML = '';
    const slots = ['E1', 'E2', 'E3', 'E4', 'E5'];

    state.targets.forEach((target, index) => {
      const row = document.createElement('div');
      row.className = 'dtu-sniper-priority-row';
      row.innerHTML = `
        <span class="dtu-sniper-priority-tag">#${index + 1}</span>
        <input type="text" class="dtu-sniper-input target-code-input" placeholder="Course Code" value="${target.code}" style="flex: 2;" data-idx="${index}" />
        <select class="dtu-sniper-select target-slot-select" style="flex: 1.3;" data-idx="${index}">
          ${slots.map(s => `<option value="${s}" ${target.slot === s ? 'selected' : ''}>Slot ${s}</option>`).join('')}
        </select>
        ${state.targets.length > 1 ? `<button class="dtu-sniper-row-delete-btn" data-idx="${index}" title="Remove Target">✕</button>` : ''}
      `;
      targetListContainer.appendChild(row);
    });

    // Wire up inputs
    targetListContainer.querySelectorAll('.target-code-input').forEach(input => {
      input.addEventListener('input', (e) => {
        const idx = parseInt(e.target.dataset.idx, 10);
        state.targets[idx].code = e.target.value.trim().toUpperCase();
        saveState();
        updateTargetSummary();
      });
    });

    targetListContainer.querySelectorAll('.target-slot-select').forEach(select => {
      select.addEventListener('change', (e) => {
        const idx = parseInt(e.target.dataset.idx, 10);
        state.targets[idx].slot = e.target.value;
        saveState();
        updateTargetSummary();
      });
    });

    targetListContainer.querySelectorAll('.dtu-sniper-row-delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.target.dataset.idx, 10);
        state.targets.splice(idx, 1);
        saveState();
        renderTargets();
        updateTargetSummary();
      });
    });

    updateTargetSummary();
  };

  const updateTargetSummary = () => {
    const valid = state.targets.filter(t => t.code);
    if (valid.length === 0) {
      targetInfo.innerHTML = `Targets: <span style="color:#768390;">Enter at least 1 target course code</span>`;
    } else {
      const list = valid.map((t, idx) => `#${idx + 1} <strong>${t.code}</strong> (${t.slot})`).join(' &gt; ');
      targetInfo.innerHTML = `Priority: ${list}`;
    }
  };

  addTargetBtn.addEventListener('click', () => {
    state.targets.push({ code: '', slot: 'E1' });
    saveState();
    renderTargets();
  });

  // Initial render
  renderTargets();

  // 8. Logger Helper
  const addLog = (msg, type = 'info') => {
    const time = new Date().toLocaleTimeString('en-IN', { hour12: false });
    const entry = document.createElement('div');
    entry.className = `dtu-sniper-log-entry ${type}`;
    entry.textContent = `[${time}] ${msg}`;
    logArea.prepend(entry);
    if (logArea.children.length > 35) {
      logArea.lastElementChild.remove();
    }
  };

  // 9. Draggable HUD Implementation
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

  // 10. UI Controls & Listeners
  collapseBtn.addEventListener('click', () => {
    hud.classList.toggle('dtu-sniper-collapsed');
    collapseBtn.textContent = hud.classList.contains('dtu-sniper-collapsed') ? '□' : '─';
  });

  closeBtn.addEventListener('click', () => {
    stopSniper();
    hud.remove();
    styleEl.remove();
  });

  if (expandLogBtn) {
    expandLogBtn.addEventListener('click', () => {
      logArea.classList.toggle('expanded');
      expandLogBtn.textContent = logArea.classList.contains('expanded') ? '⤡ Compact' : '⤢ Expand';
    });
  }

  if (clearLogBtn) {
    clearLogBtn.addEventListener('click', () => {
      logArea.innerHTML = '<div class="dtu-sniper-log-entry info">Activity log cleared. Sniper is still running...</div>';
    });
  }

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

  // 11. Resilient DOM Traversal & Selector Engine
  const normalize = (str) => (str || '').replace(/\s+/g, ' ').trim().toUpperCase();

  // Auto-clear filters if portal is currently filtering courses (e.g. "Showing 6 of 155 courses. Clear filters")
  const ensureFiltersCleared = () => {
    const hudEl = document.getElementById('dtu-sniper-hud');
    const clearBtn = Array.from(document.querySelectorAll('button, a, span')).find(el => {
      if (hudEl && hudEl.contains(el)) return false;
      return normalize(el.innerText) === 'CLEAR FILTERS';
    });
    if (clearBtn) {
      clearBtn.click();
      addLog('Clicked "Clear filters" so all 155 courses are visible in the DOM.', 'info');
      return true;
    }
    return false;
  };

  const findSlotSection = (slotName) => {
    const slotTarget = `SLOT ${slotName.toUpperCase()}`;
    const hudEl = document.getElementById('dtu-sniper-hud');
    const allHeaders = Array.from(document.querySelectorAll('div, button, section, header'));
    for (const el of allHeaders) {
      if (hudEl && hudEl.contains(el)) continue;
      if (normalize(el.innerText).includes(slotTarget)) {
        const container = el.closest('div[class*="slot"], section, div.border, div.rounded') || el.parentElement;
        return { header: el, container: container || el };
      }
    }
    return null;
  };

  const ensureSlotOpen = (slotName) => {
    const slotInfo = findSlotSection(slotName);
    if (!slotInfo) return false;
    const text = slotInfo.container.innerText;
    if (!text.includes('credits') && !text.includes('left') && !text.includes('Full')) {
      const clickable = slotInfo.header.querySelector('button') || slotInfo.header;
      clickable.click();
      return true;
    }
    return true;
  };

  // Find course row strictly within page content (NEVER inside HUD or left sidebar)
  const findCourseRow = (courseCode) => {
    const targetCode = normalize(courseCode);
    const hudEl = document.getElementById('dtu-sniper-hud');
    const allElements = Array.from(document.querySelectorAll('div, li, tr'));

    for (const el of allElements) {
      // 1. Strictly ignore HUD and its descendants
      if (hudEl && (el === hudEl || hudEl.contains(el))) continue;

      // 2. Strictly ignore left sidebar summary
      if (el.closest('aside, [class*="sidebar"]')) continue;

      const text = el.innerText || '';
      if (!text.includes(courseCode)) continue;

      // Must be a course row containing credits or seats
      if (text.includes('credits') || text.includes('left') || text.includes('Full')) {
        // Prevent matching high-level container wrapping multiple courses
        const codeTokens = (text.match(/\b[A-Z]{2,4}\d{3}[a-z]?\b/g) || []);
        if (codeTokens.includes(targetCode) && codeTokens.length === 1) {
          return el;
        }
      }
    }
    return null;
  };

  // Inspect course row for seat count and strictly verified registration status
  const inspectRow = (rowEl) => {
    if (!rowEl) return { status: 'not_found', seats: 0, addBtn: null, dropBtn: null, isAdded: false };

    const text = rowEl.innerText || '';
    let seats = 0;
    let isFull = /Full/i.test(text);
    const leftMatch = text.match(/(\d+)\s+left/i);
    if (leftMatch) {
      seats = parseInt(leftMatch[1], 10);
      isFull = false;
    }

    const buttons = Array.from(rowEl.querySelectorAll('button, a, input[type="button"], input[type="submit"]'));
    let addBtn = null;
    let dropBtn = null;

    buttons.forEach((btn) => {
      const btnText = normalize(btn.innerText || btn.value);
      if (btnText.includes('+ ADD') || btnText === 'ADD' || btnText === '+ADD' || btnText.includes('SELECT')) {
        addBtn = btn;
      }
      // Strict Drop button check: must be strictly 'DROP' or 'REMOVE'
      if (btnText === 'DROP' || btnText === 'REMOVE') {
        dropBtn = btn;
      }
    });

    // Strict Added verification: Must have a Drop button AND an explicit "Added" badge
    const hasAddedBadge = Array.from(rowEl.querySelectorAll('*')).some(b => {
      if (b.children.length > 0) return false;
      const t = b.innerText.trim();
      return t === 'Added' || t === '✓ Added';
    });

    const isAdded = !!dropBtn && hasAddedBadge;

    return { text, seats, isFull, isAdded, addBtn, dropBtn };
  };

  const findSidebarDropButton = (courseCode) => {
    const targetCode = normalize(courseCode);
    const hudEl = document.getElementById('dtu-sniper-hud');
    const sidebar = document.querySelector('div.sidebar, aside, [class*="sidebar"]') || document.body;
    const items = Array.from(sidebar.querySelectorAll('div, li'));

    for (const el of items) {
      if (hudEl && hudEl.contains(el)) continue;
      const text = normalize(el.innerText || '');
      if (text.includes(targetCode) && (text.includes('CR') || text.includes('CREDITS'))) {
        const btn = el.querySelector('button, span[class*="close"], svg, a');
        if (btn) return btn;
      }
    }
    return null;
  };

  // 12. Core Multi-Target Priority Sniping Loop
  let isExecutingAction = false;

  const performCheck = async () => {
    if (!state.isRunning || isExecutingAction) return;

    state.checkCount++;
    checkCounter.textContent = `${state.checkCount} checks`;

    const activeTargets = state.targets.filter(t => t.code);
    if (activeTargets.length === 0) return;

    let scanSummary = [];

    // Scan targets in priority order (#1 first, then #2, #3...)
    for (let i = 0; i < activeTargets.length; i++) {
      const target = activeTargets[i];
      const priorityLabel = `#${i + 1}`;

      ensureSlotOpen(target.slot);
      let row = findCourseRow(target.code);

      // If row not found, attempt to clear any active filters on the portal
      if (!row) {
        ensureFiltersCleared();
        ensureSlotOpen(target.slot);
        row = findCourseRow(target.code);
      }

      if (!row) {
        scanSummary.push(`${priorityLabel} ${target.code}: Row not found in ${target.slot}`);
        continue;
      }

      const info = inspectRow(row);

      // Check if target is already registered
      if (info.isAdded) {
        targetInfo.innerHTML = `<span style="color:#3fb950; font-weight:700;">🎉 ${target.code} is ALREADY Registered!</span>`;
        addLog(`Success! ${target.code} is registered in Slot ${target.slot}!`, 'success');
        sounds.victory();
        stopSniper();
        return;
      }

      // Check if seats opened on this target
      if (info.seats > 0 || info.addBtn) {
        isExecutingAction = true;
        sounds.foundSeat();
        addLog(`🔥 PRIORITY ${priorityLabel} HIT! Seat open for ${target.code} (${info.seats} left in Slot ${target.slot})!`, 'success');
        targetInfo.innerHTML = `<span style="color:#3fb950; font-weight:700;">🔥 HIT! Registering ${priorityLabel} ${target.code}...</span>`;

        await executeSnipeAction(target, info, priorityLabel);
        return;
      }

      scanSummary.push(`${priorityLabel} ${target.code}: Full`);
    }

    // If all targets are full, update summary
    targetInfo.innerHTML = scanSummary.join('<br>');
    if (state.checkCount % 10 === 0) {
      addLog(`Cycle ${state.checkCount}: All targets Full. Watching...`);
    }
  };

  // Execute Direct Add or Auto-Swap for the selected winning target
  const executeSnipeAction = async (target, info, priorityLabel) => {
    if (state.mode === 'direct') {
      // Mode 1: Direct Add
      if (info.addBtn) {
        info.addBtn.click();
        addLog(`Clicked [+ Add] on ${target.code}. Verifying...`, 'info');
        await handlePostAddVerification(target.code);
      } else {
        addLog(`Seat open for ${target.code} but [+ Add] missing. Slot may be occupied. Try Auto-Swap!`, 'error');
        sounds.error();
        isExecutingAction = false;
      }
    } else {
      // Mode 2: Auto-Swap
      addLog(`Auto-Swap triggered for ${priorityLabel} [${target.code}]: Dropping backup [${state.dropCode}] in Slot ${state.dropSlot}...`, 'warn');

      let dropSuccess = false;
      ensureSlotOpen(state.dropSlot);
      const dropRow = findCourseRow(state.dropCode);
      const dropInfo = inspectRow(dropRow);

      if (dropInfo.dropBtn) {
        dropInfo.dropBtn.click();
        dropSuccess = true;
        addLog(`Clicked [Drop] button on ${state.dropCode} in slot row.`, 'info');
      } else {
        const sidebarBtn = findSidebarDropButton(state.dropCode);
        if (sidebarBtn) {
          sidebarBtn.click();
          dropSuccess = true;
          addLog(`Clicked [✕] on ${state.dropCode} in sidebar.`, 'info');
        }
      }

      if (!dropSuccess) {
        addLog(`Failed to find drop button for ${state.dropCode}. Aborting swap to keep your course safe!`, 'error');
        sounds.error();
        isExecutingAction = false;
        return;
      }

      // Wait 350ms for slot to open & DOM to render +Add button
      await new Promise((r) => setTimeout(r, 350));

      ensureSlotOpen(target.slot);
      const refreshedTargetRow = findCourseRow(target.code);
      const refreshedInfo = inspectRow(refreshedTargetRow);

      if (refreshedInfo.addBtn) {
        refreshedInfo.addBtn.click();
        addLog(`Slot open! Clicked [+ Add] on target [${target.code}]. Verifying...`, 'success');
        await handlePostAddVerification(target.code, state.dropCode);
      } else {
        // Seat taken in the split-second gap — Emergency Rollback!
        addLog(`Target [+ Add] unavailable after drop! Executing EMERGENCY RESTORE on [${state.dropCode}]...`, 'error');
        sounds.error();
        await executeRollback(state.dropCode, state.dropSlot);
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

  // 13. Start / Stop Engine
  const startSniper = () => {
    const validTargets = state.targets.filter(t => t.code);
    if (validTargets.length === 0) {
      alert('Please enter at least one target Course Code (e.g. EP322n)');
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
    toggleBtn.innerHTML = '<span>⏹ Stop Priority Sniper</span>';
    badgeEl.textContent = 'SNIPING';
    badgeEl.style.background = '#238636';
    badgeEl.style.color = '#fff';
    statusDot.className = 'dtu-sniper-dot active';
    statusText.textContent = `Active (${validTargets.length} targets)`;

    sounds.click();
    addLog(`Priority Sniper started on ${validTargets.length} targets | Mode: ${state.mode}`, 'info');

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
    toggleBtn.innerHTML = '<span>▶ Start Priority Sniper</span>';
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

  sounds.beep();
  console.log(
    '%c🎯 DTU ExamSetu Priority Seat Sniper Loaded! %c\nFloating HUD is attached to the top-right corner of your page.',
    'background: #f6c034; color: #14171c; font-weight: bold; font-size: 14px; padding: 4px 8px; border-radius: 4px;',
    'color: #adbac7; font-size: 12px;'
  );
})();
