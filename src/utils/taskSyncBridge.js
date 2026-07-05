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
const PENDING_MAYA_TASKS_KEY = 'hotel_pending_maya_tasks_v1';

let broadcastChannel = null;

function getBroadcastChannel() {
  if (typeof BroadcastChannel === 'undefined') return null;
  if (!broadcastChannel) broadcastChannel = new BroadcastChannel(BC_NAME);
  return broadcastChannel;
}

export function makeMayaClientTaskId() {
  return `client_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function isPersistedServerTaskId(id) {
  const s = String(id || '').trim();
  if (!s) return false;
  if (s.startsWith('client_') || s.startsWith('local-') || s.startsWith('tmp-')) return false;
  return true;
}

export function readPendingMayaTasksFromStorage() {
  try {
    const raw = localStorage.getItem(PENDING_MAYA_TASKS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((t) => t && t.pending_sync === true) : [];
  } catch {
    return [];
  }
}

function writePendingMayaTasksToStorage(list) {
  try {
    const pending = (list || []).filter((t) => t && t.pending_sync === true);
    if (!pending.length) {
      localStorage.removeItem(PENDING_MAYA_TASKS_KEY);
      return;
    }
    localStorage.setItem(PENDING_MAYA_TASKS_KEY, JSON.stringify(pending));
  } catch (_) {}
}

export function registerPendingMayaTask(task) {
  if (!task?.pending_sync) return;
  const list = readPendingMayaTasksFromStorage();
  const cid = String(task.client_id || task.id || '');
  const next = [task, ...list.filter((t) => String(t.client_id || t.id) !== cid)];
  writePendingMayaTasksToStorage(next);
}

export function clearPendingMayaTask(clientIdOrId) {
  const key = String(clientIdOrId || '');
  if (!key) return;
  const next = readPendingMayaTasksFromStorage().filter(
    (t) => String(t.client_id || '') !== key && String(t.id || '') !== key,
  );
  writePendingMayaTasksToStorage(next);
}

function buildCreatePayload(task) {
  const client_id = task.client_id || makeMayaClientTaskId();
  const description = (task.description || task.content || task.title || '').trim();
  const payload = {
    client_id,
    source: 'maya',
    property_id: task.property_id || '',
    property_name: task.property_name || task.propertyName || '',
    description: description || '',
    title: description || '',
    content: description || '',
    raw_user_request: task.raw_user_request || task.user_request || task.rawUserRequest || '',
    staff_name: task.staff_name || task.staffName || '',
    staff_phone: task.staff_phone || '',
    assigned_to: task.assigned_to || task.staff_id || '',
    status: task.status || 'Pending',
    task_type: task.task_type || task.taskType || '',
    priority: task.priority || 'normal',
    property_context: task.property_context || '',
  };
  console.debug('[MayaTask] POST payload title/description', payload.title, payload.description);
  return payload;
}

/** POST /property-tasks when Maya returns a local-only row; keep pending_sync on failure. */
export async function ensureMayaTaskPersisted(task) {
  if (!task || typeof task !== 'object') return null;
  if (isPersistedServerTaskId(task.id) && task.pending_sync !== true) {
    return { ...task, pending_sync: false };
  }
  const payload = buildCreatePayload(task);
  const { createPropertyTask } = await import('../services/api');
  try {
    const out = await createPropertyTask(payload);
    const saved = out?.task || out;
    if (saved?.id) {
      clearPendingMayaTask(payload.client_id);
      return { ...saved, client_id: payload.client_id, source: saved.source || 'maya', pending_sync: false };
    }
  } catch (e) {
    console.warn('[taskSyncBridge] Maya task POST failed — keeping pending local row', e);
  }
  const pending = {
    ...task,
    ...payload,
    id: task.id || payload.client_id,
    client_id: payload.client_id,
    source: 'maya',
    pending_sync: true,
    created_at: task.created_at || new Date().toISOString(),
    status: task.status || 'Pending',
  };
  registerPendingMayaTask(pending);
  return pending;
}

export function notifyMissionTaskLocalUpdate(taskId, status) {
  if (taskId == null || status == null) return;
  try {
    window.dispatchEvent(
      new CustomEvent('mission-task-local-update', { detail: { taskId: String(taskId), status } }),
    );
  } catch (_) {}
}

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
    if (task) {
      window.dispatchEvent(new CustomEvent('maya-task-created', { detail: { task } }));
    }
    window.dispatchEvent(new Event('maya-refresh-tasks'));
  } catch (_) {}
  try {
    hotelRealtime.publishLocal('task_updated', { task, ts: Date.now() });
  } catch (_) {}
  try {
    const ts = String(Date.now());
    localStorage.setItem(LS_KEY, ts);
    getBroadcastChannel()?.postMessage({ type: 'tasks_updated', ts });
  } catch (_) {}
}

export async function notifyTasksChangedAsync(opts = {}) {
  let { task } = opts;
  if (task) {
    task = await ensureMayaTaskPersisted(task);
    if (task?.pending_sync) registerPendingMayaTask(task);
    else if (task?.client_id) clearPendingMayaTask(task.client_id);
  }
  notifyTasksChanged({ ...opts, task });
  return task;
}

export function notifyTasksChangedWithPersist(opts = {}) {
  void notifyTasksChangedAsync(opts);
}

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
