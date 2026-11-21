(function DTU_IN_BROWSER_SNIPER() {
  'use strict';

  // ============================================================================
  // 1. SINGLETON GUARD & CLEANUP
  // ============================================================================
  const HUD_ID = 'dtu-sniper-hud';
  const STYLE_ID = 'dtu-sniper-styles';
  const STORAGE_KEY = 'dtu_examsetu_sniper_cfg_v3';
  const CLEANUP_KEY = '__DTU_EXAMSETU_SNIPER_CLEANUP__';

  try {
    if (typeof window[CLEANUP_KEY] === 'function') {
      window[CLEANUP_KEY]();
    }
    if (window.__examSetuSeatMonitor && typeof window.__examSetuSeatMonitor.stop === 'function') {
      window.__examSetuSeatMonitor.stop();
    }
    const oldHud = document.getElementById(HUD_ID);
    if (oldHud) oldHud.remove();
    const oldStyle = document.getElementById(STYLE_ID);
    if (oldStyle) oldStyle.remove();
  } catch (err) {
    console.warn('[DTU Sniper] Cleanup warning:', err);
  }

  // ============================================================================
  // 2. CONFIGURATION & STATE
  // ============================================================================
  const DEFAULT_CONFIG = {
    mode: 'swap', // 'direct' | 'swap'
    backupCode: 'IT310',
    backupSlot: 'E4',
    targets: [
      { code: 'HU328', slot: 'E2' },
      { code: 'HU426', slot: 'E4' },
      { code: 'HU308', slot: 'E4' },
      { code: 'HU404', slot: 'E4' },
      { code: 'HU306', slot: 'E1' },
      { code: 'HU326', slot: 'E1' },
      { code: 'HU326', slot: 'E5' }
    ],
    pollMs: 900,
    soundEnabled: true,
    autoExpand: true,
    autoClearFilters: true,
    collapsed: false,
    logExpanded: false,
    pos: { left: null, top: 16 }
  };

  function loadConfig() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
      const parsed = JSON.parse(raw);
      const merged = Object.assign({}, DEFAULT_CONFIG, parsed);
      if (!Array.isArray(merged.targets) || merged.targets.length === 0) {
        merged.targets = JSON.parse(JSON.stringify(DEFAULT_CONFIG.targets));
      }
      merged.pollMs = Math.max(500, Math.min(5000, Number(merged.pollMs) || 900));
      if (!merged.pos || typeof merged.pos !== 'object') {
        merged.pos = { left: null, top: 16 };
      }
      return merged;
    } catch (_) {
      return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    }
  }

  function saveConfig() {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    } catch (_) {}
  }

  const config = loadConfig();

  const state = {
    running: false,
    acting: false,
    timerId: null,
    observer: null,
    mutationScheduled: false,
    attempted: new Set(),
    checks: 0,
    mutations: 0,
    lastFilterClearAt: 0,
    lastAccordionExpandAt: 0,
    status: 'IDLE', // IDLE | SCANNING | SWAPPING | CLAIMED | ROLLBACK | ERROR
    destroyed: false,
    logEntries: []
  };

  // ============================================================================
  // 3. ZERO-DEPENDENCY WEB AUDIO API SYNTHESIZER
  // ============================================================================
  const AudioEngine = (function createAudioEngine() {
    let ctx = null;

    function getContext() {
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return null;
        if (!ctx) ctx = new AudioCtx();
        if (ctx.state === 'suspended') {
          ctx.resume().catch(() => {});
        }
        return ctx;
      } catch (_) {
        return null;
      }
    }

    function playTone(freq, startOffset, duration, type, gainPeak) {
      try {
        const c = getContext();
        if (!c) return;
        const now = c.currentTime + startOffset;
        const osc = c.createOscillator();
        const gain = c.createGain();
        osc.type = type || 'sine';
        osc.frequency.setValueAtTime(freq, now);

        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(gainPeak || 0.18, now + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

        osc.connect(gain);
        gain.connect(c.destination);
        osc.start(now);
        osc.stop(now + duration + 0.02);
      } catch (_) {}
    }

    return {
      unlock() {
        getContext();
      },
      playSeatFound() {
        if (!config.soundEnabled) return;
        const pattern = [
          [1174.66, 0.00, 0.11],
          [1567.98, 0.12, 0.11],
          [1174.66, 0.24, 0.11],
          [1567.98, 0.36, 0.11],
          [1760.00, 0.48, 0.18]
        ];
        pattern.forEach(([f, t, d]) => playTone(f, t, d, 'square', 0.14));
      },
      playVictory() {
        if (!config.soundEnabled) return;
        const notes = [
          [523.25, 0.00, 0.16],
          [659.25, 0.14, 0.16],
          [783.99, 0.28, 0.16],
          [1046.50, 0.42, 0.45]
        ];
        notes.forEach(([f, t, d]) => playTone(f, t, d, 'triangle', 0.22));
        playTone(523.25, 0.42, 0.45, 'sine', 0.10);
        playTone(783.99, 0.42, 0.45, 'sine', 0.10);
      },
      playError() {
        if (!config.soundEnabled) return;
        try {
          const c = getContext();
          if (!c) return;
          const now = c.currentTime;
          const osc = c.createOscillator();
          const gain = c.createGain();
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(250, now);
          osc.frequency.exponentialRampToValueAtTime(95, now + 0.38);

          gain.gain.setValueAtTime(0.0001, now);
          gain.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.40);

          osc.connect(gain);
          gain.connect(c.destination);
          osc.start(now);
          osc.stop(now + 0.42);
        } catch (_) {}
      },
      playTest() {
        getContext();
        const notes = [
          [523.25, 0.00, 0.10],
          [659.25, 0.10, 0.10],
          [783.99, 0.20, 0.10],
          [1046.50, 0.30, 0.22]
        ];
        notes.forEach(([f, t, d]) => playTone(f, t, d, 'triangle', 0.18));
      },
      close() {
        try {
          if (ctx && typeof ctx.close === 'function') {
            ctx.close().catch(() => {});
          }
          ctx = null;
        } catch (_) {}
      }
    };
  })();

  // ============================================================================
  // 4. EXACT EXAMSETU DOM SELECTORS & UTILITIES (FIXED FOR SWAP MODE)
  // ============================================================================
  function normalizeCode(raw) {
    return String(raw || '').trim().toUpperCase().replace(/\s+/g, '');
  }

  function isInsideHud(el) {
    if (!el) return false;
    const node = el.nodeType === 1 ? el : el.parentElement;
    return Boolean(node && node.closest && node.closest('#' + HUD_ID));
  }

  function isVisible(el) {
    if (!el || el.nodeType !== 1) return false;
    try {
      const style = window.getComputedStyle(el);
      if (!style || style.display === 'none' || style.visibility === 'hidden') {
        return false;
      }
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    } catch (_) {
      return false;
    }
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function safeClick(el) {
    if (!el) return false;
    try {
      el.click();
      return true;
    } catch (_) {
      try {
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        return true;
      } catch (__) {
        return false;
      }
    }
  }

  /**
   * Resilient row lookup: First checks li.f-slat containing .f-code matching courseCode.
   * If not found, falls back to searching any course card element with matching code and credits.
   */
  function rowsFor(courseCode) {
    const norm = normalizeCode(courseCode);
    if (!norm) return [];
    const results = [];
    try {
      // 1. Primary: li.f-slat with .f-code
      const slats = document.querySelectorAll('li.f-slat');
      for (let i = 0; i < slats.length; i++) {
        const row = slats[i];
        if (isInsideHud(row)) continue;
        const codeEl = row.querySelector('.f-code');
        if (codeEl && normalizeCode(codeEl.textContent) === norm) {
          results.push(row);
        }
      }
      if (results.length > 0) return results;

      // 2. Resilient fallback for portal variations
      const codeRegex = new RegExp('\\b' + norm + '\\b', 'i');
      const allRows = document.querySelectorAll('div, li, tr');
      for (let i = 0; i < allRows.length; i++) {
        const el = allRows[i];
        if (isInsideHud(el)) continue;
        if (el.closest('aside, [class*="sidebar"]')) continue;
        const text = el.innerText || '';
        if (!codeRegex.test(text)) continue;
        if (/credit|cr/i.test(text) && (/left|Full|Notif|Add|Drop|Added/i.test(text))) {
          const codes = (text.match(/\b[A-Z]{2,4}\d{3}[a-z]?\b/gi) || []);
          if (codes.length <= 2) {
            results.push(el);
          }
        }
      }
      if (results.length > 0) {
        results.sort((a, b) => a.innerText.length - b.innerText.length);
        return [results[0]];
      }
    } catch (_) {}
    return results;
  }

  /**
   * Exact ExamSetu selected check:
   * Checks sidebar registered list, in-row "✓ Added" / Drop button, and aria-labels.
   */
  function isSelected(courseCode) {
    const norm = normalizeCode(courseCode);
    if (!norm) return false;
    const expected = 'DROP ' + norm;
    const codeRegex = new RegExp('\\b' + norm + '\\b', 'i');

    try {
      // 1. Check sidebar: is it listed under elective courses?
      const sidebar = document.querySelector('div.sidebar, aside, [class*="sidebar"]') || document.body;
      const sidebarItems = sidebar.querySelectorAll('div, li, tr');
      for (let i = 0; i < sidebarItems.length; i++) {
        const el = sidebarItems[i];
        if (isInsideHud(el)) continue;
        const txt = el.innerText || '';
        if (codeRegex.test(txt) && /cr|credit/i.test(txt)) {
          return true;
        }
      }

      // 2. Check row: does it have Drop button or Added badge?
      const rows = rowsFor(norm);
      for (let r = 0; r < rows.length; r++) {
        const text = (rows[r].innerText || rows[r].textContent || '').toLowerCase();
        if (text.includes('added') || text.includes('✓ added')) return true;
        const btns = rows[r].querySelectorAll('button, [role="button"]');
        for (let b = 0; b < btns.length; b++) {
          const btnTxt = (btns[b].textContent || '').trim();
          if (/^(?:drop|remove)$/i.test(btnTxt)) return true;
        }
      }

      // 3. Check any button matching aria-label="Drop CODE" or text="Drop CODE"
      const buttons = document.querySelectorAll('button');
      for (let i = 0; i < buttons.length; i++) {
        const btn = buttons[i];
        if (isInsideHud(btn)) continue;
        const label = (btn.getAttribute('aria-label') || btn.textContent || '').trim().toUpperCase();
        if (label === expected) return true;
      }
    } catch (_) {}
    return false;
  }

  /**
   * Drop button lookup:
   * 1. Checks left sidebar item close button (always visible & accessible even if slot is collapsed).
   * 2. Checks in-row Drop button inside matching course row.
   * 3. Checks global button with aria-label or text matching "Drop CODE".
   */
  function dropButtonFor(courseCode) {
    const norm = normalizeCode(courseCode);
    if (!norm) return null;
    const expected = 'DROP ' + norm;
    const codeRegex = new RegExp('\\b' + norm + '\\b', 'i');

    try {
      // 1. Check sidebar close button (top priority - works across all slots without scrolling)
      const sidebar = document.querySelector('div.sidebar, aside, [class*="sidebar"]') || document.body;
      const sidebarItems = sidebar.querySelectorAll('div, li, tr');
      for (let i = 0; i < sidebarItems.length; i++) {
        const item = sidebarItems[i];
        if (isInsideHud(item)) continue;
        const txt = item.innerText || '';
        if (codeRegex.test(txt) && /cr|credit/i.test(txt)) {
          const btn = item.querySelector('button, span[class*="close"], svg, a');
          if (btn && isVisible(btn)) return btn;
        }
      }

      // 2. Check course row Drop button
      const rows = rowsFor(norm);
      for (let r = 0; r < rows.length; r++) {
        const btns = rows[r].querySelectorAll('button, [role="button"]');
        for (let b = 0; b < btns.length; b++) {
          const btn = btns[b];
          if (btn.disabled) continue;
          const txt = (btn.textContent || '').trim();
          const aria = (btn.getAttribute('aria-label') || '').trim().toUpperCase();
          if (aria === expected || /^(?:drop|remove)$/i.test(txt) || txt === 'DROP') {
            if (isVisible(btn)) return btn;
          }
        }
      }

      // 3. Fallback: check any button on the page
      const buttons = document.querySelectorAll('button');
      for (let i = 0; i < buttons.length; i++) {
        const btn = buttons[i];
        if (isInsideHud(btn) || btn.disabled) continue;
        const aria = (btn.getAttribute('aria-label') || '').trim().toUpperCase();
        const txt = (btn.textContent || '').trim().toUpperCase();
        if (aria === expected || txt === expected) {
          if (isVisible(btn)) return btn;
        }
      }
    } catch (_) {}
    return null;
  }

  /**
   * Add button lookup:
   * Matches button in matching course row where text is "+ Add" / "Add" OR aria-label is "Add CODE".
   */
  function addButtonFor(courseCode) {
    const norm = normalizeCode(courseCode);
    if (!norm) return null;
    const expectedAria = 'ADD ' + norm;
    const rows = rowsFor(norm);

    for (let r = 0; r < rows.length; r++) {
      const buttons = rows[r].querySelectorAll('button, [role="button"]');
      for (let b = 0; b < buttons.length; b++) {
        const btn = buttons[b];
        if (btn.disabled || btn.getAttribute('aria-disabled') === 'true') continue;
        const txt = (btn.textContent || '').trim();
        const aria = (btn.getAttribute('aria-label') || '').trim().toUpperCase();
        if (aria === expectedAria || /^(?:\+?\s*add|select)$/i.test(txt)) {
          return btn;
        }
      }
    }
    return null;
  }

  /**
   * Inspect course status and seat availability
   */
  function inspectCourse(courseCode) {
    const norm = normalizeCode(courseCode);
    const rows = rowsFor(norm);
    const selected = isSelected(norm);
    const addBtn = addButtonFor(norm);

    if (rows.length === 0) {
      return {
        code: norm,
        found: false,
        selected,
        seats: null,
        isFull: false,
        addBtn: null
      };
    }

    let seats = null;
    let isFull = false;

    for (let i = 0; i < rows.length; i++) {
      const rawText = (rows[i].textContent || '').replace(/\s+/g, ' ').trim();
      const leftMatch = rawText.match(/\b(\d+)\s*(?:seat(?:s)?\s*)?(?:left|available|remaining)\b/i);
      if (leftMatch) {
        const parsed = parseInt(leftMatch[1], 10);
        if (seats === null || parsed > seats) seats = parsed;
      }
      const cleanedForFull = rawText.replace(/\bslot\s+full\b/gi, '');
      if (/\b0\s*(?:seat(?:s)?\s*)?left\b/i.test(cleanedForFull) || /\bfull\b/i.test(cleanedForFull)) {
        isFull = true;
      }
    }

    if (seats !== null && seats > 0) {
      isFull = false;
    }

    return {
      code: norm,
      found: true,
      selected,
      seats,
      isFull,
      addBtn
    };
  }

  function tryClearFilters() {
    if (!config.autoClearFilters) return false;
    const now = Date.now();
    if (now - state.lastFilterClearAt < 2500) return false;

    try {
      const clickables = document.querySelectorAll('button, a, [role="button"]');
      for (let i = 0; i < clickables.length; i++) {
        const el = clickables[i];
        if (isInsideHud(el) || el.disabled || !isVisible(el)) continue;
        const txt = (el.textContent || '').trim();
        if (/^(?:clear\s+filters?|reset\s+filters?|show\s+all)$/i.test(txt)) {
          state.lastFilterClearAt = now;
          safeClick(el);
          log('warn', 'Clicked "' + txt + '" to reveal hidden courses.');
          return true;
        }
      }
    } catch (_) {}
    return false;
  }

  function tryExpandAccordions(targetSlots) {
    if (!config.autoExpand) return 0;
    const now = Date.now();
    if (now - state.lastAccordionExpandAt < 2000) return 0;

    let expandedCount = 0;
    const slotFilters = (targetSlots || [])
      .map((s) => String(s || '').trim().toUpperCase())
      .filter(Boolean);

    try {
      const detailsList = document.querySelectorAll('details:not([open])');
      detailsList.forEach((det) => {
        if (isInsideHud(det)) return;
        const summary = det.querySelector('summary');
        const txt = (summary ? summary.textContent : det.textContent || '').trim();
        if (!/slot\s*[a-z0-9]+/i.test(txt)) return;
        if (slotFilters.length === 0 || slotFilters.some((sf) => txt.toUpperCase().includes(sf))) {
          det.open = true;
          if (summary) safeClick(summary);
          expandedCount++;
        }
      });

      const triggers = document.querySelectorAll('[aria-expanded="false"]');
      for (let i = 0; i < triggers.length; i++) {
        const el = triggers[i];
        if (isInsideHud(el) || !isVisible(el)) continue;
        const txt = (el.textContent || '').trim();
        if (!/\bslot\s*[a-z]?\d+\b/i.test(txt)) continue;
        if (slotFilters.length === 0 || slotFilters.some((sf) => txt.toUpperCase().includes(sf))) {
          safeClick(el);
          expandedCount++;
        }
      }
    } catch (_) {}

    if (expandedCount > 0) {
      state.lastAccordionExpandAt = now;
      log('info', 'Expanded ' + expandedCount + ' collapsed slot accordion(s).');
    }
    return expandedCount;
  }

  async function confirmModalIfPresent() {
    for (let attempt = 0; attempt < 8; attempt++) {
      await sleep(60);
      try {
        const modals = document.querySelectorAll('[role="dialog"], [class*="modal" i], [class*="dialog" i]');
        for (let i = 0; i < modals.length; i++) {
          const modal = modals[i];
          if (isInsideHud(modal) || !isVisible(modal)) continue;
          const btns = modal.querySelectorAll('button, [role="button"]');
          for (let j = 0; j < btns.length; j++) {
            const btn = btns[j];
            if (btn.disabled || !isVisible(btn)) continue;
            const txt = (btn.textContent || '').trim();
            if (/^(?:confirm|yes|yes,\s*drop|drop|remove|ok)$/i.test(txt)) {
              safeClick(btn);
              log('info', 'Auto-confirmed dialog ("' + txt + '").');
              return true;
            }
          }
        }
      } catch (_) {}
    }
    return false;
  }

  async function waitForSelectedState(courseCode, expectedState, timeoutMs) {
    const deadline = Date.now() + (timeoutMs || 2500);
    while (Date.now() < deadline && !state.destroyed) {
      if (isSelected(courseCode) === expectedState) return true;
      await sleep(45);
    }
    return false;
  }

  // ============================================================================
  // 5. CORE SNIPING ENGINE (FIXED SWAP FLOW)
  // ============================================================================
  function setStatus(newStatus) {
    state.status = newStatus;
    updateStatusUI();
  }

  async function executeDirectAdd(target, addBtn, seats) {
    state.acting = true;
    state.attempted.add(target.code);
    setStatus('SWAPPING');

    try {
      AudioEngine.playSeatFound();
      log(
        'success',
        'SEAT OPEN on ' + target.code + (seats !== null ? ' (' + seats + ' left)' : '') + '! Clicking Add immediately...'
      );
      safeClick(addBtn);

      const confirmed = await waitForSelectedState(target.code, true, 2600);
      if (confirmed) {
        AudioEngine.playVictory();
        log('success', 'REGISTERED ' + target.code + ' (Drop button verified)! Monitoring stopped.');
        setStatus('CLAIMED');
        stopSniper(true);
        return true;
      }

      AudioEngine.playError();
      log('warn', target.code + ' was not confirmed selected (seat may have been taken). Watching for next opening...');
      setStatus('SCANNING');
      setTimeout(() => {
        if (!addButtonFor(target.code)) {
          state.attempted.delete(target.code);
        }
      }, 1200);
      return false;
    } catch (err) {
      AudioEngine.playError();
      log('error', 'Direct Add error for ' + target.code + ': ' + err.message);
      setStatus('SCANNING');
      state.attempted.delete(target.code);
      return false;
    } finally {
      state.acting = false;
    }
  }

  async function executeEmergencyRollback(backupCode, backupSlot) {
    setStatus('ROLLBACK');
    log('error', 'EMERGENCY ROLLBACK: Re-adding backup ' + backupCode + ' immediately!');
    AudioEngine.playError();

    for (let attempt = 1; attempt <= 8; attempt++) {
      try {
        if (isSelected(backupCode)) {
          log('success', 'ROLLBACK VERIFIED: Backup ' + backupCode + ' is registered.');
          return true;
        }

        let backupAddBtn = addButtonFor(backupCode);
        if (!backupAddBtn) {
          tryClearFilters();
          tryExpandAccordions(backupSlot ? [backupSlot] : []);
          await sleep(140);
          backupAddBtn = addButtonFor(backupCode);
        }

        if (backupAddBtn) {
          safeClick(backupAddBtn);
          const restored = await waitForSelectedState(backupCode, true, 1800);
          if (restored) {
            log('success', 'ROLLBACK COMPLETE: Backup ' + backupCode + ' restored safely.');
            return true;
          }
        }
      } catch (err) {
        log('error', 'Rollback attempt #' + attempt + ' error: ' + err.message);
      }
      await sleep(180);
    }

    log('error', 'CRITICAL: Could not verify rollback of ' + backupCode + '. Check your registered courses manually!');
    return false;
  }

  async function executeAtomicSwap(target, info) {
    const backupCode = normalizeCode(config.backupCode);
    const backupSlot = String(config.backupSlot || '').trim();

    if (!backupCode) {
      log('error', 'Auto-Swap requires a Backup Course Code! Stopping sniper.');
      AudioEngine.playError();
      stopSniper(false);
      return false;
    }

    if (target.code === backupCode) {
      return false;
    }

    // Strict Atomic Safety: NEVER drop backup unless target has seats > 0 or Add is enabled
    const confirmedOpen = !info.isFull && ((info.seats !== null && info.seats > 0) || Boolean(info.addBtn));
    if (!confirmedOpen) {
      return false;
    }

    state.acting = true;
    state.attempted.add(target.code);
    setStatus('SWAPPING');

    let backupWasDropped = false;

    try {
      AudioEngine.playSeatFound();
      log(
        'success',
        'SEAT CONFIRMED on ' +
          target.code +
          (info.seats !== null ? ' (' + info.seats + ' left)' : ' (Add enabled)') +
          '! Atomic Swap: Drop ' +
          backupCode +
          ' -> Add ' +
          target.code
      );

      // Step 1: Locate Backup Drop button (sidebar or course row)
      let dropBtn = dropButtonFor(backupCode);
      if (!dropBtn && backupSlot) {
        tryExpandAccordions([backupSlot]);
        await sleep(100);
        dropBtn = dropButtonFor(backupCode);
      }

      if (!dropBtn) {
        if (!isSelected(backupCode) && info.addBtn) {
          log('warn', 'Backup ' + backupCode + ' is not selected; clicking Add on ' + target.code + ' directly.');
          safeClick(info.addBtn);
          const directOk = await waitForSelectedState(target.code, true, 2500);
          if (directOk) {
            AudioEngine.playVictory();
            log('success', 'REGISTERED ' + target.code + ' successfully!');
            setStatus('CLAIMED');
            stopSniper(true);
            return true;
          }
          AudioEngine.playError();
          setStatus('SCANNING');
          setTimeout(() => state.attempted.delete(target.code), 1500);
          return false;
        }

        log('error', 'Could not find Drop button for ' + backupCode + '. Swap aborted safely (no changes made).');
        AudioEngine.playError();
        setStatus('SCANNING');
        setTimeout(() => state.attempted.delete(target.code), 2000);
        return false;
      }

      // Step 2: Click Drop on backup course
      safeClick(dropBtn);
      log('info', 'Clicked Drop on ' + backupCode + '. Waiting for server to release slot...');
      await confirmModalIfPresent();

      // Step 3: Wait until backup is actually dropped (!isSelected)
      const dropped = await waitForSelectedState(backupCode, false, 2800);
      if (!dropped) {
        log('warn', 'Drop for ' + backupCode + ' did not complete in time; backup is still intact. Resuming scan.');
        AudioEngine.playError();
        setStatus('SCANNING');
        setTimeout(() => state.attempted.delete(target.code), 1500);
        return false;
      }

      backupWasDropped = true;
      log('info', 'Backup ' + backupCode + ' dropped! Claiming target ' + target.code + '...');

      // Brief settle so ExamSetu re-enables Add buttons in the freed slot
      await sleep(100);

      // Step 4: Ensure target slot is open and find Add button
      if (target.slot) {
        tryExpandAccordions([target.slot]);
      }

      let freshAddBtn = null;
      const addWaitDeadline = Date.now() + 2000;
      while (Date.now() < addWaitDeadline && !state.destroyed) {
        freshAddBtn = addButtonFor(target.code);
        if (freshAddBtn) break;
        const freshInfo = inspectCourse(target.code);
        if (freshInfo.found && freshInfo.isFull) break;
        await sleep(40);
      }

      if (freshAddBtn) {
        safeClick(freshAddBtn);
        log('info', 'Clicked "Add ' + target.code + '". Verifying registration...');

        // Step 5: Verify target registration (checks sidebar & row)
        const registered = await waitForSelectedState(target.code, true, 2800);
        if (registered) {
          AudioEngine.playVictory();
          log('success', 'ATOMIC SWAP SUCCEEDED! Registered ' + target.code + ' (dropped ' + backupCode + ').');
          setStatus('CLAIMED');
          stopSniper(true);
          return true;
        }
      } else {
        log('warn', '"Add ' + target.code + '" did not become available after dropping ' + backupCode + '.');
      }

      // Step 6: Target was sniped in the split-second gap -> Emergency Rollback!
      await executeEmergencyRollback(backupCode, backupSlot);
      setStatus('SCANNING');
      setTimeout(() => state.attempted.delete(target.code), 1800);
      return false;
    } catch (err) {
      log('error', 'Atomic Swap exception: ' + err.message);
      if (backupWasDropped || !isSelected(backupCode)) {
        await executeEmergencyRollback(backupCode, backupSlot);
      }
      setStatus('SCANNING');
      setTimeout(() => state.attempted.delete(target.code), 1800);
      return false;
    } finally {
      state.acting = false;
    }
  }

  async function scan(triggerSource) {
    if (!state.running || state.destroyed || state.acting) return;

    const backupCode = normalizeCode(config.backupCode);
    const activeTargets = config.targets
      .map((t, idx) => ({
        priority: idx + 1,
        code: normalizeCode(t.code),
        slot: String(t.slot || '').trim()
      }))
      .filter((t) => t.code.length > 0);

    if (activeTargets.length === 0) {
      log('warn', 'No target courses configured. Add at least one code to scan.');
      stopSniper(false);
      return;
    }

    if (triggerSource === 'poll') {
      state.checks++;
    } else {
      state.mutations++;
    }
    updateCheckCounterUI();

    let missingCount = 0;
    const missingSlots = [];

    try {
      for (let i = 0; i < activeTargets.length; i++) {
        const target = activeTargets[i];

        if (config.mode === 'swap' && target.code === backupCode) {
          continue;
        }

        if (isSelected(target.code)) {
          AudioEngine.playVictory();
          log('success', target.code + ' is already selected. Monitoring stopped.');
          setStatus('CLAIMED');
          stopSniper(true);
          return;
        }

        const info = inspectCourse(target.code);
        if (!info.found) {
          missingCount++;
          if (target.slot) missingSlots.push(target.slot);
          state.attempted.delete(target.code);
          continue;
        }

        if (config.mode === 'direct') {
          if (!info.addBtn) {
            state.attempted.delete(target.code);
            continue;
          }
          if (!state.attempted.has(target.code)) {
            await executeDirectAdd(target, info.addBtn, info.seats);
            return;
          }
        } else {
          // Auto-Swap mode: trigger on open seat (seats > 0 or enabled Add)
          const seatConfirmed = !info.isFull && ((info.seats !== null && info.seats > 0) || Boolean(info.addBtn));
          if (!seatConfirmed) {
            state.attempted.delete(target.code);
            continue;
          }
          if (!state.attempted.has(target.code)) {
            await executeAtomicSwap(target, info);
            return;
          }
        }
      }

      if (triggerSource === 'poll' && missingCount > 0) {
        const cleared = tryClearFilters();
        const expanded = tryExpandAccordions(missingSlots);
        if (!cleared && expanded === 0 && state.checks % 15 === 1) {
          log('warn', missingCount + ' target(s) not found. Check course code or expand its slot.');
        }
      }
    } catch (err) {
      log('error', 'Scan error: ' + err.message);
    }
  }

  function startObserver() {
    stopObserver();
    try {
      state.observer = new MutationObserver((mutations) => {
        if (!state.running || state.destroyed || state.acting) return;

        let hasPortalChange = false;
        for (let i = 0; i < mutations.length; i++) {
          if (!isInsideHud(mutations[i].target)) {
            hasPortalChange = true;
            break;
          }
        }
        if (!hasPortalChange) return;

        if (!state.mutationScheduled) {
          state.mutationScheduled = true;
          queueMicrotask(() => {
            state.mutationScheduled = false;
            scan('mutation');
          });
        }
      });

      state.observer.observe(document.documentElement, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true
      });
    } catch (err) {
      log('warn', 'MutationObserver unavailable (' + err.message + '); using polling fallback.');
    }
  }

  function stopObserver() {
    if (state.observer) {
      try {
        state.observer.disconnect();
      } catch (_) {}
      state.observer = null;
    }
    state.mutationScheduled = false;
  }

  function scheduleNextPoll() {
    if (!state.running || state.destroyed) return;
    state.timerId = setTimeout(async () => {
      if (!state.running || state.destroyed) return;
      await scan('poll');
      scheduleNextPoll();
    }, config.pollMs);
  }

  function startSniper() {
    if (state.running) return;
    AudioEngine.unlock();

    const validTargets = config.targets
      .map((t) => normalizeCode(t.code))
      .filter(Boolean);

    if (validTargets.length === 0) {
      log('warn', 'Enter at least one Target Course Code (e.g. HU328, HU426, EE312n) first.');
      AudioEngine.playError();
      return;
    }

    const backupCode = normalizeCode(config.backupCode);
    if (config.mode === 'swap' && !backupCode) {
      log('warn', 'Auto-Swap mode requires a Backup Course Code (e.g. IT310).');
      AudioEngine.playError();
      return;
    }

    state.running = true;
    state.attempted.clear();
    setStatus('SCANNING');

    if (config.mode === 'swap') {
      const hasDrop = Boolean(dropButtonFor(backupCode));
      log(
        hasDrop ? 'info' : 'warn',
        'Pre-flight: Backup ' + backupCode + (hasDrop ? ' Drop button READY.' : ' Drop button not in view yet (will scan sidebar).')
      );
    }

    log(
      'info',
      'Watching [' +
        validTargets.join(', ') +
        '] in ' +
        (config.mode === 'swap' ? 'AUTO-SWAP (backup: ' + backupCode + ')' : 'DIRECT ADD') +
        ' mode (Live Observer + ' +
        (config.pollMs / 1000).toFixed(1) +
        's poll).'
    );
    updateControlsUI();

    startObserver();
    scan('poll').then(() => {
      scheduleNextPoll();
    });
  }

  function stopSniper(keepStatus) {
    state.running = false;
    stopObserver();
    if (state.timerId) {
      clearTimeout(state.timerId);
      state.timerId = null;
    }
    if (!keepStatus) {
      setStatus('IDLE');
      log('info', 'Sniper stopped.');
    }
    updateControlsUI();
  }

  // ============================================================================
  // 6. FLOATING HUD STYLES & CONSTRUCTION
  // ============================================================================
  const CSS = `
    #${HUD_ID} {
      position: fixed;
      top: 16px;
      right: 16px;
      width: 376px;
      max-width: calc(100vw - 24px);
      background: #14171c;
      color: #e6edf3;
      border: 1px solid #2d333b;
      border-radius: 10px;
      box-shadow: 0 14px 40px rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(246, 192, 52, 0.14);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, sans-serif;
      font-size: 12px;
      line-height: 1.4;
      z-index: 9999999;
      user-select: none;
      overflow: hidden;
      box-sizing: border-box;
    }
    #${HUD_ID} * { box-sizing: border-box; }
    #${HUD_ID} .sn-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 9px 11px;
      background: #1c2128;
      border-bottom: 1px solid #2d333b;
      cursor: grab;
      gap: 6px;
    }
    #${HUD_ID} .sn-header:active { cursor: grabbing; }
    #${HUD_ID} .sn-title-wrap {
      display: flex;
      align-items: center;
      gap: 7px;
      min-width: 0;
    }
    #${HUD_ID} .sn-dot {
      width: 9px;
      height: 9px;
      border-radius: 50%;
      background: #6e7681;
      flex-shrink: 0;
      transition: background 0.2s, box-shadow 0.2s;
    }
    #${HUD_ID} .sn-dot.scanning {
      background: #f6c034;
      box-shadow: 0 0 8px #f6c034;
      animation: dtuSnPulse 1.2s infinite;
    }
    #${HUD_ID} .sn-dot.claimed { background: #3fb950; box-shadow: 0 0 8px #3fb950; }
    #${HUD_ID} .sn-dot.swapping { background: #58a6ff; box-shadow: 0 0 8px #58a6ff; }
    #${HUD_ID} .sn-dot.rollback, #${HUD_ID} .sn-dot.error { background: #f85149; box-shadow: 0 0 8px #f85149; }
    @keyframes dtuSnPulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.45; transform: scale(0.85); }
    }
    #${HUD_ID} .sn-title {
      font-weight: 700;
      font-size: 12.5px;
      color: #f6c034;
      letter-spacing: 0.2px;
      white-space: nowrap;
    }
    #${HUD_ID} .sn-badge {
      font-size: 10px;
      font-weight: 700;
      padding: 1px 6px;
      border-radius: 4px;
      background: #2d333b;
      color: #adbac7;
      letter-spacing: 0.4px;
    }
    #${HUD_ID} .sn-header-actions {
      display: flex;
      align-items: center;
      gap: 4px;
      flex-shrink: 0;
    }
    #${HUD_ID} .sn-icon-btn {
      background: #252b34;
      color: #c9d1d9;
      border: 1px solid #30363d;
      border-radius: 5px;
      padding: 3px 7px;
      font-size: 11px;
      cursor: pointer;
      line-height: 1.2;
      transition: background 0.15s, border-color 0.15s, color 0.15s;
    }
    #${HUD_ID} .sn-icon-btn:hover {
      background: #30363d;
      border-color: #f6c034;
      color: #ffffff;
    }
    #${HUD_ID} .sn-icon-btn.danger:hover {
      border-color: #f85149;
      color: #f85149;
    }
    #${HUD_ID} .sn-body {
      padding: 10px 11px;
      display: flex;
      flex-direction: column;
      gap: 9px;
      max-height: calc(100vh - 90px);
      overflow-y: auto;
    }
    #${HUD_ID}.collapsed .sn-body { display: none; }
    #${HUD_ID} .sn-section {
      background: #1c2128;
      border: 1px solid #2d333b;
      border-radius: 7px;
      padding: 8px 9px;
    }
    #${HUD_ID} .sn-label {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 10.5px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #8b949e;
      margin-bottom: 6px;
    }
    #${HUD_ID} .sn-mode-tabs {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px;
    }
    #${HUD_ID} .sn-mode-btn {
      padding: 6px 8px;
      border-radius: 6px;
      border: 1px solid #30363d;
      background: #14171c;
      color: #8b949e;
      font-size: 11.5px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s;
    }
    #${HUD_ID} .sn-mode-btn.active {
      background: rgba(246, 192, 52, 0.14);
      border-color: #f6c034;
      color: #f6c034;
    }
    #${HUD_ID} .sn-row {
      display: flex;
      align-items: center;
      gap: 5px;
    }
    #${HUD_ID} .sn-input {
      background: #14171c;
      color: #e6edf3;
      border: 1px solid #30363d;
      border-radius: 5px;
      padding: 5px 7px;
      font-size: 11.5px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      outline: none;
      min-width: 0;
    }
    #${HUD_ID} .sn-input:focus { border-color: #f6c034; }
    #${HUD_ID} .sn-target-list {
      display: flex;
      flex-direction: column;
      gap: 5px;
      max-height: 155px;
      overflow-y: auto;
      padding-right: 2px;
    }
    #${HUD_ID} .sn-target-item {
      display: grid;
      grid-template-columns: 24px 1fr 94px 22px 22px 22px;
      gap: 4px;
      align-items: center;
    }
    #${HUD_ID} .sn-rank {
      font-size: 10.5px;
      font-weight: 700;
      color: #f6c034;
      text-align: center;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
    #${HUD_ID} .sn-mini-btn {
      background: #252b34;
      color: #adbac7;
      border: 1px solid #30363d;
      border-radius: 4px;
      height: 25px;
      padding: 0;
      font-size: 11px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    #${HUD_ID} .sn-mini-btn:hover { border-color: #f6c034; color: #fff; }
    #${HUD_ID} .sn-mini-btn.del:hover { border-color: #f85149; color: #f85149; }
    #${HUD_ID} .sn-add-target-btn {
      margin-top: 6px;
      width: 100%;
      background: #14171c;
      color: #f6c034;
      border: 1px dashed #444c56;
      border-radius: 5px;
      padding: 5px;
      font-size: 11.5px;
      font-weight: 600;
      cursor: pointer;
    }
    #${HUD_ID} .sn-add-target-btn:hover {
      border-color: #f6c034;
      background: rgba(246, 192, 52, 0.08);
    }
    #${HUD_ID} .sn-backup-box {
      margin-top: 7px;
      padding-top: 7px;
      border-top: 1px solid #2d333b;
      display: flex;
      flex-direction: column;
      gap: 5px;
    }
    #${HUD_ID} .sn-backup-note {
      font-size: 10.5px;
      color: #8b949e;
    }
    #${HUD_ID} .sn-slider-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    #${HUD_ID} input[type="range"] {
      flex: 1;
      accent-color: #f6c034;
      cursor: pointer;
    }
    #${HUD_ID} .sn-checks-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-top: 6px;
      font-size: 11px;
      color: #adbac7;
    }
    #${HUD_ID} .sn-checks-row label {
      display: flex;
      align-items: center;
      gap: 4px;
      cursor: pointer;
    }
    #${HUD_ID} .sn-primary-btn {
      width: 100%;
      padding: 8px 10px;
      border-radius: 7px;
      border: none;
      font-size: 12.5px;
      font-weight: 700;
      cursor: pointer;
      letter-spacing: 0.3px;
      transition: filter 0.15s, transform 0.05s;
    }
    #${HUD_ID} .sn-primary-btn:active { transform: scale(0.99); }
    #${HUD_ID} .sn-primary-btn.start { background: #f6c034; color: #14171c; }
    #${HUD_ID} .sn-primary-btn.stop { background: #da3633; color: #ffffff; }
    #${HUD_ID} .sn-log-box {
      background: #0d1117;
      border: 1px solid #2d333b;
      border-radius: 6px;
      padding: 6px 7px;
      height: 110px;
      overflow-y: auto;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 10.5px;
      line-height: 1.45;
      user-select: text;
    }
    #${HUD_ID} .sn-log-box.expanded { height: 240px; }
    #${HUD_ID} .sn-log-entry { margin-bottom: 3px; word-break: break-word; }
    #${HUD_ID} .sn-log-ts { color: #6e7681; margin-right: 5px; }
    #${HUD_ID} .sn-log-info { color: #c9d1d9; }
    #${HUD_ID} .sn-log-success { color: #3fb950; font-weight: 600; }
    #${HUD_ID} .sn-log-warn { color: #f6c034; }
    #${HUD_ID} .sn-log-error { color: #f85149; font-weight: 600; }
    #${HUD_ID} .sn-log-tools {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    #${HUD_ID} .sn-link-btn {
      background: transparent;
      border: 1px solid #30363d;
      color: #8b949e;
      border-radius: 4px;
      padding: 1px 6px;
      font-size: 10px;
      cursor: pointer;
    }
    #${HUD_ID} .sn-link-btn:hover { color: #e6edf3; border-color: #f6c034; }
  `;

  const styleEl = document.createElement('style');
  styleEl.id = STYLE_ID;
  styleEl.textContent = CSS;
  document.head.appendChild(styleEl);

  const hud = document.createElement('div');
  hud.id = HUD_ID;
  if (config.collapsed) hud.classList.add('collapsed');
  if (config.pos && config.pos.left !== null) {
    hud.style.left = Math.max(8, Math.min(window.innerWidth - 120, config.pos.left)) + 'px';
    hud.style.top = Math.max(8, Math.min(window.innerHeight - 50, config.pos.top)) + 'px';
    hud.style.right = 'auto';
  }

  hud.innerHTML = `
    <div class="sn-header" id="sn-drag-handle">
      <div class="sn-title-wrap">
        <span class="sn-dot" id="sn-status-dot"></span>
        <span class="sn-title">DTU Seat Sniper</span>
        <span class="sn-badge" id="sn-status-badge">IDLE</span>
      </div>
      <div class="sn-header-actions">
        <button type="button" class="sn-icon-btn" id="sn-test-sound" title="Test Web Audio Alert">🔊 Test Sound</button>
        <button type="button" class="sn-icon-btn" id="sn-toggle-collapse" title="Collapse / Expand">${config.collapsed ? '□' : '─'}</button>
        <button type="button" class="sn-icon-btn danger" id="sn-close-hud" title="Destroy Sniper & Observers">✕</button>
      </div>
    </div>
    <div class="sn-body">
      <div class="sn-section">
        <div class="sn-label"><span>Operational Mode</span></div>
        <div class="sn-mode-tabs">
          <button type="button" class="sn-mode-btn" id="sn-mode-direct">Direct Add</button>
          <button type="button" class="sn-mode-btn" id="sn-mode-swap">Auto-Swap</button>
        </div>
        <div class="sn-backup-box" id="sn-backup-box" style="display:none;">
          <div class="sn-row">
            <input type="text" class="sn-input" id="sn-backup-code" placeholder="Backup code (e.g. IT310)" style="flex:1;" />
            <input type="text" class="sn-input" id="sn-backup-slot" placeholder="Slot (e.g. E4)" style="width:94px;" />
          </div>
          <div class="sn-backup-note">Atomic safety: never drops backup until target has open seat. Waits for drop confirmation before adding, with auto-rollback on race loss.</div>
        </div>
      </div>

      <div class="sn-section">
        <div class="sn-label">
          <span>Priority Target Queue</span>
          <span style="color:#f6c034;">#1 = Highest</span>
        </div>
        <div class="sn-target-list" id="sn-target-list"></div>
        <button type="button" class="sn-add-target-btn" id="sn-add-target">+ Add Target Course</button>
      </div>

      <div class="sn-section">
        <div class="sn-label">
          <span>Live Observer + Backup Poll</span>
          <span id="sn-poll-readout" style="color:#e6edf3;">${(config.pollMs / 1000).toFixed(1)}s</span>
        </div>
        <div class="sn-slider-row">
          <input type="range" id="sn-poll-slider" min="500" max="5000" step="100" value="${config.pollMs}" />
        </div>
        <div class="sn-checks-row">
          <label><input type="checkbox" id="sn-chk-sound" ${config.soundEnabled ? 'checked' : ''} /> Sound</label>
          <label><input type="checkbox" id="sn-chk-expand" ${config.autoExpand ? 'checked' : ''} /> Auto-Expand</label>
          <label><input type="checkbox" id="sn-chk-filter" ${config.autoClearFilters ? 'checked' : ''} /> Clear Filters</label>
        </div>
      </div>

      <button type="button" class="sn-primary-btn start" id="sn-start-stop">▶ Start Sniping</button>

      <div class="sn-section" style="padding-bottom:7px;">
        <div class="sn-label">
          <span>Activity Log (<span id="sn-check-count">0</span>)</span>
          <div class="sn-log-tools">
            <button type="button" class="sn-link-btn" id="sn-log-expand">${config.logExpanded ? 'Shrink' : 'Expand'}</button>
            <button type="button" class="sn-link-btn" id="sn-log-clear">Clear</button>
          </div>
        </div>
        <div class="sn-log-box ${config.logExpanded ? 'expanded' : ''}" id="sn-log-box"></div>
      </div>
    </div>
  `;

  document.body.appendChild(hud);

  // ============================================================================
  // 7. UI REFERENCES, RENDERING & LOGGING
  // ============================================================================
  const elStatusDot = hud.querySelector('#sn-status-dot');
  const elStatusBadge = hud.querySelector('#sn-status-badge');
  const elModeDirect = hud.querySelector('#sn-mode-direct');
  const elModeSwap = hud.querySelector('#sn-mode-swap');
  const elBackupBox = hud.querySelector('#sn-backup-box');
  const elBackupCode = hud.querySelector('#sn-backup-code');
  const elBackupSlot = hud.querySelector('#sn-backup-slot');
  const elTargetList = hud.querySelector('#sn-target-list');
  const elPollSlider = hud.querySelector('#sn-poll-slider');
  const elPollReadout = hud.querySelector('#sn-poll-readout');
  const elStartStop = hud.querySelector('#sn-start-stop');
  const elCheckCount = hud.querySelector('#sn-check-count');
  const elLogBox = hud.querySelector('#sn-log-box');
  const elLogExpand = hud.querySelector('#sn-log-expand');
  const elToggleCollapse = hud.querySelector('#sn-toggle-collapse');

  function formatTimestamp() {
    const d = new Date();
    const pad = (n, w) => String(n).padStart(w || 2, '0');
    return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + '.' + pad(d.getMilliseconds(), 3);
  }

  function log(level, message) {
    try {
      const ts = formatTimestamp();
      state.logEntries.push({ ts, level, message });
      if (state.logEntries.length > 200) {
        state.logEntries.shift();
        if (elLogBox.firstChild) elLogBox.firstChild.remove();
      }
      const line = document.createElement('div');
      line.className = 'sn-log-entry sn-log-' + (level || 'info');

      const tsSpan = document.createElement('span');
      tsSpan.className = 'sn-log-ts';
      tsSpan.textContent = '[' + ts + ']';

      const msgSpan = document.createElement('span');
      msgSpan.textContent = message;

      line.appendChild(tsSpan);
      line.appendChild(msgSpan);
      elLogBox.appendChild(line);
      elLogBox.scrollTop = elLogBox.scrollHeight;
    } catch (_) {}
  }

  function updateStatusUI() {
    elStatusBadge.textContent = state.status;
    elStatusDot.className = 'sn-dot ' + state.status.toLowerCase();
  }

  function updateCheckCounterUI() {
    elCheckCount.textContent = state.checks + ' polls · ' + state.mutations + ' live';
  }

  function updateModeUI() {
    const isSwap = config.mode === 'swap';
    elModeDirect.classList.toggle('active', !isSwap);
    elModeSwap.classList.toggle('active', isSwap);
    elBackupBox.style.display = isSwap ? 'flex' : 'none';
    elBackupCode.value = config.backupCode || '';
    elBackupSlot.value = config.backupSlot || '';
  }

  function updateControlsUI() {
    if (state.running) {
      elStartStop.textContent = '■ Stop Sniping';
      elStartStop.className = 'sn-primary-btn stop';
    } else {
      elStartStop.textContent = '▶ Start Sniping';
      elStartStop.className = 'sn-primary-btn start';
    }
  }

  function renderTargets() {
    elTargetList.innerHTML = '';
    config.targets.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = 'sn-target-item';

      const rank = document.createElement('span');
      rank.className = 'sn-rank';
      rank.textContent = '#' + (index + 1);

      const codeInput = document.createElement('input');
      codeInput.type = 'text';
      codeInput.className = 'sn-input';
      codeInput.placeholder = index === 0 ? 'e.g. HU328' : 'e.g. EE312n';
      codeInput.value = item.code || '';
      codeInput.addEventListener('input', (e) => {
        config.targets[index].code = e.target.value;
        saveConfig();
      });

      const slotInput = document.createElement('input');
      slotInput.type = 'text';
      slotInput.className = 'sn-input';
      slotInput.placeholder = 'Slot (opt)';
      slotInput.value = item.slot || '';
      slotInput.addEventListener('input', (e) => {
        config.targets[index].slot = e.target.value;
        saveConfig();
      });

      const upBtn = document.createElement('button');
      upBtn.type = 'button';
      upBtn.className = 'sn-mini-btn';
      upBtn.textContent = '↑';
      upBtn.title = 'Move Up';
      upBtn.disabled = index === 0;
      upBtn.addEventListener('click', () => {
        if (index === 0) return;
        const tmp = config.targets[index - 1];
        config.targets[index - 1] = config.targets[index];
        config.targets[index] = tmp;
        saveConfig();
        renderTargets();
      });

      const downBtn = document.createElement('button');
      downBtn.type = 'button';
      downBtn.className = 'sn-mini-btn';
      downBtn.textContent = '↓';
      downBtn.title = 'Move Down';
      downBtn.disabled = index === config.targets.length - 1;
      downBtn.addEventListener('click', () => {
        if (index === config.targets.length - 1) return;
        const tmp = config.targets[index + 1];
        config.targets[index + 1] = config.targets[index];
        config.targets[index] = tmp;
        saveConfig();
        renderTargets();
      });

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'sn-mini-btn del';
      delBtn.textContent = '✕';
      delBtn.title = 'Remove Target';
      delBtn.addEventListener('click', () => {
        if (config.targets.length === 1) {
          config.targets[0] = { code: '', slot: '' };
        } else {
          config.targets.splice(index, 1);
        }
        saveConfig();
        renderTargets();
      });

      row.appendChild(rank);
      row.appendChild(codeInput);
      row.appendChild(slotInput);
      row.appendChild(upBtn);
      row.appendChild(downBtn);
      row.appendChild(delBtn);
      elTargetList.appendChild(row);
    });
  }

  // ============================================================================
  // 8. EVENT BINDINGS & DRAGGABLE HEADER
  // ============================================================================
  elModeDirect.addEventListener('click', () => {
    config.mode = 'direct';
    saveConfig();
    updateModeUI();
  });

  elModeSwap.addEventListener('click', () => {
    config.mode = 'swap';
    saveConfig();
    updateModeUI();
  });

  elBackupCode.addEventListener('input', (e) => {
    config.backupCode = e.target.value;
    saveConfig();
  });

  elBackupSlot.addEventListener('input', (e) => {
    config.backupSlot = e.target.value;
    saveConfig();
  });

  hud.querySelector('#sn-add-target').addEventListener('click', () => {
    config.targets.push({ code: '', slot: '' });
    saveConfig();
    renderTargets();
  });

  elPollSlider.addEventListener('input', (e) => {
    config.pollMs = Math.max(500, Math.min(5000, parseInt(e.target.value, 10) || 900));
    elPollReadout.textContent = (config.pollMs / 1000).toFixed(1) + 's';
    saveConfig();
  });

  hud.querySelector('#sn-chk-sound').addEventListener('change', (e) => {
    config.soundEnabled = e.target.checked;
    saveConfig();
  });

  hud.querySelector('#sn-chk-expand').addEventListener('change', (e) => {
    config.autoExpand = e.target.checked;
    saveConfig();
  });

  hud.querySelector('#sn-chk-filter').addEventListener('change', (e) => {
    config.autoClearFilters = e.target.checked;
    saveConfig();
  });

  hud.querySelector('#sn-test-sound').addEventListener('click', (e) => {
    e.stopPropagation();
    AudioEngine.playTest();
    log('info', 'Played Web Audio test chime.');
  });

  elToggleCollapse.addEventListener('click', (e) => {
    e.stopPropagation();
    config.collapsed = !config.collapsed;
    hud.classList.toggle('collapsed', config.collapsed);
    elToggleCollapse.textContent = config.collapsed ? '□' : '─';
    saveConfig();
  });

  elStartStop.addEventListener('click', () => {
    if (state.running) {
      stopSniper(false);
    } else {
      startSniper();
    }
  });

  hud.querySelector('#sn-log-clear').addEventListener('click', () => {
    state.logEntries = [];
    elLogBox.innerHTML = '';
  });

  elLogExpand.addEventListener('click', () => {
    config.logExpanded = !config.logExpanded;
    elLogBox.classList.toggle('expanded', config.logExpanded);
    elLogExpand.textContent = config.logExpanded ? 'Shrink' : 'Expand';
    saveConfig();
  });

  // Draggable header
  let dragState = null;
  const dragHandle = hud.querySelector('#sn-drag-handle');

  function onMouseDown(e) {
    if (e.target.closest('button')) return;
    const rect = hud.getBoundingClientRect();
    dragState = {
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top
    };
    e.preventDefault();
  }

  function onMouseMove(e) {
    if (!dragState) return;
    const maxLeft = Math.max(8, window.innerWidth - hud.offsetWidth - 8);
    const maxTop = Math.max(8, window.innerHeight - 44);
    const left = Math.max(8, Math.min(maxLeft, e.clientX - dragState.offsetX));
    const top = Math.max(8, Math.min(maxTop, e.clientY - dragState.offsetY));
    hud.style.left = left + 'px';
    hud.style.top = top + 'px';
    hud.style.right = 'auto';
    config.pos = { left, top };
  }

  function onMouseUp() {
    if (dragState) {
      dragState = null;
      saveConfig();
    }
  }

  dragHandle.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);

  // ============================================================================
  // 9. DESTRUCTOR & INITIALIZATION
  // ============================================================================
  function destroy() {
    if (state.destroyed) return;
    state.destroyed = true;
    state.running = false;
    stopObserver();
    if (state.timerId) {
      clearTimeout(state.timerId);
      state.timerId = null;
    }
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
    AudioEngine.close();
    if (hud && hud.parentNode) hud.parentNode.removeChild(hud);
    if (styleEl && styleEl.parentNode) styleEl.parentNode.removeChild(styleEl);
    try {
      delete window[CLEANUP_KEY];
    } catch (_) {
      window[CLEANUP_KEY] = undefined;
    }
  }

  window[CLEANUP_KEY] = destroy;
  hud.querySelector('#sn-close-hud').addEventListener('click', (e) => {
    e.stopPropagation();
    destroy();
  });

  // Initial render
  updateModeUI();
  renderTargets();
  updateStatusUI();
  updateControlsUI();
  updateCheckCounterUI();

  log('info', 'DTU Seat Sniper loaded. Priority targets & Auto-Swap ready.');
})();
