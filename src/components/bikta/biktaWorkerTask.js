/**
 * Next room the Bikta worker must address — one focus at a time.
 * Orange (in progress) blocks starting another red until completed (green).
 */

export function getNextWorkerFocusRoom(rooms) {
  const list = [...(rooms || [])].filter((r) => !r._placeholder);
  const phaseOf = (r) => {
    const ph = r.worker_phase ?? (r.worker_done ? 2 : 0);
    return Number(ph) || 0;
  };

  const inProgress = list.filter((r) => r.admin_mark && phaseOf(r) === 1);
  if (inProgress.length) {
    return inProgress.sort((a, b) => {
      const oa = (a.orange_marked_at || '').slice(0, 19);
      const ob = (b.orange_marked_at || '').slice(0, 19);
      if (oa && ob && oa !== ob) return oa.localeCompare(ob);
      return (a.room_index || 0) - (b.room_index || 0);
    })[0];
  }

  const dirty = list.filter((r) => r.admin_mark && phaseOf(r) === 0);
  if (!dirty.length) return null;

  return dirty.sort((a, b) => {
    const da = (a.dirty_marked_at || '').slice(0, 19);
    const db = (b.dirty_marked_at || '').slice(0, 19);
    if (da && db && da !== db) return da.localeCompare(db);
    return (a.room_index || 0) - (b.room_index || 0);
  })[0];
}
