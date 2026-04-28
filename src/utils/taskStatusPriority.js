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
