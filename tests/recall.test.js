'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const recall = require('../recall.js');

const STORAGE_KEY = 'study-session-planner.v1';
const APP_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

function createElement(tag) {
  const handlers = {};
  const element = {
    tagName: tag,
    children: [],
    textContent: '',
    className: '',
    disabled: false,
    value: '',
    hidden: false,
    open: false,
    dataset: {},
    style: {},
    attributes: {},
    handlers: handlers,
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attributes, name)
        ? this.attributes[name]
        : null;
    },
    removeAttribute(name) {
      delete this.attributes[name];
    },
    appendChild(child) {
      this.children.push(child);
      child.parentNode = this;
      return child;
    },
    addEventListener(type, handler) {
      handlers[type] = handler;
    },
    removeEventListener() {},
    focus() {},
    click() {
      let current = this;
      const event = {
        target: this,
        preventDefault() {}
      };
      while (current) {
        if (current.handlers && current.handlers.click) {
          current.handlers.click(event);
        }
        current = current.parentNode;
      }
    },
    remove() {},
    contains() {
      return false;
    },
    querySelector(selector) {
      const matches = (candidate) => {
        if (selector.charAt(0) === '#') {
          return candidate.id === selector.slice(1);
        }
        if (selector === 'input[name="minutes"]') {
          return candidate.tagName === 'input' && candidate.name === 'minutes';
        }
        return false;
      };
      const pending = this.children.slice();
      while (pending.length > 0) {
        const candidate = pending.shift();
        if (matches(candidate)) {
          return candidate;
        }
        pending.push(...candidate.children);
      }
      return null;
    },
    showModal() {
      this.open = true;
    },
    close() {
      this.open = false;
    }
  };
  Object.defineProperty(element, 'textContent', {
    get() {
      return this._textContent || '';
    },
    set(value) {
      this._textContent = String(value);
      this.children.length = 0;
    }
  });
  return element;
}

function runAppWithoutRecallHelper(storedValue, includeRecallHelper) {
  const elements = new Map();
  const document = {
    activeElement: null,
    visibilityState: 'visible',
    body: createElement('body'),
    getElementById(id) {
      if (!elements.has(id)) {
        elements.set(id, createElement(id));
      }
      return elements.get(id);
    },
    createElement(tag) {
      return createElement(tag);
    },
    addEventListener() {}
  };
  const storage = new Map();
  const confirmations = [];
  if (typeof storedValue === 'string') {
    storage.set(STORAGE_KEY, storedValue);
  }
  const listeners = {};
  const window = {
    StudyCsv: undefined,
    StudyRecall: includeRecallHelper ? recall : undefined,
    confirm(message) {
      confirmations.push(message);
      return true;
    },
    setTimeout() {
      return 0;
    },
    clearTimeout() {},
    setInterval() {
      return 0;
    },
    addEventListener(type, handler) {
      listeners[type] = handler;
    }
  };
  const context = {
    window,
    document,
    localStorage: {
      getItem(key) {
        return storage.has(key) ? storage.get(key) : null;
      },
      setItem(key, value) {
        storage.set(key, String(value));
      }
    },
    console: { warn() {}, log() {}, error() {} }
  };

  vm.runInNewContext(APP_SOURCE, context, { filename: 'app.js' });

  return {
    elements,
    storedValue() {
      return storage.get(STORAGE_KEY);
    },
    confirmations,
    triggerSave() {
      listeners.pagehide();
    }
  };
}

const storedSession = {
  version: 1,
  timer: { phase: 'focus', running: false, remainingMs: 25 * 60 * 1000, endsAt: null },
  entries: [{ minutes: 25, ts: 1000 }],
  recallCards: [
    {
      id: 'card-kept',
      question: 'What is spaced recall?',
      answer: 'Reviewing material after increasing gaps.',
      createdAt: 1000,
      dueAtEntryCount: 0
    },
    { id: 'broken', question: '', answer: '', createdAt: 1, dueAtEntryCount: 0 }
  ]
};

function baseCard(overrides) {
  return Object.assign({
    id: 'card-1',
    question: 'What is spaced recall?',
    answer: 'Reviewing material after increasing gaps.',
    createdAt: 1000,
    dueAtEntryCount: 0
  }, overrides);
}

