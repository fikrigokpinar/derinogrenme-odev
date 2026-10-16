import {getCloudClient, requireCloudSession} from './cloud-client.js';
import {AvailabilityClock, normalizeAttemptPolicy, normalizeQuestionAttemptLimits, stripStudentAnswers, clearStudentPublications, publicationChanged} from './cloud-student.js';

const clone = value => JSON.parse(JSON.stringify(value));
const failure = (message, status = 502, code = 'PREVIEW_RESPONSE') => Object.assign(new Error(message),{status,code});

function validAvailability(value) {
  return value && typeof value.active === 'boolean' && typeof value.isOpen === 'boolean' &&
    ['active','inactive','expired','unapproved'].includes(value.reason) &&
    (value.deadline === null || (typeof value.deadline === 'string' && Number.isFinite(Date.parse(value.deadline)))) &&
    typeof value.serverNow === 'string' && Number.isFinite(Date.parse(value.serverNow)) &&
    (value.personalDeadline === undefined || typeof value.personalDeadline === 'boolean');
}
function previewSnapshot(value) {
  if (!value?.term || typeof value.term.id !== 'string' || typeof value.term.name !== 'string' ||
      typeof value.term.archived !== 'boolean' || typeof value.data?.content_version !== 'string' ||
      value.data.content_version !== value.assessment?.content_version ||
      !Array.isArray(value.data.forms) || !value.assessment.forms || !value.revisions) {
    throw failure('Öğretmen önizleme verileri eksik veya sürümleri uyuşmuyor.');
  }
  const seen = new Set();
  for (const form of value.data.forms) {
    if (typeof form?.id !== 'string' || seen.has(form.id) || typeof form.homework_id !== 'string' ||
        !['A','B','C'].includes(form.variant) || !Array.isArray(form.questions) || !form.questions.length ||
        !Number.isInteger(value.revisions[form.id]) || value.revisions[form.id] < 1 ||
        !value.assessment.forms[form.id] || !validAvailability(form.availability)) {
      throw failure('Öğretmen önizleme formu veya teslim durumu doğrulanamadı.');
    }
    seen.add(form.id);
  }
  // Take only preview fields. Backend attempt state and unrelated identity or
  // grade fields cannot seed a simulation's answers.
  const data = clone(value.data);
  stripStudentAnswers({data,assessment:{forms:{}},attemptState:{forms:{}}});
  for (const form of data.forms) {
    delete form.teacher_grade;
    form.attempt_policy = normalizeAttemptPolicy(form.attempt_policy);
    form.question_attempt_limits = normalizeQuestionAttemptLimits(form.question_attempt_limits,form);
  }
  return {term:clone(value.term),data,assessment:clone(value.assessment),revisions:clone(value.revisions),
    attemptState:{version:value.data.content_version,forms:{}}};
}
function availabilityForms(value) {
  if (!Array.isArray(value?.forms)) throw failure('Önizlemenin teslim durumu doğrulanamadı.');
  const seen = new Set();
  for (const form of value.forms) {
    if (typeof form?.id !== 'string' || seen.has(form.id) || !Number.isInteger(form.revision) ||
        form.revision < 1 || !validAvailability(form.availability)) {
      throw failure('Önizlemenin teslim durumu doğrulanamadı.');
    }
    seen.add(form.id);
    normalizeAttemptPolicy(form.attempt_policy);
    normalizeQuestionAttemptLimits(form.question_attempt_limits);
  }
  return value.forms;
}

