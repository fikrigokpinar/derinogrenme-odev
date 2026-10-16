import {getCloudClient, requireCloudSession} from './cloud-client.js';
import {availabilityStatus} from './teacher/assignment-availability.js';

const clone = value => JSON.parse(JSON.stringify(value));
export function clearStudentPublications(form) {
  form.grades_published = false; form.grades_published_at = null;
  form.solutions_published = false; form.solutions_published_at = null; form.solutions = [];
  if (form.result_summary) { form.result_summary.total = null; form.result_summary.finalScore = null; }
  form.teacher_grade = null;
}
export function publicationChanged(form, latest) {
  return ['grades','solutions'].some(kind => (latest[`${kind}_published`] === true) !== form[`${kind}_published`] || (latest[`${kind}_published_at`] || null) !== (form[`${kind}_published_at`] || null));
}
export const isAvailabilityError = error => ['ASSIGNMENT_CLOSED','DEADLINE_PASSED','FORM_CHANGED'].includes(error?.code);
export function normalizeAttemptPolicy(value) {
  if (value === undefined) return {code:2,choice:1};
  if (!value || !['code','choice'].every(type => Number.isInteger(value[type]) && value[type] >= 1 && value[type] <= 100)) {
    throw new Error('Ödevin deneme hakları doğrulanamadı. Sayfayı yenileyin.');
  }
  return {code:value.code,choice:value.choice};
}
export function normalizeQuestionAttemptLimits(value, form = null) {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Sorunun ek deneme hakkı doğrulanamadı.');
  const ids = form && new Set(form.questions.flatMap(question => question.type === 'code' ? [question.id] : (question.items || []).map(item => item.id)));
  const limits = {};
  for (const [id,limit] of Object.entries(value)) {
    if (!/^Q[1-9]\d*(?:\.[1-9]\d*)?$/.test(id) || (ids && !ids.has(id)) || !Number.isInteger(limit) || limit < 1 || limit > 1000) {
      throw new Error('Sorunun ek deneme hakkı doğrulanamadı.');
    }
    limits[id] = limit;
  }
  return limits;
}