test('validation trims and accepts a card inside both length limits', () => {
  const card = recall.normalizeCard(baseCard({
    question: '  What is spaced recall?  ',
    answer: '  Reviewing material after increasing gaps.  '
  }));
  assert.ok(card);
  assert.equal(card.question, 'What is spaced recall?');
  assert.equal(card.answer, 'Reviewing material after increasing gaps.');
});

test('validation rejects blank and over-long questions', () => {
  assert.equal(recall.normalizeCard(baseCard({ question: '' })), null);
  assert.equal(recall.normalizeCard(baseCard({ question: '    ' })), null);
  assert.equal(recall.normalizeCard(baseCard({ question: 'q'.repeat(201) })), null);
  assert.ok(recall.normalizeCard(baseCard({ question: 'q'.repeat(200) })));
});

test('validation rejects blank and over-long answers', () => {
  assert.equal(recall.normalizeCard(baseCard({ answer: '' })), null);
  assert.equal(recall.normalizeCard(baseCard({ answer: '    ' })), null);
  assert.equal(recall.normalizeCard(baseCard({ answer: 'a'.repeat(2001) })), null);
  assert.ok(recall.normalizeCard(baseCard({ answer: 'a'.repeat(2000) })));
});

test('validation rejects malformed identifiers, timestamps, and due counts', () => {
  assert.equal(recall.normalizeCard(null), null);
  assert.equal(recall.normalizeCard([]), null);
  assert.equal(recall.normalizeCard('card'), null);
  assert.equal(recall.normalizeCard(baseCard({ id: '' })), null);
  assert.equal(recall.normalizeCard(baseCard({ id: '   ' })), null);
  assert.equal(recall.normalizeCard(baseCard({ id: 12 })), null);
  assert.equal(recall.normalizeCard(baseCard({ createdAt: 'now' })), null);
  assert.equal(recall.normalizeCard(baseCard({ createdAt: -1 })), null);
  assert.equal(recall.normalizeCard(baseCard({ dueAtEntryCount: 1.5 })), null);
  assert.equal(recall.normalizeCard(baseCard({ dueAtEntryCount: -1 })), null);
  assert.ok(recall.normalizeCard(baseCard({ dueAtEntryCount: 0 })));
});

test('draft validation explains each invalid field', () => {
  const empty = recall.validateDraft({ question: '   ', answer: '' });
  assert.equal(empty.ok, false);
  assert.match(empty.errors.question, /question/i);
  assert.match(empty.errors.answer, /answer/i);

  const tooLong = recall.validateDraft({
    question: 'q'.repeat(201),
    answer: 'a'.repeat(2001)
  });
  assert.equal(tooLong.ok, false);
  assert.match(tooLong.errors.question, /200/);
  assert.match(tooLong.errors.answer, /2,000/);

  const valid = { question: '  What is a recall card?  ', answer: '  A question and a hidden answer.  ' };
  assert.deepEqual(recall.validateDraft(valid), {
    ok: true,
    question: 'What is a recall card?',
    answer: 'A question and a hidden answer.',
    errors: {}
  });
});

test('a newly created card is due at the current logged entry count', () => {
  const draft = { question: 'What is a recall card?', answer: 'A question and a hidden answer.' };
  const card = recall.createCard(draft, 4, { now: 5000, id: 'card-new' });
  assert.deepEqual(card, {
    id: 'card-new',
    question: draft.question,
    answer: draft.answer,
    createdAt: 5000,
    dueAtEntryCount: 4,
    reviewCount: 0,
    rememberedStreak: 0,
    lastRating: null
  });
  assert.equal(card.dueAtEntryCount, 4);
});

test('creating a card refuses an invalid draft', () => {
  assert.equal(recall.createCard({ question: '', answer: '' }, 4), null);
  assert.equal(recall.createCard({ question: 'q'.repeat(201), answer: 'a' }, 4), null);
  assert.equal(recall.createCard({ question: 'q', answer: 'a'.repeat(2001) }, 4), null);
});

test('the due check is inclusive of the logged entry count', () => {
  assert.equal(recall.isDue(baseCard({ dueAtEntryCount: 3 }), 3), true);
  assert.equal(recall.isDue(baseCard({ dueAtEntryCount: 3 }), 2), false);
  assert.equal(recall.isDue(baseCard({ dueAtEntryCount: 0 }), 0), true);
  assert.equal(recall.isDue(baseCard({ dueAtEntryCount: 5 }), 9), true);
  assert.equal(recall.isDue(baseCard({ dueAtEntryCount: 3 }), -1), false);
});

