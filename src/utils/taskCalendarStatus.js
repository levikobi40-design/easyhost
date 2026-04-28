/** Shared predicates for TaskCalendar cards (memo-friendly, no React). */
import { taskCalendarSafeStr } from './taskCalendarWhatsApp';

export function missionTaskIsTowelCleaning(task) {
  const tt = (task.task_type || '').toLowerCase();
  const raw = String(task.task_type || '');
  const d = taskCalendarSafeStr(task.description).toLowerCase();
  const isClean = tt === 'cleaning' || raw === 'ניקיון חדר';
  return isClean && (d.includes('מגבת') || d.includes('towel') || d.includes('מגבות'));
}

export function missionTaskIsDone(task) {
  return (task?.status || '').toLowerCase() === 'done';
}

export function missionTaskIsInProgress(task) {
  const s = (task?.status || '').toLowerCase().replace(/\s+/g, '_');
  return (
    s === 'in_progress'
    || s === 'assigned'
    || s === 'accepted'
    || s === 'started'
    || s === 'delayed'
    || s === 'searching_for_staff'
  );
}

export function missionTaskIsSeen(task) {
  return (task?.status || '').toLowerCase() === 'seen';
}

export function missionTaskIsDelayed(task) {
  return Boolean(task?.delayed) && !missionTaskIsDone(task);
}

export function missionTaskIsUnacked(task) {
  if (missionTaskIsDone(task) || missionTaskIsSeen(task) || missionTaskIsInProgress(task)) return false;
  const dl = task?.ack_deadline;
  if (!dl) return false;
  if ((task?.escalation_status || '') === 'escalated') return false;
  return new Date(dl) < new Date();
}

export function missionTaskIsEscalated(task) {
  return (task?.escalation_status || '') === 'escalated';
}

export function missionTaskIsSearchingStaff(task) {
  const s = (task?.status || '').toLowerCase().replace(/\s+/g, '_');
  return s === 'searching_for_staff';
}

export function missionTaskIsCheckinSoonPinned(task) {
  if (missionTaskIsDone(task) || !task?.due_at) return false;
  const due = new Date(task.due_at);
  if (Number.isNaN(due.getTime())) return false;
  const hours = (due.getTime() - Date.now()) / 3600000;
  return hours >= 0 && hours <= 4;
}
