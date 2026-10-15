// Pure report data only. null cells represent missing submissions; a numeric
// zero represents an actual submitted score. No formulas or answer data escape.
const collator=new Intl.Collator('tr',{numeric:true,sensitivity:'base'});
const questionIds=['Q1','Q2','Q3','Q4','Q5','Q6'];
const itemIds=['Q5.1','Q5.2','Q5.3','Q6.1','Q6.2','Q6.3'];
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const string=value=>String(value??'');
const homeworkName=id=>/^HW[0-9]+$/.test(id)?'Ödev '+id.slice(2).replace(/^0+(?=[0-9])/,''):id;
const detailHeaders=['Öğrenci numarası','Ad soyad','Form',...questionIds,'Ön puan toplamı','Onaylı son not','Sonuç durumu','İçerik sürümü','Öğrenci durumu',...itemIds,'Öğretmen notu'];
function require(ok,message){if(!ok)throw new Error(message);}

function submissionContent(assignment,submission){
  const version=assignment.versions?.find(v=>v.revision===submission.revision);
  const content=version?.content||(submission.revision===assignment.approvedRevision?assignment.approved:null);
  require(content,'Teslimin içerik sürümü bulunamadı: '+assignment.id);
  const variant=content.variants?.find(v=>assignment.id+'_'+v.id===submission.formId);
  require(variant,'Teslimin formu bulunamadı: '+submission.formId);
  return variant;
}

function taskScore(task,entry){
  const attempts=Array.isArray(entry?.attempts)?entry.attempts:[];
  if(!attempts.length)return null;
  const scores=attempts.map(attempt=>{
    require(Number.isFinite(attempt.score) && attempt.score>=0 && attempt.score<=task.points && !attempt.infrastructure && !attempt.cancelled,'Teslim puanı geçersiz: '+task.id);
    return attempt.score;
  });
  return Math.max(...scores);
}

function scoresFor(assignment,submission){
  const questions=Object.fromEntries(questionIds.map(id=>[id,null])),items=Object.fromEntries(itemIds.map(id=>[id,null]));
  if(!submission)return {questions,items,preliminary:null,completed:0,totalTasks:10};
  const content=submissionContent(assignment,submission);
  const knownTasks=new Set();let completed=0,totalTasks=0;
  for(const question of content.questions||[]){
    let score=null;
    if(question.type==='code'){
      knownTasks.add(question.id);totalTasks++;
      score=taskScore(question,submission.entries?.[question.id]);if(score!==null)completed++;
    }else{
      const group=[];
      for(const item of question.items||[]){
        knownTasks.add(item.id);totalTasks++;
        const value=taskScore({...item,type:'choice'},submission.entries?.[item.id]);
        if(own(items,item.id))items[item.id]=value;
        if(value!==null){group.push(value);completed++;}
      }
      if(group.length)score=group.reduce((sum,value)=>sum+value,0);
    }
    if(own(questions,question.id))questions[question.id]=score;
  }
  for(const [id,entry] of Object.entries(submission.entries||{}))require(!entry?.attempts?.length||knownTasks.has(id),'Teslimde bilinmeyen soru bulundu: '+id);
  const values=Object.values(questions).filter(value=>value!==null);
  return {questions,items,preliminary:values.length?values.reduce((sum,value)=>sum+value,0):null,completed,totalTasks};
}

function reportResult(assignment,row){
  const submission=row?.submission||null,scores=scoresFor(assignment,submission);
  const final=submission?.grade?.score??null;
  require(final===null||(Number.isFinite(final)&&final>=0&&final<=100),'Onaylı son not geçersiz.');
  const stale=!!submission&&(row?.stale===true||submission.revision!==assignment.approvedRevision);
  let status=final!==null?'Not onaylı':scores.completed===0?(submission?'Taslak / gönderim yok':'Başlamadı'):scores.completed===scores.totalTasks?'Ön puan · tamamlandı':'Ön puan · devam ediyor';
  if(stale)status+=' · eski içerik sürümü';
  const prefix=assignment.id+'_';
  const variant=submission?.formId?.startsWith(prefix)?submission.formId.slice(prefix.length):row?.assignedVariant??row?.student?.variant??null;
  return {...scores,final,total:final??scores.preliminary,status,variant,revision:submission?.revision??null,note:submission?.grade?.note?string(submission.grade.note):null};
}

/** Build full-term XLSX-ready matrices from store.resultRows(term.id).
 * Columns A/B contain text identifiers/names; summary C+ holds final grades
 * (including zero) or submitted preliminary totals. Detail nulls stay blank.
 * Students are keyed by their id, never their names or numeric conversion.
 */
export function buildResultsReport({term=null,assignments=[],students=[],rows=[],generatedAt=new Date().toISOString()}={}){
  assignments=Array.isArray(assignments)?assignments:[];students=Array.isArray(students)?students:[];rows=Array.isArray(rows)?rows:[];
  const termId=term?.id;
  const orderedAssignments=[...assignments].sort((a,b)=>collator.compare(string(a.id),string(b.id)));
  const seenStudents=new Set();
  const orderedStudents=students.filter(student=>{
    if(!student||!student.id||seenStudents.has(student.id)||(termId&&student.termId!==termId))return false;
    seenStudents.add(student.id);return true;
  }).map(student=>({id:student.id,number:string(student.number),name:string(student.name),active:student.active!==false})).sort((a,b)=>collator.compare(a.number,b.number)||collator.compare(a.name,b.name)||collator.compare(a.id,b.id));
  const rowByPair=new Map();
  for(const row of rows){
    if(!row?.student?.id||!row?.assignment?.id||(termId&&row.student.termId!==termId)||(termId&&row.submission&&row.submission.termId!==termId))continue;
    const key=JSON.stringify([row.student.id,row.assignment.id]),previous=rowByPair.get(key);
    if(!previous || (row.submission?.revision??-1)>(previous.submission?.revision??-1) || ((row.submission?.revision??-1)===(previous.submission?.revision??-1) && string(row.submission?.updatedAt)>string(previous.submission?.updatedAt)))rowByPair.set(key,row);
  }
  const results=new Map();
  for(const student of orderedStudents)for(const assignment of orderedAssignments){
    const key=JSON.stringify([student.id,assignment.id]);results.set(key,reportResult(assignment,rowByPair.get(key)));
  }
  const summary={headers:['Öğrenci numarası','Ad soyad',...orderedAssignments.map(a=>homeworkName(string(a.id)))],rows:orderedStudents.map(student=>[student.number,student.name,...orderedAssignments.map(assignment=>results.get(JSON.stringify([student.id,assignment.id])).total)])};
  const details=orderedAssignments.map(assignment=>({
    id:string(assignment.id),name:homeworkName(string(assignment.id)),title:string(assignment.approved?.title||assignment.draft?.title||assignment.id),headers:[...detailHeaders],
    rows:orderedStudents.map(student=>{const result=results.get(JSON.stringify([student.id,assignment.id]));return [student.number,student.name,result.variant,...questionIds.map(id=>result.questions[id]),result.preliminary,result.final,result.status,result.revision,student.active?'Etkin':'Pasif',...itemIds.map(id=>result.items[id]),result.note];})
  }));
  return {termName:string(term?.name),generatedAt:string(generatedAt),students:orderedStudents,assignments:details.map(({id,name,title})=>({id,name,title})),summary,details};
}