// Only real student payloads pass through this boundary. Teacher simulations
// keep their private grading keys, while student responses never expose them.
export function stripStudentAnswers(snapshot) {
  const privateFields = ['correct_option','explanation','solution','solution_code','reference_solution','reference_code','score','bestScore','correct','is_correct','isCorrect','checks','error','feedback'];
  const strip = object => { if (object && typeof object === 'object') for (const field of privateFields) delete object[field]; };
  for (const form of snapshot.data.forms) {
    // Missing publication metadata is closed, including old API/cache data.
    if (!form.result_summary) {
      const entries = Object.values(snapshot.attemptState.forms[form.id] || {});
      form.result_summary = {
        total:null,
        completed:entries.filter(entry => entry.attempts?.length).length,
        totalTasks:form.questions.reduce((sum,question) => sum + (question.type === 'code' ? 1 : (question.items || []).length),0),
        finalScore:null
      };
    }
    const summary = form.result_summary;
    form.result_summary = {
      total:Number.isFinite(summary.total) ? summary.total : null,
      completed:Number.isInteger(summary.completed) && summary.completed >= 0 ? summary.completed : 0,
      totalTasks:form.questions.reduce((sum,question) => sum + (question.type === 'code' ? 1 : (question.items || []).length),0),
      finalScore:Number.isFinite(summary.finalScore) ? summary.finalScore : null
    };
    form.grades_published = form.grades_published === true && form.availability?.isOpen === false;
    form.grades_published_at = form.grades_published ? form.grades_published_at || null : null;
    if (!form.grades_published) {
      form.result_summary.total = null;
      form.result_summary.finalScore = null;
      form.teacher_grade = null;
    }
    // Declassify only the API's explicit release payload for this assigned form.
    // Ordinary questions, grading keys and historical attempts remain private.
    const tasks = new Map(form.questions.flatMap(q => q.type === 'code' ? [[q.id,q]] : (q.items || []).map(item => [item.id,item])));
    const released = form.solutions_published === true && form.availability?.isOpen === false;
    const seen = new Set();
    form.solutions = released && Array.isArray(form.solutions) ? form.solutions.flatMap(solution => {
      const task = tasks.get(solution?.id);
      if (!task || seen.has(solution.id)) return [];
      seen.add(solution.id);
      if (solution.type === 'code' && task.type === 'code' && typeof solution.solution_code === 'string') {
        return [{id:solution.id,type:'code',title:String(solution.title || task.title || ''),prompt:clone(solution.prompt ?? task.prompt ?? ''),solution_code:solution.solution_code}];
      }
      if (solution.type === 'choice' && task.type !== 'code' && Array.isArray(task.options) && task.options.some(option => option.id === solution.correct_option)) {
        return [{id:solution.id,type:'choice',prompt:clone(solution.prompt ?? task.prompt ?? ''),options:task.options.map(option => ({id:option.id,text:String(option.text || '')})),correct_option:solution.correct_option,explanation:String(solution.explanation || '')}];
      }
      return [];
    }) : [];
    form.solutions_published = released;
    form.solutions_published_at = released ? form.solutions_published_at || null : null;
    if (form.teacher_grade) form.teacher_grade = {
      score:form.teacher_grade.score,reviewedAt:form.teacher_grade.reviewedAt,
      ...(released && typeof form.teacher_grade.note === 'string' ? {note:form.teacher_grade.note} : {})
    };
    strip(form);
    for (const question of form.questions) {
      strip(question);
      for (const item of question.items || []) strip(item);
    }
  }
  const notifications = Array.isArray(snapshot.data.notifications) ? snapshot.data.notifications : [];
  const seenNotifications = new Set();
  snapshot.data.notifications = notifications.flatMap(item => {
    const form = snapshot.data.forms.find(form => form.id === item?.form_id && form.homework_id === item?.homework_id);
    if (!form || !['grades','solutions'].includes(item.kind) || !form[`${item.kind}_published`] || typeof item.id !== 'string' || seenNotifications.has(item.id) || item.publishedAt !== form[`${item.kind}_published_at`]) return [];
    seenNotifications.add(item.id);
    return [{id:item.id,kind:item.kind,homework_id:form.homework_id,form_id:form.id,title:String(item.title || ''),message:String(item.message || ''),publishedAt:item.publishedAt}];
  });
  for (const keys of Object.values(snapshot.assessment.forms || {})) for (const key of Object.values(keys)) strip(key);
  const visibleAttemptFields = new Set(['submittedAt','submittedCode','selectedOption','provisional']);
  for (const entries of Object.values(snapshot.attemptState.forms)) for (const entry of Object.values(entries)) {
    for (const field of Object.keys(entry)) if (!['draft','attempts'].includes(field)) delete entry[field];
    for (const attempt of entry.attempts || []) for (const field of Object.keys(attempt)) if (!visibleAttemptFields.has(field)) delete attempt[field];
  }
  if (snapshot.lastAttempt) {
    for (const field of Object.keys(snapshot.lastAttempt)) if (!['formId','taskId','attempt'].includes(field)) delete snapshot.lastAttempt[field];
    if (snapshot.lastAttempt.attempt) for (const field of Object.keys(snapshot.lastAttempt.attempt)) if (!visibleAttemptFields.has(field)) delete snapshot.lastAttempt.attempt[field];
  }
  return snapshot;
}

// The cloud clock advances from the last server timestamp, independently of
// changes to the computer's calendar clock while the page is open.
export class AvailabilityClock {
  constructor(monotonicNow = () => performance.now()) { this.monotonicNow = monotonicNow; this.anchors = new Map(); }
  update(formId, availability) {
    if (!availability) { this.anchors.delete(formId); return; }
    const serverTime = Date.parse(availability.serverNow);
    if (!Number.isFinite(serverTime) || !(availability.personalDeadline === undefined || typeof availability.personalDeadline === 'boolean')) {
      throw new Error('Ödevin sunucu saati doğrulanamadı. Sayfayı yenileyin.');
    }
    this.anchors.set(formId,{settings:clone(availability),serverTime,elapsedAt:this.monotonicNow()});
  }
  status(formId) {
    const anchor = this.anchors.get(formId);
    if (!anchor) return availabilityStatus({}); // Legacy preview data.
    const now = anchor.serverTime + Math.max(0,this.monotonicNow() - anchor.elapsedAt);
    const status = availabilityStatus(anchor.settings,{approved:anchor.settings.reason !== 'unapproved',now});
    if (anchor.settings.personalDeadline === true) status.personalDeadline = true;
    return anchor.forcedReason ? {...status,isOpen:false,reason:anchor.forcedReason} : status;
  }
  close(formId, reason) {
    const anchor = this.anchors.get(formId);
    if (anchor) {
      anchor.forcedReason = reason;
    } else {
      this.update(formId,{active:false,deadline:null,serverNow:new Date(0).toISOString(),reason:'inactive'});
    }
  }
}

