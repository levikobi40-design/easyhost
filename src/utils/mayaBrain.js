/**
 * Runtime-loaded knowledge from /maya_brain.json (public/).
 * Used as background context for Maya — UI no longer shows these blocks.
 */
import useStore from '../store/useStore';

let cache = null;
let loadPromise = null;

export function getMayaBrainSync() {
  return cache;
}

export async function loadMayaBrain() {
  if (cache) return cache;
  if (loadPromise) return loadPromise;
  loadPromise = fetch(`${process.env.PUBLIC_URL || ''}/maya_brain.json`)
    .then((r) => (r.ok ? r.json() : {}))
    .then((data) => {
      cache = data && typeof data === 'object' ? data : {};
      return cache;
    })
    .catch(() => {
      cache = {};
      return cache;
    });
  return loadPromise;
}

if (typeof window !== 'undefined') {
  void loadMayaBrain();
}

/**
 * Normalize `{ id|taskId, status }[]` for bulk board updates (Maya / tools).
 */
function normalizeTaskStatusUpdates(updates) {
  return (Array.isArray(updates) ? updates : [])
    .map((u) => ({
      id: String((u && (u.taskId ?? u.id)) ?? '').trim(),
      status: u && u.status,
    }))
    .filter((u) => u.id && u.status != null);
}

/** Above this, use one POST /property-tasks-batch instead of N PATCHes + collapse Maya chat to one line. */
const BULK_TASK_UPDATE_THRESHOLD = 10;

function dispatchMissionRefreshEvents() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event('maya-refresh-tasks'));
  window.dispatchEvent(new CustomEvent('mission-full-tasks-refresh'));
}

/**
 * Fire PATCH requests in parallel for small batches; one batch POST for large bulk (Maya).
 * Optional `previousById` maps task id → prior status for optimistic rollback on total failure.
 */
export async function runParallelPropertyTaskUpdates(updates, opts = {}) {
  const norm = normalizeTaskStatusUpdates(updates);
  if (!norm.length) return { ok: true, updated: 0 };
  const { notifyMissionTasksBatchLocalUpdate } = await import('./taskSyncBridge');
  const prevById = opts.previousById && typeof opts.previousById === 'object' ? opts.previousById : {};

  if (norm.length > BULK_TASK_UPDATE_THRESHOLD) {
    const { updatePropertyTasksBatch } = await import('../services/api');
    try {
      await updatePropertyTasksBatch(
        norm.map((u) => ({ taskId: u.id, status: u.status })),
      );
    } catch (e) {
      const rollback = norm
        .map((u) => {
          const prev = prevById[u.id];
          return prev != null ? { taskId: u.id, status: prev } : null;
        })
        .filter(Boolean);
      if (rollback.length) notifyMissionTasksBatchLocalUpdate(rollback);
      throw e;
    }
    dispatchMissionRefreshEvents();
    return { ok: true, updated: norm.length, bulk: true };
  }

  notifyMissionTasksBatchLocalUpdate(norm.map((u) => ({ taskId: u.id, status: u.status })));
  const { updatePropertyTaskStatus } = await import('../services/api');
  try {
    await Promise.all(norm.map((u) => updatePropertyTaskStatus(u.id, u.status, { skipRefresh: true })));
  } catch (e) {
    const rollback = norm
      .map((u) => {
        const prev = prevById[u.id];
        return prev != null ? { taskId: u.id, status: prev } : null;
      })
      .filter(Boolean);
    if (rollback.length) notifyMissionTasksBatchLocalUpdate(rollback);
    throw e;
  }
  dispatchMissionRefreshEvents();
  return { ok: true, updated: norm.length };
}

/** Extract `{ taskId, status }[]` from a Maya `processCommand` result for bulk UI + batch routing. */
export function extractTaskStatusUpdatesFromMayaResult(result) {
  if (!result || typeof result !== 'object') return [];
  const p = result.parsed;
  let updates = null;
  if (p && Array.isArray(p.task_status_updates)) updates = p.task_status_updates;
  else if (p && Array.isArray(p.updates)) updates = p.updates;
  else if (Array.isArray(result.task_status_updates)) updates = result.task_status_updates;
  if (!Array.isArray(updates)) return [];
  return normalizeTaskStatusUpdates(updates);
}

export function countTaskStatusUpdatesInMayaResult(result) {
  return extractTaskStatusUpdatesFromMayaResult(result).length;
}

/**
 * If the server returns structured batch updates (e.g. `parsed.task_status_updates`), apply in parallel on the client.
 */
export async function applyClientSideTaskUpdatesFromMayaResult(result) {
  if (!result || typeof result !== 'object') return null;
  const p = result.parsed;
  let updates = null;
  if (p && Array.isArray(p.task_status_updates)) updates = p.task_status_updates;
  else if (p && Array.isArray(p.updates)) updates = p.updates;
  else if (Array.isArray(result.task_status_updates)) updates = result.task_status_updates;
  if (!updates || !updates.length) return null;
  const prev = {};
  (result.tasksSnapshotBefore || []).forEach((t) => {
    if (t && t.id) prev[String(t.id)] = t.status;
  });
  useStore.getState().setMayaBatchProcessing(true);
  try {
    return await runParallelPropertyTaskUpdates(updates, { previousById: prev });
  } finally {
    useStore.getState().setMayaBatchProcessing(false);
  }
}

/**
 * Field app (FieldView) silent status taps. MayaChat listens for `field-staff-status`;
 * the backend also appends to `_ACTIVITY_LOG` / activity-feed.
 */
export function notifyFieldStaffStatusTap(detail) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('field-staff-status', {
      detail: detail && typeof detail === 'object' ? detail : {},
    }),
  );
}

/** Background validation: upcoming bookings vs prep-style open tasks (server /api/health/bookings-tasks-sync). */
const BOOKING_TASK_SYNC_MS = 120000;
let _bookingSyncTimer = null;

async function runBookingTaskSyncValidationOnce() {
  try {
    const { fetchBookingTasksSyncHealth } = await import('../services/api');
    const snap = await fetchBookingTasksSyncHealth();
    if (!snap || snap.aligned !== false) return;
    console.warn('[EasyHost] Booking ↔ task sync drift', {
      upcoming: snap.upcoming_bookings,
      prepLike: snap.prep_like_open_tasks,
      drift: snap.drift_bookings_minus_prep_tasks,
    });
    window.dispatchEvent(new CustomEvent('easyhost-booking-task-drift', { detail: snap }));
  } catch (_) {
    /* offline / CORS — non-fatal */
  }
}

export function startBookingTaskSyncValidator() {
  if (typeof window === 'undefined' || _bookingSyncTimer != null) return;
  _bookingSyncTimer = window.setInterval(runBookingTaskSyncValidationOnce, BOOKING_TASK_SYNC_MS);
}

export function stopBookingTaskSyncValidator() {
  if (typeof window === 'undefined' || _bookingSyncTimer == null) return;
  window.clearInterval(_bookingSyncTimer);
  _bookingSyncTimer = null;
}

if (typeof window !== 'undefined') {
  window.setTimeout(() => {
    void runBookingTaskSyncValidationOnce();
    startBookingTaskSyncValidator();
  }, 18000);
  window.addEventListener('focus', () => {
    void runBookingTaskSyncValidationOnce();
  });
}
