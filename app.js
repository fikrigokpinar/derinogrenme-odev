import {loadState, saveState, getEntry, saveDraft, attemptLimit, remainingAttempts, recordAttempt, scoreForm, resetForm} from './attempt-policy.js';
import {PythonRunner} from './runner-client.js';
import {loadTeacherPreview} from './teacher-preview.js';
import {loadTeacherStudentPreview} from './teacher-student-preview.js';
import {loadCloudStudent, isAvailabilityError} from './cloud-student.js';
import {availabilityStatus, formatDeadline} from './teacher/assignment-availability.js';
import {assignmentScreen, deadlineCountdown, initialAssignment} from './assignment-display.js';
import {renderStudentGuide} from './usage-guide.js';
import {FeedbackClient,createPreviewFeedbackClient,mountFeedback} from './feedback.js';
import {feedbackSettings} from './teacher/feedback-model.js';

const $ = (id) => document.getElementById(id);
const STORAGE_KEY = 'tensor-calismalari-preview-v1';
const DEFAULT_RESEARCH_NOTE = 'Sorularda istenen bazı işlemler derste doğrudan ele alınmamış olabilir. Gerektiğinde ders notlarından, resmî dokümantasyondan ve diğer kaynaklardan yararlanarak araştırma yapmanız beklenmektedir.';
let data, assessment, state, form, tasks = [], taskIndex = 0, runner, busy = false, storage;
let selection = null, confirmChoice = false, codeOutput = null, status = {state:'idle', message:'Python henüz başlatılmadı'};
let toastTimer, availabilityTimer, statusRefreshTimer;
let lastAvailabilityOpen = null;
let renderedAttemptPolicy = null;
const unsavedClosedDrafts = new Set();
let teacherContext = null, cloudContext = null, localPreviewEnabled = false, gradingSubmission = false;

function toast(message, warning = false) {
  const node = $('toast');
  node.textContent = message;
  node.classList.toggle('warning', warning);
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.hidden = true; }, 4800);
}

