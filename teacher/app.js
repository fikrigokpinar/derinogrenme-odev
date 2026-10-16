import {TeacherStore, parseRoster, TEACHER_STORAGE_KEY} from './store.js';
import {CloudTeacherStore} from './cloud-store.js';
import {buildResultsReport} from './results-report.js';
import {downloadResultsWorkbook} from './results-xlsx.js';
import {assignmentVariantGroups} from './assignment-variants.js';
import {getCloudClient, requireCloudSession} from '../cloud-client.js';
import {PythonRunner} from '../runner-client.js';
import {formatDeadline, toDeadlineInput, fromDeadlineInput, assignmentAvailability, studentAssignmentAvailability} from './assignment-availability.js';
import {guideContent, renderStudentGuide} from '../usage-guide.js';
import {feedbackSettings, FEEDBACK_STATUSES} from './feedback-model.js';
import {solutionReleaseStatus, gradeReleaseStatus} from './solution-release.js';

const $ = id => document.getElementById(id);
const node = (tag, cls = '', value = '') => { const e = document.createElement(tag); if (cls) e.className = cls; if (value !== '') e.textContent = String(value); return e; };
const append = (parent, ...children) => { parent.append(...children); return parent; };
const clear = e => { e.replaceChildren(); return e; };
const button = (label, cls, fn) => { const b = node('button', `btn ${cls}`, label); b.type = 'button'; b.addEventListener('click', fn); return b; };
const text = value => String(value ?? '');
const shortDate = value => value ? new Intl.DateTimeFormat('tr-TR',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value)) : '—';
const clone = value => structuredClone(value);
let cloudClient=null, actionBusy=false;
let store, tab = 'dashboard', studentSearch = '', studentFilter = 'active', resultSearch = '', resultHW = 'all';
let edit = {id:'HW1',variant:'A',question:'Q1',draft:null,settings:null,dirty:false};
let guideEdit = {draft:null,revision:0,dirty:false};
let guidePreviewHomeworkId='HW1';
let feedbackSearch='', feedbackCategory='all', feedbackStatus='all';
const feedbackStatusOptions=Object.entries(FEEDBACK_STATUSES);
const selectedStudentIds=new Set();
let runner;
let toastTimer;
const title = {dashboard:'Genel bakış',students:'Öğrenciler',assignments:'Ödevler',results:'Sonuçlar',feedback:'Geri bildirimler',guide:'Kullanım kılavuzu'};
function toast(message, warning=false) { const e=$('toast'); e.textContent=message; e.classList.toggle('warning',warning); e.hidden=false; clearTimeout(toastTimer); toastTimer=setTimeout(()=>e.hidden=true,4500); }
function fail(error) { toast(error?.message || String(error),true); }
async function act(fn) {
  if(actionBusy) return;
  actionBusy=true;
  const controls=[...document.querySelectorAll('button,input,select,textarea')].map(e=>[e,e.disabled]);
  controls.forEach(([e])=>e.disabled=true);
  $('dialog').dataset.busy='true';$('main').setAttribute('aria-busy','true');
  try { return await fn(); } catch(error) { fail(error); }
  finally { actionBusy=false; delete $('dialog').dataset.busy;$('main').removeAttribute('aria-busy'); controls.forEach(([e,disabled])=>{if(e.isConnected)e.disabled=disabled;}); }
}
function currentTerm() { return store.state.terms.find(t=>t.id===store.state.selectedTermId) || store.state.terms[0]; }
function termId() { return currentTerm()?.id; }
function students() { return store.state.students.filter(s=>s.termId===termId()); }
function assignments() { return store.state.assignments; }
function assignment(id) { return assignments().find(a=>a.id===id); }
async function ensureVariantMaps() {
  const term=currentTerm();
  if(!term || term.archived)return;
  // Validate existing maps first; a corrupt saved map must never silently reroll.
  const missing=assignments().map(a=>store.getAssignmentVariantMap(term.id,a.id)).some(map=>!map);
  if(missing)await store.initializeAssignmentVariants(term.id);
}
function activeStudentAssignments(student, now=Date.now()) {
  return assignments().filter(a=>studentAssignmentAvailability(store.state,student,a.id,{now}).isOpen);
}
function studentForms(student, active=activeStudentAssignments(student)) {
  return active.map(a=>`${a.id}: ${store.getAssignmentVariant(student.id,a.id)}`).join(' · ') || 'Aktif ödev yok';
}
function updateStudentFormIndicators() {
  const now=Date.now(), byId=new Map(store.state.students.map(s=>[s.id,s]));
  for(const cell of document.querySelectorAll('[data-student-forms]')) {
    const student=byId.get(cell.dataset.studentForms);
    if(!student)continue;
    const active=activeStudentAssignments(student,now),key=JSON.stringify(active.map(a=>a.id));
    if(cell.dataset.homeworks===key)continue;
    cell.textContent=studentForms(student,active);cell.dataset.homeworks=key;
  }
}
function assignmentName(a) { return a?.draft?.title || a?.approved?.title || a?.id || 'Ödev'; }
function variants(hw) { return hw?.variants || hw?.forms || []; }
function variant(hw, code) { return variants(hw).find(v=>v.variant===code || v.id===code || v.id===`${edit.id}_${code}` || v.id?.endsWith(`_${code}`)); }
function questions(hw, code) { return variant(hw,code)?.questions || []; }
function heading(kicker, name, desc) { const h=node('div','page-heading'), left=node('div'); append(left,node('p','eyebrow',kicker),node('h1','',name),node('p','',desc)); h.append(left); return h; }
function status(value, tone='') { return node('span',`status ${tone}`,value); }
function field(label, input) { const wrap=node('label','field'); append(wrap,node('span','',label),input); return wrap; }
function input(type,value='',placeholder='') { const e=node('input'); e.type=type; e.value=text(value); e.placeholder=placeholder; return e; }
function textarea(value='',cls='') { const e=node('textarea',cls); e.value=text(value); return e; }
function select(options,value) { const e=node('select'); for(const [v,label] of options){const o=node('option','',label);o.value=v;e.append(o);} e.value=value; return e; }
function dialog(name, build, actions=[]) { $('dialog-title').textContent=name; clear($('dialog-body')); clear($('dialog-actions')); build($('dialog-body')); for(const a of actions) $('dialog-actions').append(button(a.label,a.cls||'outline',()=>a.onClick===closeDialog?closeDialog():act(a.onClick))); $('dialog').showModal(); }
function closeDialog() { if(!actionBusy) $('dialog').close(); }
function finishDialog() { $('dialog').close(); }
$('dialog').addEventListener('cancel',e=>{if(actionBusy)e.preventDefault();});
$('dialog-close').onclick=closeDialog;
function confirmDialog(name,message,confirmLabel,handler,mode='warn') { dialog(name,b=>b.append(node('p','',message)),[{label:'Vazgeç',cls:'outline',onClick:closeDialog},{label:confirmLabel,cls:mode,onClick:async()=>{await handler();finishDialog();}}]); }
function setTab(next) { if (tab===next) return; if(!store?.state){tab=next;return;} persistNavigation(()=>{if(tab==='students')selectedStudentIds.clear();tab=next;render();}); }
function dirtyGuard(next) { dialog('Kaydedilmemiş taslak',b=>b.append(node('p','','Ödev düzenlemeleriniz henüz taslağa kaydedilmedi. Devam etmeden önce kaydedebilir veya değişikliklerden vazgeçebilirsiniz.')),[{label:'Geri dön',cls:'outline',onClick:closeDialog},{label:'Değişikliklerden vazgeç',cls:'danger',onClick:()=>{edit.dirty=false;edit.draft=null;edit.settings=null;finishDialog();next();}},{label:'Taslağı kaydet',onClick:async()=>{await saveDraft();finishDialog();next();}}]); }
function persistNavigation(fn) { if(guideEdit.dirty) guideDirtyGuard(fn); else if(edit.dirty) dirtyGuard(fn); else fn(); }
function resetGuideEditor() { guideEdit={draft:null,revision:0,dirty:false}; }
function guideDirtyGuard(next) {
  dialog('Kaydedilmemiş kılavuz',b=>b.append(node('p','','Kılavuz düzenlemeleriniz henüz kaydedilmedi. Kaydedebilir veya bu düzenlemelerden vazgeçebilirsiniz.')),[
    {label:'Geri dön',onClick:closeDialog},
    {label:'Değişikliklerden vazgeç',cls:'danger',onClick:()=>{resetGuideEditor();finishDialog();next();}},
    {label:'Kaydet ve devam et',onClick:async()=>{await saveGuide();finishDialog();next();}}
  ]);
}
async function saveGuide() {
  await store.saveStudentGuide(guideEdit.draft,guideEdit.revision);
  resetGuideEditor();render();toast('Kılavuz kaydedildi; öğrenci ekranında güncellenecek.');
}
function renderGuideEditor(view) {
  if(!guideEdit.dirty) {
    guideEdit.draft=guideContent(store.state.studentGuide);
    guideEdit.revision=store.state.studentGuide?.revision||0;
  }
  const draft=guideEdit.draft;
  view.append(heading('PANEL / KULLANIM KILAVUZU','Kullanım kılavuzu','Öğrencilerin ana sayfasındaki başlıkları ve açıklamaları buradan düzenleyin. Bu kılavuz tüm dönemler için ortaktır.'));
  view.append(node('div','notice','Gerçek kod ve test haklarını her ödevin Ödevler > Gönderim hakları bölümünden ayarlayın. Kılavuzdaki {kod_hakki} ve {test_hakki} işaretleri öğrencinin aktif ödevindeki sayıya dönüşür. Üstteki ilk iki bilgi kutusunun hak sayısı da otomatik güncellenir. Metinler tüm dönemler için ortaktır.'));
  const previewOptions=assignments().map(a=>[a.id,a.id]);
  if(!previewOptions.some(([id])=>id===guidePreviewHomeworkId))guidePreviewHomeworkId=previewOptions[0]?.[0]||'HW1';
  const previewHomework=select(previewOptions,guidePreviewHomeworkId);previewHomework.setAttribute('aria-label','Kılavuz önizleme ödevi');
  previewHomework.onchange=()=>{guidePreviewHomeworkId=previewHomework.value;};
  const form=node('form','guide-editor');form.id='guide-editor-form';
  const actions=node('div','card guide-editor-actions'),save=button('Kaydet ve öğrencilere göster','',()=>{if(form.reportValidity())act(saveGuide);});
  const stateLabel=node('span','help');stateLabel.setAttribute('role','status');
  const updateLabel=()=>{stateLabel.textContent=guideEdit.dirty?'Kaydedilmemiş değişiklikler var.':store.state.studentGuide?.updatedAt?`Son kaydetme: ${shortDate(store.state.studentGuide.updatedAt)}`:'Hazır kılavuz · Düzenleyip kaydedebilirsiniz.';};
  const changed=()=>{guideEdit.dirty=true;updateLabel();};updateLabel();
  const preview=button('Öğrenciye nasıl görünecek?','outline',()=>{
    if(!form.reportValidity())return;
    dialog('Kılavuz önizlemesi',b=>{b.append(node('p','help','Kaydedilmemiş düzenlemelerin önizlemesi. Öğrencilere göstermek için Kaydet düğmesini kullanın.'));const guide=node('details','student-guide');guide.id='guide-preview';guide.open=true;const limits=termId()?store.getAssignmentAttemptLimits(termId(),previewHomework.value):null;renderStudentGuide(guide,draft,limits);b.append(guide);},[{label:'Düzenlemeye dön',onClick:closeDialog}]);
  });
  const reload=button('Kaydedileni yükle','subtle',()=>confirmDialog('Kaydedilmiş kılavuzu yükle','Bu ekrandaki kaydedilmemiş değişiklikler bırakılacak ve son kaydedilmiş kılavuz açılacak.','Kaydedileni yükle',async()=>{await store.reload();resetGuideEditor();render();}));
  const buttons=node('div','actions');append(buttons,save,field('Önizleme ödevi',previewHomework),preview,reload);append(actions,buttons,stateLabel);form.append(actions);
  const bind=(label,value,max,onChange,multi=false)=>{
    const control=multi?textarea(value):input('text',value);control.required=true;control.maxLength=max;
    if(multi)control.rows=8;
    control.oninput=()=>{onChange(control.value);changed();};
    return field(label,control);
  };
  const top=node('div','card');
  top.append(bind('Kılavuz başlığı',draft.title,120,v=>draft.title=v),bind('Kısa açıklama',draft.subtitle,300,v=>draft.subtitle=v));form.append(top);
  const highlights=node('div','card');highlights.append(node('h2','','Üstteki kısa bilgi kutuları'));
  draft.highlights.forEach((item,index)=>{
    const row=node('div','guide-highlight-fields');row.append(bind(`${index+1}. kutu başlığı`,item.title,60,v=>item.title=v),bind(`${index+1}. kutu açıklaması`,item.text,180,v=>item.text=v));highlights.append(row);
  });form.append(highlights);
  draft.sections.forEach((section,index)=>{
    const card=node('div','card'),head=node('div','guide-section-heading');
    const remove=button('Bölümü kaldır','subtle',()=>{draft.sections.splice(index,1);changed();render();});remove.disabled=draft.sections.length<=1;remove.setAttribute('aria-label',`${index+1}. bölümü kaldır`);
    append(head,node('h2','',`${index+1}. bölüm`),remove);card.append(head);
    card.append(bind(`${index+1}. bölüm başlığı`,section.title,160,v=>section.title=v),bind(`${index+1}. bölüm açıklaması`,section.body,10000,v=>section.body=v,true));
    const tone=select([['normal','Normal bölüm'],['deadline','Vurgulu bölüm (sarı kutu)']],section.tone);tone.onchange=()=>{section.tone=tone.value;changed();};card.append(field(`${index+1}. bölüm görünümü`,tone));
    form.append(card);
  });
  const add=button('+ Bölüm ekle','outline',()=>{draft.sections.push({id:crypto.randomUUID(),title:'Yeni bölüm',body:'',tone:'normal'});changed();render();});add.disabled=draft.sections.length>=20;
  form.append(add,node('p','help','Açıklamaları normal yazı olarak girin. Hak sayıları için {kod_hakki} ve {test_hakki} yazın; sistem bunları öğrenci ödevine göre doldurur. İlk iki bilgi kutusunun hak sayısı otomatik belirlenir. Yeni paragraf için araya boş satır bırakın. En fazla 20 bölüm ekleyebilirsiniz.'));
  form.addEventListener('submit',event=>{event.preventDefault();if(form.reportValidity())act(saveGuide);});view.append(form);
}
window.addEventListener('beforeunload',event=>{if(guideEdit.dirty||edit.dirty){event.preventDefault();event.returnValue='';}});
function openStudentPreview(homeworkId=edit.id) {
  if(!cloudClient||!currentTerm())return;
  persistNavigation(()=>{
    const url=new URL('../',location.href);
    const selected=assignment(homeworkId)?.approved ? homeworkId : assignments().find(a=>a.approvedRevision)?.id;
    url.searchParams.set('preview','teacher');url.searchParams.set('term',termId());
    url.searchParams.set('panel',tab);url.searchParams.set('editing',edit.id);
    url.searchParams.set('editingVariant',edit.variant);url.searchParams.set('editingQuestion',edit.question);
    const task=homeworkId===edit.id?edit.question:'Q1';
    if(selected)url.hash=`${selected}_${edit.variant}/${['Q5','Q6'].includes(task)?task+'.1':task}`;
    location.assign(url.href);
  });
}
function restorePreviewNavigation() {
  const params=new URLSearchParams(location.search);
  if(params.get('from')!=='student-preview')return;
  if(store.state.terms.some(t=>t.id===params.get('term')))store.selectTerm(params.get('term'));
  if(Object.hasOwn(title,params.get('view')))tab=params.get('view');
  if(assignments().some(a=>a.id===params.get('homework')))edit.id=params.get('homework');
  if(['A','B','C'].includes(params.get('variant')))edit.variant=params.get('variant');
  if(/^Q[1-6]$/.test(params.get('question')||''))edit.question=params.get('question');
}
$('student-preview').onclick=()=>openStudentPreview();
function render() { const t=currentTerm(); $('panel').hidden=false; $('load-state').hidden=true; const ts=$('term-select'); clear(ts); for(const x of store.state.terms){const o=node('option','',`${x.name}${x.archived?' · arşiv':''}`);o.value=x.id;ts.append(o);} ts.value=t?.id || ''; $('archive-term').textContent=t?.archived?'Arşivden çıkar':'Dönemi arşivle'; $('archive-term').disabled=!t; $('term-note').textContent=t?.isDemo?'Örnek dönem (temsili veriler) · Bu dönemdeki örnek sonuçlar gerçek öğrenci teslimi değildir.':t?.archived?'Arşivlenmiş dönem · Kayıtlar korunur.':cloudClient?'Dönem kayıtları bulutta saklanır.':'Dönem kayıtları yalnızca bu tarayıcıda saklanır.'; $('term-note').classList.toggle('demo',!!t?.isDemo); document.querySelectorAll('.nav-link').forEach(b=>{b.classList.toggle('active',b.dataset.tab===tab);b.setAttribute('aria-current',b.dataset.tab===tab?'page':'false');}); $('student-preview').hidden=!cloudClient;$('student-preview').disabled=!t||!assignments().some(a=>a.approvedRevision); const view=clear($('view')); if(tab==='guide'){renderGuideEditor(view);return;} if(!t){view.append(heading('PANEL','İlk döneminizi oluşturun','Öğrencileri eklemek ve sonuçları görmek için yeni bir dönem oluşturun.'));return;} if(tab==='dashboard') renderDashboard(view); else if(tab==='students') renderStudents(view); else if(tab==='assignments') renderAssignments(view); else if(tab==='feedback') renderFeedback(view); else renderResults(view); }
document.querySelectorAll('.nav-link').forEach(b=>b.onclick=()=>setTab(b.dataset.tab));
$('term-select').onchange=e=>{const id=e.target.value;persistNavigation(async()=>{const previous=termId();try{store.selectTerm(id);await ensureVariantMaps();studentSearch='';resultSearch='';feedbackSearch='';feedbackCategory='all';feedbackStatus='all';selectedStudentIds.clear();render();}catch(error){store.selectTerm(previous);render();fail(error);}});if(edit.dirty||guideEdit.dirty)e.target.value=termId();};
$('new-term').onclick=()=>{const name=input('text','','Örneğin 2026–2027 Güz');name.required=true;dialog('Yeni dönem oluştur',b=>{b.append(node('p','','Yeni dönem boş bir öğrenci listesiyle başlar. Önceki dönem kayıtları korunur.'));b.append(field('Dönem adı',name));},[{label:'Vazgeç',cls:'outline',onClick:closeDialog},{label:'Dönem oluştur',onClick:async()=>{await store.addTerm(name.value.trim());finishDialog();render();toast('Yeni dönem oluşturuldu.');}}]);name.focus();};
$('archive-term').onclick=()=>{const t=currentTerm();confirmDialog(t.archived?'Dönemi arşivden çıkar':'Dönemi arşivle',t.archived?'Bu dönem yeniden etkin görünür. Kayıtları korunmuştur.':'Dönem arşivlenir; öğrenciler, ödevler ve sonuçlar silinmez.',t.archived?'Arşivden çıkar':'Arşivle',async()=>{await store.archiveTerm(t.id,!t.archived);await ensureVariantMaps();render();toast('Dönem durumu güncellendi.');});};
function feedbackStatusLabel(value) { return feedbackStatusOptions.find(([id])=>id===value)?.[1] || 'Yeni'; }
function feedbackBadge(value) { return status(feedbackStatusLabel(value),value==='new'?'pending':value==='reviewing'?'blue':''); }
function feedbackCategoryLabel(row,settings=feedbackSettings(store.state.feedbackSettings)) { return row.categoryLabel || settings.categories.find(c=>c.id===row.categoryId)?.label || 'Diğer'; }
function feedbackContext(row) { return [row.homeworkTitle || row.homeworkId,row.taskTitle || row.taskId,row.formId,row.revision!=null?`İçerik sürümü ${row.revision}`:''].filter(Boolean).join(' · '); }
function renderFeedback(view) {
  const settings=feedbackSettings(store.state.feedbackSettings);
  const rows=(store.state.feedback||[]).filter(r=>r.termId===termId()).sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')) || String(b.id).localeCompare(String(a.id)));
  const h=heading('PANEL / GERİ BİLDİRİMLER','Geri bildirimler','Öğrencilerin bildirimlerini inceleyin, cevap yazın ve takip durumunu güncelleyin.');
  h.append(button('Kategori ayarları','outline',openFeedbackSettings));view.append(h);
  const stats=node('div','stats feedback-stats');
  for(const [label,count,hint] of [['Toplam bildirim',rows.length,'Seçili dönem'],...feedbackStatusOptions.map(([id,label])=>[label,rows.filter(r=>(r.status||'new')===id).length,'Seçili dönem'])]) {
    const card=node('div','stat-card');append(card,node('span','',label),node('strong','',count),node('small','',hint));stats.append(card);
  }
  view.append(stats);
  const categorySummary=node('div','feedback-category-summary');categorySummary.setAttribute('aria-label','Kategori başına bildirim sayısı');
  for(const c of settings.categories) { const item=node('div','feedback-category-count');append(item,node('span','',c.label),node('strong','',rows.filter(r=>r.categoryId===c.id).length));if(!c.enabled)item.append(node('small','','Kapalı'));categorySummary.append(item); }
  view.append(categorySummary);
  if(!settings.enabled)view.append(node('div','notice warning','Geri bildirim toplama kapalı. Önceden gönderilen bildirimleri inceleyebilir ve durumlarını güncelleyebilirsiniz.'));
  const toolbar=node('div','toolbar feedback-toolbar');
  const search=input('search',feedbackSearch,'Öğrenci numarası, adı veya bildirim metni');search.className='grow';search.setAttribute('aria-label','Geri bildirimlerde ara');
  const category=select([['all','Tüm kategoriler'],...settings.categories.map(c=>[c.id,c.label])],feedbackCategory);category.setAttribute('aria-label','Kategoriye göre filtrele');
  const state=select([['all','Tüm durumlar'],...feedbackStatusOptions],feedbackStatus);state.setAttribute('aria-label','Duruma göre filtrele');
  append(toolbar,search,category,state);view.append(toolbar);
  const results=node('div');results.id='feedback-results';view.append(results);
  const update=()=>{
    clear(results);const query=feedbackSearch.trim().toLocaleLowerCase('tr-TR');
    const visible=rows.filter(r=>(feedbackCategory==='all'||r.categoryId===feedbackCategory)&&(feedbackStatus==='all'||(r.status||'new')===feedbackStatus)&&(!query||[r.studentNumber,r.studentName,r.message].some(v=>text(v).toLocaleLowerCase('tr-TR').includes(query))));
    const count=node('p','help',`${visible.length} / ${rows.length} bildirim · En yeni önce`);count.setAttribute('role','status');results.append(count);
    if(!visible.length){const empty=node('div','card feedback-empty');append(empty,node('div','feedback-empty-icon','◇'),node('h2','',rows.length?'Eşleşen bildirim bulunamadı':'Henüz geri bildirim yok'),node('p','',rows.length?'Arama metnini veya kategori ve durum filtrelerini değiştirerek yeniden deneyin.':'Öğrencilerin gönderdiği geri bildirimler burada görünecek. Kategori ayarlarından geri bildirim toplamayı ve açık kategorileri yönetebilirsiniz.'));if(rows.length)empty.append(button('Filtreleri temizle','outline',()=>{feedbackSearch='';feedbackCategory='all';feedbackStatus='all';render();}));results.append(empty);return;}
    const wrap=node('div','table-wrap'),table=node('table','data-table feedback-table'),thead=node('thead'),head=node('tr');
    for(const label of ['Öğrenci','Kategori / bildirim','Gönderim','Durum','İşlem']){const th=node('th','',label);th.scope='col';head.append(th);}thead.append(head);table.append(thead);const body=node('tbody');
    for(const row of visible){const tr=node('tr'),student=node('td'),message=node('td'),date=node('td'),stateCell=node('td'),action=node('td');
      append(student,node('strong','',row.studentName||'Öğrenci'),node('div','help',row.studentNumber||'—'));
      append(message,node('strong','',feedbackCategoryLabel(row,settings)),node('p','feedback-excerpt',row.message||''));
      const context=feedbackContext(row);if(context)message.append(node('div','help',context));
      const timestamp=node('time','',shortDate(row.createdAt));if(row.createdAt)timestamp.dateTime=row.createdAt;date.append(timestamp);stateCell.append(feedbackBadge(row.status),node('div','help',row.teacherReply?.message?'Cevap yazıldı':'Henüz cevap yok'));
      const inspect=button('Ayrıntı','outline small',()=>openFeedbackDetail(row.id));inspect.setAttribute('aria-label',`${row.studentName||row.studentNumber||'Öğrenci'} geri bildirimini incele`);action.append(inspect);append(tr,student,message,date,stateCell,action);body.append(tr);
    }
    table.append(body);wrap.append(table);results.append(wrap);
  };
  search.oninput=()=>{feedbackSearch=search.value;update();};category.onchange=()=>{feedbackCategory=category.value;update();};state.onchange=()=>{feedbackStatus=state.value;update();};update();
}
function openFeedbackDetail(id) {
  const row=(store.state.feedback||[]).find(r=>r.id===id&&r.termId===termId());if(!row)return;
  const choice=select(feedbackStatusOptions,row.status||'new');
  let savedReply=row.teacherReply||null;
  const reply=textarea(savedReply?.message||'','feedback-reply-editor');reply.rows=5;reply.maxLength=3000;reply.setAttribute('aria-label','Öğrenciye cevabınız');
  reply.placeholder='Öğrencinin bildirimine cevabınızı yazın.';
  const replyMeta=node('p','help'),replyCount=node('p','feedback-reply-count'),replyError=node('p','validation');replyError.setAttribute('role','alert');
  const updateReplyMeta=()=>{replyMeta.textContent=savedReply?`Cevap ${shortDate(savedReply.updatedAt)} tarihinde kaydedildi. Öğrenci güncel metni görür.`:'Kaydettiğiniz cevap yalnız bu öğrenciye gösterilir. Daha sonra düzenleyebilirsiniz.';replyCount.textContent=`${reply.value.length} / 3000 karakter`;};
  reply.oninput=()=>{replyError.textContent='';replyCount.textContent=`${reply.value.length} / 3000 karakter`;};updateReplyMeta();
  const reloadReply=button('Güncel cevabı yükle','outline small',()=>act(async()=>{
    await store.reload();const current=store.state.feedback?.find(r=>r.id===id);if(!current)throw new Error('Bildirim bulunamadı.');
    savedReply=current.teacherReply||null;reply.value=savedReply?.message||'';choice.value=current.status||'new';
    updateReplyMeta();replyError.textContent='';reloadReply.hidden=true;render();
  }));reloadReply.hidden=true;
  dialog('Geri bildirim ayrıntısı',body=>{
    const meta=node('div','feedback-detail-meta');
    for(const [label,value] of [['Kategori',feedbackCategoryLabel(row)],['Öğrenci',`${row.studentNumber||'—'} · ${row.studentName||'Öğrenci'}`],['Gönderim zamanı',shortDate(row.createdAt)],['İlgili ödev / soru',feedbackContext(row)]]){if(!value)continue;const item=node('div');append(item,node('strong','',label),node('span','',value));meta.append(item);}
    body.append(meta,node('h3','feedback-message-label','Öğrencinin bildirimi'),node('div','feedback-message',row.message||''));
    const replyBox=node('section','feedback-reply-box');replyBox.append(field('Öğrenciye cevabınız',reply),replyCount,replyMeta,replyError,reloadReply);body.append(replyBox);
    body.append(field('Takip durumu',choice),node('p','help','Cevap ve takip durumu ayrı kaydedilir. Öğrenci ikisini de kendi bildiriminde görür.'));
  },[{label:'Kapat',cls:'outline',onClick:closeDialog},{label:'Durumu kaydet',onClick:async()=>{await store.setFeedbackStatus(row.id,choice.value);render();toast('Geri bildirim durumu kaydedildi.');}},
    {label:'Cevabı kaydet ve öğrenciye göster',cls:'',onClick:async()=>{
      const message=reply.value.trim();
      if(!message){replyError.textContent='Lütfen öğrenciye cevabınızı yazın.';return;}
      if(message===savedReply?.message){toast('Bu cevap zaten kaydedilmiş.');return;}
      try {
        await store.saveFeedbackReply(row.id,message,savedReply?.revision||0);
        savedReply=store.state.feedback.find(r=>r.id===row.id).teacherReply;reply.value=savedReply.message;
        updateReplyMeta();replyError.textContent='';reloadReply.hidden=true;render();toast('Cevap kaydedildi; öğrenci kendi bildiriminde görebilir.');
      } catch(error) {
        replyError.textContent=error?.message||'Cevap kaydedilemedi. Metniniz burada duruyor; tekrar deneyin.';
        if(error?.code==='FEEDBACK_REPLY_CONFLICT') {reloadReply.hidden=false;replyError.textContent+=' Güncel cevabı yükle düğmesi, bu alandaki metni son kaydedilen cevapla değiştirir.';}
      }
    }}]);
}
function openFeedbackSettings() {
  const draft=clone(feedbackSettings(store.state.feedbackSettings)),revision=draft.revision;
  const enabled=input('checkbox');enabled.checked=draft.enabled;enabled.onchange=()=>draft.enabled=enabled.checked;
  const editors=[];
  dialog('Kategori ayarları',body=>{
    body.append(node('p','','Geri bildirim toplama ve kategori ayarları tüm dönemlerde öğrenci ekranına uygulanır. Mevcut bildirimlerin kayıtlı kategori adları korunur.'));
    const collection=node('label','delivery-active');append(collection,enabled,node('span','','Öğrencilerden geri bildirim topla'));body.append(collection);
    for(const category of draft.categories){const box=node('div','feedback-category-editor');const active=input('checkbox');active.checked=category.enabled;active.onchange=()=>category.enabled=active.checked;
      const toggle=node('label','checkbox');append(toggle,active,node('strong','',`${category.label} kategorisi açık`));box.append(toggle);
      const label=input('text',category.label);label.maxLength=100;label.required=true;label.oninput=()=>category.label=label.value;
      const description=textarea(category.description||'');description.rows=2;description.maxLength=500;description.oninput=()=>category.description=description.value;
      append(box,field('Kategori adı',label),field('Öğrenciye gösterilen açıklama',description));
      if(category.requiresQuestion)box.append(node('p','help','Bu kategori için öğrenci ödev ve soru seçer.'));
      editors.push(label);body.append(box);
    }
    body.append(node('p','help','Kapalı kategoriler yeni bildirim formunda görünmez. Geçmiş bildirimler listede kalır.'));
  },[{label:'Vazgeç',cls:'outline',onClick:closeDialog},{label:'Ayarları kaydet',onClick:async()=>{
    const invalid=editors.find(e=>!e.value.trim());if(invalid)throw new Error('Kategori adı boş olamaz. Her kategori için bir ad girin.');
    if(draft.enabled&&!draft.categories.some(c=>c.enabled))throw new Error('Geri bildirim toplamak için en az bir kategoriyi açın.');
    for(const c of draft.categories){c.label=c.label.trim();c.description=c.description.trim();}
    await store.saveFeedbackSettings(draft,revision);finishDialog();render();toast('Geri bildirim kategori ayarları kaydedildi.');
  }}]);
}

