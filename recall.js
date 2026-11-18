'use strict';

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module !== null && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.StudyRecall = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this), function () {
  'use strict';

  const MAX_QUESTION_LENGTH = 200;
  const MAX_ANSWER_LENGTH = 2000;
  const RATING_INTERVALS = Object.freeze({
    remembered: 3,
    partly: 2,
    missed: 1
  });

  let idCounter = 0;

  function trimString(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function validateDraft(draft) {
    const question = trimString(draft && draft.question);
    const answer = trimString(draft && draft.answer);
    const errors = {};

    if (question.length === 0) {
      errors.question = 'Enter a question to recall later.';
    } else if (question.length > MAX_QUESTION_LENGTH) {
      errors.question = 'Keep the question to 200 characters or fewer.';
    }

    if (answer.length === 0) {
      errors.answer = 'Enter the saved answer you want to check yourself against.';
    } else if (answer.length > MAX_ANSWER_LENGTH) {
      errors.answer = 'Keep the answer to 2,000 characters or fewer.';
    }

    return {
      ok: Object.keys(errors).length === 0,
      question: question,
      answer: answer,
      errors: errors
    };
  }

  function isValidCard(raw) {
    if (!isPlainObject(raw)) {
      return false;
    }
    if (typeof raw.id !== 'string' || raw.id.trim() === '') {
      return false;
    }
    const question = trimString(raw.question);
    const answer = trimString(raw.answer);
    if (question.length < 1 || question.length > MAX_QUESTION_LENGTH) {
      return false;
    }
    if (answer.length < 1 || answer.length > MAX_ANSWER_LENGTH) {
      return false;
    }
    if (typeof raw.createdAt !== 'number' || !isFinite(raw.createdAt) || raw.createdAt < 0) {
      return false;
    }
    if (!Number.isInteger(raw.dueAtEntryCount) || raw.dueAtEntryCount < 0) {
      return false;
    }
    return true;
  }

  function normalizeCard(raw) {
    if (!isValidCard(raw)) {
      return null;
    }
    return {
      id: raw.id,
      question: raw.question.trim(),
      answer: raw.answer.trim(),
      createdAt: raw.createdAt,
      dueAtEntryCount: raw.dueAtEntryCount
    };
  }

  function normalizeCards(raw) {
    if (!Array.isArray(raw)) {
      return [];
    }
    const cards = [];
    for (let i = 0; i < raw.length; i += 1) {
      const card = normalizeCard(raw[i]);
      if (card) {
        cards.push(card);
      }
    }
    return cards;
  }

  function generateId(now) {
    idCounter += 1;
    return 'card-' + now.toString(36) + '-' + idCounter.toString(36) + '-'
      + Math.random().toString(36).slice(2, 8);
  }

  function createCard(draft, entryCount, options) {
    const result = validateDraft(draft);
    if (!result.ok) {
      return null;
    }
    const opts = isPlainObject(options) ? options : {};
    const now = typeof opts.now === 'number' && isFinite(opts.now) && opts.now >= 0
      ? opts.now
      : Date.now();
    const id = typeof opts.id === 'string' && opts.id.trim() !== ''
      ? opts.id
      : generateId(now);
    const dueAtEntryCount = Number.isInteger(entryCount) && entryCount >= 0 ? entryCount : 0;

    return {
      id: id,
      question: result.question,
      answer: result.answer,
      createdAt: now,
      dueAtEntryCount: dueAtEntryCount
    };
  }

  function isDue(card, entryCount) {
    if (!isValidCard(card)) {
      return false;
    }
    if (!Number.isInteger(entryCount) || entryCount < 0) {
      return false;
    }
    return card.dueAtEntryCount <= entryCount;
  }

  function compareCards(a, b) {
    if (a.dueAtEntryCount !== b.dueAtEntryCount) {
      return a.dueAtEntryCount - b.dueAtEntryCount;
    }
    if (a.createdAt !== b.createdAt) {
      return a.createdAt - b.createdAt;
    }
    if (a.id < b.id) {
      return -1;
    }
    if (a.id > b.id) {
      return 1;
    }
    return 0;
  }

  function selectDueCard(cards, entryCount) {
    if (!Array.isArray(cards)) {
      return null;
    }
    if (!Number.isInteger(entryCount) || entryCount < 0) {
      return null;
    }

    let best = null;
    for (let i = 0; i < cards.length; i += 1) {
      const card = normalizeCard(cards[i]);
      if (!card || card.dueAtEntryCount > entryCount) {
        continue;
      }
      if (best === null || compareCards(card, best) < 0) {
        best = card;
      }
    }
    return best;
  }

  function nextDueAtEntryCount(rating, entryCount) {
    if (!Object.prototype.hasOwnProperty.call(RATING_INTERVALS, rating)) {
      return null;
    }
    if (!Number.isInteger(entryCount) || entryCount < 0) {
      return null;
    }
    return entryCount + RATING_INTERVALS[rating];
  }

  function rescheduleCard(card, rating, entryCount) {
    const normalized = normalizeCard(card);
    if (!normalized) {
      return null;
    }
    const nextDue = nextDueAtEntryCount(rating, entryCount);
    if (nextDue === null) {
      return null;
    }
    return {
      id: normalized.id,
      question: normalized.question,
      answer: normalized.answer,
      createdAt: normalized.createdAt,
      dueAtEntryCount: nextDue
    };
  }

  return {
    MAX_QUESTION_LENGTH: MAX_QUESTION_LENGTH,
    MAX_ANSWER_LENGTH: MAX_ANSWER_LENGTH,
    RATING_INTERVALS: RATING_INTERVALS,
    validateDraft: validateDraft,
    isValidCard: isValidCard,
    normalizeCard: normalizeCard,
    normalizeCards: normalizeCards,
    createCard: createCard,
    isDue: isDue,
    selectDueCard: selectDueCard,
    nextDueAtEntryCount: nextDueAtEntryCount,
    rescheduleCard: rescheduleCard
  };
});