function escapeText(value) { return String(value ?? ''); }
function persist() {
  if (cloudContext) return true;
  if (teacherContext) {
    try { teacherContext.persist(form.id, state.forms[form.id] || {}); return true; }
    catch (error) { if (isAvailabilityError(error)) { unsavedClosedDrafts.add(form.id); updateAvailabilityUI(); } toast(error.message || 'Öğretmen paneline kaydedilemedi.',true); return false; }
  }
  if (!saveState(storage, STORAGE_KEY, state)) { toast('Tarayıcı kaydı kullanılamıyor. Bu oturumdaki yanıtlar yenileyince kaybolabilir.', true); return false; }
  return true;
}
function storeDraft(formId, taskId, draft) {
  if (!currentAvailability(formId).isOpen) {
    // An input event already queued at the deadline keeps its final character
    // in memory; closed work is never sent to the server.
    saveDraft(state,formId,taskId,draft);
    if (cloudContext) cloudContext.saveDraft(formId,taskId,draft);
    else unsavedClosedDrafts.add(formId);
    updateAvailabilityUI(); return;
  }
  saveDraft(state, formId, taskId, draft);
  if (cloudContext) cloudContext.saveDraft(formId, taskId, draft);
  else persist();
}
function syncCloudState() {
  const formId = form?.id, taskId = currentTask()?.taskId, output = codeOutput;
  data = cloudContext.data; assessment = cloudContext.assessment; state = cloudContext.attemptState;
  if (!data.forms.length) { form = null; tasks = []; updateAvailabilityUI(); return; }
  selectForm(data.forms.some(f => f.id === formId) ? formId : data.forms[0].id, taskId, true);
  codeOutput = output; renderOutput();
}
function canSubmit() {
  if (!currentAvailability().isOpen) { updateAvailabilityUI(); toast('Bu ödev kapalı. Yeni yanıt gönderilemez; kayıtlı puan özetini görebilirsin.',true); return false; }
  if (!teacherContext) return true;
  try { teacherContext.check(form.id); return true; }
  catch (error) { updateAvailabilityUI(); toast(error.message,true); return false; }
}
function currentAvailability(formId = form?.id) {
  if (cloudContext) return cloudContext.availability(formId);
  if (teacherContext?.isSimulation) return teacherContext.availability(formId);
  const selected = data?.forms.find(f => f.id === formId);
  return availabilityStatus(selected?.availability,{approved:selected?.availability?.reason !== 'unapproved'});
}
function updateAvailabilityUI() {
  if (!data) return;
  if (cloudContext && data !== cloudContext.data) { syncCloudState(); return; }
  if (form?.grades_published !== true) $('teacher-grade')?.remove();
  else if (form?.solutions_published !== true) $('teacher-grade')?.querySelector('.feedback-text')?.remove();
  renderPublications();
  renderPublishedSolutions();
  const policyKey = JSON.stringify([form?.attempt_policy,form?.question_attempt_limits]);
  if (form && currentTask() && !busy && renderedAttemptPolicy !== policyKey) renderTask();
  renderStudentGuide($('student-guide'),data.student_guide,form && currentAvailability().isOpen ? form.attempt_policy || {code:2,choice:1} : null,form?.question_attempt_limits);
  const screen = assignmentScreen(data.forms,form?.id,currentAvailability);
  const open = screen.phase === 'active';
  $('content').hidden = !open;
  $('assignment-empty').hidden = open;
  document.querySelector('.workspace').classList.toggle('assignment-unavailable',!open);
  // Only currently open assignments are navigable, by title. Assigned form IDs
  // stay internal; teachers choose variants in their own panel.
  const activeNav = $('available-homeworks');
  activeNav.hidden = !open || screen.available.length < 2;
  const navKey = JSON.stringify([form?.id,...screen.available.map(item => [item.id,item.title])]);
  if (activeNav.dataset.key !== navKey) {
    activeNav.replaceChildren(...screen.available.map(item => {
      const button = element('button','nav-button',item.title || 'Çalışmanız'); button.type = 'button';
      if (item.homework_id === form?.homework_id) button.setAttribute('aria-current','page');
      button.addEventListener('click',() => { selectForm(item.id); refreshAvailability(); });
      return button;
    }));
    activeNav.dataset.key = navKey;
  }
  activeNav.querySelectorAll('button').forEach(button => { button.disabled = busy; });
  const hasWork = Object.values(state?.forms || {}).some(entries => Object.values(entries).some(entry => entry?.attempts?.length || entry?.draft != null));
  $('export-btn').hidden = !open && !hasWork;
  $('reset-btn').hidden = !open || !!cloudContext || !!(teacherContext && !teacherContext.isSimulation);
  const banner = $('availability-banner');
  if (open) {
    const countdown = deadlineCountdown(screen.status);
    $('availability-title').textContent = countdown?.urgent ? 'Son gönderim için son 24 saat' : 'Ödev aktif';
    $('availability-deadline').textContent = screen.status.deadline ? `${screen.status.personalDeadline ? 'Size özel son gönderim' : 'Son gönderim'}: ${formatDeadline(screen.status.deadline)} · Türkiye saati` : 'Bu ödev için son gönderim tarihi belirlenmedi.';
    $('deadline-countdown').hidden = !countdown;
    banner.classList.toggle('deadline-urgent',!!countdown?.urgent);
    if (countdown) for (const unit of ['days','hours','minutes','seconds']) $('remaining-'+unit).textContent = unit === 'days' ? String(countdown[unit]) : String(countdown[unit]).padStart(2,'0');
  } else {
    const changed = form && cloudContext?.isFormChanged(form.id);
    const pending = form && !teacherContext?.isSimulation && (cloudContext?.hasPausedDrafts(form.id) || unsavedClosedDrafts.has(form.id));
    $('assignment-empty-kicker').textContent = screen.phase === 'expired' ? 'SÜRE TAMAMLANDI' : 'ÖDEV DURUMU';
    $('assignment-empty-title').textContent = changed ? 'Ödeviniz güncellendi' : screen.title;
    $('assignment-empty-message').textContent = changed ? 'Güncel ödevinizi görmek için sayfayı yenileyin. Kaydedilmemiş yanıtlarınızı önce Sonuçları indir düğmesiyle saklayabilirsiniz.' : screen.message;
    const showClosedDeadline = !changed && screen.phase === 'expired' && !!screen.status?.deadline;
    $('assignment-empty-deadline').hidden = !showClosedDeadline;
    $('assignment-empty-deadline').textContent = showClosedDeadline ? `Son gönderim süresi ${formatDeadline(screen.status.deadline)} tarihinde doldu.` : '';
    document.querySelector('.empty-footnote').hidden = !showClosedDeadline;
    $('assignment-empty-draft').hidden = !pending;
    $('assignment-empty-draft').textContent = 'Son taslağınız bu açık sayfada korunuyor; hesabınıza gönderilemedi. Sayfayı yenilemeden önce Sonuçları indir düğmesiyle saklayabilirsiniz. Ödev yeniden açılırsa kaydetme devam eder.';
    const result = $('assignment-empty-results');
    const totals = form ? formResult() : {completed:0,totalTasks:0,total:0,finalScore:null};
    const completed = totals.completed;
    const grade = form?.teacher_grade;
    result.hidden = !completed && !grade;
    const summary = totals.finalScore != null ? `Onaylı son not: ${totals.finalScore} / 100` : totals.total == null ? 'Notların öğretmenin yayımladığında görünür.' : `Toplam ödev puanı: ${totals.total} / 100`;
    const note = form?.solutions_published === true ? grade?.note : null;
    const resultKey = JSON.stringify([completed,totals.totalTasks,summary,note]);
    if (result.dataset.key !== resultKey) {
      result.replaceChildren(element('p','closed-result-label','Kayıtlı sonuçlarınız'),element('strong','closed-score',summary),element('p','',`${completed} / ${totals.totalTasks} yanıt gönderildi. ${totals.finalScore != null ? 'Öğretmeninizin onayladığı nottur.' : 'Son not öğretmen onayına bağlıdır.'}`));
      if (note) result.append(element('p','',note));
      result.dataset.key = resultKey;
    }
    const actions = $('assignment-empty-actions'), actionKey = JSON.stringify([!!changed,...screen.available.map(item => [item.id,item.title])]);
    if (actions.dataset.key !== actionKey) {
      actions.replaceChildren();
      for (const item of screen.available) {
        const button = element('button','action-button grade',`${item.title || 'Çalışmanıza devam edin'} →`); button.type = 'button';
        button.addEventListener('click',() => { selectForm(item.id); refreshAvailability(); }); actions.append(button);
      }
      const refresh = element('button','nav-button',changed ? 'Güncel ödevi aç' : 'Durumu yenile'); refresh.type = 'button';
      refresh.addEventListener('click',() => { if (form && !changed) refreshAvailability(); else location.reload(); }); actions.append(refresh);
      actions.dataset.key = actionKey;
    }
    actions.querySelectorAll('button').forEach(button => { button.disabled = busy; });
  }
  if (lastAvailabilityOpen === true && !open) {
    if (busy) runner?.cancel();
    toast(screen.phase === 'expired' ? 'Son gönderim tarihi doldu. Sorular kapatıldı; kayıtlı yanıtlarınız korundu.' : 'Ödev kapatıldı; kayıtlı yanıtlarınız korundu.',true);
  }
  lastAvailabilityOpen = open;
  if (!form) $('reset-btn').disabled = true;
  const retry = $('retry-draft-btn');
  if (retry) retry.disabled = !cloudContext.hasWritableDrafts() || busy;
  applyTaskAvailability();
}
function applyTaskAvailability() {
  if (!form || !currentTask()) return;
  const closed = !currentAvailability().isOpen;
  const editor = $('code-editor'); if (editor) editor.readOnly = busy || closed;
  document.querySelectorAll('#task-body button, #task-body select, #task-body input').forEach(el => { el.disabled = busy || closed; });
  const stop = $('stop-run-btn'); if (stop) stop.disabled = false;
  if (currentTask().kind === 'choice' && (taskRemaining(currentEntry(),'choice') === 0 || cloudContext?.pendingAttempt(form.id,currentTask().taskId))) {
    document.querySelectorAll('#task-body input').forEach(el => { el.disabled = true; });
  }
  const grade = $('grade-btn'); if (grade) grade.disabled = busy || closed || (taskRemaining(currentEntry(),'code') === 0 && !cloudContext?.pendingAttempt(form.id,currentTask().taskId));
  if (currentTask().kind === 'choice' && taskRemaining(currentEntry(),'choice') === 0 && !cloudContext?.pendingAttempt(form.id,currentTask().taskId)) {
    document.querySelectorAll('#task-body button').forEach(el => { el.disabled = true; });
  }
  $('reset-btn').disabled = busy || closed;
}
async function refreshAvailability() {
  if (!data) return;
  try {
    if (cloudContext) await cloudContext.refreshAvailability();
    else if (teacherContext) {
      await teacherContext.refreshAvailability();
      for (const formId of [...unsavedClosedDrafts]) {
        if (!currentAvailability(formId).isOpen) continue;
        try { teacherContext.persist(formId,state.forms[formId] || {}); unsavedClosedDrafts.delete(formId); }
        catch (_) { /* Preserve unsaved text until a valid reopening. */ }
      }
    }
    updateAvailabilityUI();
  } catch (error) {
    // A transient refresh failure keeps the last server clock and current text.
    if (isAvailabilityError(error)) updateAvailabilityUI();
  }
}
function startAvailabilityUpdates() {
  availabilityTimer = setInterval(updateAvailabilityUI,1000);
  statusRefreshTimer = setInterval(() => { if (!document.hidden) refreshAvailability(); },15000);
  window.addEventListener('focus',refreshAvailability);
  document.addEventListener('visibilitychange',() => { if (!document.hidden) { updateAvailabilityUI(); refreshAvailability(); } });
  window.addEventListener('pagehide',() => { clearInterval(availabilityTimer); clearInterval(statusRefreshTimer); });
}
function formTasks(selectedForm) {
  return selectedForm.questions.flatMap((question) => question.type === 'code'
    ? [{...question, taskId:question.id, groupId:question.id, kind:'code'}]
    : question.items.map((item) => ({...item, taskId:item.id, groupId:question.id, kind:'choice', title:question.title, groupPrompt:question.prompt})));
}
function currentTask() { return tasks[taskIndex]; }
function currentEntry() { return getEntry(state, form.id, currentTask().taskId); }
function taskLimit(type,taskId=currentTask()?.taskId) { return attemptLimit(type,form?.attempt_policy,taskId,form?.question_attempt_limits); }
function taskRemaining(entry,type,taskId=currentTask()?.taskId) { return remainingAttempts(entry,type,form?.attempt_policy,taskId,form?.question_attempt_limits); }
function submitted(task) { return getEntry(state, form.id, task.taskId).attempts.length > 0; }
function resultFor(selected) {
  const selectedTasks = formTasks(selected), completed = selectedTasks.filter(task => getEntry(state,selected.id,task.taskId).attempts.length).length;
  const published = selected.grades_published === true && !currentAvailability(selected.id).isOpen;
  if (cloudContext) {
    const summary = selected.result_summary || {completed,totalTasks:selectedTasks.length};
    return {completed:summary.completed,totalTasks:summary.totalTasks,total:published ? summary.finalScore ?? summary.total ?? null : null,finalScore:published ? summary.finalScore ?? null : null};
  }
  return {total:published ? selected.teacher_grade?.score ?? scoreForm(state,selected.id) : null,completed,totalTasks:selectedTasks.length,finalScore:published ? selected.teacher_grade?.score ?? null : null};
}
function formResult() { return resultFor(form); }
function publicationForms(kind) {
  return cloudContext || teacherContext ? data.forms.filter(item => item[`${kind}_published`] === true && !currentAvailability(item.id).isOpen && !cloudContext?.isFormChanged(item.id)) : [];
}
function renderPublications() {
  const host = $('student-notifications');
  const notifications = (data.notifications || []).filter(item => publicationForms(item.kind).some(form => form.id === item.form_id && form[`${item.kind}_published_at`] === item.publishedAt));
  const key = JSON.stringify(notifications); host.hidden = !notifications.length;
  if (host.dataset.key !== key) {
    host.dataset.key = key; host.replaceChildren(); host.append(element('h2','','Bildirimler'));
    for (const notice of notifications) {
      const item = element('article','publication-notification');
      item.append(element('h3','',notice.title),element('p','',notice.message));
      if (notice.publishedAt) item.append(element('p','publication-date',`${formatDeadline(notice.publishedAt)} · Türkiye saati`));
      const link = element('a','text-button',notice.kind === 'grades' ? 'Yayımlanan notları gör' : 'Yayımlanan çözümleri gör');
      link.href = notice.kind === 'grades' ? '#published-grades' : '#published-solutions'; item.append(link); host.append(item);
    }
  }
  const grades = $('published-grades'), published = publicationForms('grades');
  const gradeKey = JSON.stringify(published.map(item => [item.id,item.title,resultFor(item),item.solutions_published ? item.teacher_grade?.note : null]));
  grades.hidden = !published.length;
  if (grades.dataset.key === gradeKey) return;
  grades.dataset.key = gradeKey; grades.replaceChildren(); grades.append(element('h2','','Yayımlanan notlar'));
  for (const homework of published) {
    const item = element('article','published-grade'), result = resultFor(homework);
    item.append(element('h3','',homework.title || 'Ödeviniz'),element('p','published-total',result.total == null ? 'Toplam not yüklenemedi. Durumu yenileyin.' : `${result.finalScore != null ? 'Onaylı son not' : 'Toplam ödev notu'}: ${result.total} / 100`));
    if (homework.solutions_published && homework.teacher_grade?.note) item.append(element('p','',homework.teacher_grade.note));
    grades.append(item);
  }
}
function renderPublishedSolutions() {
  const host = $('published-solutions');
  const published = publicationForms('solutions').filter(item => item.solutions?.length);
  const key = JSON.stringify(published.map(item => [item.id,item.title,item.solutions]));
  host.hidden = !published.length;
  if (host.dataset.key === key) return;
  host.dataset.key = key; host.replaceChildren();
  host.append(element('h2','','Yayımlanan çözümler'),element('p','', 'Öğretmeninizin yayımladığı, size atanmış ödev çözümleri.'));
  for (const homework of published) {
    const section = element('details','published-homework');
    section.append(element('summary','',homework.title || 'Ödev çözümleri'));
    for (const solution of homework.solutions) {
      const article = element('article','published-solution');
      article.append(element('h3','',`${solution.id}${solution.title ? ' · '+solution.title : ''}`));
      renderPrompt(article,solution.prompt);
      if (solution.type === 'code') article.append(element('pre','solution-code',solution.solution_code));
      else {
        for (const option of solution.options) article.append(element('p','',`${option.id}. ${option.text}`));
        article.append(element('p','',`Doğru seçenek: ${solution.correct_option}`));
        if (solution.explanation) article.append(element('p','',solution.explanation));
      }
      section.append(article);
    }
    host.append(section);
  }
}
function setDisabledWhileBusy(disabled) {
  busy = disabled;
  document.querySelectorAll('#available-homeworks button, #assignment-empty-actions button').forEach(el => { el.disabled = disabled; });
  $('reset-btn').disabled = disabled;
  $('previous-btn').disabled = disabled || taskIndex === 0;
  $('next-btn').disabled = disabled || taskIndex === tasks.length - 1;
  document.querySelectorAll('#task-nav button, #task-body button, #task-body select, #task-body input').forEach(el => { el.disabled = disabled; });
  const editor = $('code-editor'); if (editor) editor.readOnly = disabled;
  const stop = $('stop-run-btn'); if (stop) { stop.hidden = !disabled; stop.disabled = false; }
  if (!disabled && currentTask()?.kind === 'choice' && (taskRemaining(currentEntry(),'choice') === 0 || cloudContext?.pendingAttempt(form.id,currentTask().taskId))) {
    document.querySelectorAll('#task-body input').forEach(el => { el.disabled = true; });
  }
  if (!disabled && currentTask()?.kind === 'code') {
    const grade = $('grade-btn');
    if (grade) grade.disabled = taskRemaining(currentEntry(),'code') === 0 && !cloudContext?.pendingAttempt(form.id,currentTask().taskId);
  }
  applyTaskAvailability();
}
function updateProgress() {
  const totals = formResult(), completed = totals.completed;
  $('progress-count').textContent = `${completed} / ${totals.totalTasks}`;
  $('progress-fill').style.width = `${totals.totalTasks ? 100*completed/totals.totalTasks : 0}%`;
  $('score-value').textContent = totals.total == null ? '—' : String(totals.total);
  $('score-value').setAttribute('aria-label',totals.total == null ? 'Notların öğretmenin yayımladığında görünür' : `${totals.total} toplam puan`);
  $('score-value').closest('.score-row').hidden = totals.total == null;
  $('score-pending').hidden = totals.total != null;
  for (const nav of $('task-nav').querySelectorAll('button[data-task-id]')) {
    const task = tasks.find(t => t.taskId === nav.dataset.taskId);
    nav.classList.toggle('done', submitted(task));
    const marker = nav.querySelector('.task-link-status');
    marker.textContent = submitted(task) ? '•' : '';
    marker.setAttribute('aria-label',submitted(task) ? 'Gönderildi' : '');
  }
}
function selectForm(formId, preferredTaskId = null, allowBusy = false) {
  if (busy && !allowBusy) return;
  const selected = data.forms.find(f => f.id === formId);
  if (!selected) return;
  form = selected; tasks = formTasks(form); taskIndex = Math.max(0, tasks.findIndex(t => t.taskId === preferredTaskId));
  codeOutput = null; selection = null; confirmChoice = false;
  $('sidebar-title').textContent = 'Sorular';
  $('sidebar-subtitle').textContent = `${tasks.length} soru · 100 puan`;
  $('lesson-kicker').textContent = 'ÇALIŞMANIZ';
  $('lesson-title').textContent = form.title;
  $('lesson-summary').textContent = `${form.summary}${form.instructions ? ' ' + form.instructions : ''}`;
  const minutes = Array.isArray(form.estimated_minutes) ? form.estimated_minutes.join('–') : form.estimated_minutes;
  $('time-label').textContent = `◷  ${minutes} dk`;
  $('task-count-label').textContent = `${tasks.length} soru · 100 puan`;
  $('research-note-text').textContent = form.research_note || data.research_note || DEFAULT_RESEARCH_NOTE;
  $('teacher-grade')?.remove();
  if (formResult().finalScore != null) {
    const grade = element('section','feedback-panel'); grade.id = 'teacher-grade';
    grade.append(element('h3','feedback-title',`Öğretmen tarafından onaylanan son not: ${form.teacher_grade.score} / 100`));
    if (form.solutions_published === true && form.teacher_grade.note) grade.append(element('p','feedback-text',form.teacher_grade.note));
    document.querySelector('.research-note').after(grade);
  }
  if (teacherContext || cloudContext) {
    $('clipboard-toggle').checked = form.clipboardBlocked !== false;
    $('clipboard-toggle').disabled = true;
  }
  lastAvailabilityOpen = null;
  renderNav(); renderTask(); updateProgress(); updateAvailabilityUI();
  try { history.replaceState(null, '', `#${encodeURIComponent(form.id)}/${encodeURIComponent(currentTask().taskId)}`); } catch (_) { /* local file preview */ }
}
function renderNav() {
  const nav = $('task-nav'); nav.replaceChildren();
  let currentGroup = '';
  tasks.forEach((task, index) => {
    if (task.kind === 'choice' && task.groupId !== currentGroup) {
      currentGroup = task.groupId;
      const label = document.createElement('p'); label.className = 'nav-group-label'; label.textContent = `ÇOKTAN SEÇMELİ · ${currentGroup}`; nav.append(label);
    } else if (task.kind === 'code' && index === 0) {
      const label = document.createElement('p'); label.className = 'nav-group-label'; label.textContent = 'KOD ALIŞTIRMALARI'; nav.append(label);
    }
    const button = document.createElement('button'); button.type = 'button'; button.className = 'task-link'; button.dataset.taskId = task.taskId; button.setAttribute('aria-label', `${task.taskId}: ${task.title}`);
    const id = document.createElement('span'); id.className = 'task-index'; id.textContent = task.taskId;
    const title = document.createElement('span'); title.className = 'task-link-title'; title.textContent = task.kind === 'code' ? task.title : `${task.taskId} · ${task.title}`;
    const mark = document.createElement('span'); mark.className = 'task-link-status';
    button.append(id,title,mark);
    button.addEventListener('click', () => navigate(index)); nav.append(button);
  });
}
function navigate(index) {
  if (busy || index < 0 || index >= tasks.length || index === taskIndex) return;
  taskIndex = index; codeOutput = null; selection = null; confirmChoice = false;
  renderTask(); updateProgress(); updateAvailabilityUI(); refreshAvailability();
  try { history.replaceState(null, '', `#${encodeURIComponent(form.id)}/${encodeURIComponent(currentTask().taskId)}`); } catch (_) {}
  $('main').focus({preventScroll:true}); window.scrollTo({top:0,behavior:'smooth'});
}
function renderPrompt(container, content) {
  const lines = Array.isArray(content) ? content : content ? [content] : [];
  for (const line of lines) { const p = document.createElement('p'); p.textContent = escapeText(line); container.append(p); }
}
function renderTask() {
  renderedAttemptPolicy = JSON.stringify([form?.attempt_policy,form?.question_attempt_limits]);
  const task = currentTask(), entry = currentEntry();
  $('crumb-task').textContent = task.taskId;
  $('task-kind').textContent = task.kind === 'code' ? 'Kod alıştırması' : 'Çoktan seçmeli';
  $('task-kind').classList.toggle('choice', task.kind === 'choice');
  $('task-number').textContent = `SORU ${task.taskId}`;
  $('task-points').textContent = `${task.points} PUAN`;
  $('task-title').textContent = task.title;
  const prompt = $('task-prompt'); prompt.replaceChildren();
  if (task.kind === 'choice') { renderPrompt(prompt, task.groupPrompt); renderPrompt(prompt, task.prompt); }
  else renderPrompt(prompt, task.prompt);
  $('task-body').replaceChildren();
  if (task.kind === 'code') renderCode(task, entry); else renderChoice(task, entry);
  $('task-position').textContent = `${taskIndex + 1} / ${tasks.length}`;
  $('previous-btn').disabled = taskIndex === 0; $('next-btn').disabled = taskIndex === tasks.length - 1;
  for (const button of $('task-nav').querySelectorAll('button[data-task-id]')) button.classList.toggle('active', button.dataset.taskId === task.taskId);
  applyTaskAvailability();
}
function element(tag, className, textValue) {
  const el = document.createElement(tag); if (className) el.className = className; if (textValue != null) el.textContent = textValue; return el;
}
function statusNode() {
  const node = element('span','status-inline'); node.id = 'runner-status';
  const dot = element('span','status-dot'); node.append(dot,document.createTextNode(status.message));
  dot.classList.toggle('ready',status.state === 'ready'); dot.classList.toggle('busy',['loading','running','grading'].includes(status.state));
  return node;
}
function updateRunnerStatus(next) {
  if (gradingSubmission && ['ready','error'].includes(next.state)) next = {state:'ready',message:'Değerlendirme işlemi tamamlandı.'};
  status = next;
  const node = $('runner-status'); if (!node) return;
  node.replaceChildren(); const dot = element('span','status-dot');
  dot.classList.toggle('ready',next.state === 'ready'); dot.classList.toggle('busy',['loading','running','grading'].includes(next.state));
  node.append(dot,document.createTextNode(next.message || (next.state === 'ready' ? 'Python hazır' : 'Python başlatılıyor')));
}
function attachEditorKeys(editor, formId, taskId) {
  editor.addEventListener('keydown', (event) => {
    if (editor.readOnly) return;
    if (event.key !== 'Tab') return;
    event.preventDefault();
    const start = editor.selectionStart, end = editor.selectionEnd;
    editor.setRangeText('    ', start, end, 'end');
    storeDraft(formId, taskId, editor.value);
  });
  for (const type of ['copy','cut','paste','drop']) editor.addEventListener(type, event => {
    if (!$('clipboard-toggle').checked) return;
    event.preventDefault(); toast(cloudContext || teacherContext?.isSimulation ? 'Bu ödevde öğretmen kod editöründe kopyalama ve yapıştırmayı sınırladı.' : 'Önizleme ayarı: kod editöründe kopyalama ve yapıştırma sınırlı. Bu ayarı üst çubuktan değiştirebilirsiniz.', true);
  });
}
function renderCode(task, entry) {
  const host = $('task-body'), formId = form.id; host.append(element('div','exercise-divider'));
  const label = element('div','editor-label'); label.append(element('span','', 'ÇÖZÜMÜNÜ YAZ'),statusNode()); host.append(label);
  const frame = element('div','editor-frame'), bar = element('div','editor-top');
  const dots = element('div','editor-dots'); dots.append(element('span'),element('span'),element('span'));
  bar.append(element('span','', 'main.py'),dots); frame.append(bar);
  const editor = element('textarea','code-editor'); editor.id = 'code-editor'; editor.setAttribute('aria-label', `${task.taskId} Python kodu`); editor.setAttribute('spellcheck','false'); editor.autocomplete = 'off'; editor.autocapitalize = 'off'; editor.value = entry.draft ?? task.starter_code ?? '';
  editor.addEventListener('input', () => storeDraft(formId, task.taskId, editor.value)); attachEditorKeys(editor, formId, task.taskId); frame.append(editor); host.append(frame);
  const actions = element('div','editor-actions');
  const run = element('button','action-button run','▶  Kodu çalıştır'); run.type = 'button'; run.addEventListener('click', () => runCode(task,editor.value));
  const grade = element('button','action-button grade','Değerlendirmeye gönder →'); grade.type = 'button'; grade.id = 'grade-btn'; grade.disabled = taskRemaining(entry,'code') === 0 && !cloudContext?.pendingAttempt(formId,task.taskId);
  if (cloudContext?.pendingAttempt(formId, task.taskId)) grade.textContent = 'Bekleyen gönderimi yeniden kaydet →';
  grade.addEventListener('click', () => gradeCode(task,editor.value));
  const stop = element('button','text-button','Çalışmayı durdur'); stop.type = 'button'; stop.id = 'stop-run-btn'; stop.hidden = true; stop.addEventListener('click', () => runner?.cancel());
  const hint = element('span','attempt-hint'); hint.innerHTML = `<strong>${taskRemaining(entry,'code')}</strong> / ${taskLimit('code',task.taskId)} değerlendirme hakkı kaldı · Çalıştırma hakkı sınırsız<br>Gönderimlerin en yüksek puanı geçerlidir. Gönderimde kod hatası da hak kullanır.`;
  actions.append(run,grade,stop,hint); host.append(actions);
  const output = element('div','output-panel'); output.id = 'output-panel'; host.append(output); renderOutput();
  if (entry.attempts.length) renderCodeFeedback(entry);
}
function renderOutput() {
  const panel = $('output-panel'); if (!panel) return;
  panel.replaceChildren(); const head = element('div','output-head'); head.append(element('span','', 'ÇIKTI'),element('span','',codeOutput?.mode || 'Henüz çalıştırılmadı')); panel.append(head);
  const content = codeOutput ? [codeOutput.stdout,codeOutput.stderr,codeOutput.error].filter(Boolean).map(String).join('\n').trim() : '';
  const placeholder = codeOutput?.mode?.endsWith('…') ? 'Python çalışıyor…' : codeOutput ? 'Kod çalıştı. Çıktı görmek için print kullanabilirsin.' : 'Kodu çalıştırdığında çıktı burada görünür.';
  const body = element('pre',`output-body${!content?' empty':''}${codeOutput && !codeOutput.ok?' error':''}`,content || placeholder); panel.append(body);
}
function renderCodeFeedback(entry) {
  const panel = element('section','submission-receipt');
  panel.append(element('h3','','Gönderim kaydedildi'));
  panel.append(element('p','',taskRemaining(entry,'code') ? 'Kodunu düzenleyip kalan hakkınla tekrar gönderebilirsin.' : 'Gönderim hakların tamamlandı; ödev açıkken kodu çalıştırabilirsin.'));
  $('task-body').append(panel);
}
function renderChoice(task, entry) {
  const host = $('task-body'); host.append(element('div','exercise-divider'));
  host.append(element('div','answer-label','BİR SEÇENEK İŞARETLE'));
  const formId = form.id, remaining = taskRemaining(entry,'choice',task.taskId), locked = remaining === 0;
  const last = entry.attempts.at(-1);
  const pending = cloudContext?.pendingAttempt(formId,task.taskId);
  if (pending) { selection = pending.selectedOption; confirmChoice = true; }
  if (!locked && selection == null && entry.draft != null) { selection = entry.draft; confirmChoice = true; }
  const options = element('fieldset','question-options'); options.setAttribute('aria-label', `${task.taskId}: ${task.prompt}`);
  task.options.forEach((option, index) => {
    const selected = locked && !pending ? last?.selectedOption === option.id : selection === option.id;
    const row = element('label',`option${selected?' selected':''}${locked?' locked':''}`);
    const input = element('input'); input.type = 'radio'; input.name = 'choice'; input.value = option.id; input.checked = selected; input.disabled = locked || Boolean(pending);
    input.addEventListener('change', () => { selection = option.id; confirmChoice = true; storeDraft(formId,task.taskId,option.id); renderTask(); });
    row.append(input,element('span','option-letter',option.id || String.fromCharCode(65+index)),element('span','',option.text)); options.append(row);
  }); host.append(options);
  host.append(element('p','attempt-hint',`${remaining} / ${taskLimit('choice',task.taskId)} gönderim hakkı kaldı · En yüksek puan geçerlidir.`));
  if (last) {
    const result = element('section','submission-receipt choice-result');
    result.append(element('h3','','Yanıt kaydedildi'));
    result.append(element('p','',`Son seçimin: ${last.selectedOption}.`));
    result.append(element('p','feedback-text',locked ? 'Bu soru için gönderim hakların tamamlandı.' : 'Kalan hakkınla yeni bir yanıt gönderebilirsin. Doğru cevap ve çözüm açıklaması gösterilmez.')); host.append(result);
  }
  if ((!locked || pending) && confirmChoice && selection) {
    const chosen = task.options.find(o => o.id === selection), confirm = element('div','choice-confirm');
    confirm.append(element('strong','',`Seçimin: ${selection} — ${chosen?.text || ''}`));
    confirm.append(element('div','', pending ? 'Bekleyen yanıtın aynı kayıtla yeniden denenecek; ikinci kez hak kullanılmaz.' : `Bu gönderim ${remaining} kalan hakkından birini kullanır. ${remaining === 1 ? 'Ardından gönderim hakkın tamamlanır.' : 'En yüksek puanın geçerli olur. Doğru cevap ve çözüm açıklaması gösterilmez.'}`));
    const actions = element('div','choice-confirm-actions');
    const submit = element('button','action-button choice-submit','Yanıtı kesin olarak gönder'); submit.type = 'button';
    if (cloudContext?.pendingAttempt(formId, task.taskId)) submit.textContent = 'Bekleyen yanıtı yeniden kaydet';
    submit.addEventListener('click', () => submitChoice(task,selection));
    const change = element('button','text-button','Seçimi değiştir'); change.type = 'button'; change.addEventListener('click', () => { selection = null; confirmChoice = false; storeDraft(formId,task.taskId,null); renderTask(); });
    actions.append(submit); if (!pending) actions.append(change); confirm.append(actions); host.append(confirm);
  } else if (!locked) {
    const hint = element('p','attempt-hint','Seçimini işaretledikten sonra göndermeden önce onaylayacaksın.'); hint.style.margin = '14px 0 0'; host.append(hint);
  }
}
async function ensureRunner() {
  if (!runner) runner = new PythonRunner({onStatus:updateRunnerStatus});
  return runner;
}
async function runCode(task, code) {
  if (busy || !canSubmit()) return;
  storeDraft(form.id,task.taskId,code);
  setDisabledWhileBusy(true); codeOutput = {ok:true,stdout:'',mode:'Çalışıyor…'}; renderOutput();
  try {
    const result = await (await ensureRunner()).run(code);
    codeOutput = {...result,mode:'Serbest çalıştırma'};
    if (result.infrastructure || result.cancelled) toast(result.error || 'Python çalıştırması tamamlanamadı. Tekrar deneyebilirsin.', true);
  } catch (error) {
    codeOutput = {ok:false,error:String(error?.message || error),mode:'Çalıştırma hatası'};
    toast('Python çalıştırması tamamlanamadı. Tekrar deneyebilirsin.', true);
  } finally { renderOutput(); setDisabledWhileBusy(false); }
}
async function gradeCode(task, code) {
  if (busy || (!taskRemaining(getEntry(state,form.id,task.taskId),'code',task.taskId) && !cloudContext?.pendingAttempt(form.id,task.taskId)) || !canSubmit()) return;
  const formId = form.id, pending = cloudContext?.pendingAttempt(formId, task.taskId);
  const check = assessment.forms[formId]?.[task.taskId];
  if (!pending && !check?.checks_code) { toast('Bu soru için değerlendirme yüklenemedi.',true); return; }
  storeDraft(formId,task.taskId,code);
  gradingSubmission = true;
  setDisabledWhileBusy(true); codeOutput = {ok:true,stdout:'',mode:pending ? 'Gönderim kaydediliyor…' : 'Değerlendiriliyor…'}; renderOutput();
  try {
    let result;
    if (pending) {
      result = {...pending.codeResult,ok:!pending.codeResult.error};
      toast('Önceki gönderimin aynı kodu yeniden kaydediliyor; yeni bir değerlendirme hakkı kullanılmaz.');
    } else {
      result = await (await ensureRunner()).grade(code,check.checks_code);
      if (result.infrastructure || result.cancelled) {
        codeOutput = {ok:false,error:result.cancelled ? 'İşlem iptal edildi; gönderim hakkın korunuyor.' : 'Değerlendirme tamamlanamadı; gönderim hakkın korunuyor.',mode:result.cancelled ? 'Değerlendirme durduruldu' : 'Python başlatılamadı'};
        toast(codeOutput.error,true); return;
      }
    }
    if (!canSubmit()) { codeOutput = {ok:false,error:'Ödev kapandığı için değerlendirme gönderilmedi. Yeni bir hak kullanılmadı.',mode:'Ödev kapalı'}; return; }
    const rawScore = Number(result.score ?? 0);
    const score = Number.isFinite(rawScore) ? Math.max(0,Math.min(task.points,rawScore)) : 0;
    const attempt = {
      score,maxPoints:task.points,submittedCode:pending ? pending.codeResult.submittedCode : code,
      checks:Array.isArray(result.checks) ? result.checks : [],
      stdout:String(result.stdout ?? '').slice(0,12000),stderr:String(result.stderr ?? '').slice(0,12000),
      error:result.error ? String(result.error).slice(0,1000) : null
    };
    if (cloudContext) {
      codeOutput = {ok:true,stdout:'',mode:'Gönderim kaydediliyor…'}; renderOutput();
      if ($('stop-run-btn')) $('stop-run-btn').hidden = true;
      await cloudContext.submit(formId,task.taskId,{codeResult:{...attempt,output:[attempt.stdout,attempt.stderr].filter(Boolean).join('\n')}});
      codeOutput = {ok:true,stdout:'Gönderim kaydedildi.',mode:'Kaydedilen gönderim'};
      syncCloudState();
      toast('Değerlendirme hesabına kaydedildi.');
    } else {
      codeOutput = {ok:true,stdout:'Gönderim kaydedildi.',mode:'Kaydedilen gönderim'};
      recordAttempt(state,formId,task.taskId,'code',attempt,form.attempt_policy,form.question_attempt_limits);
      if (!persist()) { getEntry(state,formId,task.taskId).attempts.pop(); codeOutput = {ok:false,error:'Değerlendirme kaydedilemedi. Yeni bir hak kullanılmadı.',mode:'Kaydedilemedi'}; }
      renderTask(); updateProgress();
    }
  } catch (error) {
    codeOutput = {ok:false,error:cloudContext ? String(error?.message || 'Gönderim tamamlanamadı.') : 'Değerlendirme tamamlanamadı; gönderim hakkın korunuyor.',mode:'Gönderim tamamlanamadı'};
    if (cloudContext) renderTask();
    toast(cloudContext ? `${error?.message || 'Gönderim sunucuya kaydedilemedi.'} ${cloudContext.pendingAttempt(formId,task.taskId) ? 'Bekleyen gönderimi aynı kod ve kimlikle tekrar kaydetmek için gönder düğmesini kullan.' : 'Güncel hakları görmek için sayfayı yenileyebilirsin.'}` : 'Değerlendirme tamamlanamadı; gönderim hakkın korunuyor.',true);
  } finally { gradingSubmission = false; renderOutput(); setDisabledWhileBusy(false); }
}
async function submitChoice(task, selectedOption) {
  if (busy || !canSubmit() || (taskRemaining(currentEntry(),'choice') === 0 && !cloudContext?.pendingAttempt(form.id,task.taskId))) return;
  const formId = form.id;
  if (!task.options.some(o => o.id === selectedOption)) { toast('Yanıt kaydedilemedi.',true); return; }
  if (cloudContext) {
    setDisabledWhileBusy(true);
    try {
      const pending = cloudContext.pendingAttempt(formId,task.taskId);
      if (pending) toast(`Önceki ${pending.selectedOption} yanıtının kaydı yeniden deneniyor.`);
      await cloudContext.submit(formId,task.taskId,{selectedOption});
      selection = null; confirmChoice = false; syncCloudState();
      toast('Yanıtın hesabına kaydedildi.');
    } catch (error) {
      renderTask();
      toast(`${error?.message || 'Yanıt sunucuya kaydedilemedi.'} ${cloudContext.pendingAttempt(formId,task.taskId) ? 'Aynı yanıtın kaydını tekrar denemek için gönder düğmesini kullan.' : 'Güncel hakları görmek için sayfayı yenileyebilirsin.'}`,true);
    } finally { setDisabledWhileBusy(false); }
    return;
  }
  const key = assessment.forms[formId]?.[task.taskId];
  if (!key) { toast('Yanıt kaydedilemedi.',true); return; }
  try {
    recordAttempt(state,formId,task.taskId,'choice',{score:selectedOption === key.correct_option ? task.points : 0,maxPoints:task.points,selectedOption},form.attempt_policy,form.question_attempt_limits);
    saveDraft(state,formId,task.taskId,null);
    if (!persist()) { getEntry(state,formId,task.taskId).attempts.pop(); saveDraft(state,formId,task.taskId,selectedOption); }
    selection = null; confirmChoice = false; renderTask(); updateProgress();
  } catch (error) { toast(String(error?.message || error),true); }
}
function resultsPayload() {
  const exportedState = structuredClone(state);
  for (const entries of Object.values(exportedState.forms || {})) for (const entry of Object.values(entries)) {
    for (const key of Object.keys(entry)) if (!['draft','attempts'].includes(key)) delete entry[key];
    entry.attempts = entry.attempts.map(attempt => Object.fromEntries(['submittedAt','submittedCode','selectedOption','provisional'].filter(key => Object.hasOwn(attempt,key)).map(key => [key,attempt[key]])));
  }
  const results = Object.fromEntries(data.forms.map(item => {
    const result = resultFor(item);
    delete result.finalScore;
    if (item.grades_published !== true || currentAvailability(item.id).isOpen) { delete result.total; delete result.finalScore; }
    return [item.id,result];
  }));
  return {kind:cloudContext ? 'tensor-calismalari-student-results' : 'tensor-calismalari-local-preview',content_version:data.content_version,exported_at:new Date().toISOString(),results,state:exportedState};
}
function downloadResults() {
  const payload = resultsPayload();
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));
  const link = document.createElement('a'); link.href = url; link.download = `tensor-calismalari-deneme-${new Date().toISOString().slice(0,10)}.json`;
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url),1000);
}
function resetCurrentForm() {
  if (busy || !form || (teacherContext && !teacherContext.isSimulation) || cloudContext) return;
  const dialog = element('dialog','reset-dialog');
  const heading = element('h2','', 'Deneme yanıtlarını sıfırla'); heading.id = 'reset-dialog-heading';
  dialog.setAttribute('aria-labelledby',heading.id);
  dialog.append(heading,element('p','',`${form.title} çalışmasındaki deneme cevapları, puanları ve kullanılan haklar ${teacherContext?.isSimulation ? 'bu önizlemede sıfırlanacak. Gerçek öğrenci kayıtları etkilenmez' : 'bu tarayıcıdan temizlenecek'}.`));
  const buttons = element('div','choice-confirm-actions');
  const cancel = element('button','text-button','Vazgeç'); cancel.type = 'button'; cancel.addEventListener('click',()=>dialog.close());
  const confirm = element('button','action-button grade','Evet, denemeyi sıfırla'); confirm.type = 'button';
  confirm.addEventListener('click',()=>{
    resetForm(state,form.id); persist(); codeOutput = null; selection = null; confirmChoice = false;
    status = runner?.ready ? {state:'ready',message:'Python ve PyTorch hazır.'} : {state:'idle',message:'Python henüz başlatılmadı'};
    dialog.close(); renderTask(); updateProgress(); toast('Bu çalışmanın deneme kayıtları sıfırlandı.');
  });
  buttons.append(cancel,confirm); dialog.append(buttons);
  dialog.addEventListener('close',()=>dialog.remove()); document.body.append(dialog); dialog.showModal(); cancel.focus();
}
function setupEvents() {
  $('previous-btn').addEventListener('click', () => navigate(taskIndex - 1));
  $('next-btn').addEventListener('click', () => navigate(taskIndex + 1));
  $('export-btn').addEventListener('click', downloadResults);
  $('reset-btn').addEventListener('click', resetCurrentForm);
}
function teacherReturnUrl() {
  const params = new URLSearchParams(location.search), url = new URL('./teacher/',location.href);
  url.searchParams.set('from','student-preview');
  if (teacherContext?.term?.id || params.get('term')) url.searchParams.set('term',teacherContext?.term?.id || params.get('term'));
  for (const [source,target] of [['panel','view'],['editing','homework'],['editingVariant','variant'],['editingQuestion','question']]) {
    if (params.has(source)) url.searchParams.set(target,params.get(source));
  }
  return url.href;
}
function setupTeacherPreviewToolbar() {
  document.title = 'Tensor Çalışmaları · Öğrenci görünümü';
  document.querySelector('.preview-bar').setAttribute('aria-label','Öğretmenin öğrenci görünümü');
  document.querySelector('.preview-title strong').textContent = 'Öğrenci görünümü';
  document.querySelector('.preview-title > span:last-child').textContent = `${teacherContext.term.name} · Onaylı içerik · Denemeler öğrenci kayıtlarını etkilemez`;
  const avatar = document.querySelector('.avatar'); avatar.textContent = 'Ö'; avatar.setAttribute('aria-label','Öğretmen önizlemesi');
  $('clipboard-toggle').closest('label').style.display = 'none';
  $('reset-btn').textContent = 'Önizlemeyi sıfırla';
  $('export-btn').textContent = 'Deneme sonuçlarını indir';
  document.querySelector('.sidebar-foot p').textContent = 'Denemeler yalnızca bu açık önizlemede tutulur; sayfadan ayrılınca sıfırlanır. Öğrencilerin puanları ve hakları değişmez.';
  const back = element('a','toolbar-button teacher-return','← Öğretmen paneline dön'); back.id = 'teacher-return'; back.href = teacherReturnUrl();
  const refresh = element('button','toolbar-button','Görünümü yenile'); refresh.type = 'button';
  refresh.addEventListener('click',() => location.reload());
  document.querySelector('.preview-controls').append(refresh,back);
}
function setupCloudToolbar() {
  document.title = 'Tensor Çalışmaları · Öğrenci';
  document.querySelector('.preview-bar').setAttribute('aria-label','Öğrenci ödev araçları');
  document.querySelector('.preview-title strong').textContent = 'Öğrenci hesabı';
  document.querySelector('.preview-title > span:last-child').textContent = `${cloudContext.student.name} · ${cloudContext.student.number} · ${cloudContext.term.name}`;
  const avatar = document.querySelector('.avatar');
  avatar.textContent = cloudContext.student.name?.slice(0,1) || 'Ö'; avatar.setAttribute('aria-label','Öğrenci hesabı');
  $('clipboard-toggle').closest('label').style.display = 'none';
  $('reset-btn').hidden = true;
  document.querySelector('.sidebar-foot p').textContent = 'Yanıtların hesabına kaydedilir. Taslaklar otomatik kaydedilir; bağlantı hatasında kaydı tekrar dene.';
  const password = element('a','toolbar-button','Şifre değiştir'); password.href = './change-password.html';
  const logout = element('button','toolbar-button','Çıkış yap'); logout.type = 'button';
  logout.addEventListener('click',async () => {
    if (busy) return;
    logout.disabled = true;
    try {
      await cloudContext.flushDrafts();
      await cloudContext.client.signOut();
      location.replace('./login.html');
    } catch (error) { toast(error?.message || 'Çıkış yapılamadı. Tekrar deneyin.',true); logout.disabled = false; }
  });
  const retry = element('button','toolbar-button','Taslak kaydını yeniden dene'); retry.type = 'button'; retry.id = 'retry-draft-btn'; retry.hidden = true;
  retry.addEventListener('click',async () => {
    retry.disabled = true;
    try { const result = await cloudContext.flushDrafts(); retry.hidden = !cloudContext.hasWritableDrafts(); toast(result.paused ? 'Gönderilemeyen taslak bu açık sayfada korunuyor. Ödevin üstündeki açıklamayı kontrol et.' : 'Taslakların hesabına kaydedildi.',result.paused); updateAvailabilityUI(); }
    catch (error) { toast(error?.message || 'Taslak kaydedilemedi. Tekrar deneyin.',true); }
    finally { updateAvailabilityUI(); }
  });
  document.querySelector('.preview-controls').append(retry,password,logout);
}
function setupFeedback() {
  let client;
  if(cloudContext) {
    client=new FeedbackClient(cloudContext.client,{termId:cloudContext.term.id,studentId:cloudContext.student.id,cache:cloudContext.cache});
  } else {
    client=createPreviewFeedbackClient(async()=>{
      const saved=teacherContext?.client ? (await teacherContext.client.api('teacher-state',{})).state.feedbackSettings : null;
      const seen=new Set(),contexts=[];
      for(const item of [form,...data.forms].filter(Boolean)) {
        if(seen.has(item.homework_id) || !currentAvailability(item.id).isOpen)continue;
        seen.add(item.homework_id);
        contexts.push({homeworkId:item.homework_id,formId:item.id,revision:item.revision||1,title:item.title,
          tasks:item.questions.flatMap(q=>q.type==='code'?[{id:q.id,title:q.title}]:(q.items||[]).map(i=>({id:i.id,title:q.title})))});
      }
      return {settings:feedbackSettings(saved),contexts};
    });
  }
  mountFeedback({client,preview:!cloudContext,getCurrentContext:()=>({homeworkId:form?.homework_id,taskId:currentTask()?.taskId})});
}
async function init() {
  try {
    teacherContext = await loadTeacherStudentPreview({onAvailabilityChange:updateAvailabilityUI});
    if (teacherContext?.redirected) return;
    if (!teacherContext) cloudContext = await loadCloudStudent({onAvailabilityChange:updateAvailabilityUI,onDraftError:error => {
      if ($('retry-draft-btn')) $('retry-draft-btn').hidden = false;
      updateAvailabilityUI();
      toast(`${error?.message || 'Taslak hesabına kaydedilemedi.'} ${error?.code === 'FORM_CHANGED' ? 'Yenilemeden önce Sonuçları indir düğmesiyle açık sayfadaki yanıtlarını saklayabilirsin.' : isAvailabilityError(error) ? 'Taslağın bu açık sayfada korunuyor; ödev açılana kadar kayıt durduruldu.' : 'Taslağın bu açık sayfada korunuyor; taslak kaydını yeniden dene.'}`,true);
    }});
    if (cloudContext?.redirected) return;
    if (teacherContext?.isSimulation) {
      data = teacherContext.data; assessment = teacherContext.assessment; state = teacherContext.attemptState;
      setupTeacherPreviewToolbar();
    } else if (cloudContext) {
      data = cloudContext.data; assessment = cloudContext.assessment; state = cloudContext.attemptState;
      setupCloudToolbar();
    } else {
      localPreviewEnabled = true;
      teacherContext = await loadTeacherPreview();
      if (teacherContext) {
        data = teacherContext.data; assessment = teacherContext.assessment;
        document.querySelector('.preview-title > span:last-child').textContent = `${teacherContext.student.name} · ${teacherContext.student.number} · ${teacherContext.term.name}`;
        $('reset-btn').hidden = true;
        const back = element('a','toolbar-button','Öğretmen paneline dön'); back.href = './teacher/';
        document.querySelector('.preview-controls').append(back);
      } else {
        const [assignmentResponse,assessmentResponse] = await Promise.all([fetch('./assignments.json'),fetch('./assessment.json')]);
        if (!assignmentResponse.ok || !assessmentResponse.ok) throw new Error('Ödev verileri yüklenemedi.');
        data = await assignmentResponse.json(); assessment = await assessmentResponse.json();
      }
      try { storage = window.localStorage; storage.getItem(STORAGE_KEY); } catch (_) { const memory = new Map(); storage = {getItem:key=>memory.get(key) ?? null,setItem:(key,value)=>memory.set(key,value)}; toast('Tarayıcı depolaması kullanılamıyor; kayıtlar sayfa yenilenince kaybolur.',true); }
      state = teacherContext ? teacherContext.attemptState : loadState(storage,STORAGE_KEY,data.content_version);
    }
    if (data.content_version !== assessment.content_version || !Array.isArray(data.forms)) throw new Error('Ödev ve değerlendirme sürümleri uyuşmuyor.');
    setupEvents();
    const [hashForm,hashTask] = decodeURIComponent(location.hash.slice(1)).split('/');
    const initial = initialAssignment(data.forms,hashForm,currentAvailability);
    if (initial) selectForm(initial.id,hashTask);
    else { $('sidebar-title').textContent = 'Ödevler'; updateAvailabilityUI(); }
    setupFeedback();
    startAvailabilityUpdates();
    document.querySelector('.preview-bar').style.removeProperty('display');
  } catch (error) {
    $('load-error').hidden = false;
    $('load-error').textContent = error?.message || 'Ödev yüklenemedi. Sayfayı yenileyerek tekrar deneyin.';
    if (new URLSearchParams(location.search).get('preview') === 'teacher' || (localPreviewEnabled && new URLSearchParams(location.search).has('student'))) {
      const back = element('a','toolbar-button','Öğretmen paneline dön'); back.href = teacherReturnUrl();
      $('load-error').append(element('br'),back);
    }
  }
}
init();