test('selection returns the earliest due card and skips future cards', () => {
  const cards = [
    baseCard({ id: 'later', dueAtEntryCount: 8 }),
    baseCard({ id: 'earliest', dueAtEntryCount: 2 }),
    baseCard({ id: 'middle', dueAtEntryCount: 5 }),
    baseCard({ id: 'future', dueAtEntryCount: 20 })
  ];
  const picked = recall.selectDueCard(cards, 6);
  assert.ok(picked);
  assert.equal(picked.id, 'earliest');
});

test('selection breaks due ties by creation time then id', () => {
  const cards = [
    baseCard({ id: 'b', dueAtEntryCount: 2, createdAt: 2000 }),
    baseCard({ id: 'a', dueAtEntryCount: 2, createdAt: 2000 }),
    baseCard({ id: 'older', dueAtEntryCount: 2, createdAt: 1000 })
  ];
  assert.equal(recall.selectDueCard(cards, 10).id, 'older');
  assert.equal(recall.selectDueCard([cards[0], cards[1]], 10).id, 'a');
});

test('selection returns null when nothing is due or input is missing', () => {
  assert.equal(recall.selectDueCard([baseCard({ dueAtEntryCount: 9 })], 3), null);
  assert.equal(recall.selectDueCard([], 3), null);
  assert.equal(recall.selectDueCard(null, 3), null);
  assert.equal(recall.selectDueCard(undefined, 3), null);
});

test('selection ignores a malformed card but keeps a valid due card', () => {
  const picked = recall.selectDueCard([
    { id: 'broken', question: '', answer: '', createdAt: 1, dueAtEntryCount: 0 },
    baseCard({ id: 'valid', dueAtEntryCount: 1 })
  ], 3);
  assert.ok(picked);
  assert.equal(picked.id, 'valid');
});

test('legacy cards gain adaptive recall progress defaults without losing their content', () => {
  const card = recall.normalizeCard(baseCard());

  assert.ok(card);
  assert.equal(card.question, 'What is spaced recall?');
  assert.equal(card.answer, 'Reviewing material after increasing gaps.');
  assert.equal(card.reviewCount, 0);
  assert.equal(card.rememberedStreak, 0);
  assert.equal(card.lastRating, null);
});

test('remembered intervals grow with consecutive successful recall and cap at 36 focus sessions', () => {
  const intervals = [];
  for (let streak = 0; streak <= 6; streak += 1) {
    intervals.push(recall.nextDueAtEntryCount('remembered', 10, streak) - 10);
  }

  assert.deepEqual(intervals, [3, 6, 12, 24, 36, 36, 36]);
});

test('remembered reviews increase the review count and streak', () => {
  const result = recall.rescheduleCard(baseCard({
    reviewCount: 2,
    rememberedStreak: 1,
    lastRating: 'remembered'
  }), 'remembered', 4);

  assert.ok(result);
  assert.equal(result.dueAtEntryCount, 10);
  assert.equal(result.reviewCount, 3);
  assert.equal(result.rememberedStreak, 2);
  assert.equal(result.lastRating, 'remembered');
});

test('partly and missed ratings reset the success streak and keep the review history', () => {
  const prior = baseCard({
    reviewCount: 8,
    rememberedStreak: 4,
    lastRating: 'remembered'
  });
  const partly = recall.rescheduleCard(prior, 'partly', 4);
  const missed = recall.rescheduleCard(prior, 'missed', 4);

  assert.equal(partly.dueAtEntryCount, 6);
  assert.equal(partly.reviewCount, 9);
  assert.equal(partly.rememberedStreak, 0);
  assert.equal(partly.lastRating, 'partly');
  assert.equal(missed.dueAtEntryCount, 5);
  assert.equal(missed.reviewCount, 9);
  assert.equal(missed.rememberedStreak, 0);
  assert.equal(missed.lastRating, 'missed');
});

