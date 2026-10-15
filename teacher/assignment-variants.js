const LETTERS=['A','B','C'];
const own=(object,key)=>Object.prototype.hasOwnProperty.call(object,key);
function require(ok,message='Ödevin numara–form eşlemesi geçersiz.') { if(!ok)throw new Error(message); }

export function validateAssignmentVariantMap(map) {
  require(map && typeof map==='object' && !Array.isArray(map));
  require(Array.isArray(map.digits) && map.digits.length===10 && map.digits.every(x=>LETTERS.includes(x)));
  const counts=LETTERS.map(letter=>map.digits.filter(x=>x===letter).length).sort();
  require(counts.join(',')==='3,3,4');
  require(typeof map.createdAt==='string' && Number.isFinite(Date.parse(map.createdAt)) && new Date(map.createdAt).toISOString()===map.createdAt);
  return map;
}

// Canonical digit groups ignore the group labels: swapping A and B is not a
// different partition of the students.
export function normalizedVariantPartition(map) {
  validateAssignmentVariantMap(map);
  return LETTERS.map(letter=>map.digits.flatMap((value,digit)=>value===letter?[digit]:[]).join('')).sort().join('|');
}

export function assignmentVariantGroups(map) {
  validateAssignmentVariantMap(map);
  return Object.fromEntries(LETTERS.map(letter=>[letter,map.digits.flatMap((value,digit)=>value===letter?[digit]:[])]));
}

function savedMaps(term) {
  if(!own(term,'assignmentVariants'))return null;
  const maps=term.assignmentVariants;
  require(maps && typeof maps==='object' && !Array.isArray(maps));
  return maps;
}

export function getAssignmentVariantMap(state,termId,homeworkId) {
  const term=state.terms.find(t=>t.id===termId);require(term,'Dönem bulunamadı.');
  const maps=savedMaps(term);
  if(!maps || !own(maps,homeworkId))return null;
  const map=validateAssignmentVariantMap(maps[homeworkId]);
  return {digits:[...map.digits],createdAt:map.createdAt};
}

function randomBelow(limit) {
  require(globalThis.crypto?.getRandomValues,'Güvenli rastgele sayı kaynağı kullanılamıyor.');
  const buffer=new Uint32Array(1),ceiling=Math.floor(4294967296/limit)*limit;
  do { crypto.getRandomValues(buffer); } while(buffer[0]>=ceiling);
  return buffer[0]%limit;
}

function makeMap(createdAt) {
  const digits=['A','A','A','B','B','B','C','C','C',LETTERS[randomBelow(3)]];
  for(let index=digits.length-1;index>0;index--){const other=randomBelow(index+1);[digits[index],digits[other]]=[digits[other],digits[index]];}
  return validateAssignmentVariantMap({digits,createdAt});
}

// Mutates only after every existing map is validated and all missing maps are
// ready. Existing partitions never reroll, including on repeated initialization.
export function initializeAssignmentVariantMaps(state,termId,{createdAt=new Date().toISOString()}={}) {
  const term=state.terms.find(t=>t.id===termId);require(term,'Dönem bulunamadı.');require(!term.archived,'Arşivlenmiş dönemin form eşlemeleri değiştirilemez.');
  const existing=savedMaps(term)||{},used=new Set();
  for(const map of Object.values(existing)){const partition=normalizedVariantPartition(map);require(!used.has(partition),'Kaydedilmiş ödev form eşlemeleri aynı öğrenci bölüşümünü kullanıyor.');used.add(partition);}
  const added={};
  for(const assignment of state.assignments){
    if(own(existing,assignment.id))continue;
    let map,partition;
    for(let tries=0;tries<10000;tries++){
      map=makeMap(createdAt);partition=normalizedVariantPartition(map);
      if(!used.has(partition))break;
      map=null;
    }
    require(map,'Ödevler için farklı form eşlemeleri oluşturulamadı.');
    used.add(partition);added[assignment.id]=map;
  }
  if(Object.keys(added).length || !own(term,'assignmentVariants'))term.assignmentVariants={...existing,...added};
  return term.assignmentVariants;
}

export function assignmentVariant(state,student,homeworkId) {
  require(student && typeof student==='object','Öğrenci bulunamadı.');
  const map=getAssignmentVariantMap(state,student.termId,homeworkId);
  const submissions=(state.submissions||[]).map((submission,index)=>({submission,index})).filter(({submission:s})=>s.termId===student.termId && s.studentId===student.id && s.homeworkId===homeworkId);
  submissions.sort((a,b)=>(a.submission.revision??0)-(b.submission.revision??0) || a.index-b.index);
  if(submissions.length){
    const formId=submissions[0].submission.formId,prefix=homeworkId+'_';
    require(typeof formId==='string' && formId.startsWith(prefix) && formId.length===prefix.length+1 && LETTERS.includes(formId.at(-1)),'Öğrencinin önceki teslim formu geçersiz.');
    return formId.at(-1);
  }
  if(map){
    const number=String(student.number??'');require(/^\d+$/.test(number),'Öğrenci numarası geçersiz.');
    return map.digits[Number(number.at(-1))];
  }
  return LETTERS.includes(student.variant)?student.variant:'A';
}