function closedError(status) {
  return Object.assign(new Error(status.reason === 'expired' ? 'Ödevin son teslim tarihi geçti. Yeni yanıt gönderilemez.' : 'Bu ödev kapalı. Yeni yanıt gönderilemez.'),
    {status:403,code:status.reason === 'expired' ? 'DEADLINE_PASSED' : 'ASSIGNMENT_CLOSED'});
}

function validateSnapshot(snapshot) {
  if (!snapshot?.student || !snapshot?.term || !snapshot?.data ||
      !Array.isArray(snapshot.data.forms) ||
      snapshot.data.content_version !== snapshot.assessment?.content_version ||
      snapshot.attemptState?.version !== snapshot.data.content_version ||
      !snapshot.attemptState?.forms || !snapshot.revisions) {
    throw new Error('Öğrenci ödev verileri eksik veya sürümleri uyuşmuyor.');
  }
  const policies = snapshot.data.forms.map(form => normalizeAttemptPolicy(form.attempt_policy));
  const questionLimits = snapshot.data.forms.map(form => normalizeQuestionAttemptLimits(form.question_attempt_limits,form));
  snapshot.data.forms.forEach((form,index) => {
    form.attempt_policy = policies[index];
    form.question_attempt_limits = questionLimits[index];
  });
  return stripStudentAnswers(snapshot);
}

function validateAvailabilityResponse(response) {
  if (!Array.isArray(response?.forms)) throw new Error('Ödevin teslim durumu doğrulanamadı.');
  const seen = new Set();
  for (const form of response.forms) {
    const status = form?.availability;
    if (typeof form?.id !== 'string' || seen.has(form.id) || !Number.isInteger(form.revision) || form.revision < 1 ||
        typeof status?.active !== 'boolean' || typeof status?.isOpen !== 'boolean' ||
        !['active','inactive','expired','unapproved'].includes(status?.reason) ||
        !(status.deadline === null || (typeof status.deadline === 'string' && Number.isFinite(Date.parse(status.deadline)))) ||
        !Number.isFinite(Date.parse(status?.serverNow)) ||
        !(status.personalDeadline === undefined || typeof status.personalDeadline === 'boolean')) throw new Error('Ödevin teslim durumu doğrulanamadı.');
    seen.add(form.id);
    normalizeAttemptPolicy(form.attempt_policy);
    normalizeQuestionAttemptLimits(form.question_attempt_limits);
  }
  return response.forms;
}

