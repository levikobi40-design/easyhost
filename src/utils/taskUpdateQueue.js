/**
 * Persist failed PATCH /property-tasks updates when offline; flush when connection returns.
 */
const STORAGE_KEY = 'hotel_property_task_update_queue_v1';

function readQueue() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writeQueue(items) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    /* quota */
  }
}

export function enqueueTaskUpdate(taskId, status, meta = {}) {
  if (!taskId || !status) return;
  const q = readQueue().filter((x) => x.taskId !== taskId);
  q.push({
    taskId: String(taskId),
    status,
    ts: Date.now(),
    ...meta,
  });
  writeQueue(q);
}

export function getQueuedTaskUpdates() {
  return readQueue();
}

export function clearTaskUpdateQueue() {
  writeQueue([]);
}

export function removeQueuedTaskUpdate(taskId) {
  const q = readQueue().filter((x) => x.taskId !== String(taskId));
  writeQueue(q);
}
