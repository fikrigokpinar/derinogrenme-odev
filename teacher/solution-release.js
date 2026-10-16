import {assignmentAvailability,studentAssignmentAvailability} from './assignment-availability.js';

// Publishing is a separate, explicit instructor action after every delivery
// window closes. Inactive roster entries never delay the rest of the class.
function releaseStatus(state,termId,homeworkId,kind,{now=Date.now()}={}) {
  const term=state.terms.find(t=>t.id===termId),assignment=state.assignments.find(a=>a.id===homeworkId);
  const students=state.students.filter(s=>s.termId===termId&&s.active===true);
  const openStudentCount=students.filter(s=>studentAssignmentAvailability(state,s,homeworkId,{now}).isOpen).length;
  const blocked=!term?'missing_term':term.archived?'archived':!assignment?.approved||!assignment.approvedRevision?'unapproved':assignmentAvailability(state,termId,homeworkId,{now}).isOpen?'assignment_open':openStudentCount?'student_windows_open':null;
  const saved=term?.[kind]?.[homeworkId];
  const published=!blocked&&saved?.revision===assignment.approvedRevision&&typeof saved.publishedAt==='string'&&Number.isFinite(Date.parse(saved.publishedAt));
  return {published:!!published,canPublish:!blocked,reason:blocked||(published?'published':'unpublished'),openStudentCount,publishedAt:published?saved.publishedAt:null,revision:published?saved.revision:null};
}

export function solutionReleaseStatus(state,termId,homeworkId,options={}) {
  return releaseStatus(state,termId,homeworkId,'solutionReleases',options);
}

export function gradeReleaseStatus(state,termId,homeworkId,options={}) {
  return releaseStatus(state,termId,homeworkId,'gradeReleases',options);
}
