import {TeacherStore} from './store.js';

// The local domain model provides read helpers only. Every cloud write awaits
// the authenticated server command before replacing the displayed state.
export class CloudTeacherStore {
  constructor(client) { this.client=client; this.state=null; this.busy=false; this.pendingWrites=new Map(); }
  acceptState(state,{preserveTerm=true}={}) {
    if(state?.schemaVersion!==1 || !Array.isArray(state.terms) || !Array.isArray(state.students) || !Array.isArray(state.assignments) || !Array.isArray(state.submissions)) throw new Error('Sunucu panel verisi geçersiz.');
    const selected=this.state?.selectedTermId;
    const next=structuredClone(state);
    if(preserveTerm && next.terms.some(t=>t.id===selected)) next.selectedTermId=selected;
    this.state=next;
    return this.state;
  }
  async exclusive(fn) {
    if(this.busy) throw new Error('Önce devam eden işlemin tamamlanmasını bekleyin.');
    this.busy=true;
    try { return await fn(); } finally { this.busy=false; }
  }
  async reload() { return this.exclusive(async()=>{const response=await this.client.api('teacher-state',{});return this.acceptState(response.state);}); }
  selectTerm(id) { if(!this.state.terms.some(t=>t.id===id)) throw new Error('Dönem bulunamadı.'); this.state.selectedTermId=id; }
  view() { return new TeacherStore({seed:this.state,storage:{getItem:()=>null}}); }
  previewRoster(termId,rows) {
    const eligible=[],errors=[];
    rows.forEach((row,index)=>{if(!/^\d{6,20}$/.test(String(row.number)))errors.push({line:index+1,message:'Öğrenci numarası 6–20 rakam olmalıdır.'});else eligible.push(row);});
    const result=this.view().previewRoster(termId,eligible);
    result.errors.push(...errors);
    return result;
  }
  resultRows(termId) { return termId ? this.view().resultRows(termId) : []; }
  getAssignmentVariant(studentId,homeworkId) { return this.view().getAssignmentVariant(studentId,homeworkId); }
  getAssignmentVariantMap(termId,homeworkId) { return this.view().getAssignmentVariantMap(termId,homeworkId); }
  getSubmissionSummary(sub) { return this.view().getSubmissionSummary(sub); }
  getStudentAssignmentAvailability(studentId,homeworkId,nowMs=Date.now()) { return this.view().getStudentAssignmentAvailability(studentId,homeworkId,nowMs); }
  getStudentQuestionAttemptLimit(studentId,homeworkId,taskId) { return this.view().getStudentQuestionAttemptLimit(studentId,homeworkId,taskId); }
  getAssignmentAttemptLimits(termId,homeworkId) { return this.view().getAssignmentAttemptLimits(termId,homeworkId); }
  getAssignmentAvailability(termId,homeworkId,nowMs=Date.now()) { return this.view().getAssignmentAvailability(termId,homeworkId,nowMs); }
  async write(action,payload) {
    const key=JSON.stringify([action,payload]);
    let request=this.pendingWrites.get(key);
    if(!request){request={...structuredClone(payload),requestId:crypto.randomUUID()};this.pendingWrites.set(key,request);}
    try {
      const response=await this.client.api(action,request);
      // A successful server response confirms this request was accepted, even
      // if a subsequent display-state check fails.
      this.pendingWrites.delete(key);
      return response;
    } catch(error) {
      // Transport failures, timeouts and 5xx responses may follow a committed
      // write. Reuse its id on retry so the server can return the stored result.
      if(error?.status>=400 && error.status<500 && error.status!==408)this.pendingWrites.delete(key);
      throw error;
    }
  }
  async command(method,args) {
    return this.exclusive(async()=>{
      const response=await this.write('teacher-command',{method,args});
      this.acceptState(response.state,{preserveTerm:method!=='addTerm'});
      if(response.credentials) return {...response.result,credentials:response.credentials};
      return response.result;
    });
  }
  async resetPassword(studentId) { return this.exclusive(async()=>{const response=await this.write('reset-password',{studentId});return response.credential;}); }
}
for(const method of ['addTerm','archiveTerm','addStudent','updateStudent','setStudentActive','clearRoster','importRoster','saveAssignment','approveAssignment','revertAssignment','reviewGrade','setAssignmentAvailability','setSolutionRelease','setGradeRelease','setAssignmentAttemptLimits','grantStudentQuestionAttempts','setStudentAssignmentDeadlines','initializeAssignmentVariants','saveStudentGuide','saveFeedbackSettings','saveFeedbackReply','setFeedbackStatus']) {
  CloudTeacherStore.prototype[method]=function(...args) { return this.command(method,args); };
}
