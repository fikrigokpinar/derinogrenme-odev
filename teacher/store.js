import {feedbackSettings,validateFeedbackSettings,FEEDBACK_STATUSES} from './feedback-model.js';
import {assignmentAttemptLimits,normalizeAttemptLimits,studentQuestionAttemptLimit} from './assignment-attempts.js';
import {assignmentVariant,getAssignmentVariantMap,initializeAssignmentVariantMaps,validateAssignmentVariantMap} from './assignment-variants.js';
import {assignmentAvailability,normalizeAvailability,studentAssignmentAvailability} from './assignment-availability.js';
import {solutionReleaseStatus,gradeReleaseStatus} from './solution-release.js';
export const TEACHER_STORAGE_KEY='tensor-teacher-preview-v1';
const clone=x=>JSON.parse(JSON.stringify(x)), same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const check=(ok,msg)=>{if(!ok)throw new Error(msg);};
const variants=['A','B','C'],now=()=>new Date().toISOString();let serial=0;const uid=p=>`${p}-${Date.now()}-${++serial}`;
function rowValue(r,line=1){const number=String(r.number??'').trim(),name=String(r.name??'').trim().replace(/\s+/g,' ');check(/^\d{4,20}$/.test(number),`${line}. satır: Öğrenci numarası 4–20 rakam olmalıdır.`);check(name.length&&name.length<=160&&!/[\x00-\x1f]/.test(name),`${line}. satır: Ad soyad gerekli ve en fazla 160 karakter olmalıdır.`);check(!r.variant||variants.includes(r.variant),`${line}. satır: Grup A, B veya C olmalıdır.`);return {number,name,...(r.variant?{variant:r.variant}:{})};}
export function parseRoster(text){
  text=String(text).replace(/^\uFEFF/,'');
  let quote=false,first='';
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(c==='"'){if(quote&&text[i+1]==='"'){i++;continue;}quote=!quote;}
    if(!quote&&/[\r\n]/.test(c))break;
    if(!quote)first+=c;
  }
  const delimiter=first.includes('\t')?'\t':first.includes(';')?';':',';
  let cells=[],records=[],field='',quoted=false,line=1,start=1,errors=[];
  const end=()=>{cells.push(field);if(cells.some(x=>x.trim()))records.push({cells,line:start});cells=[];field='';};
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(c==='"'){
      if(quoted&&text[i+1]==='"'){field+='"';i++;}
      else if(!quoted&&field!==''){errors.push({line:start,message:'Tırnak biçimi geçersiz.'});field+=c;}
      else quoted=!quoted;
    }else if(!quoted&&c===delimiter){cells.push(field);field='';}
    else if(!quoted&&(c==='\n'||c==='\r')){
      if(c==='\r'&&text[i+1]==='\n')i++;
      end();line++;start=line;
    }else{field+=c;if(c==='\n')line++;}
  }
  end();if(quoted)errors.push({line:start,message:'Kapanmamış tırnak.'});
  const normalize=s=>s.trim().toLocaleLowerCase('tr-TR').replace(/[_-]/g,' ').replace(/\s+/g,' ');
  const numberHeader=/^(öğrenci numarası|ogrenci numarasi|öğrenci no\.?|ogrenci no\.?|numara|number|student number|student id|no\.?)$/;
  const surnameHeader=/^(soyad|soyadı|soyadi|soyisim|soyismi|last name|surname)$/;
  const groupHeader=/^(grup|grubu|group|form|variant)$/;
  let header=null;
  if(records.length&&numberHeader.test(normalize(records[0].cells[0])))header=records.shift().cells.map(normalize);
  const invalidLines=new Set(errors.map(error=>error.line)),rows=[];
  for(const record of records){
    if(invalidLines.has(record.line))continue;
    try{
      const values=record.cells.map(value=>value.trim());
      // Excel may copy additional empty cells to the right of the selected data.
      while(values.length>2&&!values[values.length-1])values.pop();
      check(values.length>=2&&values.length<=4,'Numara ve ad soyad sütunlarını seçin; ad ile soyad ayrı sütunlarda da olabilir.');
      const explicitGroup=header&&groupHeader.test(header[2]||'');
      const explicitSurname=header&&surnameHeader.test(header[2]||'');
      const legacyGroup=!explicitSurname&&values.length===3&&variants.includes(values[2].toUpperCase());
      const separateNames=explicitSurname||(!explicitGroup&&!legacyGroup&&values.length>=3);
      let name=values[1],variant;
      if(separateNames){
        check(values[1]&&values[2],'Ad ve soyad sütunlarının ikisi de dolu olmalıdır.');
        name=values[1]+' '+values[2];
        variant=values[3]?.toUpperCase();
      }else{
        check(values.length<=3,'Ad soyad sütunundan sonra yalnızca isteğe bağlı grup sütunu olabilir.');
        variant=values[2]?.toUpperCase();
      }
      rows.push(rowValue({number:values[0],name,variant},record.line));
    }catch(error){errors.push({line:record.line,message:error.message});}
  }
  return {rows,errors};
}
export function toCSV(rows){return '\uFEFF'+rows.map(row=>row.map(v=>{let s=String(v??'');if(/^\s*[=+@-]/.test(s)||/^[\t\r\n]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}).join(';')).join('\r\n');}
function validateAssignment(d,previous){check(d&&typeof d.title==='string'&&d.title.trim(),'Ödev başlığı gereklidir.');check(Array.isArray(d.variants)&&d.variants.length===3&&same(d.variants.map(v=>v.id).sort(),variants),'A, B ve C formları gereklidir.');const stable=x=>x.variants.map(v=>[v.id,v.questions.map(q=>[q.id,q.type,(q.items||[]).map(i=>i.id)])]);if(previous)check(d.homework_id===previous.homework_id&&same(stable(d),stable(previous)),'Ödev, soru ve madde kimlikleri değiştirilemez.');for(const v of d.variants){check(v.questions?.length===6,'Her form altı soru içermelidir.');let code=0,choice=0;const ids=new Set();for(const q of v.questions){check(!ids.has(q.id),'Soru kimlikleri benzersiz olmalıdır.');ids.add(q.id);check(q.title?.trim()&&(Array.isArray(q.prompt)?q.prompt.length&&q.prompt.every(p=>typeof p==='string'&&p.trim()):typeof q.prompt==='string'&&q.prompt.trim()),'Soru başlığı ve metni gereklidir.');check(Number.isFinite(q.points)&&q.points>0,'Soru puanı geçersiz.');check(Array.isArray(q.rubric)&&q.rubric.every(r=>Number.isFinite(r.points)&&r.points>=0)&&q.rubric.reduce((a,r)=>a+r.points,0)===q.points,'Rubrik puanları soru puanına eşit olmalıdır.');if(q.type==='code'){code+=q.points;for(const k of ['starter_code','solution_code','checks_code'])check(typeof q[k]==='string'&&q[k].trim(),'Başlangıç, çözüm ve kontrol kodu gereklidir.');}else{check(q.type==='choice_group'&&q.items?.length===3&&q.points===15,'İki grup üçer çoktan seçmeli madde içermelidir.');choice+=q.points;check(q.items.reduce((a,i)=>a+i.points,0)===q.points,'Madde puanları geçersiz.');for(const i of q.items){check(!ids.has(i.id)&&typeof i.prompt==='string'&&i.prompt.trim(),'Madde kimliği veya metni geçersiz.');ids.add(i.id);check(i.points===5,'Madde puanı 5 olmalıdır.');check(typeof i.explanation==='string'&&i.explanation.trim(),'Doğru cevap açıklaması gereklidir.');check(i.options?.length===4&&i.options.every(o=>typeof o.text==='string'&&o.text.trim())&&same(i.options.map(o=>o.id).sort(),['A','B','C','D'])&&new Set(i.options.map(o=>o.text.trim())).size===4&&i.options.filter(o=>o.id===i.correct_option).length===1,'Dört farklı seçenek ve tek doğru cevap gereklidir.');}}}check(v.questions.filter(q=>q.type==='code').length===4&&code===70&&choice===30,'Dört kod sorusu 70, altı seçim maddesi 30 puan olmalıdır.');}}
export class TeacherStore{
constructor({storage,seed}){this.storage=storage;try{const raw=storage.getItem(TEACHER_STORAGE_KEY),stored=raw?JSON.parse(raw):null;this.state=clone(stored?.schemaVersion===1?stored:seed);}catch(e){throw new Error('Yerel kayıt okunamadı. Tarayıcı depolama izinlerini kontrol edin.');}check(this.state?.schemaVersion===1,'Kayıt şeması geçersiz.');}
reload(){try{const raw=this.storage.getItem(TEACHER_STORAGE_KEY);if(raw){const value=JSON.parse(raw);check(value?.schemaVersion===1,'Kayıt şeması geçersiz.');this.state=clone(value);}return this.state;}catch(e){throw new Error('Yerel kayıt okunamadı. Tarayıcı depolama izinlerini kontrol edin.');}}
_mutate(fn){this.reload();const before=clone(this.state);let result;try{result=fn();for(const term of this.state.terms)for(const [kind,status]of [['solutionReleases',solutionReleaseStatus],['gradeReleases',gradeReleaseStatus]])for(const homeworkId of Object.keys(term[kind]||{}))if(!status(this.state,term.id,homeworkId).published)delete term[kind][homeworkId];}catch(e){this.state=before;throw e;}try{this.storage.setItem(TEACHER_STORAGE_KEY,JSON.stringify(this.state));}catch(e){this.state=before;throw new Error('Yerel kayıt kaydedilemedi. Depolama alanını ve izinlerini kontrol edin; değişiklik geri alındı.');}return result;}
_term(id){const x=this.state.terms.find(x=>x.id===id);check(x,'Dönem bulunamadı.');return x;}_student(id){const x=this.state.students.find(x=>x.id===id);check(x,'Öğrenci bulunamadı.');return x;}_assignment(id){const x=this.state.assignments.find(x=>x.id===id);check(x,'Ödev bulunamadı.');return x;}_audit(action,target){this.state.audit.push({action,target,at:now()});}
selectTerm(id){return this._mutate(()=>{this._term(id);this.state.selectedTermId=id;});}
saveFeedbackSettings(settings,expectedRevision){return this._mutate(()=>{
  const previous=feedbackSettings(this.state.feedbackSettings);
  check(Number.isInteger(expectedRevision)&&expectedRevision>=0,'Geri bildirim ayar sürümü geçersiz.');
  check(expectedRevision===previous.revision,'Geri bildirim ayarları başka bir sekmede değişmiş. Güncel kaydı yükleyip tekrar düzenleyin.');
  const value=validateFeedbackSettings(settings);
  this.state.feedbackSettings={...value,revision:previous.revision+1,updatedAt:now()};
  this._audit('saveFeedbackSettings',String(this.state.feedbackSettings.revision));
  return clone(this.state.feedbackSettings);
});}
saveFeedbackReply(feedbackId,message,expectedRevision=0){return this._mutate(()=>{
  check(typeof feedbackId==='string','Geri bildirim kimliği geçersiz.');
  check(Number.isInteger(expectedRevision)&&expectedRevision>=0,'Cevap sürümü geçersiz.');
  const item=this.state.feedback?.find(item=>item.id===feedbackId);check(item,'Geri bildirim bulunamadı.');
  const previous=item.teacherReply;
  if(expectedRevision!==(previous?.revision||0)){
    const error=new Error('Bu cevap başka bir sekmede değişmiş. Yazdığınız metni saklayın; güncel cevabı yükleyip tekrar düzenleyin.');
    error.code='FEEDBACK_REPLY_CONFLICT';throw error;
  }
  check(typeof message==='string','Cevap metni geçersiz.');
  const text=message.trim();
  check(text.length>=1&&text.length<=3000&&!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text),'Cevap 1–3000 karakter olmalı ve geçersiz kontrol karakterleri içermemelidir.');
  const updatedAt=now();
  item.teacherReply={message:text,createdAt:previous?.createdAt||updatedAt,updatedAt,revision:expectedRevision+1};
  item.updatedAt=updatedAt;this._audit('saveFeedbackReply',feedbackId);return clone(item);
});}
setFeedbackStatus(feedbackId,status){return this._mutate(()=>{
  check(typeof feedbackId==='string'&&Object.hasOwn(FEEDBACK_STATUSES,status),'Geri bildirim durumu geçersiz.');
  const item=this.state.feedback?.find(item=>item.id===feedbackId);check(item,'Geri bildirim bulunamadı.');
  item.status=status;item.updatedAt=now();this._audit('setFeedbackStatus',feedbackId);return clone(item);
});}
saveStudentGuide(guide,expectedRevision){return this._mutate(()=>{
  const previous=this.state.studentGuide;
  check(Number.isInteger(expectedRevision)&&expectedRevision>=0,'Kılavuz sürümü geçersiz.');
  check(expectedRevision===(previous?.revision||0),'Kılavuz başka bir sekmede değişmiş. Metninizi kopyalayarak saklayın; güncel kaydı yükleyip tekrar düzenleyin.');
  const bounded=(value,max,label)=>{check(typeof value==='string'&&value.trim()&&value.length<=max&&!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value),`${label} gerekli ve en fazla ${max} karakter olmalıdır.`);return value.trim();};
  check(guide&&typeof guide==='object'&&!Array.isArray(guide),'Kılavuz metni geçersiz.');
  const title=bounded(guide.title,120,'Kılavuz başlığı'),subtitle=bounded(guide.subtitle,300,'Kısa açıklama');
  check(Array.isArray(guide.highlights)&&guide.highlights.length===3,'Üç kısa bilgi kutusu gereklidir.');
  const highlights=guide.highlights.map((item,i)=>({title:bounded(item?.title,60,`${i+1}. bilgi başlığı`),text:bounded(item?.text,180,`${i+1}. bilgi açıklaması`)}));
  check(Array.isArray(guide.sections)&&guide.sections.length>=1&&guide.sections.length<=20,'Kılavuz 1 ile 20 arasında bölüm içermelidir.');
  const ids=new Set();
  const sections=guide.sections.map((section,i)=>{
    check(typeof section?.id==='string'&&/^[a-z0-9_-]{1,80}$/.test(section.id)&&!ids.has(section.id),'Bölüm kimliği geçersiz veya tekrarlanmış.');ids.add(section.id);
    check(['normal','deadline'].includes(section.tone),'Bölüm görünümü geçersiz.');
    return {id:section.id,title:bounded(section.title,160,`${i+1}. bölüm başlığı`),body:bounded(section.body,10000,`${i+1}. bölüm açıklaması`),tone:section.tone};
  });
  check(JSON.stringify({title,subtitle,highlights,sections}).length<=100000,'Kılavuz toplamda çok uzun.');
  this.state.studentGuide={title,subtitle,highlights,sections,revision:expectedRevision+1,updatedAt:now()};
  this._audit('saveStudentGuide',String(this.state.studentGuide.revision));
  return clone(this.state.studentGuide);
});}
addTerm(name){return this._mutate(()=>{check(typeof name==='string'&&name.trim(),'Dönem adı gereklidir.');const t={id:uid('term'),name:name.trim(),archived:false,isDemo:false,assignmentAvailability:Object.fromEntries(this.state.assignments.map(a=>[a.id,{active:false,deadline:null}]))};this.state.terms.push(t);initializeAssignmentVariantMaps(this.state,t.id);this.state.selectedTermId=t.id;return t;});}
initializeAssignmentVariants(termId){return this._mutate(()=>{const maps=initializeAssignmentVariantMaps(this.state,termId);this._audit('initializeAssignmentVariants',termId);return maps;});}
getAssignmentVariant(studentId,homeworkId){this._assignment(homeworkId);return assignmentVariant(this.state,this._student(studentId),homeworkId);}
getAssignmentVariantMap(termId,homeworkId){this._assignment(homeworkId);return getAssignmentVariantMap(this.state,termId,homeworkId);}
getAssignmentAvailability(termId,homeworkId,nowMs=Date.now()){this._term(termId);this._assignment(homeworkId);return assignmentAvailability(this.state,termId,homeworkId,{now:nowMs});}
getSolutionReleaseStatus(termId,homeworkId,nowMs=Date.now()){this._term(termId);this._assignment(homeworkId);return solutionReleaseStatus(this.state,termId,homeworkId,{now:nowMs});}
getGradeReleaseStatus(termId,homeworkId,nowMs=Date.now()){this._term(termId);this._assignment(homeworkId);return gradeReleaseStatus(this.state,termId,homeworkId,{now:nowMs});}
setSolutionRelease(termId,homeworkId,published){return this._setRelease(termId,homeworkId,published,'solutionReleases',solutionReleaseStatus,'setSolutionRelease');}
setGradeRelease(termId,homeworkId,published){return this._setRelease(termId,homeworkId,published,'gradeReleases',gradeReleaseStatus,'setGradeRelease');}
_setRelease(termId,homeworkId,published,kind,status,action){return this._mutate(()=>{const term=this._term(termId),assignment=this._assignment(homeworkId);check(typeof published==='boolean','Yayın ayarı geçersiz.');if(published){check(status(this.state,termId,homeworkId).canPublish,'Yayın için onaylı ödev, arşivlenmemiş dönem ve tüm genel/kişisel teslim sürelerinin kapanması gereklidir.');term[kind]??={};term[kind][homeworkId]={revision:assignment.approvedRevision,publishedAt:now()};}else if(term[kind])delete term[kind][homeworkId];this._audit(action,`${termId}/${homeworkId}/${published}`);return status(this.state,termId,homeworkId);});}
getAssignmentAttemptLimits(termId,homeworkId){this._term(termId);this._assignment(homeworkId);return assignmentAttemptLimits(this.state,termId,homeworkId);}
_studentAssignment(studentId,homeworkId){const student=this._student(studentId),term=this._term(student.termId),assignment=this._assignment(homeworkId);check(student.active&&!term.archived,'Etkin öğrenci ve arşivlenmemiş dönem gereklidir.');check(assignment.approved&&assignment.approvedRevision,'Onaylı ödev gereklidir.');const formId=`${homeworkId}_${assignmentVariant(this.state,student,homeworkId)}`;return {student,term,assignment,formId,tasks:this._tasks({homeworkId,revision:assignment.approvedRevision,formId})};}
getStudentAssignmentAvailability(studentId,homeworkId,nowMs=Date.now()){const student=this._student(studentId);this._assignment(homeworkId);return studentAssignmentAvailability(this.state,student,homeworkId,{now:nowMs});}
getStudentQuestionAttemptLimit(studentId,homeworkId,taskId){const {student,tasks}=this._studentAssignment(studentId,homeworkId),task=tasks.find(t=>t.id===taskId);check(task,'Atanan formda soru bulunamadı.');return studentQuestionAttemptLimit(this.state,student,homeworkId,task);}
grantStudentQuestionAttempts(studentId,homeworkId,taskId,count){return this._mutate(()=>{const {student,assignment,tasks}=this._studentAssignment(studentId,homeworkId),task=tasks.find(t=>t.id===taskId);check(task,'Atanan formda soru bulunamadı.');check(Number.isInteger(count)&&count>=1&&count<=100,'Ek gönderim hakkı 1–100 arasında tam sayı olmalıdır.');const used=this.state.submissions.find(s=>s.studentId===studentId&&s.termId===student.termId&&s.homeworkId===homeworkId&&s.revision===assignment.approvedRevision)?.entries?.[taskId]?.attempts?.length||0;const base=assignmentAttemptLimits(this.state,student.termId,homeworkId)[task.type==='code'?'code':'choice'],effective=Math.max(used,studentQuestionAttemptLimit(this.state,student,homeworkId,task))+count;check(effective<=1000,'Toplam soru gönderim hakkı 1000 değerini aşamaz.');student.assignmentOverrides??={};const override=student.assignmentOverrides[homeworkId]??={};override.questionExtraAttempts??={};override.questionExtraAttempts[taskId]=effective-base;this._audit('grantStudentQuestionAttempts',`${studentId}/${homeworkId}/${taskId}`);return {studentId,homeworkId,taskId,limit:effective,remaining:effective-used};});}
setStudentAssignmentDeadlines(studentIds,homeworkId,settings){return this._mutate(()=>{check(Array.isArray(studentIds)&&studentIds.length>=1&&studentIds.length<=500&&new Set(studentIds).size===studentIds.length,'En az bir, en fazla 500 farklı öğrenci seçilmelidir.');const selected=studentIds.map(id=>this._studentAssignment(id,homeworkId).student);check(selected.every(s=>s.termId===selected[0].termId),'Seçilen öğrenciler aynı dönemde olmalıdır.');if(settings!==null){check(settings&&typeof settings==='object'&&!Array.isArray(settings)&&Object.keys(settings).length===2&&Object.keys(settings).every(k=>['deadline','allowClosed'].includes(k))&&typeof settings.allowClosed==='boolean'&&typeof settings.deadline==='string','Öğrenciye özel tarih ve kapalı ödev izni gereklidir.');normalizeAvailability({active:true,deadline:settings.deadline});}for(const student of selected){student.assignmentOverrides??={};const override=student.assignmentOverrides[homeworkId]??={};if(settings===null){delete override.deadline;delete override.allowClosed;}else{override.deadline=settings.deadline;override.allowClosed=settings.allowClosed;}if(!Object.keys(override).length)delete student.assignmentOverrides[homeworkId];}const term=this._term(selected[0].termId);if(term.solutionReleases)delete term.solutionReleases[homeworkId];if(term.gradeReleases)delete term.gradeReleases[homeworkId];this._audit('setStudentAssignmentDeadlines',`${selected[0].termId}/${homeworkId}`);return {updated:selected.length};});}
setAssignmentAttemptLimits(termId,homeworkId,limits){return this._mutate(()=>{const term=this._term(termId);this._assignment(homeworkId);check(!term.archived,'Arşivlenmiş dönemin gönderim hakları değiştirilemez.');const value=normalizeAttemptLimits(limits);term.assignmentAttemptLimits??={};term.assignmentAttemptLimits[homeworkId]=value;this._audit('setAssignmentAttemptLimits',`${termId}/${homeworkId}`);return value;});}
setAssignmentAvailability(termId,homeworkId,settings){return this._mutate(()=>{const t=this._term(termId);this._assignment(homeworkId);check(!t.archived,'Arşivlenmiş dönemin teslim ayarları değiştirilemez.');const value=normalizeAvailability(settings);t.assignmentAvailability??={};t.assignmentAvailability[homeworkId]=value;this._audit('setAssignmentAvailability',`${termId}/${homeworkId}`);return value;});}
archiveTerm(id,value=true){return this._mutate(()=>{this._term(id).archived=!!value;this._audit('archiveTerm',id);});}
_addStudent(termId,row){const value=rowValue(row),term=this._term(termId);if(term.assignmentVariants!==undefined){check(term.assignmentVariants&&typeof term.assignmentVariants==='object'&&!Array.isArray(term.assignmentVariants),'Ödevin numara–form eşlemesi geçersiz.');Object.values(term.assignmentVariants).forEach(validateAssignmentVariantMap);if(Object.keys(term.assignmentVariants).length)value.variant='A';}check(!this.state.students.some(s=>s.termId===termId&&s.number===value.number),'Bu numara dönemde zaten kayıtlı.');const counts=Object.fromEntries(variants.map(v=>[v,this.state.students.filter(s=>s.termId===termId&&s.active&&s.variant===v).length]));const s={id:uid('student'),termId,...value,variant:value.variant||variants.reduce((a,b)=>counts[b]<counts[a]?b:a),active:true,isDemo:false};this.state.students.push(s);return s;}
addStudent(termId,row){return this._mutate(()=>{this._term(termId);return this._addStudent(termId,row);});}
updateStudent(id,patch){return this._mutate(()=>{const s=this._student(id),r=rowValue({...s,...patch}),term=this._term(s.termId);if(term.assignmentVariants!==undefined){check(term.assignmentVariants&&typeof term.assignmentVariants==='object'&&!Array.isArray(term.assignmentVariants),'Ödevin numara–form eşlemesi geçersiz.');Object.values(term.assignmentVariants).forEach(validateAssignmentVariantMap);check(!Object.keys(term.assignmentVariants).length||r.variant===s.variant,'Numaraya göre atanan formlar elle değiştirilemez.');}check(!this.state.students.some(o=>o.id!==id&&o.termId===s.termId&&o.number===r.number),'Bu numara dönemde zaten kayıtlı.');check(r.variant===s.variant||!this.state.submissions.some(x=>x.studentId===id),'Sonucu olan öğrencinin grubu değiştirilemez.');Object.assign(s,r);return s;});}
setStudentActive(id,active){return this._mutate(()=>{this._student(id).active=!!active;this._audit('studentActive',id);});}
clearRoster(termId){return this._mutate(()=>{this._term(termId);this.state.students.filter(s=>s.termId===termId).forEach(s=>s.active=false);this._audit('clearRoster',termId);});}
previewRoster(termId,rows){this._term(termId);const seen=new Set(this.state.students.filter(s=>s.termId===termId).map(s=>s.number)),accepted=[],duplicates=[],errors=[];rows.forEach((r,i)=>{try{const v=rowValue(r,i+1);if(seen.has(v.number))duplicates.push({number:v.number,name:v.name});else{seen.add(v.number);accepted.push(v);}}catch(e){errors.push({line:i+1,message:e.message});}});return {accepted,duplicates,errors};}
importRoster(termId,rows){return this._mutate(()=>{const p=this.previewRoster(termId,rows);check(!p.errors.length,p.errors.map(e=>e.message).join('\n'));p.accepted.forEach(r=>this._addStudent(termId,r));return {added:p.accepted.length,skipped:p.duplicates.length};});}
saveAssignment(id,draft,settings){return this._mutate(()=>{const a=this._assignment(id);validateAssignment(draft,a.draft);const next=settings===undefined?a.settings:settings;check(typeof next?.clipboardBlocked==='boolean','Panoya ilişkin ayar geçersiz.');if(!same(draft,a.draft)||!same(next,a.settings)){a.draft=clone(draft);a.settings=clone(next);a.revision++;this._audit('saveAssignment',id);}return a;});}
applySourceDraftUpdates(seed){
    this.reload();
    const updates=(seed.sourceDraftUpdates||[]).filter(u=>!this.state.appliedSourceDraftUpdates?.includes(u.id));
    if(!updates.length)return {updated:[],conflicts:[]};
    return this._mutate(()=>{
        const updated=[],conflicts=[];
        for(const update of updates){
            const source=seed.assignments.find(a=>a.id===update.homeworkId),a=this._assignment(update.homeworkId);
            const baseline=source.versions.find(v=>v.revision===update.baseRevision)?.content||source.approved;
            const draft=clone(a.draft);let conflict=false;
            for(const variant of draft.variants){
                const base=baseline.variants.find(v=>v.id===variant.id),next=source.draft.variants.find(v=>v.id===variant.id);
                for(const id of update.questionIds){
                    const index=variant.questions.findIndex(q=>q.id===id),oldQuestion=base.questions.find(q=>q.id===id),newQuestion=next.questions.find(q=>q.id===id);
                    if(same(variant.questions[index],oldQuestion)||same(variant.questions[index],newQuestion))variant.questions[index]=clone(newQuestion);
                    else conflict=true;
                }
                if(same(variant.summary,base.summary))variant.summary=next.summary;
            }
            if(conflict){conflicts.push(a.id);continue;}
            if(same(draft.teacher_notes,baseline.teacher_notes))draft.teacher_notes=clone(source.draft.teacher_notes);
            validateAssignment(draft,a.draft);
            if(!same(draft,a.draft)){a.draft=draft;a.revision++;this._audit('sourceDraftUpdate',update.id);updated.push(a.id);}
            (this.state.appliedSourceDraftUpdates??=[]).push(update.id);
        }
        return {updated,conflicts};
    });
}
approveAssignment(id){return this._mutate(()=>{const a=this._assignment(id);validateAssignment(a.draft,a.approved);if(a.approvedRevision!==a.revision){a.approved=clone(a.draft);a.approvedSettings=clone(a.settings);a.approvedRevision=a.revision;a.approvedAt=now();a.versions.push({revision:a.revision,content:clone(a.draft),settings:clone(a.settings),approvedAt:a.approvedAt});this._audit('approveAssignment',id);}return a;});}
revertAssignment(id){return this._mutate(()=>{const a=this._assignment(id);if(!same(a.draft,a.approved)||!same(a.settings,a.approvedSettings)){a.draft=clone(a.approved);a.settings=clone(a.approvedSettings);a.revision++;this._audit('revertAssignment',id);}return a;});}
_tasks(sub){const a=this._assignment(sub.homeworkId),version=a.versions.find(v=>v.revision===sub.revision),content=version?.content||(sub.revision===a.approvedRevision?a.approved:null);check(content,'Ödev sürümü bulunamadı.');const variant=content.variants.find(v=>`${a.id}_${v.id}`===sub.formId);check(variant,'Form bulunamadı.');return variant.questions.flatMap(q=>q.type==='code'?[q]:q.items.map(i=>({...i,type:'choice'})));}
getSubmissionSummary(sub){let codeScore=0,choiceScore=0,completed=0;for(const t of this._tasks(sub)){const attempts=sub.entries?.[t.id]?.attempts||[];if(attempts.length){completed++;if(t.type==='code')codeScore+=Math.max(...attempts.map(a=>a.score));else choiceScore+=Math.max(...attempts.map(a=>a.score));}}return {codeScore,choiceScore,total:codeScore+choiceScore,completed,totalTasks:10,finalScore:sub.grade?.score??null};}
resultRows(termId){this._term(termId);return this.state.students.filter(s=>s.termId===termId).flatMap(student=>this.state.assignments.map(assignment=>{const submission=this.state.submissions.filter(s=>s.termId===termId&&s.studentId===student.id&&s.homeworkId===assignment.id).sort((a,b)=>b.revision-a.revision||String(b.updatedAt).localeCompare(String(a.updatedAt)))[0]||null,summary=submission?this.getSubmissionSummary(submission):{codeScore:0,choiceScore:0,total:0,completed:0,totalTasks:10,finalScore:null};return {student,assignment,submission,summary,assignedVariant:assignmentVariant(this.state,student,assignment.id),status:submission?.grade?'approved':summary.completed===10?'submitted':summary.completed||submission?'in_progress':'not_started',stale:!!submission&&submission.revision!==assignment.approvedRevision};}));}
upsertSubmission(input){return this._mutate(()=>{const s=this._student(input.studentId),a=this._assignment(input.homeworkId);this._term(input.termId);check(s.active&&s.termId===input.termId&&input.formId===`${a.id}_${assignmentVariant(this.state,s,a.id)}`,'Etkin öğrenci, dönem ve form eşleşmelidir.');check(input.revision===a.approvedRevision,'Güncel onaylı ödev sürümü gereklidir.');const existing=this.state.submissions.find(x=>x.termId===input.termId&&x.studentId===s.id&&x.homeworkId===a.id&&x.revision===input.revision);const byId=Object.fromEntries(this._tasks(input).map(t=>[t.id,t]));check(input.entries&&typeof input.entries==='object'&&!Array.isArray(input.entries),'Cevap kayıtları geçersiz.');for(const [id,e] of Object.entries(input.entries)){const t=byId[id];check(t&&e&&Array.isArray(e.attempts),'Geçersiz soru kaydı.');const prior=existing?.entries?.[id]?.attempts||[];check(e.attempts.length<=prior.length||e.attempts.length<=studentQuestionAttemptLimit(this.state,s,a.id,t),'Deneme sınırı aşıldı.');for(const attempt of e.attempts){check(Number.isFinite(attempt.score)&&attempt.score>=0&&attempt.score<=t.points&&attempt.maxPoints===t.points&&typeof attempt.submittedAt==='string'&&!Number.isNaN(Date.parse(attempt.submittedAt)),'Deneme puanı veya zamanı geçersiz.');if(t.type!=='code'){check(t.options.some(o=>o.id===attempt.selectedOption),'Seçenek geçersiz.');check(attempt.score===(attempt.selectedOption===t.correct_option?t.points:0),'Seçim puanı cevap anahtarıyla uyuşmuyor.');}}}let sub=this.state.submissions.find(x=>x.termId===input.termId&&x.studentId===s.id&&x.homeworkId===a.id&&x.revision===input.revision);if(sub){check(sub.formId===input.formId,'Teslimin formu değiştirilemez.');for(const [id,e] of Object.entries(sub.entries)){const next=input.entries[id]?.attempts||[];check(next.length>=e.attempts.length&&same(next.slice(0,e.attempts.length),e.attempts),'Gönderilen denemeler değiştirilemez veya silinemez.');}const attempts=entries=>Object.fromEntries(Object.entries(entries).filter(([,v])=>v.attempts.length).map(([k,v])=>[k,v.attempts]));if(!same(attempts(sub.entries),attempts(input.entries)))sub.grade=null;sub.entries=clone(input.entries);sub.updatedAt=now();}else{sub={id:uid('submission'),termId:input.termId,studentId:s.id,homeworkId:a.id,formId:input.formId,revision:input.revision,source:'preview',entries:clone(input.entries),updatedAt:now(),grade:null};this.state.submissions.push(sub);}return sub;});}
reviewGrade(id,{score,note=''}){return this._mutate(()=>{const sub=this.state.submissions.find(s=>s.id===id);check(sub,'Sonuç bulunamadı.');const summary=this.getSubmissionSummary(sub);check(summary.completed===10,'Not onayı için on görev tamamlanmalıdır.');check(Number.isFinite(score)&&score>=0&&score<=100,'Not 0–100 arasında olmalıdır.');check(typeof note==='string'&&(score===summary.total||note.trim()),'Otomatik puandan farklı not için açıklama gereklidir.');sub.grade={score,note:note.trim(),reviewedAt:now()};const term=this._term(sub.termId);if(term.gradeReleases)delete term.gradeReleases[sub.homeworkId];this._audit('reviewGrade',id);return sub;});}
}