export class TeacherStudentPreviewContext {
  constructor(client, value, {onAvailabilityChange = () => {}, monotonicNow} = {}) {
    this.client = client;
    this.snapshot = previewSnapshot(value);
    this.isSimulation = true;
    this.onAvailabilityChange = onAvailabilityChange;
    this.clock = new AvailabilityClock(monotonicNow);
    this.refreshingAvailability = null;
    for (const form of this.data.forms) this.updateAvailability(form.id,form.availability);
  }
  get data() { return this.snapshot.data; }
  get assessment() { return this.snapshot.assessment; }
  get revisions() { return this.snapshot.revisions; }
  get attemptState() { return this.snapshot.attemptState; }
  get term() { return this.snapshot.term; }
  updateAvailability(formId, status) {
    this.clock.update(formId,status);
    if (!status.isOpen) this.clock.close(formId,status.reason === 'expired' ? 'expired' : 'inactive');
  }
  availability(formId) {
    if (!this.data.forms.some(form => form.id === formId)) throw failure('Önizleme formu bulunamadı.',400,'FORM_NOT_FOUND');
    const status = this.clock.status(formId);
    return this.term.archived ? {...status,active:false,isOpen:false,reason:'inactive'} : status;
  }
  check(formId) {
    const status = this.availability(formId);
    if (!status.isOpen) throw failure(status.reason === 'expired' ? 'Ödevin son gönderim tarihi geçti. Önizlemede yeni yanıt değerlendirilemez.' : 'Bu ödev kapalı. Önizlemede kayıtlı yanıtları inceleyebilirsin.',
      403,status.reason === 'expired' ? 'DEADLINE_PASSED' : 'ASSIGNMENT_CLOSED');
  }
  persist(formId, entries) {
    this.check(formId);
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) throw failure('Önizleme yanıtları geçersiz.',400,'PREVIEW_ENTRIES');
    this.attemptState.forms[formId] = clone(entries);
    return true;
  }
  async refreshAvailability() {
    if (this.refreshingAvailability) return this.refreshingAvailability;
    this.refreshingAvailability = (async () => {
      try {
        const response = await this.client.api('teacher-preview-availability',{termId:this.term.id,guideRevision:this.data.student_guide?.revision||0});
        const forms = availabilityForms(response);
        let refreshSolutions = false;
        for (const form of this.data.forms) {
          const latest = forms.find(item => item.id === form.id);
          if (!latest || latest.revision !== this.revisions[form.id] || publicationChanged(form,latest) || ((Object.hasOwn(latest,'solutions_published') || Object.hasOwn(latest,'grades_published')) && latest.availability.isOpen !== form.availability.isOpen)) {
            clearStudentPublications(form);
            if (latest && latest.revision === this.revisions[form.id]) refreshSolutions = true;
          }
        }
        if (refreshSolutions) { this.data.notifications = []; this.onAvailabilityChange(); }
        for (const latest of forms) {
          const form = this.data.forms.find(item => item.id === latest.id);
          if (form && latest.revision === this.revisions[form.id]) normalizeQuestionAttemptLimits(latest.question_attempt_limits,form);
        }
        if (Object.hasOwn(response,'student_guide')) this.data.student_guide = clone(response.student_guide);
        for (const form of this.data.forms) {
          const latest = forms.find(item => item.id === form.id);
          if (latest && latest.revision === this.revisions[form.id]) {
            form.availability = clone(latest.availability);
            form.attempt_policy = normalizeAttemptPolicy(latest.attempt_policy);
            form.question_attempt_limits = normalizeQuestionAttemptLimits(latest.question_attempt_limits,form);
            this.updateAvailability(form.id,latest.availability);
          } else this.clock.close(form.id,'inactive');
        }
        if (refreshSolutions) {
          const full = previewSnapshot(await this.client.api('teacher-preview',{termId:this.term.id}));
          for (const form of this.data.forms) {
            const latest = full.data.forms.find(item => item.id === form.id);
            if (latest && full.revisions[form.id] === this.revisions[form.id] && !this.availability(form.id).isOpen) {
              form.solutions_published = latest.solutions_published;
              form.solutions = latest.solutions;
              form.solutions_published_at = latest.solutions_published_at;
              form.grades_published = latest.grades_published;
              form.grades_published_at = latest.grades_published_at;
            }
          }
          this.data.notifications = full.data.notifications.filter(item => this.data.forms.some(form => form.id === item.form_id && form[`${item.kind}_published`]));
        }
        this.onAvailabilityChange();
      } catch (error) {
        if ([400,401,403].includes(error?.status)) {
          for (const form of this.data.forms) { this.clock.close(form.id,'inactive'); clearStudentPublications(form); }
          this.data.notifications = [];
          this.onAvailabilityChange();
        }
        throw error;
      }
    })().finally(() => { this.refreshingAvailability = null; });
    return this.refreshingAvailability;
  }
}

export async function loadTeacherStudentPreview(options = {}) {
  const params = new URLSearchParams(location.search);
  if (params.get('preview') !== 'teacher') return null;
  const client = await getCloudClient();
  if (!client) throw failure('Öğretmen önizlemesi için bulut bağlantısı etkin olmalıdır.',400,'PREVIEW_CONFIG');
  const session = await requireCloudSession('teacher');
  if (!session) return {redirected:true};
  if (session.profile?.role !== 'teacher') throw failure('Bu önizleme yalnızca öğretmen hesabına açıktır.',403,'ROLE');
  const termId = params.get('term');
  const snapshot = await client.api('teacher-preview',termId ? {termId} : {});
  return new TeacherStudentPreviewContext(client,snapshot,options);
}
