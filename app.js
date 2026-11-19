(() => {
  'use strict';

  const STORAGE_KEY = 'study-session-planner.v1';
  const STATE_VERSION = 1;
  const PHASE_DURATIONS = { focus: 25 * 60 * 1000, break: 5 * 60 * 1000 };
  const MAX_LOG_MINUTES = 1440;
  const DEFAULT_LOG_MINUTES = 25;
  const MAX_ENTRIES = 2000;
  const AUTOSAVE_MS = 5000;
  const TICK_MS = 250;
  const RING_RADIUS = 104;
  const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

  const els = {
    timerHeading: document.getElementById('timer-heading'),
    timerPanel: document.getElementById('timer-panel'),
    timeDisplay: document.getElementById('time-display'),
    elapsedDisplay: document.getElementById('elapsed-time'),
    phaseBadge: document.getElementById('phase-badge'),
    ring: document.getElementById('ring-progress'),
    startBtn: document.getElementById('start-btn'),
    toggleBtn: document.getElementById('toggle-btn'),
    resetBtn: document.getElementById('reset-btn'),
    status: document.getElementById('status'),
    todayTotal: document.getElementById('today-total'),
    entryList: document.getElementById('entry-list'),
    resetLogBtn: document.getElementById('reset-log-btn'),
    entryCount: document.getElementById('entry-count'),
    form: document.getElementById('log-form'),
    minutesInput: document.getElementById('minutes-input'),
    logError: document.getElementById('log-error'),
    exportBtn: document.getElementById('export-btn'),
    exportHint: document.getElementById('export-hint'),
    recallForm: document.getElementById('recall-form'),
    recallQuestionInput: document.getElementById('recall-question-input'),
    recallAnswerInput: document.getElementById('recall-answer-input'),
    recallQuestionError: document.getElementById('recall-question-error'),
    recallAnswerError: document.getElementById('recall-answer-error'),
    recallList: document.getElementById('recall-list'),
    recallCount: document.getElementById('recall-count'),
    recallDueCount: document.getElementById('recall-due-count'),
    recallRotationCount: document.getElementById('recall-rotation-count'),
    recallLongTermCount: document.getElementById('recall-long-term-count'),
    recallReviewCount: document.getElementById('recall-review-count'),
    recallDialog: document.getElementById('recall-dialog'),
    recallQuestion: document.getElementById('recall-question'),
    recallAttempt: document.getElementById('recall-attempt'),
    recallAttemptError: document.getElementById('recall-attempt-error'),
    recallReveal: document.getElementById('recall-reveal'),
    recallAnswerBlock: document.getElementById('recall-answer-block'),
    recallAnswer: document.getElementById('recall-answer'),
    recallClose: document.getElementById('recall-close'),
    recallLater: document.getElementById('recall-later'),
    recallRatingGroup: document.getElementById('recall-rating-group'),
    recallDialogStatus: document.getElementById('recall-dialog-status')
  };

  const state = {
    phase: 'focus',
    endsAt: null,
    remainingMs: PHASE_DURATIONS.focus,
    entries: [],
    editingEntryIndex: null,
    recallCards: []
  };

  let todayKey = localDateKey(new Date());
  let lastAutosave = 0;
  let storageWarned = false;
  let corruptWarned = false;
  let inconsistentWarned = false;
  let announceTimer = 0;
  let dialogAnnounceTimer = 0;
  let activeReviewCardId = null;
  let pendingTimerAction = null;

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

  function formatElapsed(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
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

  function currentElapsedMs() {
    const full = PHASE_DURATIONS[state.phase];
    return Math.min(full, Math.max(0, full - currentRemainingMs()));
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
      entries: state.entries,
      recallCards: state.recallCards
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

    const recallHelper = recallApi();
    if (recallHelper) {
      state.recallCards = recallHelper.normalizeCards(data.recallCards);
    } else {
      state.recallCards = Array.isArray(data.recallCards) ? data.recallCards : [];
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
    if (maybeOpenReview('start')) {
      return;
    }
    performStart(false);
  }

  function performStart(fromDialog) {
    if (isRunning() || state.remainingMs !== PHASE_DURATIONS[state.phase]) {
      return;
    }
    const startHadFocus = document.activeElement === els.startBtn;
    state.endsAt = Date.now() + state.remainingMs;
    lastAutosave = Date.now();
    renderAll();
    if (startHadFocus || fromDialog) {
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
    if (maybeOpenReview('resume')) {
      return;
    }
    performResume(false);
  }

  function performResume(fromDialog) {
    if (isRunning() || state.remainingMs <= 0 || state.remainingMs === PHASE_DURATIONS[state.phase]) {
      return;
    }
    state.endsAt = Date.now() + state.remainingMs;
    lastAutosave = Date.now();
    renderAll();
    if (fromDialog) {
      els.toggleBtn.focus();
    }
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
    els.elapsedDisplay.textContent = formatElapsed(currentElapsedMs());
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
    const entries = state.entries.slice().reverse();

    if (entries.length === 0) {
      const li = document.createElement('li');
      li.className = 'entry-empty';
      li.textContent = 'No focus sessions logged yet.';
      els.entryList.appendChild(li);
    } else {
      entries.forEach((entry, index) => {
        const entryIndex = state.entries.length - index - 1;
        if (entryIndex === state.editingEntryIndex) {
          appendEntryEditor(els.entryList, entry, entryIndex);
        } else {
          appendEntry(els.entryList, entry, entryIndex + 1, entryIndex);
        }
      });
    }

    els.entryList.tabIndex = entries.length > 0 ? 0 : -1;
    els.resetLogBtn.disabled = state.entries.length === 0;

    if (state.entries.length === 1) {
      els.entryCount.textContent = '1 entry saved.';
    } else {
      els.entryCount.textContent = state.entries.length + ' entries saved.';
    }

    updateExportUi();
  }

  function appendEntry(list, entry, sessionNumber, entryIndex) {
    const li = document.createElement('li');
    const number = document.createElement('span');
    number.className = 'entry-number';
    number.textContent = '#' + sessionNumber;
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
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.id = 'entry-edit-' + entryIndex;
    edit.className = 'btn btn-secondary entry-edit-button';
    edit.dataset.entryAction = 'edit';
    edit.dataset.entryIndex = String(entryIndex);
    edit.setAttribute('aria-label', 'Edit focus session #' + sessionNumber);
    edit.textContent = 'Edit';
    li.appendChild(number);
    li.appendChild(when);
    li.appendChild(amount);
    li.appendChild(edit);
    list.appendChild(li);
  }

  function appendEntryEditor(list, entry, entryIndex) {
    const sessionNumber = entryIndex + 1;
    const li = document.createElement('li');
    li.className = 'entry-editing';
    const form = document.createElement('form');
    form.className = 'entry-edit-form';
    form.dataset.entryIndex = String(entryIndex);
    form.setAttribute('novalidate', '');

    const label = document.createElement('label');
    label.htmlFor = 'entry-edit-minutes-' + entryIndex;
    label.textContent = 'Minutes for session #' + sessionNumber;

    const input = document.createElement('input');
    input.id = 'entry-edit-minutes-' + entryIndex;
    input.name = 'minutes';
    input.type = 'number';
    input.inputMode = 'numeric';
    input.min = '1';
    input.max = String(MAX_LOG_MINUTES);
    input.step = '1';
    input.value = String(entry.minutes);
    input.setAttribute('aria-describedby', 'entry-edit-error-' + entryIndex);

    const error = document.createElement('p');
    error.id = 'entry-edit-error-' + entryIndex;
    error.className = 'error entry-edit-error';
    error.setAttribute('aria-live', 'polite');

    const actions = document.createElement('div');
    actions.className = 'entry-edit-actions';
    actions.appendChild(createEntryAction('save', 'Save', entryIndex, 'btn-primary'));
    actions.appendChild(createEntryAction('cancel', 'Cancel', entryIndex, 'btn-secondary'));
    actions.appendChild(createEntryAction('delete', 'Delete', entryIndex, 'btn-secondary'));

    form.appendChild(label);
    form.appendChild(input);
    form.appendChild(error);
    form.appendChild(actions);
    li.appendChild(form);
    list.appendChild(li);
  }

  function createEntryAction(action, label, entryIndex, buttonStyle) {
    const button = document.createElement('button');
    button.type = action === 'save' ? 'submit' : 'button';
    button.className = 'btn ' + buttonStyle + ' entry-action-button';
    button.dataset.entryAction = action;
    button.dataset.entryIndex = String(entryIndex);
    button.textContent = label;
    return button;
  }

  function csvApi() {
    return (typeof window !== 'undefined' && window.StudyCsv) || null;
  }

  function updateExportUi() {
    const api = csvApi();
    const count = state.entries.length;

    if (!api) {
      els.exportBtn.disabled = true;
      els.exportHint.textContent = 'CSV export is unavailable because its helper script did not load.';
      return;
    }

    els.exportBtn.disabled = count === 0;
    if (count === 0) {
      els.exportHint.textContent = 'Export is unavailable because no focus sessions are logged yet. '
        + 'Log a completed focus session to enable it.';
    } else if (count === 1) {
      els.exportHint.textContent = 'Saves the 1 logged entry as a CSV file on this device. '
        + 'Nothing is sent anywhere.';
    } else {
      els.exportHint.textContent = 'Saves all ' + count + ' logged entries as a CSV file on this device. '
        + 'Nothing is sent anywhere.';
    }
  }

  function exportCsv() {
    const api = csvApi();
    if (!api || state.entries.length === 0) {
      return;
    }
    const count = state.entries.length;
    const csvText = api.serializeEntries(state.entries);
    const filename = api.filenameForDate(new Date());
    const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1000);
    announce('Exported ' + count + ' focus entries to ' + filename + '.');
  }

  function recallApi() {
    return (typeof window !== 'undefined' && window.StudyRecall) || null;
  }

  function announceDialog(message) {
    if (!els.recallDialogStatus) {
      return;
    }
    window.clearTimeout(dialogAnnounceTimer);
    els.recallDialogStatus.textContent = '';
    dialogAnnounceTimer = window.setTimeout(() => {
      els.recallDialogStatus.textContent = message;
    }, 100);
  }

  function previewQuestion(text) {
    const limit = 80;
    return text.length <= limit ? text : text.slice(0, limit - 1) + '\u2026';
  }

  function clearRecallErrors() {
    els.recallQuestionError.textContent = '';
    els.recallAnswerError.textContent = '';
    els.recallQuestionInput.removeAttribute('aria-invalid');
    els.recallAnswerInput.removeAttribute('aria-invalid');
  }

  function clearRecallFieldError(kind) {
    if (kind === 'question') {
      if (els.recallQuestionError.textContent) {
        els.recallQuestionError.textContent = '';
        els.recallQuestionInput.removeAttribute('aria-invalid');
      }
      return;
    }
    if (els.recallAnswerError.textContent) {
      els.recallAnswerError.textContent = '';
      els.recallAnswerInput.removeAttribute('aria-invalid');
    }
  }

  function renderRecall() {
    if (!els.recallList) {
      return;
    }
    els.recallList.textContent = '';
    const helper = recallApi();
    if (!helper) {
      els.recallCount.textContent = '';
      updateRecallProgress(null);
      const unavailable = document.createElement('li');
      unavailable.className = 'recall-empty';
      unavailable.textContent = 'Recall cards are unavailable because the helper script did not load. '
        + 'Saved cards are preserved and will return when it does.';
      els.recallList.appendChild(unavailable);
      return;
    }
    const count = state.recallCards.length;
    updateRecallProgress(helper);

    if (count === 0) {
      els.recallCount.textContent = '';
      const empty = document.createElement('li');
      empty.className = 'recall-empty';
      empty.textContent = 'No recall cards yet. Save a question and its answer to start the loop.';
      els.recallList.appendChild(empty);
      return;
    }

    els.recallCount.textContent = count === 1 ? '1 card saved.' : count + ' cards saved.';
    const cards = state.recallCards.slice().reverse();
    for (const card of cards) {
      const li = document.createElement('li');
      li.className = 'recall-item';

      const info = document.createElement('div');
      info.className = 'recall-item-info';

      const question = document.createElement('p');
      question.className = 'recall-item-question';
      question.textContent = card.question;

      const meta = document.createElement('p');
      meta.className = 'recall-item-meta';
      const remaining = card.dueAtEntryCount - state.entries.length;
      if (remaining <= 0) {
        meta.textContent = 'Due now';
      } else {
        meta.textContent = 'Due after ' + remaining + ' more logged focus '
          + (remaining === 1 ? 'session' : 'sessions');
      }
      const progress = card.rememberedStreak >= helper.LONG_TERM_STREAK
        ? 'Long-term'
        : card.rememberedStreak > 0
          ? 'Building · ' + card.rememberedStreak + '/' + helper.LONG_TERM_STREAK
            + ' remembered in a row'
          : 'New card';
      const lastRating = card.lastRating
        ? ' · Last: ' + (card.lastRating === 'partly' ? 'partly remembered' : card.lastRating)
        : '';
      meta.textContent += ' · ' + progress + ' · ' + card.reviewCount + ' '
        + (card.reviewCount === 1 ? 'review' : 'reviews') + lastRating;

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn btn-secondary recall-delete';
      remove.setAttribute('data-delete-id', card.id);
      remove.setAttribute('aria-label', 'Delete recall card: ' + previewQuestion(card.question));
      remove.textContent = 'Delete';

      info.appendChild(question);
      info.appendChild(meta);
      li.appendChild(info);
      li.appendChild(remove);
      els.recallList.appendChild(li);
    }
  }

  function updateRecallProgress(helper) {
    if (!els.recallDueCount || !els.recallRotationCount
      || !els.recallLongTermCount || !els.recallReviewCount) {
      return;
    }
    if (!helper) {
      els.recallDueCount.textContent = '—';
      els.recallRotationCount.textContent = '—';
      els.recallLongTermCount.textContent = '—';
      els.recallReviewCount.textContent = '—';
      return;
    }

    const cards = helper.normalizeCards(state.recallCards);
    const dueNow = cards.filter((card) => card.dueAtEntryCount <= state.entries.length).length;
    const longTerm = cards.filter((card) => card.rememberedStreak >= helper.LONG_TERM_STREAK).length;
    const rotation = cards.length - longTerm;
    const reviews = cards.reduce((total, card) => total + card.reviewCount, 0);
    els.recallDueCount.textContent = String(dueNow);
    els.recallRotationCount.textContent = String(rotation);
    els.recallLongTermCount.textContent = String(longTerm);
    els.recallReviewCount.textContent = String(reviews);
  }

  function submitRecall(event) {
    event.preventDefault();
    const helper = recallApi();
    if (!helper) {
      announce('Recall cards are unavailable because the helper script did not load.');
      return;
    }

    const draft = {
      question: els.recallQuestionInput.value,
      answer: els.recallAnswerInput.value
    };
    const result = helper.validateDraft(draft);
    clearRecallErrors();

    if (!result.ok) {
      if (result.errors.question) {
        els.recallQuestionError.textContent = result.errors.question;
        els.recallQuestionInput.setAttribute('aria-invalid', 'true');
      }
      if (result.errors.answer) {
        els.recallAnswerError.textContent = result.errors.answer;
        els.recallAnswerInput.setAttribute('aria-invalid', 'true');
      }
      if (result.errors.question) {
        els.recallQuestionInput.focus();
      } else {
        els.recallAnswerInput.focus();
      }
      return;
    }

    const card = helper.createCard(draft, state.entries.length);
    if (!card) {
      return;
    }
    state.recallCards.push(card);
    els.recallQuestionInput.value = '';
    els.recallAnswerInput.value = '';
    renderRecall();
    announce('Recall card saved. It is due now and can appear at your next focus start.');
    save();
    els.recallQuestionInput.focus();
  }

  function handleRecallListClick(event) {
    const target = event.target;
    if (!target || typeof target.closest !== 'function') {
      return;
    }
    const button = target.closest('button[data-delete-id]');
    if (!button || !els.recallList.contains(button)) {
      return;
    }
    const id = button.getAttribute('data-delete-id');
    const before = state.recallCards.length;
    state.recallCards = state.recallCards.filter((card) => card.id !== id);
    if (state.recallCards.length === before) {
      return;
    }
    renderRecall();
    announce('Recall card deleted.');
    save();
    els.recallQuestionInput.focus();
  }

  function maybeOpenReview(action) {
    if (state.phase !== 'focus') {
      return false;
    }
    const helper = recallApi();
    if (!helper || !els.recallDialog) {
      return false;
    }
    if (els.recallDialog.open) {
      return true;
    }
    const card = helper.selectDueCard(state.recallCards, state.entries.length);
    if (!card) {
      return false;
    }

    pendingTimerAction = action;
    activeReviewCardId = card.id;
    els.recallQuestion.textContent = card.question;
    els.recallAnswer.textContent = '';
    els.recallAttempt.value = '';
    els.recallAttempt.removeAttribute('aria-invalid');
    els.recallAttemptError.textContent = '';
    els.recallAnswerBlock.hidden = true;
    els.recallReveal.hidden = false;
    els.recallReveal.disabled = true;
    if (els.recallDialogStatus) {
      els.recallDialogStatus.textContent = '';
    }

    if (typeof els.recallDialog.showModal === 'function') {
      els.recallDialog.showModal();
    } else {
      els.recallDialog.setAttribute('open', '');
    }
    els.recallAttempt.focus();
    announce('Recall check opened. Answer from memory before revealing the saved answer.');
    return true;
  }

  function closeReview(startNow) {
    const action = pendingTimerAction;
    pendingTimerAction = null;
    activeReviewCardId = null;

    els.recallQuestion.textContent = '';
    els.recallAnswer.textContent = '';
    els.recallAttempt.value = '';
    els.recallAttempt.removeAttribute('aria-invalid');
    els.recallAttemptError.textContent = '';
    els.recallAnswerBlock.hidden = true;
    els.recallReveal.hidden = false;
    els.recallReveal.disabled = true;
    if (els.recallDialogStatus) {
      els.recallDialogStatus.textContent = '';
    }

    if (els.recallDialog.open) {
      if (typeof els.recallDialog.close === 'function') {
        els.recallDialog.close();
      } else {
        els.recallDialog.removeAttribute('open');
      }
    }

    if (!startNow || !action) {
      return;
    }
    if (action === 'start') {
      performStart(true);
    } else if (action === 'resume') {
      performResume(true);
    }
  }

  function onAttemptInput() {
    if (els.recallAttemptError.textContent) {
      els.recallAttemptError.textContent = '';
      els.recallAttempt.removeAttribute('aria-invalid');
    }
    if (!els.recallAnswerBlock.hidden) {
      return;
    }
    els.recallReveal.disabled = els.recallAttempt.value.trim() === '';
  }

  function revealAnswer() {
    if (els.recallAttempt.value.trim() === '') {
      return;
    }
    let card = null;
    if (activeReviewCardId) {
      card = state.recallCards.find((item) => item.id === activeReviewCardId) || null;
    }
    if (!card) {
      return;
    }
    els.recallAttemptError.textContent = '';
    els.recallAttempt.removeAttribute('aria-invalid');
    els.recallAnswer.textContent = card.answer;
    els.recallAnswerBlock.hidden = false;
    els.recallReveal.hidden = true;
    const firstRating = els.recallRatingGroup.querySelector('button[data-rating]');
    if (firstRating) {
      firstRating.focus();
    }
    announceDialog('Saved answer revealed. Rate your recall as remembered, partly remembered, or missed.');
  }

  function rateReview(rating) {
    const helper = recallApi();
    const id = activeReviewCardId;
    const action = pendingTimerAction;
    if (!helper || !id) {
      closeReview(true);
      return;
    }
    const index = state.recallCards.findIndex((card) => card.id === id);
    if (index === -1) {
      closeReview(true);
      return;
    }
    const rescheduled = helper.rescheduleCard(state.recallCards[index], rating, state.entries.length);
    if (!rescheduled) {
      closeReview(true);
      return;
    }

    state.recallCards[index] = rescheduled;
    const interval = rescheduled.dueAtEntryCount - state.entries.length;
    const labels = { remembered: 'remembered', partly: 'partly remembered', missed: 'missed' };
    renderRecall();
    save();
    closeReview(true);
    announce('Rated ' + labels[rating] + '. Next review after ' + interval
      + ' more logged focus ' + (interval === 1 ? 'session' : 'sessions') + '. '
      + (action === 'resume' ? 'Focus timer resumed.' : 'Focus timer started.'));
  }

  function onRatingClick(event) {
    const target = event.target;
    if (!target || typeof target.closest !== 'function') {
      return;
    }
    const button = target.closest('button[data-rating]');
    if (!button || !els.recallRatingGroup.contains(button)) {
      return;
    }
    rateReview(button.getAttribute('data-rating'));
  }

  function onDialogCancel(event) {
    event.preventDefault();
    closeReview(false);
  }

  function renderAll() {
    renderTimer();
    renderLog();
    renderRecall();
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

    state.editingEntryIndex = null;
    state.entries.push({ minutes: parsed, ts: Date.now() });
    clearLogError();
    els.minutesInput.value = String(DEFAULT_LOG_MINUTES);
    renderLog();
    announce('Logged ' + parsed + ' minutes of focus. Today\u2019s total is '
      + todayTotalMinutes() + ' minutes.');
    save();
  }

  function rebaseRecallSchedules(previousCount, nextCount) {
    const helper = recallApi();
    if (!helper || previousCount <= nextCount) {
      return;
    }
    const removedCount = previousCount - nextCount;
    state.recallCards = helper.normalizeCards(state.recallCards).map((card) => Object.assign({}, card, {
      dueAtEntryCount: Math.max(nextCount, card.dueAtEntryCount - removedCount)
    }));
  }

  function resetAllLogs() {
    const count = state.entries.length;
    if (count === 0) {
      return;
    }
    const message = 'Reset all ' + count + ' focus session logs? This cannot be undone. '
      + 'Recall cards will be kept, and their remaining review gaps will be preserved.';
    if (typeof window.confirm !== 'function' || !window.confirm(message)) {
      return;
    }

    rebaseRecallSchedules(count, 0);
    state.entries = [];
    state.editingEntryIndex = null;
    renderAll();
    save();
    announce('Reset all ' + count + ' focus session logs. Recall cards were kept.');
  }

  function handleEntryListClick(event) {
    const button = event.target;
    const action = button && button.dataset && button.dataset.entryAction;
    const entryIndex = Number(button && button.dataset && button.dataset.entryIndex);
    if (!action || !Number.isInteger(entryIndex) || !state.entries[entryIndex]) {
      return;
    }

    if (action === 'edit') {
      state.editingEntryIndex = entryIndex;
      renderLog();
      const input = els.entryList.querySelector('#entry-edit-minutes-' + entryIndex);
      if (input) {
        input.focus();
      }
    } else if (action === 'cancel') {
      state.editingEntryIndex = null;
      renderLog();
      const editButton = els.entryList.querySelector('#entry-edit-' + entryIndex);
      if (editButton) {
        editButton.focus();
      }
    } else if (action === 'delete') {
      deleteLogEntry(entryIndex);
    }
  }

  function handleEntryListSubmit(event) {
    const form = event.target;
    const entryIndex = Number(form && form.dataset && form.dataset.entryIndex);
    if (!Number.isInteger(entryIndex) || !state.entries[entryIndex]) {
      return;
    }
    event.preventDefault();

    const input = form.querySelector('input[name="minutes"]');
    const error = form.querySelector('#entry-edit-error-' + entryIndex);
    const value = input.value.trim();
    const minutes = Number(value);
    if (value === '' || !Number.isInteger(minutes) || minutes < 1 || minutes > MAX_LOG_MINUTES) {
      error.textContent = value !== '' && Number.isFinite(minutes) && !Number.isInteger(minutes)
        ? 'Use whole minutes, like 25.'
        : 'Minutes must be a whole number from 1 to 1,440.';
      input.setAttribute('aria-invalid', 'true');
      input.focus();
      return;
    }

    const sessionNumber = entryIndex + 1;
    state.entries[entryIndex].minutes = minutes;
    state.editingEntryIndex = null;
    renderAll();
    save();
    announce('Updated focus session #' + sessionNumber + ' to ' + minutes + ' minutes.');
  }

  function deleteLogEntry(entryIndex) {
    const entry = state.entries[entryIndex];
    if (!entry) {
      return;
    }
    const sessionNumber = entryIndex + 1;
    const message = 'Delete focus session #' + sessionNumber + ' (' + entry.minutes + ' min)? '
      + 'It will be removed from totals and CSV export. This cannot be undone.';
    if (typeof window.confirm !== 'function' || !window.confirm(message)) {
      return;
    }

    const previousCount = state.entries.length;
    state.entries.splice(entryIndex, 1);
    rebaseRecallSchedules(previousCount, state.entries.length);
    state.editingEntryIndex = null;
    renderAll();
    save();
    announce('Deleted focus session #' + sessionNumber + '.');
    if (state.entries.length > 0) {
      els.entryList.focus();
    } else {
      els.minutesInput.focus();
    }
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
    els.exportBtn.addEventListener('click', exportCsv);
    els.form.addEventListener('submit', submitLog);
    els.minutesInput.addEventListener('input', clearLogError);
    els.resetLogBtn.addEventListener('click', resetAllLogs);
    els.entryList.addEventListener('click', handleEntryListClick);
    els.entryList.addEventListener('submit', handleEntryListSubmit);
    els.recallForm.addEventListener('submit', submitRecall);
    els.recallQuestionInput.addEventListener('input', () => clearRecallFieldError('question'));
    els.recallAnswerInput.addEventListener('input', () => clearRecallFieldError('answer'));
    els.recallList.addEventListener('click', handleRecallListClick);
    els.recallAttempt.addEventListener('input', onAttemptInput);
    els.recallReveal.addEventListener('click', revealAnswer);
    els.recallClose.addEventListener('click', () => closeReview(false));
    els.recallLater.addEventListener('click', () => closeReview(true));
    els.recallRatingGroup.addEventListener('click', onRatingClick);
    els.recallDialog.addEventListener('cancel', onDialogCancel);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', save);
    window.addEventListener('beforeunload', save);

    window.setInterval(tick, TICK_MS);
  }

  init();
})();