test('recall dashboard summarizes due, rotating, long-term, and reviewed cards', () => {
  const stored = Object.assign({}, storedSession, {
    recallCards: [
      baseCard({ id: 'due-card', dueAtEntryCount: 0 }),
      baseCard({
        id: 'long-term-card',
        dueAtEntryCount: 4,
        reviewCount: 4,
        rememberedStreak: 4,
        lastRating: 'remembered'
      })
    ]
  });
  const app = runAppWithoutRecallHelper(JSON.stringify(stored), true);

  assert.equal(app.elements.get('recall-due-count').textContent, '1');
  assert.equal(app.elements.get('recall-rotation-count').textContent, '1');
  assert.equal(app.elements.get('recall-long-term-count').textContent, '1');
  assert.equal(app.elements.get('recall-review-count').textContent, '4');
  const longTermMeta = app.elements.get('recall-list').children[0].children[0].children[1];
  assert.match(longTermMeta.textContent, /Long-term · 4 reviews · Last: remembered/);
});

test('focus history shows six recent entries and full-history view includes those six', () => {
  const entries = [];
  for (let i = 1; i <= 8; i += 1) {
    entries.push({ minutes: i, ts: 1000 + i });
  }
  const stored = Object.assign({}, storedSession, { entries: entries });
  const app = runAppWithoutRecallHelper(JSON.stringify(stored));
  const list = app.elements.get('entry-list');
  const toggle = app.elements.get('entry-history-toggle');

  assert.equal(list.children.length, 6);
  assert.deepEqual(list.children.map((item) => item.children[2].textContent), [
    '8 min', '7 min', '6 min', '5 min', '4 min', '3 min'
  ]);
  assert.deepEqual(list.children.map((item) => item.children[0].textContent), [
    '#8', '#7', '#6', '#5', '#4', '#3'
  ]);
  assert.equal(toggle.hidden, false);
  assert.equal(toggle.textContent, 'Show all 8 sessions');
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');

  toggle.click();
  assert.equal(list.children.length, 8);
  assert.deepEqual(list.children.map((item) => item.children[0].textContent), [
    '#8', '#7', '#6', '#5', '#4', '#3', '#2', '#1'
  ]);
  assert.equal(toggle.textContent, 'Show recent 6 sessions');
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');

  toggle.click();
  assert.equal(list.children.length, 6);
});

test('focus history hides its full-history control at six or fewer sessions', () => {
  const stored = Object.assign({}, storedSession, {
    entries: Array.from({ length: 6 }, (_, index) => ({ minutes: 25, ts: 1000 + index }))
  });
  const app = runAppWithoutRecallHelper(JSON.stringify(stored));

  assert.equal(app.elements.get('entry-list').children.length, 6);
  assert.equal(app.elements.get('entry-history-toggle').hidden, true);
});

test('editing a session updates its minutes and the corresponding totals', () => {
  const stored = Object.assign({}, storedSession, {
    entries: [
      { minutes: 25, ts: Date.now() },
      { minutes: 40, ts: Date.now() + 1 }
    ]
  });
  const app = runAppWithoutRecallHelper(JSON.stringify(stored), true);
  const list = app.elements.get('entry-list');

  list.children[0].children[3].click();
  const form = list.children[0].children[0];
  const input = form.querySelector('input[name="minutes"]');
  input.value = '90';
  list.handlers.submit({ target: form, preventDefault() {} });

  const saved = JSON.parse(app.storedValue());
  assert.equal(saved.entries[1].minutes, 90);
  assert.equal(app.elements.get('today-total').textContent, '115');
});

