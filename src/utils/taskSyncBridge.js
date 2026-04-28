/**
 * Task sync across tabs (Dashboard, Mission Board, Worker portal, Guest view).
 * window.dispatchEvent only reaches the current tab; workers often open /worker/* in another tab.
 */
import hotelRealtime from '../services/hotelRealtime';
import useStore from '../store/useStore';

function taskStatusLabelHe(st) {
  const s = String(st ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
  if (s === 'done' || s === 'completed') return 'הושלם';
  if (s === 'in_progress' || s === 'inprogress' || s === 'seen' || s === 'accepted') return 'בטיפול';
  if (s === 'pending') return 'ממתין';
  if (s === 'assigned') return 'הוקצה';
  if (s === 'delayed') return 'באיחור';
  return String(st ?? '').trim() || '—';
}

const BC_NAME = 'hotel-dashboard-tasks';
const LS_KEY = 'hotel_task_sync_v1';

let broadcastChannel = null;

function getBroadcastChannel() {
  if (typeof BroadcastChannel === 'undefined') return null;
  if (!broadcastChannel) broadcastChannel = new BroadcastChannel(BC_NAME);
  return broadcastChannel;
}

/**
 * Call after a task is created/updated (Maya chat, guest towels, inject, etc.).
 * @param {{ task?: object }} [opts] — optional task for optimistic Mission Board prepend
 */
/** Optimistic Mission Board / PremiumDashboard — apply status before PATCH returns. */
export function notifyMissionTaskLocalUpdate(taskId, status) {
  if (taskId == null || status == null) return;
  try {
    window.dispatchEvent(
      new CustomEvent('mission-task-local-update', { detail: { taskId: String(taskId), status } }),
    );
  } catch (_) {}
}

/** Batch optimistic patch: `updates` = [{ id or taskId, status }, …] */
export function notifyMissionTasksBatchLocalUpdate(updates) {
  if (!Array.isArray(updates) || !updates.length) return;
  const norm = updates
    .map((u) => ({
      taskId: String(u.taskId ?? u.id ?? '').trim(),
      status: u.status,
    }))
    .filter((u) => u.taskId);
  if (!norm.length) return;
  try {
    window.dispatchEvent(new CustomEvent('mission-tasks-batch-local-update', { detail: { updates: norm } }));
  } catch (_) {}
  try {
    const { addMayaActivityEntry } = useStore.getState();
    if (norm.length <= 50) {
      norm.forEach((u) => {
        const id = u.taskId;
        const shortId = id.length > 14 ? `${id.slice(0, 10)}…` : id;
        addMayaActivityEntry({
          kind: 'task_status',
          text: `משימה #${shortId} → ${taskStatusLabelHe(u.status)}`,
          taskId: id,
          status: u.status,
        });
      });
    } else {
      addMayaActivityEntry({
        kind: 'task_batch',
        text: `עודכנו ${norm.length} משימות (פירוט בהיסטוריה — קבוצה גדולה).`,
      });
    }
  } catch (_) {}
}

export function notifyTasksChanged(opts = {}) {
  const { task } = opts;
  try {
    window.dispatchEvent(new Event('maya-refresh-tasks'));
    if (task) {
      window.dispatchEvent(new CustomEvent('maya-task-created', { detail: { task } }));
    }
  } catch (_) {}
  try {
    hotelRealtime.publishLocal('task_updated', { ts: Date.now() });
  } catch (_) {}
  try {
    const ts = String(Date.now());
    localStorage.setItem(LS_KEY, ts);
    getBroadcastChannel()?.postMessage({ type: 'tasks_updated', ts });
  } catch (_) {}
}

/**
 * Call after Maya registers a new staff member via register_staff action.
 * Components (StaffManager, StaffRosterDashboard) listen for 'maya-staff-registered'
 * and immediately re-fetch their staff list.
 */
export function notifyStaffChanged(opts = {}) {
  const { staff } = opts;
  try {
    window.dispatchEvent(new CustomEvent('maya-staff-registered', { detail: { staff } }));
  } catch (_) {}
  try {
    const ts = String(Date.now());
    localStorage.setItem('hotel_staff_sync_v1', ts);
  } catch (_) {}
}

/** Subscribe in MissionContext, WorkerView, GodModeDashboard so other tabs bump local state */
export function subscribeCrossTabTaskSync(callback) {
  const handlers = [];
  let ch;
  if (typeof BroadcastChannel !== 'undefined') {
    ch = new BroadcastChannel(BC_NAME);
    const onMsg = (ev) => {
      if (ev?.data?.type === 'tasks_updated') callback();
    };
    ch.addEventListener('message', onMsg);
    handlers.push(() => {
      ch.removeEventListener('message', onMsg);
      ch.close();
    });
  }
  const onStorage = (e) => {
    if (e.key === LS_KEY && e.newValue) callback();
  };
  window.addEventListener('storage', onStorage);
  handlers.push(() => window.removeEventListener('storage', onStorage));
  return () => handlers.forEach((fn) => fn());
}
