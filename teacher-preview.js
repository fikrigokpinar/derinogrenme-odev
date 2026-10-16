import {TeacherStore} from './teacher/store.js';
import {assignmentVariant} from './teacher/assignment-variants.js';
import {solutionReleaseStatus,gradeReleaseStatus} from './teacher/solution-release.js';

const clone = value => JSON.parse(JSON.stringify(value));

export async function loadTeacherPreview() {
  const params = new URLSearchParams(location.search);
  if (!params.has('student') && !params.has('term')) return null;
  const studentId = params.get('student'), termId = params.get('term');
  if (!studentId || !termId) throw new Error('Öğretmen panelinden bir öğrenci seçerek bu ekranı açın.');
  const response = await fetch('./teacher/seed.json');
  if (!response.ok) throw new Error('Öğretmen paneli verileri yüklenemedi.');
  const seed = await response.json();
  const freshStore = () => new TeacherStore({storage: localStorage, seed});
  const store = freshStore();
  function requireStudent(nextStore) {
    const term = nextStore.state.terms.find(t => t.id === termId);
    const student = nextStore.state.students.find(s => s.id === studentId && s.termId === termId);
    if (!term || term.archived) throw new Error('Bu dönem arşivlenmiş veya bulunamıyor. Öğretmen paneline dönün.');
    if (!student || !student.active) throw new Error('Bu öğrenci aktif listede bulunmuyor. Öğretmen paneline dönün.');
    return student;
  }
  const student = requireStudent(store), forms = [], keys = {}, revisions = {};
  const sourceSnapshots = {};
  function questionLimits(nextStore, currentStudent, form) {
    const extra = currentStudent.assignmentOverrides?.[form.homework_id]?.questionExtraAttempts || {};
    const ids = new Set(form.questions.flatMap(question => question.type === 'code' ? [question.id] : question.items.map(item => item.id)));
    return Object.fromEntries(Object.entries(extra).filter(([id,count]) => ids.has(id) && Number.isInteger(count) && count > 0)
      .map(([id]) => [id,nextStore.getStudentQuestionAttemptLimit(studentId,form.homework_id,id)]));
  }
  for (const assignment of store.state.assignments) {
    if (!assignment.approved || !assignment.approvedRevision) continue;
    const hw = assignment.approved;
    const variant = hw.variants.find(v => v.id === assignmentVariant(store.state,student,assignment.id));
    if (!variant) continue;
    const id = assignment.id + '_' + variant.id;
    const form = {id, homework_id: assignment.id, variant: variant.id, title: hw.title,
      summary: assignment.id === 'HW1' ? 'Tensör oluşturma, şekil değiştirme, indeksleme ve temel işlemlerle çalışın.' : 'Autograd ile türev hesaplayın; basit bir veri seti ve dönüşüm sınıfı oluşturun.',
      instructions: assignment.id === 'HW1' ? 'Kodu doğrudan hücreye yazın; def ve return kullanmayın. Verilen değişken adlarını koruyun.' : variant.questions.slice(0,3).every(q => q.execution_model === 'cell') ? 'Q1–Q3 için kodu doğrudan hücreye yazın; def ve return kullanmayın. Verilen değişken adlarını koruyun. Q4 için verilen sınıf ve metot adlarını koruyun.' : 'Verilen fonksiyon ve sınıf adlarını koruyun.',
      estimated_minutes: hw.estimated_minutes, research_note: hw.research_note,
      clipboardBlocked: assignment.approvedSettings?.clipboardBlocked !== false,
      availability:store.getStudentAssignmentAvailability(studentId,assignment.id),
      attempt_policy:store.getAssignmentAttemptLimits(termId,assignment.id), questions: []};
    keys[id] = {};
    revisions[id] = assignment.approvedRevision;
    sourceSnapshots[id] = clone(assignment.approved);
    for (const question of variant.questions) {
      const q = {};
      for (const key of ['id','type','title','points','prompt']) q[key] = clone(question[key]);
      if (q.type === 'code') {
        q.starter_code = question.starter_code;
        q.rubric = question.rubric.map(r => ({criterion: r.criterion, points: r.points}));
        keys[id][q.id] = {type:'code',checks_code:question.checks_code};
      } else {
        q.items = question.items.map(item => {
          keys[id][item.id] = {type:'choice',correct_option:item.correct_option,explanation:item.explanation,points:item.points};
          return {id:item.id,prompt:item.prompt,points:item.points,options:clone(item.options)};
        });
      }
      form.questions.push(q);
    }
    form.question_attempt_limits = questionLimits(store,student,form);
    forms.push(form);
  }
  if (!forms.length) throw new Error('Bu öğrenci için onaylanmış bir ödev bulunamadı.');
  const version = 'teacher:' + termId + ':' + studentId + ':' + forms.map(form => form.id + ':' + revisions[form.id]).join('-');
  const attemptState = {version, forms:{}};
  for (const form of forms) {
    const submission = store.state.submissions.find(s => s.termId === termId && s.studentId === studentId && s.formId === form.id && s.revision === revisions[form.id]);
    attemptState.forms[form.id] = clone(submission?.entries || {});
    form.teacher_grade = clone(submission?.grade || null);
  }
  function ensureCurrent(formId) {
    const latest = freshStore();
    const currentStudent = requireStudent(latest);
    const form = forms.find(f => f.id === formId);
    const assignment = latest.state.assignments.find(a => a.id === form?.homework_id);
    if (form && assignmentVariant(latest.state,currentStudent,form.homework_id) !== form.variant) {
      form.availability = {...latest.getStudentAssignmentAvailability(studentId,form.homework_id),active:false,isOpen:false,reason:'inactive'};
      throw Object.assign(new Error('Bu ödevdeki form ataması değişti. Güncel formu açmak için sayfayı yenileyin; eski yanıtlar yeni forma aktarılmaz.'),{status:409,code:'FORM_CHANGED'});
    }
    if (!assignment || assignment.approvedRevision !== revisions[formId] || JSON.stringify(assignment.approved) !== JSON.stringify(sourceSnapshots[formId])) {
      throw new Error('Ödev veya grup değişti. Güncel sürümü açmak için sayfayı yenileyin.');
    }
    return latest;
  }
  function availability(formId, latest = freshStore()) {
    const form = forms.find(f => f.id === formId);
    const currentStudent = requireStudent(latest);
    let status = latest.getStudentAssignmentAvailability(studentId,form?.homework_id);
    if (form && assignmentVariant(latest.state,currentStudent,form.homework_id) !== form.variant) {
      status = {...status,active:false,isOpen:false,reason:'inactive'};
    }
    if (form) {
      form.availability = status;
      form.attempt_policy = latest.getAssignmentAttemptLimits(termId,form.homework_id);
      form.question_attempt_limits = questionLimits(latest,currentStudent,form);
      const assignment = latest.state.assignments.find(item => item.id === form.homework_id);
      const valid = assignment?.approvedRevision === revisions[form.id] && JSON.stringify(assignment.approved) === JSON.stringify(sourceSnapshots[form.id]) && !status.isOpen && assignmentVariant(latest.state,currentStudent,form.homework_id) === form.variant;
      for (const [kind,release] of [['grades',gradeReleaseStatus],['solutions',solutionReleaseStatus]]) {
        const publication = release(latest.state,termId,form.homework_id);
        form[`${kind}_published`] = valid && publication.published;
        form[`${kind}_published_at`] = form[`${kind}_published`] ? publication.publishedAt : null;
      }
      const variant = assignment?.approved?.variants.find(item => item.id === form.variant);
      form.solutions = form.solutions_published ? variant.questions.flatMap(q => q.type === 'code' ? [{id:q.id,type:'code',title:q.title,prompt:clone(q.prompt),solution_code:q.solution_code}] : q.items.map(item => ({id:item.id,type:'choice',prompt:item.prompt,options:clone(item.options),correct_option:item.correct_option,explanation:item.explanation}))) : [];
      const submission = latest.state.submissions.find(item => item.termId === termId && item.studentId === studentId && item.formId === form.id && item.revision === revisions[form.id]);
      form.teacher_grade = form.grades_published && submission?.grade ? clone(submission.grade) : null;
      if (form.teacher_grade && !form.solutions_published) delete form.teacher_grade.note;
    }
    return status;
  }
  function requireOpen(formId, latest) {
    const status = availability(formId,latest);
    if (!status.isOpen) throw Object.assign(new Error(status.reason === 'expired' ? 'Ödevin son teslim tarihi geçti. Yeni yanıt kaydedilemez.' : 'Bu ödev kapalı. Yeni yanıt kaydedilemez.'),
      {status:403,code:status.reason === 'expired' ? 'DEADLINE_PASSED' : 'ASSIGNMENT_CLOSED'});
  }
  for (const form of forms) availability(form.id,store);
  function notifications() {
    return forms.flatMap(form => ['grades','solutions'].flatMap(kind => form[`${kind}_published`] ? [{
      id:[termId,form.id,revisions[form.id],kind,form[`${kind}_published_at`]].join(':'),kind,homework_id:form.homework_id,form_id:form.id,
      title:kind === 'grades' ? 'Notlar yayımlandı' : 'Çözümler yayımlandı',message:form.title + (kind === 'grades' ? ' için toplam ödev notun yayımlandı.' : ' için çözümler yayımlandı.'),publishedAt:form[`${kind}_published_at`]
    }] : []));
  }
  return {
    student, term: store.state.terms.find(t => t.id === termId), revisions, attemptState,
    data: {student_guide:clone(store.state.studentGuide||null),content_version:version,forms,research_note:forms[0].research_note,get notifications(){return notifications();}},
    assessment: {content_version:version,forms:keys},
    availability,
    refreshAvailability() {
      const latest = freshStore();
      this.data.student_guide = clone(latest.state.studentGuide||null);
      for (const form of forms) availability(form.id,latest);
    },
    check(formId) { requireOpen(formId,ensureCurrent(formId)); },
    persist(formId, entries) {
      const latest = ensureCurrent(formId);
      requireOpen(formId,latest);
      const form = forms.find(f => f.id === formId);
      latest.upsertSubmission({termId,studentId,homeworkId:form.homework_id,formId,revision:revisions[formId],entries:clone(entries)});
    }
  };
}