function renderDashboard(view){const ss=students(), rows=store.resultRows(termId()), submitted=rows.filter(r=>r.status==='submitted'||r.status==='approved').length,pending=assignments().filter(a=>a.revision!==a.approvedRevision).length;view.append(heading('PANEL / GENEL BAKIŞ','Dönemin durumu','Öğrencileri yönetin, ödev taslaklarını inceleyin ve tamamlanan çalışmaları değerlendirin.'));const stats=node('div','stats');for(const [label,value,hint] of [['Etkin öğrenci',ss.filter(s=>s.active).length,'Bu dönemde'],['Ödev',assignments().length,'Hazır içerik'],['Onay bekleyen taslak',pending,'İçerik onayı'],['Tamamlanan çalışma',submitted,'İncelemeye hazır kayıt']]){const c=node('div','stat-card');append(c,node('span','',label),node('strong','',value),node('small','',hint));stats.append(c);}view.append(stats);const grid=node('div','grid-2');const c1=node('div','card');append(c1,node('p','eyebrow','SINIF'),node('h2','','Öğrenci listesi'),node('p','','Numara ve adla arayın, yeni öğrenci ekleyin veya toplu liste içe aktarın.'),button('Öğrencilere git →','outline',()=>setTab('students')));const c2=node('div','card');append(c2,node('p','eyebrow','DEĞERLENDİRME'),node('h2','','Sonuçlar'),node('p','','Ön puanları, denemeleri ve öğretmen notlarını tek yerde inceleyin.'),button('Sonuçlara git →','outline',()=>setTab('results')));append(grid,c1,c2);view.append(grid);view.append(node('p','section-label','ÖDEVLER'));for(const a of assignments()){const c=node('div','card assignment-header');const info=node('div');append(info,node('p','eyebrow',a.id),node('h2','',assignmentName(a)),node('div','assignment-meta',`Onaylı sürüm ${a.approvedRevision || 'yok'} · Taslak sürüm ${a.revision}`));const right=node('div','actions');right.append(status(a.revision===a.approvedRevision?'İçerik onaylı':'Onay bekliyor',a.revision===a.approvedRevision?'':'pending'),button('Düzenle','outline',()=>{edit.id=a.id;edit.draft=null;edit.settings=null;setTab('assignments');}));append(c,info,right);view.append(c);}}
function visibleStudents(){
  let rows=students().filter(s=>studentFilter==='all'||(studentFilter==='active')===!!s.active);
  const query=studentSearch.trim().toLocaleLowerCase('tr-TR');
  if(query)rows=rows.filter(s=>text(s.number).toLocaleLowerCase('tr-TR').includes(query)||text(s.name).toLocaleLowerCase('tr-TR').includes(query));
  return rows.sort((a,b)=>text(a.number).localeCompare(text(b.number),'tr',{numeric:true}));
}
function renderStudents(view){
  const ss=students();
  const h=heading('PANEL / ÖĞRENCİLER','Öğrenciler',`${ss.filter(s=>s.active).length} etkin · ${ss.filter(s=>!s.active).length} pasif öğrenci`);
  const actions=node('div','actions');append(actions,button('+ Öğrenci ekle','',()=>studentDialog()),button('Toplu içe aktar','outline',openImport));h.append(actions);view.append(h);
  view.append(node('p','student-access-help','Bir öğrencinin veya test hesabının ödev erişimini durdurmak için satırındaki Pasif yap düğmesini kullanın. Hesap ve sonuçlar saklanır. Yeniden açmak için durum filtresinden Pasif’i seçip Etkinleştir’e basın.'));
  const bar=node('div','toolbar'),search=input('search',studentSearch,'Numara veya ad ara');search.setAttribute('aria-label','Öğrenci ara');
  search.oninput=()=>{studentSearch=search.value;selectedStudentIds.clear();renderStudentTable();};
  const filter=select([['active','Etkin'],['inactive','Pasif'],['all','Tümü']],studentFilter);filter.setAttribute('aria-label','Durum filtresi');
  filter.onchange=()=>{studentFilter=filter.value;selectedStudentIds.clear();renderStudentTable();};
  append(bar,search,filter,node('span','grow'));
  const selected=button('Seçililere teslim tarihi','outline',()=>bulkDeadlineDialog([...selectedStudentIds]));selected.id='bulk-deadline';
  append(bar,selected,button('Listeyi temizle','danger',()=>clearRosterDialog()));view.append(bar);
  const mount=node('div');mount.id='student-table';view.append(mount);renderStudentTable();
}
function renderStudentTable(){
  const mount=clear($('student-table')),ss=visibleStudents();
  const bulk=$('bulk-deadline');if(bulk){bulk.textContent=`Seçililere teslim tarihi (${selectedStudentIds.size})`;bulk.disabled=!selectedStudentIds.size||!!currentTerm()?.archived;}
  if(!ss.length){mount.append(node('div','card empty','Bu filtreye uyan öğrenci yok.'));return;}
  const wrap=node('div','table-wrap'),table=node('table','data-table student-data-table'),head=node('tr');
  const selectHead=node('th');const all=input('checkbox');all.setAttribute('aria-label','Görünen etkin öğrencilerin tümünü seç');
  const eligible=ss.filter(s=>s.active&&!currentTerm()?.archived);all.disabled=!eligible.length;all.checked=!!eligible.length&&eligible.every(s=>selectedStudentIds.has(s.id));
  all.onchange=()=>{for(const s of eligible){if(all.checked)selectedStudentIds.add(s.id);else selectedStudentIds.delete(s.id);}renderStudentTable();};selectHead.append(all);head.append(selectHead);
  for(const label of ['Numara','Ad soyad','Aktif ödev / grup','Durum','İşlemler'])head.append(node('th','',label));
  const thead=node('thead');thead.append(head);table.append(thead);const body=node('tbody');
  for(const s of ss){const tr=node('tr'),selectCell=node('td'),check=input('checkbox');
    check.checked=selectedStudentIds.has(s.id);check.disabled=!s.active||!!currentTerm()?.archived;check.setAttribute('aria-label',`${s.number} ${s.name} öğrencisini seç`);
    check.onchange=()=>{if(check.checked)selectedStudentIds.add(s.id);else selectedStudentIds.delete(s.id);renderStudentTable();};selectCell.append(check);tr.append(selectCell);
    for(const value of [s.number,s.name])tr.append(node('td','',value));
    const active=activeStudentAssignments(s),formsCell=node('td','',studentForms(s,active));
    formsCell.dataset.studentForms=s.id;formsCell.dataset.homeworks=JSON.stringify(active.map(a=>a.id));tr.append(formsCell);
    const st=node('td');st.append(status(s.active?'Etkin':'Pasif',s.active?'':'muted'));tr.append(st);
    const cell=node('td'),row=node('div','row-actions');
    append(row,button('Düzenle','outline small',()=>studentDialog(s)),button(s.active?'Pasif yap':'Etkinleştir',s.active?'danger small':'subtle small',()=>confirmDialog(s.active?'Öğrenciyi pasif yap':'Öğrenciyi etkinleştir',`${s.name} (${s.number}) ${s.active?'pasif yapılacak. Pasifken ödevlere erişemez. Hesabı, önceki yanıtları ve sonuç kayıtları korunur; Pasif filtresinden yeniden etkinleştirebilirsiniz':'yeniden etkin olacak. Hesabı ve önceki kayıtlarıyla ödevlere erişebilecek'}.`,s.active?'Pasif yap':'Etkinleştir',async()=>{await store.setStudentActive(s.id,!s.active);selectedStudentIds.delete(s.id);render();toast('Öğrenci durumu güncellendi.');})));
    if(s.active){const extra=button('Ek hak / süre','outline small',()=>studentExceptionsDialog(s));extra.disabled=!!currentTerm()?.archived;row.append(extra);}
    if(cloudClient)row.append(button('Şifre sıfırla','outline small',()=>resetPasswordDialog(s)));
    if(s.active&&!cloudClient)row.append(button('Öğrenci ekranını aç','subtle small',()=>openStudent(s)));
    cell.append(row);tr.append(cell);body.append(tr);
  }
  table.append(body);wrap.append(table);mount.append(wrap);
}
function assignedTasks(student,homeworkId){
  const a=assignment(homeworkId),code=store.getAssignmentVariant(student.id,homeworkId),form=variant(a?.approved,code);
  return (form?.questions||[]).flatMap(q=>q.type==='code'?[{id:q.id,title:q.title,type:'code'}]:(q.items||[]).map(item=>({id:item.id,title:`${q.title} · ${item.id}`,type:'choice'})));
}
function latestStudentSubmission(student,homeworkId){
  const a=assignment(homeworkId);return store.state.submissions.filter(x=>x.studentId===student.id&&x.homeworkId===homeworkId&&x.revision===a?.approvedRevision).sort((x,y)=>String(y.updatedAt).localeCompare(String(x.updatedAt)))[0];
}
function studentExceptionsDialog(student,initialHomework,initialTask){
  if(!student.active||student.termId!==termId()||currentTerm()?.archived){toast('Yalnız bu dönemin etkin öğrencileri için değişiklik yapılabilir.',true);return;}
  const homeworkId=initialHomework||assignments()[0]?.id;if(!homeworkId)return;
  const homework=select(assignments().map(a=>[a.id,`${a.id} · ${assignmentName(a)}`]),homeworkId);
  const task=select(assignedTasks(student,homeworkId).map(x=>[x.id,`${x.id} · ${x.title}`]),initialTask||'Q1');
  const count=input('number',1);count.min='1';count.max='100';count.step='1';count.required=true;count.setAttribute('aria-label','Eklenecek hak sayısı');
  const summary=node('div','exception-summary'),error=node('p','validation');error.setAttribute('role','alert');
  const update=()=>{const hw=homework.value,tasks=assignedTasks(student,hw),key=task.value;
    if(!tasks.some(x=>x.id===key)){task.replaceChildren();for(const x of tasks){const option=node('option','',`${x.id} · ${x.title}`);option.value=x.id;task.append(option);}}
    const id=task.value,used=latestStudentSubmission(student,hw)?.entries?.[id]?.attempts?.length||0;
    const effective=store.getStudentQuestionAttemptLimit(student.id,hw,id);
    summary.textContent=`Kullanılan ${used} · Toplam hak ${effective} · Kalan ${Math.max(0,effective-used)}. Ek hak önceki denemeleri veya puanları silmez.`;
  };
  homework.onchange=()=>{
    const previous=task.value,tasks=assignedTasks(student,homework.value);
    task.replaceChildren();
    for(const item of tasks){const option=node('option','',`${item.id} · ${item.title}`);option.value=item.id;task.append(option);}
    if(tasks.some(item=>item.id===previous))task.value=previous;
    update();
  };task.onchange=update;update();
  const deadlineBody=node('div');
  dialog(`${student.name} · Ek hak / süre`,body=>{
    append(body,node('p','',`${student.number} · Atanan soruya ek hak verin veya bu öğrenci için özel son tarih belirleyin.`),
      field('Ödev',homework),field('Soru veya test maddesi',task),summary,field('Eklenecek hak',count),error);
    const grant=button('Bu soruya ek hak ver','',()=>act(async()=>{
      const n=Number(count.value);if(!Number.isInteger(n)||n<1||n>100){error.textContent='Ek hak 1–100 arasında tam sayı olmalıdır.';return;}
      await store.grantStudentQuestionAttempts(student.id,homework.value,task.value,n);
      const hw=homework.value,id=task.value;finishDialog();render();toast(`${id} için ${n} ek hak verildi.`);studentExceptionsDialog(student,hw,id);
    }));body.append(grant,node('div','subtle-line'),deadlineBody);
    renderPersonalDeadlineEditor(deadlineBody,[student.id],homework.value);
  },[{label:'Kapat',cls:'outline',onClick:closeDialog}]);
  homework.addEventListener('change',()=>renderPersonalDeadlineEditor(deadlineBody,[student.id],homework.value));
}
function renderPersonalDeadlineEditor(root,studentIds,homeworkId){
  clear(root);const single=studentIds.length===1?store.state.students.find(s=>s.id===studentIds[0]):null;
  const prior=single?.assignmentOverrides?.[homeworkId];
  const current=store.getAssignmentAvailability(termId(),homeworkId);
  root.append(node('h3','',single?'Kişisel teslim tarihi':'Seçili öğrencilerin teslim tarihi'));
  root.append(node('p','help',single&&prior?.deadline?`Kişisel tarih: ${formatDeadline(prior.deadline)} · Türkiye saati`:current?.deadline?`Genel tarih: ${formatDeadline(current.deadline)} · Türkiye saati`:'Genel tarih sınırı yok.'));
  const deadline=input('datetime-local',toDeadlineInput(prior?.deadline||null));deadline.step='60';deadline.setAttribute('aria-label','Kişisel son tarih');
  const allow=input('checkbox');allow.checked=!!prior?.allowClosed;
  const allowRow=node('label','delivery-active');append(allowRow,allow,node('span','','Genel olarak kapalı olsa da bu öğrenciye izin ver'));
  if(studentIds.length>1)allowRow.lastChild.textContent='Genel olarak kapalı olsa da seçili öğrencilere izin ver';
  const issue=node('p','validation');issue.setAttribute('role','alert');
  append(root,field('Son gönderim tarihi ve saati (Türkiye saati)',deadline),allowRow,
    node('p','help','Kişisel son tarih genel tarihi aşabilir. Genel tarihe dönmek için “Genel ayarlara dön” düğmesini kullanın. Kapatılmış ödevde izin vermek için yukarıdaki kutuyu işaretleyin.'),issue);
  const actions=node('div','actions');
  actions.append(button(studentIds.length===1?'Kişisel tarihi kaydet':'Seçililere uygula','',()=>act(async()=>{
    let date;try{date=fromDeadlineInput(deadline.value);}catch{issue.textContent='Geçerli bir tarih ve saat seçin.';return;}
    if(!date){issue.textContent='Kişisel son tarih seçin veya “Genel ayarlara dön” düğmesini kullanın.';return;}
    await store.setStudentAssignmentDeadlines(studentIds,homeworkId,{deadline:date,allowClosed:allow.checked});
    finishDialog();render();toast(`${studentIds.length} öğrenci için teslim tarihi kaydedildi.`);
  })));
  actions.append(button('Genel ayarlara dön','subtle',()=>confirmPersonalDeadlineReset(studentIds,homeworkId)));
  root.append(actions);
}
function confirmPersonalDeadlineReset(studentIds,homeworkId){
  finishDialog();confirmDialog('Kişisel son tarihi kaldır',`${studentIds.length} öğrenci ${homeworkId} için yeniden genel teslim tarihini ve ödevin açık/kapalı durumunu kullanacak.`, 'Genel ayarlara dön',async()=>{
    await store.setStudentAssignmentDeadlines(studentIds,homeworkId,null);selectedStudentIds.clear();render();toast('Kişisel teslim tarihleri kaldırıldı.');
  });
}
function bulkDeadlineDialog(ids){
  const valid=ids.filter(id=>{const s=store.state.students.find(x=>x.id===id);return s?.active&&s.termId===termId();});
  if(!valid.length||currentTerm()?.archived){selectedStudentIds.clear();render();toast('Seçili etkin öğrenci yok.',true);return;}
  const homework=select(assignments().map(a=>[a.id,`${a.id} · ${assignmentName(a)}`]),assignments()[0]?.id);
  const pane=node('div');
  dialog('Seçililere teslim tarihi',body=>{
    append(body,node('p','',`${valid.length} etkin öğrenciye aynı ödev için kişisel son tarih uygulanacak. Filtre değişince seçim temizlenir.`),field('Ödev',homework),pane);
    renderPersonalDeadlineEditor(pane,valid,homework.value);
  },[{label:'Kapat',cls:'outline',onClick:closeDialog}]);
  homework.onchange=()=>renderPersonalDeadlineEditor(pane,valid,homework.value);
}
function openStudent(s){const homework=assignments().find(a=>a.approvedRevision)?.id||'HW1';const form=`${homework}_${store.getAssignmentVariant(s.id,homework)}`;const url=new URL('../',location.href);url.searchParams.set('student',s.id);url.searchParams.set('term',s.termId);url.hash=`${form}/Q1`;window.open(url.href,'_blank','noopener');}
function credentialDialog(credentials,name='Öğrenci giriş bilgileri') {
  const rows=Array.isArray(credentials)?credentials:[credentials];
  dialog(name,b=>{
    b.append(node('p','','İlk giriş şifresi öğrenci numarasının son 6 hanesidir. Öğrenci ilk girişinde şifresini değiştirmelidir.'));
    for(const row of rows) if(row?.number&&row?.password) b.append(node('p','mono',`${row.number} · İlk giriş şifresi: ${row.password}`));
  },[{label:'Tamam',onClick:closeDialog}]);
}
function resetPasswordDialog(s) {
  dialog('Öğrenci şifresini sıfırla',b=>b.append(node('p','',`${s.name} (${s.number}) için şifre numaranın son 6 hanesine sıfırlanır. Öğrenci ilk girişte şifresini değiştirir.`)),[
    {label:'Vazgeç',cls:'outline',onClick:closeDialog},
    {label:'Şifreyi sıfırla',cls:'warn',onClick:async()=>{
      const credentials=await store.resetPassword(s.id);
      finishDialog();credentialDialog(credentials,'Şifre sıfırlandı');
    }}
  ]);
}
function studentDialog(s){
  const number=input('text',s?.number||'','Öğrenci numarası'),name=input('text',s?.name||'','Ad soyad');
  number.required=true;number.inputMode='numeric';number.pattern=cloudClient?'[0-9]{6,20}':'[0-9]{4,20}';number.disabled=!!(cloudClient&&s);name.required=true;
  dialog(s?'Öğrenciyi düzenle':'Öğrenci ekle',b=>{
    append(b,field('Öğrenci numarası',number),field('Ad soyad',name),node('p','help','Formlar öğrenci numarasının son rakamına göre her ödev için ayrı atanır. Eşlemeleri Ödevler bölümünde görebilirsiniz.'));
    if(cloudClient)b.append(node('p','help',s?'Giriş hesabıyla eşleşen öğrenci numarası değiştirilemez.':'Numara 6–20 rakam olmalıdır. İlk şifre numaranın son 6 hanesidir; öğrenci ilk girişte değiştirir.'));
  },[{label:'Vazgeç',cls:'outline',onClick:closeDialog},{label:s?'Değişiklikleri kaydet':'Öğrenci ekle',onClick:async()=>{
    if(!(cloudClient?/^[0-9]{6,20}$/:/^[0-9]{4,20}$/).test(number.value.trim()))throw new Error(cloudClient?'Öğrenci numarası 6–20 rakam olmalıdır.':'Öğrenci numarası 4–20 rakam olmalıdır.');if(!name.value.trim())throw new Error('Ad soyad gereklidir.');
    const data={number:number.value.trim(),name:name.value.trim()};
    const result=s?await store.updateStudent(s.id,data):await store.addStudent(termId(),data);
    finishDialog();render();toast('Öğrenci kaydedildi.');
    if(cloudClient&&!s&&result?.credentials)credentialDialog(result.credentials);
  }}]);(number.disabled?name:number).focus();
}
function clearRosterDialog(){const count=students().filter(s=>s.active).length;confirmDialog('Öğrenci listesini temizle',`Bu dönemdeki ${count} etkin öğrenci pasif yapılacak. Sonuçlar ve önceki teslimler korunur. İşlem geri alınabilir.`, 'Listeyi temizle',async()=>{await store.clearRoster(termId());render();toast('Öğrenci listesi temizlendi.');},'danger');}
function openImport(){const area=textarea('','prompt'),file=input('file');file.accept='.csv,.txt,text/csv,text/plain';const preview=node('div'),commit=button('Geçerli kayıtları ekle','',()=>{});commit.disabled=true;let accepted=[];const update=()=>{clear(preview);const parsed=parseRoster(area.value);const result=store.previewRoster(termId(),parsed.rows);accepted=result.accepted||[];const errors=[...(parsed.errors||[]),...(result.errors||[])],dupes=result.duplicates||[];preview.append(node('p','',`${accepted.length} eklenecek · ${dupes.length} tekrar · ${errors.length} hatalı satır`));const wrap=node('div','import-preview'),table=node('table','mini-table'),thead=node('tr');for(const h of ['Numara','Ad soyad','Son rakam'])thead.append(node('th','',h));const theadEl=node('thead');theadEl.append(thead);table.append(theadEl);const tbody=node('tbody');for(const r of accepted.slice(0,100)){const tr=node('tr');for(const v of [r.number,r.name,String(r.number).slice(-1)])tr.append(node('td','',v));tbody.append(tr);}table.append(tbody);wrap.append(table);preview.append(wrap);if(accepted.length>100)preview.append(node('p','help','İlk 100 kayıt gösteriliyor.'));for(const d of dupes.slice(0,8))preview.append(node('p','help',`Tekrar: ${d.number} · ${d.name}`));for(const er of errors.slice(0,8))preview.append(node('p','validation',`Satır ${er.line ?? '?'}: ${er.message}`));commit.disabled=!accepted.length;};area.oninput=update;file.onchange=async()=>{try{if(file.files[0]){area.value=await file.files[0].text();update();}}catch(error){fail(error);}};dialog('Öğrenci listesi içe aktar',b=>{append(b,node('p','','CSV dosyası seçin veya Excel’den kopyaladığınız listeyi yapıştırın. İki sütun (Numara | Ad soyad) ya da üç sütun (Numara | Ad | Soyad) kullanabilirsiniz; ad ile soyad otomatik birleştirilir. Sütun başlıkları olabilir veya olmayabilir. Önizlemedeki geçerli satırlar onayınızla eklenir. Formlar her ödevde son rakama göre atanır; eski listelerdeki grup sütunu bu dağılımı değiştirmez.'),field('CSV dosyası',file),field('Yapıştırılan liste',area),node('p','help',cloudClient?'Numaralar 6–20 rakam olmalıdır. İlk şifre numaranın son 6 hanesidir; ilk girişte değişir.':''),preview);},[{label:'Vazgeç',cls:'outline',onClick:closeDialog}]);commit.onclick=()=>act(async()=>{const result=await store.importRoster(termId(),accepted);finishDialog();render();toast(`${result.added} öğrenci eklendi; ${result.skipped} atlandı.`);if(cloudClient&&result.credentials)credentialDialog(result.credentials);});$('dialog-actions').append(commit);}
function startAssignment(id){const a=assignment(id);if(!a)return;if(edit.id===id&&edit.draft)return;edit={id,variant:edit.id===id?edit.variant:'A',question:edit.id===id?edit.question:'Q1',draft:clone(a.draft),settings:clone(a.settings||{}),dirty:false};}
async function saveDraft(){if(!edit.draft)return;const a=assignment(edit.id);await store.saveAssignment(edit.id,edit.draft,edit.settings);edit.dirty=false;edit.draft=clone(assignment(edit.id).draft);edit.settings=clone(assignment(edit.id).settings||{});toast('Taslak kaydedildi. Öğrenci ekranına yayımlanmadı.');render();}
function showAssignment(id){const navigate=()=>{edit.id=id;edit.variant='A';edit.question='Q1';edit.draft=null;edit.dirty=false;render();};if(edit.dirty)dirtyGuard(navigate);else navigate();}
function deliveryLabel(value){return ({active:'Aktif',inactive:'Kapalı',expired:'Süresi doldu',unapproved:'İçerik onayı bekliyor'})[value.reason];}
function deliveryToggleLabel(value){return value.isOpen?'Kapat':value.reason==='expired'?'Süreyi düzenle':'Aktif et';}
function updateDeliveryIndicators(){
  if(!store?.state)return;
  if(tab==='students')updateStudentFormIndicators();
  updateGradeReleaseIndicators();
  updateSolutionReleaseIndicators();
  document.querySelectorAll('.delivery-box[data-homework]').forEach(box=>{
    const value=assignmentAvailability(store.state,termId(),box.dataset.homework);
    const badge=box.querySelector('[data-delivery-status]');badge.textContent=deliveryLabel(value);badge.classList.toggle('pending',!value.isOpen);
    box.querySelector('[data-delivery-toggle]').textContent=deliveryToggleLabel(value);
  });
}
setInterval(updateDeliveryIndicators,1000);
function releaseExplanation(value,homeworkId,targetTerm=termId(),kind='solution') {
  const label=kind==='grade'?'Notlar':'Çözümler',object=kind==='grade'?'notları':'çözümleri';
  if(value.reason==='missing_term')return `${label} için bir dönem seçin.`;
  if(value.reason==='unapproved')return `Önce ödev içeriğini onaylayın. ${label}, tüm gönderimler kapandıktan sonra ayrıca yayımlanır.`;
  if(value.reason==='archived')return `Bu dönem arşivlenmiş. ${label} için önce dönemi arşivden çıkarın.`;
  if(value.published)return `${label} öğrencilere açık${value.publishedAt?` · ${shortDate(value.publishedAt)}`:''}.`;
  if(value.canPublish)return `Tüm gönderimler kapalı. Hazır olduğunuzda ${object} bu düğmeyle açabilirsiniz.`;
  const general=assignmentAvailability(store.state,targetTerm,homeworkId);
  if(general.isOpen)return `Genel gönderim açık. ${label} için önce gönderimleri kapatın veya son tarihi bekleyin.${value.openStudentCount?` Şu anda ${value.openStudentCount} etkin öğrenci gönderim yapabilir.`:''}`;
  if(value.openStudentCount)return `${value.openStudentCount} etkin öğrenci kişisel ek süre veya izinle hâlâ gönderim yapabilir. ${label} ancak bu gönderimler de kapandığında yayımlanabilir.`;
  return `${label} için tüm gönderimlerin kapanması gerekir.`;
}
function updateGradeReleaseIndicators() {
  for(const box of document.querySelectorAll('[data-grade-release]')) {
    const value=gradeReleaseStatus(store.state,box.dataset.term,box.dataset.gradeRelease);
    const badge=box.querySelector('[data-grade-status]');
    badge.textContent=value.published?'Notlar yayımlandı':'Notlar açıklanmadı';badge.classList.toggle('muted',!value.published);
    const explanation=box.querySelector('[data-grade-explanation]'),message=releaseExplanation(value,box.dataset.gradeRelease,box.dataset.term,'grade');
    if(explanation.textContent!==message)explanation.textContent=message;
    const publish=box.querySelector('[data-grade-publish]'),hide=box.querySelector('[data-grade-hide]');
    publish.hidden=value.published;publish.disabled=actionBusy||!value.canPublish;
    hide.hidden=!value.published;hide.disabled=actionBusy;
  }
}
function renderGradeReleaseControls(card,a) {
  const targetTerm=termId(),box=node('section','solution-release-box grade-release-box');
  box.dataset.gradeRelease=a.id;box.dataset.term=targetTerm;
  const badge=status('Notlar açıklanmadı','muted');badge.dataset.gradeStatus='';
  const explanation=node('p','solution-release-explanation');explanation.dataset.gradeExplanation='';explanation.setAttribute('aria-live','polite');
  const actions=node('div','actions');
  const publish=button('Notları yayımla','outline',()=>{
    const value=gradeReleaseStatus(store.state,targetTerm,a.id);
    if(!value.canPublish){updateGradeReleaseIndicators();toast(releaseExplanation(value,a.id,targetTerm,'grade'),true);return;}
    const term=store.state.terms.find(t=>t.id===targetTerm);
    confirmDialog('Notları öğrencilere yayımla',`${term?.name||'Seçili dönem'} · ${a.id}: Bu ödeve atanmış tüm öğrencilere, kısmi teslimler dahil, varsa onaylı son notları; yoksa kayıtlı otomatik toplam puanları gösterilecek. Soru puanları açılmaz. Öğrencilere hemen uygulama içi bildirim gösterilir; e-posta gönderilmez. Çözümlerin yayımı ayrı yönetilir. Notlar yayımlansın mı?`,'Notları yayımla',async()=>{
      await store.setGradeRelease(targetTerm,a.id,true);updateGradeReleaseIndicators();updateSolutionReleaseIndicators();toast(`${a.id} notları yayımlandı; uygulama içi bildirim hazır.`);
    });
  });publish.dataset.gradePublish='';
  const hide=button('Notları gizle','subtle',()=>confirmDialog('Notları gizle',`${a.id} toplam notları bu dönemin öğrencilerine kapatılacak. Çözümlerin yayım durumu değişmez. Yanıtlar ve not kayıtları korunur.`,'Notları gizle',async()=>{
    await store.setGradeRelease(targetTerm,a.id,false);updateGradeReleaseIndicators();updateSolutionReleaseIndicators();toast(`${a.id} notları gizlendi.`);
  }));hide.dataset.gradeHide='';
  append(actions,publish,hide);
  append(box,node('p','eyebrow','NOTLARIN YAYIMI'),badge,node('p','help','Öğrenciler bu dönem ve ödev için siz notları yayımlayana kadar toplam puan göremez. Yayımlanınca varsa onaylı son not, yoksa kayıtlı otomatik toplam gösterilir; kısmi teslimler dahildir. Soru puanları açılmaz. Yayım hemen uygulama içi bildirim oluşturur; e-posta gönderilmez. Son notu değiştirmek notların yeniden yayımlanmasını gerektirir.'),explanation,actions);
  card.append(box);
}
function updateSolutionReleaseIndicators() {
  for(const box of document.querySelectorAll('[data-solution-release]')) {
    const value=solutionReleaseStatus(store.state,box.dataset.term,box.dataset.solutionRelease);
    const badge=box.querySelector('[data-solution-status]');
    badge.textContent=value.published?'Çözümler yayımlandı':'Çözümler gizli';badge.classList.toggle('muted',!value.published);
    const explanation=box.querySelector('[data-solution-explanation]'),message=releaseExplanation(value,box.dataset.solutionRelease,box.dataset.term);
    if(explanation.textContent!==message)explanation.textContent=message;
    const publish=box.querySelector('[data-solution-publish]'),hide=box.querySelector('[data-solution-hide]');
    publish.hidden=value.published;publish.disabled=actionBusy||!value.canPublish;
    hide.hidden=!value.published;hide.disabled=actionBusy;
  }
}
function renderSolutionReleaseControls(card,a) {
  const targetTerm=termId(),box=node('section','solution-release-box');
  box.dataset.solutionRelease=a.id;box.dataset.term=targetTerm;
  const badge=status('Çözümler gizli','muted');badge.dataset.solutionStatus='';
  const explanation=node('p','solution-release-explanation');explanation.dataset.solutionExplanation='';explanation.setAttribute('aria-live','polite');
  const actions=node('div','actions');
  const publish=button('Çözümleri yayımla','outline',()=>{
    const value=solutionReleaseStatus(store.state,targetTerm,a.id);
    if(!value.canPublish){updateSolutionReleaseIndicators();toast(releaseExplanation(value,a.id,targetTerm),true);return;}
    const term=store.state.terms.find(t=>t.id===targetTerm);
    confirmDialog('Çözümleri öğrencilere yayımla',`${term?.name||'Seçili dönem'} · ${a.id}: Öğrenciler çözüm ve doğru yanıt ayrıntılarını görebilecek. Bu işlem içerik onayından ve notların yayımından ayrıdır. Öğrencilere hemen uygulama içi bildirim gösterilir; e-posta gönderilmez. Çözümleri daha sonra gizleyebilirsiniz. Yayımlansın mı?`,'Çözümleri yayımla',async()=>{
      await store.setSolutionRelease(targetTerm,a.id,true);updateSolutionReleaseIndicators();toast(`${a.id} çözümleri yayımlandı.`);
    });
  });publish.dataset.solutionPublish='';
  const hide=button('Çözümleri gizle','subtle',()=>confirmDialog('Çözümleri gizle',`${a.id} çözümleri bu dönemin öğrencilerine kapatılacak. Notların yayım durumu değişmez. Önceki yanıtlar ve sonuçlar korunur.`,'Çözümleri gizle',async()=>{
    await store.setSolutionRelease(targetTerm,a.id,false);updateSolutionReleaseIndicators();toast(`${a.id} çözümleri gizlendi.`);
  }));hide.dataset.solutionHide='';
  append(actions,publish,hide);
  append(box,node('p','eyebrow','ÇÖZÜMLERİN YAYIMI'),badge,node('p','help','Bu dönem ve ödev için ayrı yönetilir. İçerik onayı ve notların yayımı çözümleri açmaz. Çözüm ayrıntıları tüm gönderim süreleri kapanıp siz çözümleri yayımladıktan sonra açılır. Bu düğme notların görünürlüğünü değiştirmez. Yayım hemen uygulama içi bildirim oluşturur; e-posta gönderilmez.'),explanation,actions);
  card.append(box);
}

