export const COURSE_TIME_ZONE = 'Europe/Istanbul';

// Content approval and term delivery settings are independent. Legacy terms
// retain their previous open behavior; newly created terms explicitly start closed.
export function normalizeAvailability(settings) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings) ||
      typeof settings.active !== 'boolean' ||
      Object.keys(settings).some(key => !['active','deadline'].includes(key))) {
    throw new Error('Ödevin aktiflik ayarı geçersiz.');
  }
  const deadline = settings.deadline ?? null;
  if (deadline !== null) {
    const date = new Date(deadline);
    if (typeof deadline !== 'string' || !Number.isFinite(date.getTime()) ||
        date.toISOString() !== deadline || !/^\d{4}-/.test(deadline)) {
      throw new Error('Son gönderim tarihi ve saati geçersiz.');
    }
  }
  return {active:settings.active, deadline};
}

export function availabilityStatus(settings, {approved = true, now = Date.now()} = {}) {
  const active = settings?.active === undefined ? true : settings.active === true;
  const deadline = settings?.deadline ?? null;
  const expired = deadline !== null && (!Number.isFinite(Date.parse(deadline)) || now >= Date.parse(deadline));
  const reason = !approved ? 'unapproved' : !active ? 'inactive' : expired ? 'expired' : 'active';
  return {active, deadline, isOpen:reason === 'active', reason, serverNow:new Date(now).toISOString()};
}

export function assignmentAvailability(state, termId, homeworkId, {now = Date.now()} = {}) {
  const term = state.terms.find(t => t.id === termId);
  const assignment = state.assignments.find(a => a.id === homeworkId);
  const settings = term?.assignmentAvailability?.[homeworkId];
  return availabilityStatus(term?.archived ? {...settings, active:false} : settings,
    {approved:!!(term && assignment?.approved && assignment.approvedRevision), now});
}

export function formatDeadline(value) {
  if (!value) return 'Süre sınırı yok';
  if (!Number.isFinite(Date.parse(value))) return 'Geçersiz tarih';
  return new Intl.DateTimeFormat('tr-TR', {
    timeZone:COURSE_TIME_ZONE, dateStyle:'medium', timeStyle:'short',
  }).format(new Date(value));
}

export function toDeadlineInput(value) {
  if (!value) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone:COURSE_TIME_ZONE, year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', hourCycle:'h23',
  }).formatToParts(new Date(value));
  const p = Object.fromEntries(parts.map(x => [x.type,x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

export function fromDeadlineInput(value) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('Tarih ve saat birlikte seçilmelidir.');
  const local = Date.parse(value + ':00.000Z');
  if (!Number.isFinite(local)) throw new Error('Son gönderim tarihi geçersiz.');
  // Convert the explicitly labelled Istanbul wall time, independent of the
  // teacher computer's timezone. Round-trip validation rejects invalid dates.
  let instant = local;
  for (let n=0;n<3;n++) {
    const displayed = Date.parse(toDeadlineInput(new Date(instant).toISOString()) + ':00.000Z');
    instant += local - displayed;
  }
  const result = new Date(instant).toISOString();
  if (toDeadlineInput(result) !== value) throw new Error('Son gönderim tarihi geçersiz.');
  return result;
}

export function studentAssignmentAvailability(state,student,homeworkId,{now=Date.now()}={}) {
  const term=state.terms.find(t=>t.id===student.termId),assignment=state.assignments.find(a=>a.id===homeworkId);
  const general=term?.assignmentAvailability?.[homeworkId],override=student.assignmentOverrides?.[homeworkId];
  const personalDeadline=!!override&&Object.hasOwn(override,'deadline');
  const settings={active:!term?.archived&&student.active!==false&&(override?.allowClosed===true||general?.active!==false),deadline:personalDeadline?override.deadline:(general?.deadline??null)};
  return {...availabilityStatus(settings,{approved:!!(term&&assignment?.approved&&assignment.approvedRevision),now}),...(personalDeadline?{personalDeadline:true}:{})};
}