test('deleting one session updates totals and preserves remaining recall intervals', () => {
  const stored = Object.assign({}, storedSession, {
    entries: [
      { minutes: 25, ts: Date.now() },
      { minutes: 40, ts: Date.now() + 1 }
    ],
    recallCards: [baseCard({ dueAtEntryCount: 5 })]
  });
  const app = runAppWithoutRecallHelper(JSON.stringify(stored), true);
  const list = app.elements.get('entry-list');

  list.children[0].children[3].click();
  const form = list.children[0].children[0];
  const deleteButton = form.children[3].children.find((child) => child.dataset.entryAction === 'delete');
  deleteButton.click();

  const saved = JSON.parse(app.storedValue());
  assert.equal(saved.entries.length, 1);
  assert.equal(saved.entries[0].minutes, 25);
  assert.equal(saved.recallCards[0].dueAtEntryCount, 4);
  assert.equal(app.elements.get('today-total').textContent, '25');
  assert.match(app.confirmations[0], /Delete focus session #2/);
});

test('reset all focus logs clears entries but preserves recall cards and remaining gaps', () => {
  const entries = Array.from({ length: 8 }, (_, index) => ({ minutes: 25, ts: Date.now() + index }));
  const stored = Object.assign({}, storedSession, {
    entries: entries,
    recallCards: [baseCard({ dueAtEntryCount: 10, reviewCount: 2 })]
  });
  const app = runAppWithoutRecallHelper(JSON.stringify(stored), true);

  app.elements.get('reset-log-btn').click();

  const saved = JSON.parse(app.storedValue());
  assert.deepEqual(saved.entries, []);
  assert.equal(saved.recallCards.length, 1);
  assert.equal(saved.recallCards[0].dueAtEntryCount, 2);
  assert.equal(saved.recallCards[0].reviewCount, 2);
  assert.equal(app.elements.get('today-total').textContent, '0');
  assert.match(app.confirmations[0], /Reset all 8 focus session logs/);
});
test('remembered reschedules three logged entries from the current count', () => {
  const result = recall.rescheduleCard(baseCard({ dueAtEntryCount: 2 }), 'remembered', 4);
  assert.ok(result);
  assert.equal(result.dueAtEntryCount, 7);
  assert.equal(result.id, 'card-1');
});

test('partly remembered reschedules two logged entries from the current count', () => {
  const result = recall.rescheduleCard(baseCard({ dueAtEntryCount: 2 }), 'partly', 4);
  assert.ok(result);
  assert.equal(result.dueAtEntryCount, 6);
});

test('missed reschedules one logged entry from the current count', () => {
  const result = recall.rescheduleCard(baseCard({ dueAtEntryCount: 2 }), 'missed', 4);
  assert.ok(result);
  assert.equal(result.dueAtEntryCount, 5);
});

test('rescheduling rejects unknown ratings, invalid counts, and malformed cards', () => {
  assert.equal(recall.rescheduleCard(baseCard(), 'later', 4), null);
  assert.equal(recall.rescheduleCard(baseCard(), 'remembered', -1), null);
  assert.equal(recall.rescheduleCard(baseCard({ question: '' }), 'remembered', 4), null);
  assert.equal(recall.nextDueAtEntryCount('remembered', 0), 3);
  assert.equal(recall.nextDueAtEntryCount('partly', 0), 2);
  assert.equal(recall.nextDueAtEntryCount('missed', 0), 1);
  assert.equal(recall.nextDueAtEntryCount('unknown', 0), null);
});

test('normalization keeps valid cards and ignores malformed cards individually', () => {
  const validA = baseCard({ id: 'a' });
  const validB = baseCard({ id: 'b', dueAtEntryCount: 2 });
  const cards = recall.normalizeCards([null, validA, 'nope', { id: 'x' }, validB, 42]);
  assert.deepEqual(cards.map((card) => card.id), ['a', 'b']);
  assert.equal(cards.length, 2);
});

test('legacy or missing recall data behaves as an empty collection', () => {
  assert.deepEqual(recall.normalizeCards(undefined), []);
  assert.deepEqual(recall.normalizeCards(null), []);
  assert.deepEqual(recall.normalizeCards({}), []);
  assert.deepEqual(recall.normalizeCards([]), []);
});

test('normalization does not mutate or return the stored card objects', () => {
  const raw = baseCard();
  const before = JSON.stringify(raw);
  const cards = recall.normalizeCards([raw]);
  assert.equal(JSON.stringify(raw), before);
  assert.notEqual(cards[0], raw);
});

test('an unavailable recall helper preserves stored cards through a normal save', () => {
  const app = runAppWithoutRecallHelper(JSON.stringify(storedSession));
  app.triggerSave();

  const saved = JSON.parse(app.storedValue());
  assert.deepEqual(saved.recallCards, storedSession.recallCards);
  assert.deepEqual(saved.entries, storedSession.entries);
  assert.equal(saved.timer.phase, 'focus');
});

test('an unavailable recall helper shows a notice instead of rendering stored cards', () => {
  const app = runAppWithoutRecallHelper(JSON.stringify(storedSession));
  const list = app.elements.get('recall-list');

  assert.equal(list.children.length, 1);
  assert.equal(list.children[0].className, 'recall-empty');
  assert.match(list.children[0].textContent, /helper script did not load/i);
  assert.ok(!list.children.some((item) => item.textContent === 'What is spaced recall?'));
});
