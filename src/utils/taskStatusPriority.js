/**
 * Normalize for comparison (Seen → in_progress bucket).
 */
export function normTaskStatus(s) {
  const x = String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
  if (x === 'seen' || x === 'accepted') return 'in_progress';
  if (x === 'completed') return 'done';
  return x;
}

export function taskStatusRank(status) {
  const s = normTaskStatus(status);
  if (s === 'done') return 4;
  if (s === 'in_progress' || s === 'inprogress') return 3;
  if (s === 'assigned' || s === 'delayed' || s === 'searching_for_staff') return 2;
  if (s === 'pending' || s === '') return 1;
  return 2;
}

/**
 * While a lock exists, prefer it until server row matches (then clear lock).
 * TTL prevents stale locks. Prevents polls from downgrading In_Progress → Pending.
 */
export function applyTaskStatusLock(serverTask, locksRef) {
  if (!serverTask?.id) return serverTask;
  const id = String(serverTask.id);
  const lock = locksRef.get(id);
  if (!lock) return serverTask;
  const maxAge = 10 * 60 * 1000;
  if (Date.now() - lock.at > maxAge) {
    locksRef.delete(id);
    return serverTask;
  }
  const ns = normTaskStatus(serverTask.status);
  const nl = normTaskStatus(lock.status);
  if (ns === nl) {
    locksRef.delete(id);
    return serverTask;
  }
  return { ...serverTask, status: lock.status };
}

export function setTaskStatusLock(locksRef, taskId, status) {
  if (taskId == null || status == null) return;
  locksRef.set(String(taskId), { status, at: Date.now() });
}

/**
 * Quiet poll must not downgrade local "forward" statuses when the server row still lags (e.g. Pending).
 * Only applies to in-progress bucket and completed — not Assigned/Delayed vs In_Progress.
 */
export function preserveLocalForwardStatus(localTask, mergedTask) {
  if (!localTask || !mergedTask) return mergedTask;
  const ls = normTaskStatus(localTask.status);
  const ms = normTaskStatus(mergedTask.status);
  if (ls === 'done') {
    if (ms !== 'done') return { ...mergedTask, status: localTask.status };
    return mergedTask;
  }
  if (ls === 'in_progress' || ls === 'inprogress') {
    if (ms === 'done') return mergedTask;
    if (taskStatusRank(mergedTask.status) <= 1) {
      return { ...mergedTask, status: localTask.status };
    }
  }
  return mergedTask;
}

/** Full-list poll: apply locks, then never regress local In_Progress/Done to Waiting from stale rows. */
export function mergeTasksFromServerPoll(prevList, serverList, locksMap) {
  if (!Array.isArray(serverList)) return prevList ?? [];
  const prevById = new Map((prevList ?? []).map((t) => [String(t.id), t]));
  return serverList.map((srv) => {
    if (srv?.id == null) return srv;
    const id = String(srv.id);
    const local = prevById.get(id);
    let m = applyTaskStatusLock({ ...srv }, locksMap);
    if (local) m = preserveLocalForwardStatus(local, m);
    return m;
  });
}

function isTempClientId(id) {
  const s = String(id || '');
  return s.startsWith('client_') || s.startsWith('local-') || s.startsWith('tmp-');
}

/** Dedupe by id first, then client_id (server rows win over temp local ids). */
export function dedupeTaskListByIdAndClient(list) {
  const seenIds = new Set();
  const seenClientIds = new Set();
  const out = [];
  for (const row of list || []) {
    if (!row) continue;
    const id = row.id != null ? String(row.id) : '';
    const cid = row.client_id ? String(row.client_id) : '';
    if (id && seenIds.has(id)) continue;
    if (cid && seenClientIds.has(cid)) continue;
    if (id && isTempClientId(id)) {
      if (cid && seenClientIds.has(cid)) continue;
      if (seenClientIds.has(id)) continue;
    }
    if (id) seenIds.add(id);
    if (cid) seenClientIds.add(cid);
    if (id && isTempClientId(id)) seenClientIds.add(id);
    out.push(row);
  }
  return out;
}

export function logTasksMergeDebug(backend, pending, merged) {
  const pick = (arr) => (arr || []).map((t) => t?.id || t?.client_id || '?');
  console.log('[Tasks] backend', pick(backend));
  console.log('[Tasks] pending', pick(pending));
  console.log('[Tasks] merged', pick(merged));
}

/**
 * Server list is authoritative.
 * pendingLocals: only pending_sync rows (storage + memory).
 * tail: scrolled pages beyond the current server head fetch.
 */
export function mergeMissionTaskLists(pendingLocals, serverHead, tail = [], locksMap = null) {
  const pending = Array.isArray(pendingLocals) ? pendingLocals : [];
  const head = (Array.isArray(serverHead) ? serverHead : []).map((row) =>
    (locksMap ? applyTaskStatusLock(row, locksMap) : row),
  );

  const serverById = new Map();
  const serverByClientId = new Map();
  for (const t of head) {
    if (t?.id != null) serverById.set(String(t.id), t);
    const cid = t?.client_id ? String(t.client_id) : '';
    if (cid) serverByClientId.set(cid, t);
  }

  const stillPending = pending.filter((local) => {
    if (!local || local.pending_sync !== true) return false;
    const cid = local.client_id ? String(local.client_id) : '';
    const lid = local.id != null ? String(local.id) : '';
    if (cid && serverByClientId.has(cid)) return false;
    if (lid && serverByClientId.has(lid)) return false;
    if (lid && serverById.has(lid) && !isTempClientId(lid)) return false;
    return true;
  });

  const serverIds = new Set(head.map((t) => String(t.id)));
  const safeTail = (Array.isArray(tail) ? tail : []).filter((t) => {
    if (!t?.id || t.pending_sync === true) return false;
    return !serverIds.has(String(t.id));
  });

  const merged = dedupeTaskListByIdAndClient([...stillPending, ...head, ...safeTail]);
  logTasksMergeDebug(head, stillPending, merged);
  return merged;
}

function isTerminalDoneStatus(status) {
  const raw = String(status ?? '').trim().toLowerCase();
  return raw === 'done' || raw === 'completed' || raw === 'closed';
}

/** Worker poll — server authoritative; never regress a locally completed row on stale poll/socket. */
export function mergeWorkerTasksFromServer(fetched, prevList = null) {
  const list = Array.isArray(fetched) ? fetched : [];
  const prevById = new Map((prevList ?? []).map((t) => [String(t.id), t]));
  const merged = dedupeTaskListByIdAndClient(
    list.map((srv) => {
      if (!srv?.id) return srv;
      const local = prevById.get(String(srv.id));
      if (local && isTerminalDoneStatus(local.status) && !isTerminalDoneStatus(srv.status)) {
        return {
          ...srv,
          status: local.status,
          completed_at: local.completed_at || srv.completed_at,
          completed_by: local.completed_by || srv.completed_by,
        };
      }
      return srv;
    }),
  );
  logTasksMergeDebug(list, [], merged);
  return merged;
}
