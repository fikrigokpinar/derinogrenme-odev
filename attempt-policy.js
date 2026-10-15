// Local preview policy. Production limits must also be enforced by the database.
export const ATTEMPT_LIMITS = Object.freeze({code: 2, choice: 1});

export function createState(version) {
  return {version, forms: {}};
}

export function loadState(storage, key, version) {
  try {
    const value = JSON.parse(storage.getItem(key));
    if (value?.version === version && value.forms && typeof value.forms === 'object' && !Array.isArray(value.forms)) return value;
  } catch (_) { /* A blocked or corrupt local store must not prevent preview. */ }
  return createState(version);
}

export function saveState(storage, key, state) {
  try { storage.setItem(key, JSON.stringify(state)); return true; }
  catch (_) { return false; }
}

export function getEntry(state, formId, taskId) {
  state.forms[formId] ??= {};
  const existing = state.forms[formId][taskId];
  if (!existing || !Array.isArray(existing.attempts)) state.forms[formId][taskId] = {draft: null, attempts: []};
  return state.forms[formId][taskId];
}

export function saveDraft(state, formId, taskId, draft) {
  getEntry(state, formId, taskId).draft = draft;
}

export function attemptLimit(type, policy = ATTEMPT_LIMITS, taskId, questionLimits) {
  if (!(type in ATTEMPT_LIMITS)) throw new Error('Bilinmeyen soru türü');
  const personal = questionLimits?.[taskId];
  if (Number.isInteger(personal) && personal >= 1 && personal <= 1000) return personal;
  const value = policy?.[type];
  return Number.isInteger(value) && value >= 1 && value <= 100 ? value : ATTEMPT_LIMITS[type];
}

export function remainingAttempts(entry, type, policy, taskId, questionLimits) {
  return Math.max(0, attemptLimit(type, policy, taskId, questionLimits) - entry.attempts.length);
}

export function recordAttempt(state, formId, taskId, type, result, policy, questionLimits) {
  const entry = getEntry(state, formId, taskId);
  if (result.infrastructure || result.cancelled) throw new Error('Tamamlanmayan değerlendirme hak kullanamaz.');
  if (!remainingAttempts(entry, type, policy, taskId, questionLimits)) throw new Error('Bu soru için gönderim hakkı kalmadı.');
  if (!Number.isFinite(result.score) || !Number.isFinite(result.maxPoints) || result.score < 0 || result.score > result.maxPoints || result.maxPoints <= 0) throw new Error('Geçersiz değerlendirme puanı.');
  entry.attempts.push({...result, submittedAt: new Date().toISOString()});
  return entry;
}

export function bestScore(entry) {
  return Math.max(0, ...entry.attempts.map(attempt => Number.isFinite(attempt.score) ? attempt.score : 0));
}

export function scoreForm(state, formId) {
  return Object.values(state.forms[formId] || {}).reduce((total, entry) => total + bestScore(entry), 0);
}

export function resetForm(state, formId) { delete state.forms[formId]; }
