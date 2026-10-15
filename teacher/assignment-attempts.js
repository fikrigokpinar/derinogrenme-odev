// Attempt budgets belong to delivery settings, independently of content revisions.
export const DEFAULT_ATTEMPT_LIMITS = Object.freeze({code:2,choice:1});
export function normalizeAttemptLimits(limits) {
  if (!limits || typeof limits !== 'object' || Array.isArray(limits) ||
      Object.keys(limits).length !== 2 || Object.keys(limits).some(k=>!['code','choice'].includes(k)) ||
      !['code','choice'].every(k=>Number.isInteger(limits[k]) && limits[k]>=1 && limits[k]<=100)) {
    throw new Error('Kod ve test gönderim hakları 1–100 arasında tam sayı olmalıdır.');
  }
  return {code:limits.code,choice:limits.choice};
}
export function assignmentAttemptLimits(state,termId,homeworkId) {
  const limits=state.terms.find(t=>t.id===termId)?.assignmentAttemptLimits?.[homeworkId];
  return limits===undefined ? {...DEFAULT_ATTEMPT_LIMITS} : normalizeAttemptLimits(limits);
}

export function studentAssignmentTasks(state,student,homeworkId,variantId) {
  const assignment=state.assignments.find(a=>a.id===homeworkId);
  const variant=assignment?.approved?.variants?.find(v=>v.id===variantId);
  return variant?.questions.flatMap(q=>q.type==='code'?[q]:q.items.map(i=>({...i,type:'choice'})))||[];
}
export function studentQuestionAttemptLimit(state,student,homeworkId,task) {
  const base=assignmentAttemptLimits(state,student.termId,homeworkId)[task.type==='code'?'code':'choice'];
  const extra=student.assignmentOverrides?.[homeworkId]?.questionExtraAttempts?.[task.id]??0;
  if(!Number.isInteger(extra)||extra<0||extra>999)throw new Error('Öğrenciye özel gönderim hakkı geçersiz.');
  return Math.min(1000,base+extra);
}
export function studentQuestionAttemptLimits(state,student,homeworkId,tasks) {
  const overrides=student.assignmentOverrides?.[homeworkId]?.questionExtraAttempts||{};
  return Object.fromEntries(tasks.filter(t=>Object.hasOwn(overrides,t.id)).map(t=>[t.id,studentQuestionAttemptLimit(state,student,homeworkId,t)]));
}
