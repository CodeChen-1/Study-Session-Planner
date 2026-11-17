(() => {
  'use strict';

  const STORAGE_KEY = 'study-session-planner.v1';
  const STATE_VERSION = 1;
  const PHASE_DURATIONS = { focus: 25 * 60 * 1000, break: 5 * 60 * 1000 };
  const MAX_LOG_MINUTES = 1440;
  const DEFAULT_LOG_MINUTES = 25;
  const MAX_ENTRIES = 2000;
  const MAX_SHOWN_ENTRIES = 50;
  const AUTOSAVE_MS = 5000;
  const TICK_MS = 250;
  const RING_RADIUS = 104;
  const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

  const els = {
    timerHeading: document.getElementById('timer-heading'),
    timerPanel: document.getElementById('timer-panel'),
    timeDisplay: document.getElementById('time-display'),
    phaseBadge: document.getElementById('phase-badge'),
    ring: document.getElementById('ring-progress'),
    startBtn: document.getElementById('start-btn'),
    toggleBtn: document.getElementById('toggle-btn'),
    resetBtn: document.getElementById('reset-btn'),
    status: document.getElementById('status'),
    todayTotal: document.getElementById('today-total'),
    entryList: document.getElementById('entry-list'),
    entryCount: document.getElementById('entry-count'),
    form: document.getElementById('log-form'),
    minutesInput: document.getElementById('minutes-input'),
    logError: document.getElementById('log-error')
  };

  const state = {
    phase: 'focus',
    endsAt: null,
    remainingMs: PHASE_DURATIONS.focus,
    entries: []
  };

  let todayKey = localDateKey(new Date());
  let lastAutosave = 0;
  let storageWarned = false;
  let corruptWarned = false;
  let inconsistentWarned = false;
  let announceTimer = 0;

  function localDateKey(date) {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return date.getFullYear() + '-' + month + '-' + day;
  }

  function phaseName(phase) {
    return phase === 'focus' ? 'Focus' : 'Break';
  }

  function formatClock(ms) {
    const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
  }

  function isRunning() {
    return state.endsAt !== null;
  }

  function currentRemainingMs() {
    return state.endsAt === null
      ? state.remainingMs
      : Math.max(0, state.endsAt - Date.now());
  }

  function todayTotalMinutes() {
    const key = localDateKey(new Date());
    let total = 0;
    for (const entry of state.entries) {
      if (localDateKey(new Date(entry.ts)) === key) {
        total += entry.minutes;
      }
    }
    return total;
  }

  function announce(message) {
    window.clearTimeout(announceTimer);
    els.status.textContent = '';
    announceTimer = window.setTimeout(() => {
      els.status.textContent = message;
    }, 100);
  }

  function warnStorageUnavailable(err) {
    if (storageWarned) {
      return;
    }
    storageWarned = true;
    console.warn('Study Session Planner: localStorage is unavailable.', err);
    announce('Storage is unavailable. Your timer and log will not be saved.');
  }

  function warnCorruptData() {
    if (corruptWarned) {
      return;
    }
    corruptWarned = true;
    console.warn('Study Session Planner: saved data was invalid and has been discarded.');
    announce('Saved data was invalid, so a fresh session was started.');
  }

  function warnInconsistentTimer() {
    if (inconsistentWarned) {
      return;
    }
    inconsistentWarned = true;
    console.warn('Study Session Planner: saved timer deadline was beyond the phase length; remaining time was clamped.');
    announce('The saved timer was out of sync, so the remaining time was limited to the current phase length.');
  }

  function serialize() {
    return {
      version: STATE_VERSION,
      timer: {
        phase: state.phase,
        running: isRunning(),
        remainingMs: Math.round(currentRemainingMs()),
        endsAt: state.endsAt
      },
      entries: state.entries
    };
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(serialize()));
    } catch (err) {
      warnStorageUnavailable(err);
    }
  }

  function isValidEntry(item) {
    return Boolean(item)
      && typeof item === 'object'
      && !Array.isArray(item)
      && Number.isInteger(item.minutes)
      && item.minutes >= 1
      && item.minutes <= MAX_LOG_MINUTES
      && typeof item.ts === 'number'
      && isFinite(item.ts)
      && item.ts >= 0;
  }

  function load() {
    let raw = null;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch (err) {
      warnStorageUnavailable(err);
      return;
    }
    if (raw === null) {
      return;
    }

    let data = null;
    try {
      data = JSON.parse(raw);
    } catch (err) {
      warnCorruptData();
      return;
    }

    if (!data || typeof data !== 'object' || Array.isArray(data) || data.version !== STATE_VERSION) {
      warnCorruptData();
      return;
    }

    const timer = data.timer;
    if (!timer
      || typeof timer !== 'object'
      || Array.isArray(timer)
      || (timer.phase !== 'focus' && timer.phase !== 'break')
      || typeof timer.remainingMs !== 'number'
      || !isFinite(timer.remainingMs)) {
      warnCorruptData();
      return;
    }

    state.phase = timer.phase;
    const full = PHASE_DURATIONS[state.phase];
    state.remainingMs = Math.min(Math.max(Math.round(timer.remainingMs), 0), full);

    if (Array.isArray(data.entries)) {
      state.entries = data.entries.filter(isValidEntry).slice(-MAX_ENTRIES);
    }

    if (timer.running === true) {
      if (typeof timer.endsAt !== 'number' || !isFinite(timer.endsAt)) {
        warnCorruptData();
        return;
      }
      const now = Date.now();
      if (timer.endsAt > now) {
        const remaining = timer.endsAt - now;
        if (remaining > full) {
          warnInconsistentTimer();
          state.endsAt = now + full;
          state.remainingMs = full;
        } else {
          state.endsAt = timer.endsAt;
          state.remainingMs = remaining;
        }
      } else {
        finishPhase('restored');
      }
    } else {
      state.endsAt = null;
      if (state.remainingMs <= 0) {
        finishPhase('restored');
      }
    }
  }

  function advancePhase() {
    const finished = state.phase;
    state.phase = finished === 'focus' ? 'break' : 'focus';
    state.endsAt = null;
    state.remainingMs = PHASE_DURATIONS[state.phase];
    return finished;
  }

  function finishPhase(source) {
    const finished = advancePhase();
    renderAll();
    if (source === 'countdown') {
      announce(phaseName(finished) + ' session complete. '
        + phaseName(state.phase) + ' timer is ready and paused at '
        + formatClock(state.remainingMs) + '.');
    } else {
      announce('The previous ' + phaseName(finished) + ' session had already ended. '
        + phaseName(state.phase) + ' timer is ready and paused at '
        + formatClock(state.remainingMs) + '.');
    }
    save();
  }

  function startTimer() {
    if (isRunning() || state.remainingMs !== PHASE_DURATIONS[state.phase]) {
      return;
    }
    const startHadFocus = document.activeElement === els.startBtn;
    state.endsAt = Date.now() + state.remainingMs;
    lastAutosave = Date.now();
    renderAll();
    if (startHadFocus) {
      els.toggleBtn.focus();
    }
    announce(phaseName(state.phase) + ' timer started.');
    save();
  }

  function pauseTimer() {
    if (!isRunning()) {
      return;
    }
    const remaining = state.endsAt - Date.now();
    if (remaining <= 0) {
      finishPhase('countdown');
      return;
    }
    state.remainingMs = remaining;
    state.endsAt = null;
    renderAll();
    announce(phaseName(state.phase) + ' timer paused at ' + formatClock(state.remainingMs) + '.');
    save();
  }

  function resumeTimer() {
    if (isRunning() || state.remainingMs <= 0 || state.remainingMs === PHASE_DURATIONS[state.phase]) {
      return;
    }
    state.endsAt = Date.now() + state.remainingMs;
    lastAutosave = Date.now();
    renderAll();
    announce(phaseName(state.phase) + ' timer resumed.');
    save();
  }

  function resetTimer() {
    if (!isRunning() && state.remainingMs === PHASE_DURATIONS[state.phase]) {
      return;
    }
    const resetHadFocus = document.activeElement === els.resetBtn;
    state.endsAt = null;
    state.remainingMs = PHASE_DURATIONS[state.phase];
    renderAll();
    if (resetHadFocus) {
      els.startBtn.focus();
    }
    announce(phaseName(state.phase) + ' timer reset to ' + formatClock(state.remainingMs) + '.');
    save();
  }

  function updateButtons() {
    const full = PHASE_DURATIONS[state.phase];
    const running = isRunning();
    const fresh = !running && state.remainingMs === full;

    els.startBtn.disabled = running || state.remainingMs !== full;
    els.startBtn.setAttribute('aria-label', 'Start ' + state.phase + ' timer');

    if (running) {
      els.toggleBtn.disabled = false;
      els.toggleBtn.textContent = 'Pause';
      els.toggleBtn.setAttribute('aria-label', 'Pause ' + state.phase + ' timer');
    } else if (!fresh) {
      els.toggleBtn.disabled = false;
      els.toggleBtn.textContent = 'Resume';
      els.toggleBtn.setAttribute('aria-label', 'Resume ' + state.phase + ' timer');
    } else {
      els.toggleBtn.disabled = true;
      els.toggleBtn.textContent = 'Pause';
      els.toggleBtn.setAttribute('aria-label', 'Pause timer');
    }

    els.resetBtn.disabled = !running && fresh;
  }

  function renderTimer() {
    const remaining = currentRemainingMs();
    const fraction = Math.min(1, Math.max(0, remaining / PHASE_DURATIONS[state.phase]));
    els.timeDisplay.textContent = formatClock(remaining);
    els.ring.style.strokeDasharray = RING_CIRCUMFERENCE + 'px';
    els.ring.style.strokeDashoffset = RING_CIRCUMFERENCE * (1 - fraction) + 'px';
    els.timerPanel.dataset.phase = state.phase;
    els.phaseBadge.textContent = phaseName(state.phase);
    els.timerHeading.textContent = phaseName(state.phase) + ' timer';
    updateButtons();
  }

  function renderLog() {
    els.todayTotal.textContent = String(todayTotalMinutes());
    els.entryList.textContent = '';
    const shown = state.entries.slice(-MAX_SHOWN_ENTRIES).reverse();

    if (shown.length === 0) {
      const li = document.createElement('li');
      li.className = 'entry-empty';
      li.textContent = 'No focus sessions logged yet.';
      els.entryList.appendChild(li);
    } else {
      for (const entry of shown) {
        const li = document.createElement('li');
        const when = document.createElement('span');
        when.className = 'entry-time';
        when.textContent = new Date(entry.ts).toLocaleString(undefined, {
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit'
        });
        const amount = document.createElement('span');
        amount.className = 'entry-minutes';
        amount.textContent = entry.minutes + ' min';
        li.appendChild(when);
        li.appendChild(amount);
        els.entryList.appendChild(li);
      }
    }

    if (state.entries.length > MAX_SHOWN_ENTRIES) {
      els.entryCount.textContent = 'Showing the latest ' + MAX_SHOWN_ENTRIES
        + ' of ' + state.entries.length + ' entries.';
    } else if (state.entries.length === 1) {
      els.entryCount.textContent = '1 entry saved.';
    } else {
      els.entryCount.textContent = state.entries.length + ' entries saved.';
    }
  }

  function renderAll() {
    renderTimer();
    renderLog();
  }

  function checkMidnight() {
    const key = localDateKey(new Date());
    if (key !== todayKey) {
      todayKey = key;
      renderLog();
    }
  }

  function tick() {
    checkMidnight();
    if (!isRunning()) {
      return;
    }
    const remaining = state.endsAt - Date.now();
    if (remaining <= 0) {
      finishPhase('countdown');
      return;
    }
    state.remainingMs = remaining;
    renderTimer();
    const now = Date.now();
    if (now - lastAutosave >= AUTOSAVE_MS) {
      lastAutosave = now;
      save();
    }
  }

  function clearLogError() {
    if (els.logError.textContent) {
      els.logError.textContent = '';
      els.minutesInput.removeAttribute('aria-invalid');
    }
  }

  function showLogError(message) {
    els.logError.textContent = message;
    els.minutesInput.setAttribute('aria-invalid', 'true');
    els.minutesInput.focus();
  }

  function submitLog(event) {
    event.preventDefault();
    const value = els.minutesInput.value.trim();
    const parsed = Number(value);

    if (value === '' || !isFinite(parsed)) {
      showLogError('Enter a number of minutes.');
      return;
    }
    if (!Number.isInteger(parsed)) {
      showLogError('Use whole minutes, like 25.');
      return;
    }
    if (parsed < 1 || parsed > MAX_LOG_MINUTES) {
      showLogError('Minutes must be between 1 and 1,440.');
      return;
    }

    state.entries.push({ minutes: parsed, ts: Date.now() });
    clearLogError();
    els.minutesInput.value = String(DEFAULT_LOG_MINUTES);
    renderLog();
    announce('Logged ' + parsed + ' minutes of focus. Today\u2019s total is '
      + todayTotalMinutes() + ' minutes.');
    save();
  }

  function onVisibilityChange() {
    if (document.visibilityState === 'visible') {
      checkMidnight();
      if (isRunning() && state.endsAt <= Date.now()) {
        finishPhase('countdown');
        return;
      }
      renderAll();
    }
    save();
  }

  function init() {
    load();
    renderAll();

    els.startBtn.addEventListener('click', startTimer);
    els.toggleBtn.addEventListener('click', () => {
      if (isRunning()) {
        pauseTimer();
      } else {
        resumeTimer();
      }
    });
    els.resetBtn.addEventListener('click', resetTimer);
    els.form.addEventListener('submit', submitLog);
    els.minutesInput.addEventListener('input', clearLogError);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', save);
    window.addEventListener('beforeunload', save);

    window.setInterval(tick, TICK_MS);
  }

  init();
})();