// All network writes are ordered. Drafts capture their form and revision when
// edited; a late autosave cannot apply a snapshot to a different open form.
export class CloudStudentContext {
  constructor(client, profile, snapshot, {onDraftError = () => {}, onAvailabilityChange = () => {}, delay = 500, cache = null, monotonicNow} = {}) {
    this.client = client;
    this.profile = profile;
    this.snapshot = validateSnapshot(snapshot);
    this.onDraftError = onDraftError;
    this.onAvailabilityChange = onAvailabilityChange;
    this.clock = new AvailabilityClock(monotonicNow);
    for (const form of snapshot.data.forms) this.clock.update(form.id,form.availability);
    this.refreshingAvailability = null;
    this.delay = delay;
    this.drafts = new Map();
    this.pending = new Map();
    this.changedForms = new Set();
    this.timer = null;
    this.queue = Promise.resolve();
    this.cache = cache;
    this.cacheKey = `tensor-cloud-pending:${profile.userId}:${snapshot.term.id}:${snapshot.data.content_version}`;
    try {
      const saved = JSON.parse(cache?.getItem(this.cacheKey) || '[]');
      for (const [key, request] of saved) {
        if (request?.requestId && request.termId === snapshot.term.id &&
            snapshot.data.forms.some(form => form.id === key.split('/')[0] && request.formId === form.id && form.homework_id === request.homeworkId && snapshot.revisions[form.id] === request.revision)) {
          this.pending.set(key, request);
        }
      }
    } catch (_) { /* A blocked recovery cache must not block cloud use. */ }
  }
  get student() { return this.snapshot.student; }
  get term() { return this.snapshot.term; }
  get data() { return this.snapshot.data; }
  get assessment() { return this.snapshot.assessment; }
  get attemptState() { return this.snapshot.attemptState; }
  get revisions() { return this.snapshot.revisions; }
  key(formId, taskId) { return `${formId}/${taskId}`; }
  payload(formId, taskId) {
    const form = this.data.forms.find(item => item.id === formId);
    if (!form || !this.revisions[formId]) throw new Error('Ödev sürümü değişti. Sayfayı yenileyin.');
    return {termId:this.term.id, homeworkId:form.homework_id, formId, revision:this.revisions[formId], taskId};
  }
  enqueue(work) {
    const result = this.queue.then(work, work);
    this.queue = result.catch(() => {});
    return result;
  }
  saveRecovery() {
    try { this.cache?.setItem(this.cacheKey, JSON.stringify([...this.pending])); } catch (_) {}
  }
  pendingAttempt(formId, taskId) { return this.pending.get(this.key(formId, taskId)); }
  isFormChanged(formId) { return this.changedForms.has(formId); }
  availability(formId) { return this.clock.status(formId); }
  assertOpen(formId) {
    if (this.changedForms.has(formId)) throw Object.assign(new Error('Bu ödevdeki form ataman değişti. Güncel formu açmak için sayfayı yenile; eski formdaki taslağın yeni forma gönderilmez.'),{status:409,code:'FORM_CHANGED'});
    const status = this.availability(formId);
    if (!status.isOpen) throw closedError(status);
  }
  markClosed(formId, error) {
    if (error?.code === 'FORM_CHANGED') this.changedForms.add(formId);
    this.clock.close(formId,error?.code === 'DEADLINE_PASSED' ? 'expired' : 'inactive');
    const form = this.data.forms.find(item => item.id === formId);
    if (form) clearStudentPublications(form);
    stripStudentAnswers(this.snapshot);
    this.onAvailabilityChange();
  }
  hasPausedDrafts(formId = null) {
    return [...this.drafts.values()].some(draft => (!formId || draft.formId === formId) && !this.availability(draft.formId).isOpen);
  }
  hasWritableDrafts() { return [...this.drafts.values()].some(draft => this.availability(draft.formId).isOpen); }
  async refreshAvailability() {
    if (this.refreshingAvailability) return this.refreshingAvailability;
    this.refreshingAvailability = (async () => {
      const response = await this.client.api('student-availability',{termId:this.term.id,guideRevision:this.data.student_guide?.revision||0});
      const next = validateAvailabilityResponse(response);
      let refreshState = false;
      for (const form of this.data.forms) {
        const latest = next.find(item => item.id === form.id);
        if (!latest || latest.revision !== this.revisions[form.id] || publicationChanged(form,latest) || ((Object.hasOwn(latest,'solutions_published') || Object.hasOwn(latest,'grades_published')) && latest.availability.isOpen !== form.availability?.isOpen)) {
          // Hide the previous release immediately, even if the full fetch fails.
          clearStudentPublications(form);
          if (latest && latest.revision === this.revisions[form.id]) refreshState = true;
        }
      }
      if (refreshState) { stripStudentAnswers(this.snapshot); this.onAvailabilityChange(); }
      for (const latest of next) {
        const form = this.data.forms.find(item => item.id === latest.id);
        if (form && latest.revision === this.revisions[form.id]) normalizeQuestionAttemptLimits(latest.question_attempt_limits,form);
      }
      if (Object.hasOwn(response,'student_guide')) this.data.student_guide = clone(response.student_guide);
      for (const form of this.data.forms) {
        const latest = next.find(item => item.id === form.id);
        if (latest && latest.revision === this.revisions[form.id] && !this.changedForms.has(form.id)) {
          form.availability = latest.availability;
          const policy = normalizeAttemptPolicy(latest.attempt_policy);
          form.attempt_policy = policy;
          form.question_attempt_limits = normalizeQuestionAttemptLimits(latest.question_attempt_limits,form);
          this.clock.update(form.id,latest.availability);
        } else {
          if (!latest && next.some(item => item.id !== form.id && ['A','B','C'].some(variant => item.id === `${form.homework_id}_${variant}`))) this.changedForms.add(form.id);
          this.clock.close(form.id,'inactive');
        }
      }
      stripStudentAnswers(this.snapshot);
      if (refreshState) this.applySnapshot(await this.client.api('student-state',{termId:this.term.id}));
      this.onAvailabilityChange();
      clearTimeout(this.timer);
      if (this.hasWritableDrafts()) this.timer = setTimeout(() => { this.flushDrafts().catch(this.onDraftError); },this.delay);
    })().catch(error => {
      if ([401,403].includes(error?.status)) {
        for (const form of this.data.forms) clearStudentPublications(form);
        stripStudentAnswers(this.snapshot); this.onAvailabilityChange();
      }
      throw error;
    }).finally(() => { this.refreshingAvailability = null; });
    return this.refreshingAvailability;
  }
  saveDraft(formId, taskId, draft) {
    const key = this.key(formId, taskId);
    this.drafts.set(key, {formId, ...this.payload(formId, taskId), draft});
    clearTimeout(this.timer);
    if (this.hasWritableDrafts()) this.timer = setTimeout(() => { this.flushDrafts().catch(this.onDraftError); }, this.delay);
  }
  async flushDrafts() {
    clearTimeout(this.timer);
    this.timer = null;
    return this.enqueue(async () => {
      for (const [key, draft] of [...this.drafts]) {
        if (!this.availability(draft.formId).isOpen) continue;
        const formId = draft.formId, payload = {...draft};
        // Ignore returned snapshots: edits made during this request are newer.
        try { await this.client.api('student-save-draft', payload); }
        catch (error) {
          if (!isAvailabilityError(error)) throw error;
          this.markClosed(formId,error);
          this.onDraftError(error);
          continue;
        }
        if (this.drafts.get(key) === draft) this.drafts.delete(key);
      }
      return {paused:this.hasPausedDrafts()};
    });
  }
  applySnapshot(snapshot) {
    const next = validateSnapshot(snapshot);
    for (const previous of this.data.forms) {
      if (!next.data.forms.some(form => form.id === previous.id)) {
        if (next.data.forms.some(form => form.homework_id === previous.homework_id && form.id !== previous.id)) this.changedForms.add(previous.id);
        this.clock.close(previous.id,'inactive');
      }
    }
    for (const draft of this.drafts.values()) {
      if (next.term.id !== draft.termId || next.revisions[draft.formId] !== draft.revision) continue;
      const entries = next.attemptState.forms[draft.formId] ??= {};
      const entry = entries[draft.taskId] ??= {draft:null, attempts:[]};
      const form = next.data.forms.find(f => f.id === draft.formId);
      const task = form?.questions
        .flatMap(q => q.type === 'code' ? [q] : q.items).find(q => q.id === draft.taskId);
      if (task?.type === 'code' || entry.attempts.length < (form?.question_attempt_limits[draft.taskId] ?? form?.attempt_policy.choice)) entry.draft = draft.draft;
    }
    this.snapshot = next;
    for (const form of next.data.forms) {
      this.clock.update(form.id,form.availability);
      if (this.changedForms.has(form.id)) this.clock.close(form.id,'inactive');
    }
    this.onAvailabilityChange();
  }
  async submit(formId, taskId, result) {
    this.assertOpen(formId);
    const key = this.key(formId, taskId);
    let request = this.pending.get(key);
    if (!request) {
      request = {...this.payload(formId, taskId), requestId:crypto.randomUUID(), ...clone(result)};
      this.pending.set(key, request);
      this.saveRecovery();
    }
    clearTimeout(this.timer);
    // Draft writes already in flight finish first; no newer autosave can
    // overwrite the submission's draft after an accepted choice response.
    return this.enqueue(async () => {
      try {
        this.assertOpen(formId);
        const snapshot = await this.client.api('student-submit', request);
        validateSnapshot(snapshot);
        this.pending.delete(key);
        this.saveRecovery();
        const draft = this.drafts.get(key);
        const submittedDraft = request.codeResult ? request.codeResult.submittedCode : request.selectedOption;
        if (!draft || draft.draft === submittedDraft) this.drafts.delete(key);
        this.applySnapshot(snapshot);
        if (this.hasWritableDrafts()) this.timer = setTimeout(() => { this.flushDrafts().catch(this.onDraftError); }, this.delay);
        return snapshot;
      } catch (error) {
        // A definite rejection never consumed this request. An uncertain
        // transport/server result must keep its UUID and identical payload.
        if ([400,401,403,409].includes(error?.status) || error?.code === 'ATTEMPT_LIMIT') {
          this.pending.delete(key);
          this.saveRecovery();
        }
        if (isAvailabilityError(error)) this.markClosed(formId,error);
        if (error?.code === 'ATTEMPT_LIMIT') {
          try { await this.refreshAvailability(); } catch (refreshError) { this.onDraftError(refreshError); }
        }
        throw error;
      }
    });
  }
}

export async function loadCloudStudent(options = {}) {
  const client = await getCloudClient();
  if (!client) return null; // Only an explicitly unconfigured app can preview.
  const session = await requireCloudSession('student');
  if (!session) return {redirected:true};
  const termId = new URLSearchParams(location.search).get('term');
  const snapshot = await client.api('student-state', termId ? {termId} : {});
  let cache = null;
  try { cache = window.sessionStorage; } catch (_) {}
  return new CloudStudentContext(client, session.profile, snapshot, {...options, cache});
}