function renderVariantMap(card,a) {
  const box=node('section','variant-map');
  box.setAttribute('aria-label',`${a.id} son rakama göre form dağılımı`);
  box.append(node('p','eyebrow','NUMARANIN SON RAKAMI'));
  const map=store.getAssignmentVariantMap(termId(),a.id);
  if(!map){box.append(node('p','help','Bu dönemde önceki öğrenci form atamaları korunuyor.'));card.append(box);return;}
  const groups=assignmentVariantGroups(map),rows=node('div','variant-groups');
  for(const code of ['A','B','C']){
    const row=node('div','variant-group');
    row.append(node('span','variant-letter',`${code} formu`),node('strong','',groups[code].join(', ')));
    rows.append(row);
  }
  box.append(rows,node('p','help','Her ödev için ayrı oluşturulur ve sabit kalır. 10 rakam, 3/3/4 olarak paylaşılır; öğrenci sayıları son rakamların sıklığına göre değişebilir.'),node('p','help','Başlanmış ödevlerde öğrencinin önceki formu ve cevapları korunur.'));
  card.append(box);
}
function renderDeliveryControls(card,a){
  const value=store.getAssignmentAvailability(termId(),a.id),box=node('div','delivery-box');
  box.dataset.homework=a.id;
  const badge=status(deliveryLabel(value),value.isOpen?'':'pending');badge.dataset.deliveryStatus='';
  append(box,node('p','eyebrow','ÖĞRENCİYE AÇIKLIK'),badge,
    node('p','delivery-deadline',value.deadline?`Son gönderim: ${formatDeadline(value.deadline)} · Türkiye saati`:'Son gönderim: Süre sınırı yok'));
  const actions=node('div','actions');
  const toggle=button(deliveryToggleLabel(value),value.isOpen?'subtle':'outline',()=>{
    const current=store.getAssignmentAvailability(termId(),a.id);
    if(!current.isOpen&&current.deadline&&Date.parse(current.deadline)<=Date.now()){deliveryDialog(a.id);return;}
    const active=!current.isOpen;
    confirmDialog(active?'Ödevi aktif et':'Ödevi kapat',`${currentTerm().name} döneminde ${a.id} için ${active?'öğrenci gönderimleri açılacak.':'yeni yanıt gönderimi duracak. Önceki yanıtlar ve sonuçlar korunacak.'}`,active?'Aktif et':'Kapat',async()=>{
      await store.setAssignmentAvailability(termId(),a.id,{active,deadline:current.deadline});render();toast(active?'Ödev aktif edildi.':'Ödev kapatıldı.');
    },active?'':'warn');
  });
  toggle.dataset.deliveryToggle='';
  toggle.disabled=!!currentTerm()?.archived||!a.approvedRevision;
  const settings=button('Teslim ayarları','outline',()=>deliveryDialog(a.id));settings.disabled=!!currentTerm()?.archived;
  append(actions,toggle,settings);box.append(actions);card.append(box);
}
function deliveryDialog(homeworkId){
  const targetTerm=termId(),a=assignment(homeworkId),saved=store.getAssignmentAvailability(targetTerm,homeworkId);
  const active=input('checkbox');active.checked=saved.active;active.disabled=!a.approvedRevision;
  const activeField=node('label','delivery-active');append(activeField,active,node('span','','Ödev aktif olsun'));
  const deadline=input('datetime-local',toDeadlineInput(saved.deadline));deadline.step='60';
  const hint=node('p','help');
  const updateHint=()=>{
    try{const date=fromDeadlineInput(deadline.value);hint.textContent=date&&Date.parse(date)<=Date.now()?'Seçilen son tarih geçmişte. Bu ayarla ödev gönderime kapalı olur.':'Seçilen dakika başladığında gönderimler kapanır. Örneğin 23:59 seçilirse 23:59:00’dan itibaren yanıt kabul edilmez.';}
    catch{hint.textContent='Geçerli bir tarih ve saat seçin.';}
  };
  deadline.oninput=updateHint;updateHint();
  dialog(`${homeworkId} · Teslim ayarları`,body=>{
    append(body,node('p','',`${currentTerm().name} · A/B/C formlarının tamamı için geçerlidir.`),
      activeField,field('Son gönderim tarihi ve saati (Türkiye saati)',deadline),hint,
      button('Tarih sınırını kaldır','subtle',()=>{deadline.value='';updateHint();}),
      node('p','help','Tarih boşsa süre sınırı uygulanmaz. Ödev kapatıldığında önceki yanıtlar ve sonuçlar korunur; yeni yanıt ve taslak kaydı kabul edilmez.'),
      node('p','help','Bu ayarlar soru içeriğini veya gönderim haklarını değiştirmez. Kaydettiğinizde bu dönem için hemen uygulanır.'));
  },[{label:'Vazgeç',cls:'outline',onClick:closeDialog},{label:'Teslim ayarlarını kaydet',onClick:async()=>{
    const date=fromDeadlineInput(deadline.value);
    await store.setAssignmentAvailability(targetTerm,homeworkId,{active:active.checked,deadline:date});
    finishDialog();render();toast('Teslim ayarları kaydedildi.');
  }}]);
}
function renderAttemptControls(card,a){
  const limits=store.getAssignmentAttemptLimits(termId(),a.id),box=node('div','delivery-box');
  box.dataset.attemptSettings=a.id;
  append(box,node('p','eyebrow','GÖNDERİM HAKLARI'),node('p','delivery-deadline',`Kod: her soru için ${limits.code} hak · Test: her madde için ${limits.choice} hak`));
  const change=button('Hakları değiştir','outline',()=>attemptLimitsDialog(a.id));change.disabled=!!currentTerm()?.archived;box.append(change);card.append(box);
}
function attemptLimitsDialog(homeworkId){
  const selectedTerm=termId(),saved=store.getAssignmentAttemptLimits(selectedTerm,homeworkId);
  const code=input('number',saved.code),choice=input('number',saved.choice);
  for(const control of [code,choice]){control.min='1';control.max='100';control.step='1';control.required=true;}
  const error=node('p','validation');error.setAttribute('role','alert');
  dialog(`${homeworkId} · Gönderim hakları`,body=>{
    append(body,node('p','',`${currentTerm().name} dönemi · ${homeworkId} ödevinin A/B/C formlarının tamamı için geçerlidir.`),
      field('Her kod sorusu için gönderim hakkı',code),field('Her test maddesi için gönderim hakkı',choice),
      node('p','help','1–100 arasında tam sayı girin. Değişiklik bu dönem ve ödev için hemen uygulanır. Önceki denemeler ve puanlar korunur. Hak artırılırsa ek gönderim yapılabilir; azaltılırsa kullanılan haklar geri alınmaz.'),error);
  },[{label:'Vazgeç',cls:'outline',onClick:closeDialog},{label:'Gönderim haklarını kaydet',onClick:async()=>{
    const values={code:Number(code.value),choice:Number(choice.value)};
    if(![values.code,values.choice].every(n=>Number.isInteger(n)&&n>=1&&n<=100)){error.textContent='Kod ve test hakkı 1–100 arasında tam sayı olmalıdır.';return;}
    await store.setAssignmentAttemptLimits(selectedTerm,homeworkId,values);
    finishDialog();render();toast('Gönderim hakları kaydedildi.');
  }}]);
}
function renderAssignments(view){const h=heading('PANEL / ÖDEVLER','Ödev içerikleri','Ödevleri açıp kapatın, son gönderim tarihini belirleyin; soruları taslakta düzenleyip onaylayın.');view.append(h);const cards=node('div','grid-2');for(const a of assignments()){const c=node('div','card');append(c,node('p','eyebrow',a.id),node('h2','',assignmentName(a)),node('p','',a.draft?.summary||'A, B ve C formları · 100 puan'),node('div','assignment-meta',`Taslak sürüm ${a.revision} · Onaylı sürüm ${a.approvedRevision||'yok'}`));const line=node('div','card-actions');append(line,status(a.revision===a.approvedRevision?'Onaylı':'Onay bekliyor',a.revision===a.approvedRevision?'':'pending'),button('İçeriği düzenle','outline',()=>showAssignment(a.id)));if(cloudClient){const preview=button('Öğrenci görünümü','subtle',()=>openStudentPreview(a.id));preview.disabled=!a.approvedRevision;line.append(preview);}c.append(line);renderDeliveryControls(c,a);renderGradeReleaseControls(c,a);renderSolutionReleaseControls(c,a);renderAttemptControls(c,a);renderVariantMap(c,a);cards.append(c);}view.append(cards);updateGradeReleaseIndicators();updateSolutionReleaseIndicators();startAssignment(edit.id);const a=assignment(edit.id);if(!a)return;const wrap=node('div','card');wrap.append(node('p','eyebrow',`${a.id} · TASLAK DÜZENLEYİCİ`));const subtitle=node('div','assignment-meta',`Onaylı sürüm ${a.approvedRevision||'yok'} · Taslak sürüm ${a.revision}${edit.dirty?' · Kaydedilmemiş değişiklikler':''}`);wrap.append(subtitle);const hw=edit.draft;const tt=input('text',hw.title||'');tt.oninput=()=>{hw.title=tt.value;edit.dirty=true;subtitle.textContent=`Onaylı sürüm ${a.approvedRevision||'yok'} · Taslak sürüm ${a.revision} · Kaydedilmemiş değişiklikler`;};wrap.append(field('Ödev başlığı',tt));const research=textarea(hw.research_note||'');research.rows=3;research.oninput=()=>{hw.research_note=research.value;edit.dirty=true;};wrap.append(field('Öğrenciye gösterilen araştırma notu',research));const clipboard=input('checkbox');clipboard.checked=edit.settings.clipboardBlocked!==false;clipboard.onchange=()=>{edit.settings.clipboardBlocked=clipboard.checked;edit.dirty=true;};wrap.append(field('Kod editöründe kopyala/yapıştırı sınırla',clipboard));{const limits=store.getAssignmentAttemptLimits(termId(),a.id);wrap.append(node('p','help',`Bu dönem ${a.id}: her kod sorusu ${limits.code}, her test maddesi ${limits.choice} gönderim hakkı. Kodu çalıştırmak hak azaltmaz. Hakları yukarıdaki ödev kartından değiştirebilirsiniz.`));}const tabs=node('div','form-tabs');for(const code of ['A','B','C']){const b=node('button','',`Form ${code}`);b.type='button';b.classList.toggle('active',code===edit.variant);b.onclick=()=>{edit.variant=code;edit.question='Q1';render();};tabs.append(b);}wrap.append(tabs);const form=variant(hw,edit.variant);if(!form){wrap.append(node('div','error-box','Bu formun içerik verisi bulunamadı.'));view.append(wrap);return;}const fsummary=textarea(form.summary||'');fsummary.rows=2;fsummary.oninput=()=>{form.summary=fsummary.value;edit.dirty=true;};wrap.append(field(`Form ${edit.variant} hazırlama notu (öğretmene özel)`,fsummary));const qnav=node('div','question-nav');for(const q of form.questions){const b=node('button','',q.id);b.type='button';b.classList.toggle('active',q.id===edit.question);b.onclick=()=>{edit.question=q.id;render();};qnav.append(b);}wrap.append(qnav);const q=form.questions.find(x=>x.id===edit.question)||form.questions[0];if(q){edit.question=q.id;renderQuestion(wrap,q);}const bar=node('div','savebar');append(bar,button('Taslağı kaydet','',()=>act(saveDraft)),button('Onaylı içeriğe dön','subtle',()=>revertDraft()),button('İçeriği onayla','outline',()=>approveDraft()));const approveButton=bar.lastChild;approveButton.disabled=edit.dirty||a.revision===a.approvedRevision;bar.append(node('span','help',cloudClient?'İçerik onayı güncel soruları kaydeder; teslim ayarları, notların ve çözümlerin yayımı ayrıca yönetilir.':'İçerik onayı öğrenciler için yayımlama işlemi değildir.'));wrap.append(bar);view.append(wrap);}
function renderQuestion(wrap,q){const box=node('div','question-box');const row=node('div','assignment-header'),head=node('div');append(head,node('p','eyebrow',q.type==='code'?'KOD SORUSU':'ÇOKTAN SEÇMELİ'),node('h2','',`${q.id} · ${q.title}`));append(row,head,node('span','fixed-points',`${q.points} puan · sabit`));box.append(row);const qtitle=input('text',q.title);qtitle.oninput=()=>{q.title=qtitle.value;edit.dirty=true;};box.append(field('Soru başlığı',qtitle));const prompt=textarea((q.prompt||[]).join('\n\n'),'prompt');prompt.oninput=()=>{q.prompt=prompt.value.split(/\n\s*\n/).map(s=>s.trim()).filter(Boolean);edit.dirty=true;};box.append(field('Soru metni (paragraflar arasında boş satır)',prompt));if(q.type==='code'){const starter=textarea(q.starter_code||'','code');starter.oninput=()=>{q.starter_code=starter.value;edit.dirty=true;};box.append(field('Öğrenciye verilen başlangıç kodu',starter));const details=node('details');details.append(node('summary','','Gelişmiş · örnek çözüm ve kontrol kodu'));const solution=textarea(q.solution_code||'','code');solution.oninput=()=>{q.solution_code=solution.value;edit.dirty=true;};details.append(field('Öğretmen örnek çözümü',solution));const checks=textarea(q.checks_code||'','code checks');checks.oninput=()=>{q.checks_code=checks.value;edit.dirty=true;};details.append(field('Kontrol kodu',checks));const checkState=node('div','help');const actions=node('div','actions');const run=button('Örnek çözümü kontrol et','outline',async()=>{run.disabled=true;cancel.disabled=false;checkState.textContent='Python ve PyTorch hazırlanıyor…';try{runner ||= new PythonRunner({onStatus:({message})=>{checkState.textContent=message;}});const result=await runner.grade(q.solution_code||'',q.checks_code||'');clear(checkState);if(result.infrastructure||result.cancelled){checkState.textContent=result.error||'Kontrol tamamlanamadı.';return;}checkState.append(node('p','',`Sonuç: ${result.score??0}/${result.total??q.points} puan${result.error?` · ${result.error}`:''}`));for(const x of result.checks||[])checkState.append(node('p',x.passed?'':'validation',`${x.passed?'✓':'×'} ${x.label}: ${x.detail}`));}catch(error){checkState.textContent=error?.message||String(error);}finally{run.disabled=false;cancel.disabled=true;}});const cancel=button('İptal','subtle',()=>runner?.cancel());cancel.disabled=true;append(actions,run,cancel);details.append(actions,checkState);box.append(details);box.append(node('p','help','Kod soruları toplam 70 puan. Kontrol sonucu taslağı onaylamak için otomatik karar vermez.'));}else{for(const item of q.items||[]){const group=node('div','choice-item');group.append(node('h4','',`${item.id} · ${item.points} puan`));const ip=textarea(item.prompt||'');ip.rows=2;ip.oninput=()=>{item.prompt=ip.value;edit.dirty=true;};group.append(field('Madde metni',ip));for(const opt of item.options||[]){const inp=input('text',opt.text||'');inp.oninput=()=>{opt.text=inp.value;edit.dirty=true;};const line=node('label','option-row');append(line,node('span','',opt.id),inp);group.append(line);}const correct=select([['','Seçin'],['A','A'],['B','B'],['C','C'],['D','D']],item.correct_option||item.correctOption||'');correct.onchange=()=>{item.correct_option=correct.value;edit.dirty=true;};group.append(field('Doğru seçenek',correct));const explanation=textarea(item.explanation||'');explanation.rows=2;explanation.oninput=()=>{item.explanation=explanation.value;edit.dirty=true;};group.append(field('Açıklama',explanation));box.append(group);}box.append(node('p','help','Çoktan seçmeli maddeler toplam 30 puan; her madde 5 puan.'));}wrap.append(box);}
function revertDraft(){if(edit.dirty)return dirtyGuard(revertDraft);confirmDialog('Taslağı geri al','Bu ödevin kaydedilmiş taslak değişiklikleri son onaylı içerikle değiştirilecek. Sonuç kayıtları korunur.','Taslağı geri al',async()=>{await store.revertAssignment(edit.id);edit.draft=null;render();toast('Taslak son onaylı içeriğe döndü.');},'danger');}
function approveDraft(){if(edit.dirty){toast('Önce taslağı kaydedin.',true);return;}const a=assignment(edit.id);if(a.revision===a.approvedRevision){toast('Onay bekleyen değişiklik yok.');return;}confirmDialog('İçeriği onayla',`${a.id} taslak sürüm ${a.revision} onaylı sürüm olarak saklanacak. ${cloudClient?'Güncel içerik öğrencilere açılır.':'İçeriği onaylar; yayımlamaz.'} Mevcut öğrenci sonuçları eski sürümleriyle korunur.`, 'İçeriği onayla',async()=>{await store.approveAssignment(edit.id);edit.draft=null;render();toast(cloudClient?'İçerik onaylandı; öğrenciler güncel sürüme erişebilir.':'İçerik onaylandı; yayımlanmadı.');});}
function renderResults(view){const all=store.resultRows(termId());const h=heading('PANEL / SONUÇLAR','Sonuçlar','Kod ve test ön puanlarını, denemeleri ve öğretmen onayını inceleyin.');h.append(button('Excel raporu indir (.xlsx)','outline',()=>act(exportResults)));view.append(h);view.append(node('p','help','Excel raporu seçili dönemin tüm öğrencilerini ve tüm ödevlerini içerir. İlk sayfa genel not tablosu, diğer sayfalar soru puanlarıdır. Ekrandaki filtreler raporu daraltmaz.'));const bar=node('div','toolbar');const search=input('search',resultSearch,'Numara veya ad ara');search.setAttribute('aria-label','Sonuçlarda ara');search.oninput=()=>{resultSearch=search.value;renderResultsTable();};const filter=select([['all','Tüm ödevler'],...assignments().map(a=>[a.id,a.id])],resultHW);filter.setAttribute('aria-label','Ödev filtresi');filter.onchange=()=>{resultHW=filter.value;renderResultsTable();};append(bar,search,filter);view.append(bar);const mount=node('div');mount.id='results-table';view.append(mount);renderResultsTable();}
function filteredResults(){const q=resultSearch.trim().toLocaleLowerCase('tr-TR');return store.resultRows(termId()).filter(r=>(resultHW==='all'||r.assignment?.id===resultHW)&&(!q||text(r.student?.number).toLocaleLowerCase('tr-TR').includes(q)||text(r.student?.name).toLocaleLowerCase('tr-TR').includes(q)));}
function resultStatus(r){if(r.status==='approved')return ['Not onaylı',''];if(r.status==='submitted')return ['Tamamlandı','blue'];if(r.status==='in_progress')return ['Devam ediyor','pending'];return ['Başlamadı','muted'];}
function renderResultsTable(){const mount=clear($('results-table'));const rows=filteredResults();if(!rows.length){mount.append(node('div','card empty','Bu filtreye uyan sonuç yok.'));return;}const wrap=node('div','table-wrap'),table=node('table','data-table'),head=node('tr');for(const label of ['Numara','Öğrenci','Ödev / Form','Kod / 70','Test / 30','Toplam / 100','Durum','İşlem'])head.append(node('th','',label));const theadEl=node('thead');theadEl.append(head);table.append(theadEl);const body=node('tbody');for(const r of rows){const tr=node('tr'),s=r.summary||{};const n=node('td');n.append(node('strong','',r.student?.number||'—'));tr.append(n,node('td','',r.student?.name||'—'),node('td','',`${r.assignment?.id||'—'} / ${r.submission?.formId?.split('_').at(-1)||r.assignedVariant||'—'}`),node('td','',s.codeScore??0),node('td','',s.choiceScore??0),node('td','',s.finalScore??s.total??0));const st=node('td');const [label,tone]=resultStatus(r);st.append(status(label,tone));if(r.stale)st.append(node('div','help','Eski içerik sürümü'));if(r.submission?.source==='demo')st.append(node('div','help','Temsili sonuç'));tr.append(st);const action=node('td');action.append(button('İncele','outline small',()=>inspectResult(r)));tr.append(action);body.append(tr);}table.append(body);wrap.append(table);mount.append(wrap);}
async function exportResults(){
  if(cloudClient)await store.reload();
  const term=currentTerm();
  if(!term)throw new Error('Önce bir dönem seçin.');
  const report=buildResultsReport({term,assignments:assignments(),students:students(),rows:store.resultRows(term.id),generatedAt:new Date().toISOString()});
  await downloadResultsWorkbook(report,term.id);
  renderResultsTable();
  toast('Excel raporu indirildi: genel not tablosu ve her ödev için ayrıntılı puanlar.');
}
function inspectResult(r){const sub=r.submission,s=r.summary||{},student=r.student,assignment=r.assignment;dialog(`${student?.name||'Öğrenci'} · ${assignment?.id||'Ödev'}`,b=>{const history=store.state.submissions.filter(x=>x.studentId===student.id&&x.termId===termId()&&x.homeworkId===assignment.id).sort((a,b)=>b.revision-a.revision);if(history.length>1){const chooser=select(history.map(x=>[x.id,`Sürüm ${x.revision}${x.revision===assignment.approvedRevision?' · güncel':' · önceki teslim'}`]),sub?.id);chooser.onchange=()=>{const chosen=history.find(x=>x.id===chooser.value);closeDialog();inspectResult({...r,submission:chosen,summary:store.getSubmissionSummary(chosen),stale:chosen.revision!==assignment.approvedRevision});};b.append(field('Teslim sürümü',chooser));}const intro=node('div');append(intro,node('p','',`${student?.number||'—'} · ${sub?.formId||`${assignment.id}_${r.assignedVariant}`} · ${s.completed??0}/${s.totalTasks??10} yanıt alanı`),node('p','',`Kod ${s.codeScore??0}/70 · Test ${s.choiceScore??0}/30 · Ön puan ${s.total??0}/100${s.finalScore!=null?` · Son not ${s.finalScore}/100`:''}`));if(!sub){intro.append(node('p','help','Henüz teslim kaydı yok.'));b.append(intro);return;}if(sub.source==='demo')intro.append(node('div','notice warning','Temsili sonuç, gerçek öğrenci teslimi değildir.'));if(r.stale)intro.append(node('div','notice warning','Bu sonuç eski bir içerik sürümüne aittir. Güncel ödev taslağıyla yeniden puanlanmadı.'));b.append(intro);for(const [key,entry] of Object.entries(sub.entries||{})){const block=node('div','detail-block');block.append(node('h4','',key));const attempts=entry?.attempts||[];if(!attempts.length){block.append(node('p','help','Henüz gönderim yok.'));if(entry?.draft)block.append(node('pre','mono',entry.draft));}else{attempts.forEach((at,i)=>{const score=node('p','',`Deneme ${i+1} · ${at.score??0}/${at.maxPoints??0} puan · ${shortDate(at.submittedAt)}`);block.append(score);if(at.submittedCode)block.append(node('pre','mono',at.submittedCode));if(at.selectedOption)block.append(node('p','',`Seçilen seçenek: ${at.selectedOption}`));for(const check of at.checks||[])block.append(node('p',check.passed?'help':'validation',`${check.passed?'✓':'×'} ${check.label||''} · ${check.detail||''}`));});}b.append(block);}const review=node('div','subtle-line');b.append(review);if(sub.grade){b.append(node('p','',`Onaylı son not: ${sub.grade.score}/100 · ${shortDate(sub.grade.reviewedAt)}`));if(sub.grade.note)b.append(node('p','',`Öğretmen notu: ${sub.grade.note}`));}const grade=input('number',sub.grade?.score??s.total??0);grade.min='0';grade.max='100';grade.step='1';const note=textarea(sub.grade?.note||'');note.rows=3;b.append(field('Son not / 100',grade),field('Öğretmen notu (ön puan değişirse zorunlu)',note));const hint=node('p','help',s.completed===s.totalTasks?cloudClient?'Notu onayladığınızda sonuç buluta kaydedilir.':'Notu onayladığınızda sonuç yerel kayda yazılır.':'Not onayı için 10 yanıt alanının tamamı gönderilmiş olmalı.');b.append(hint);const approve=button(sub.grade?'Notu güncelle':'Notu onayla','',()=>{if(!Number.isFinite(Number(grade.value))||grade.value===''||Number(grade.value)<0||Number(grade.value)>100){hint.textContent='Son not 0 ile 100 arasında olmalı.';return;}if(Number(grade.value)!==Number(s.total??0)&&!note.value.trim()){hint.textContent='Ön puandan farklı bir not için açıklama yazın.';return;}closeDialog();confirmDialog('Son notu onayla',`${student?.name||'Öğrenci'} için ${grade.value}/100 son not kaydedilecek.`, 'Notu kaydet',async()=>{await store.reviewGrade(sub.id,{score:Number(grade.value),note:note.value.trim()});render();toast('Son not kaydedildi.');});});approve.disabled=s.completed!==s.totalTasks;$('dialog-actions').append(approve);});}
window.addEventListener('storage',e=>{if(cloudClient||!store||e.key!==TEACHER_STORAGE_KEY)return;try{store.reload();if(edit.dirty){toast('Başka sekmede yeni kayıt var; kaydedilmemiş taslağınız korunuyor.');}else edit.draft=null;render();}catch(error){fail(error);}});
async function refreshCloud(){
  if(!cloudClient||!store?.state)return;
  await store.reload();
  await ensureVariantMaps();
  if(!edit.dirty)edit.draft=null;
  render();toast('Bulut kayıtları güncellendi.');
}
async function init(){
  try {
    cloudClient=await getCloudClient();
    if(cloudClient){
      const session=await requireCloudSession('teacher');
      if(!session)return;
      cloudClient=session.client;
      $('mode-bar').replaceChildren(node('strong','','Bulut öğretmen paneli'),node('span','',session.profile?.name||session.profile?.email||'Öğretmen oturumu'));
      document.querySelector('.side-foot').textContent='Öğrenci hesapları ve sonuçlar bulutta saklanır. Öğretmen işlemleri oturumunuzla doğrulanır.';
      $('sign-out').hidden=false;$('refresh-cloud').hidden=false;$('change-password').hidden=false;
      $('sign-out').onclick=()=>act(async()=>{await cloudClient.signOut();location.assign('../login.html?role=teacher');});
      $('refresh-cloud').onclick=()=>act(refreshCloud);
      store=new CloudTeacherStore(cloudClient);await store.reload();restorePreviewNavigation();await ensureVariantMaps();render();$('mode-bar').style.removeProperty('display');return;
    }
    const response=await fetch('./seed.json');if(!response.ok)throw new Error('Örnek veri dosyası yüklenemedi.');
    const seed=await response.json();store=new TeacherStore({storage:localStorage,seed});
    const update=store.applySourceDraftUpdates(seed);await ensureVariantMaps();render();$('mode-bar').style.removeProperty('display');
    if(update.updated.length)toast('2. ödev: Q1–Q3 doğrudan kod hücresi olarak güncellendi. Taslak onayınızı bekliyor.');
    if(update.conflicts.length){const notice=node('div','notice warning','Kaynak soru güncellemesi uygulanamadı: '+update.conflicts.join(', ')+'. Bu sorulardaki panel düzenlemeleriniz korunmuştur; içerikler ayrıca birleştirilmelidir.');$('panel').before(notice);}
  } catch(error){
    $('panel').hidden=true;$('load-state').hidden=false;$('load-state').className='error-box';
    $('load-state').textContent=`Panel açılamadı: ${error?.message||error}. ${cloudClient?'Bulut bağlantınızı ve öğretmen oturumunuzu kontrol edin.':'Yerel sunucuyu ve seed.json dosyasını kontrol edin.'}`;
  }
}
init();
