import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { getPropertyTasks, fetchTaskStatusCounts } from '../services/api';
import hotelRealtime from '../services/hotelRealtime';
import { subscribeCrossTabTaskSync } from '../utils/taskSyncBridge';
import useStore from '../store/useStore';
import { isBiktaNessZionaUser } from '../utils/biktaUser';
import { applyTaskStatusLock, setTaskStatusLock } from '../utils/taskStatusPriority';
import { clearTaskUpdateQueue } from '../utils/taskUpdateQueue';

/** Mission board: background poll interval (reduces server/log noise vs 5s). */
export const TASKS_REFRESH_POLL_MS = 30000;
/** Initial page + scroll chunk — matches fast GET /api/tasks default strategy. */
export const TASK_MISSION_PAGE_SIZE = 20;

const MissionContext = createContext(null);

/** Coalesce realtime / socket-driven refetches so bursts do not stack. */
const DEBOUNCE_MS = 8000;

export function MissionProvider({ children }) {
  const authToken = useStore((s) => s.authToken);
  const activeTenantId = useStore((s) => s.activeTenantId);
  const skipStandardTasks = isBiktaNessZionaUser(authToken, activeTenantId);
  /** Bikta-only: skip standard portfolio tasks. Bazaar Jaffa loads /property-tasks like everyone else. */
  const skipMissionFetch = skipStandardTasks;

  /** null = before first successful fetch; then array (possibly empty) from GET /api/tasks */
  const [tasks, setTasks] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tasksTotal, setTasksTotal] = useState(0);
  /** Authoritative DB breakdown from GET /api/tasks/status-counts (full tenant, not current page). */
  const [taskStatusCounts, setTaskStatusCounts] = useState({
    total: 0,
    pending: 0,
    in_progress: 0,
    done: 0,
  });
  const [hasMoreTasks, setHasMoreTasks] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  /** Incremented when Maya chat dispatches task events — drives debounced refetch below */
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const loadRef = useRef(0);
  const tasksRef = useRef(null);
  const debounceTimerRef = useRef(null);
  const tasksPollIntervalRef = useRef(null);
  const lastQuietPollAtRef = useRef(0);
  /** Until server confirms the same status, do not let quiet polls overwrite Maya/user-driven transitions. */
  const statusLocksRef = useRef(new Map());

  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  /**
   * @param {{ blocking?: boolean }} [opts] — blocking true = full loader (pull-to-refresh / hard reload).
   * Default: show loader only until the first successful load; later refetches stay in the background.
   */
  const syncTotalFromServer = useCallback(() => {
    if (!authToken) return Promise.resolve();
    return fetchTaskStatusCounts()
      .then((c) => {
        if (!c) return;
        const total = Number(c.total);
        if (Number.isFinite(total)) setTasksTotal(total);
        setTaskStatusCounts({
          total: Number.isFinite(total) ? total : 0,
          pending: Number(c.pending) || 0,
          in_progress: Number(c.in_progress) || 0,
          done: Number(c.done) || 0,
        });
      })
      .catch(() => {});
  }, [authToken]);

  const refresh = useCallback((opts = {}) => {
    if (!authToken) return Promise.resolve();
    if (skipMissionFetch) return Promise.resolve();
    const blocking = opts.blocking === true;
    const fullList = opts.fullList === true;
    const showBlockingLoader = blocking || tasksRef.current === null;
    const loadId = ++loadRef.current;
    if (showBlockingLoader) {
      setLoading(true);
    }
    if (fullList) {
      return Promise.all([getPropertyTasks({ limit: 0 }), fetchTaskStatusCounts()])
        .then(([list, counts]) => {
          if (loadId !== loadRef.current) return;
          if (!Array.isArray(list)) {
            setTasks([]);
            setTasksTotal(0);
            setHasMoreTasks(false);
            return;
          }
          const dbTotal = counts && Number.isFinite(Number(counts.total)) ? Number(counts.total) : list.length;
          setTasksTotal(dbTotal);
          if (counts) {
            setTaskStatusCounts({
              total: dbTotal,
              pending: Number(counts.pending) || 0,
              in_progress: Number(counts.in_progress) || 0,
              done: Number(counts.done) || 0,
            });
          }
          setHasMoreTasks(false);
          setTasks(list.map((row) => applyTaskStatusLock(row, statusLocksRef.current)));
        })
        .catch(() => {
          if (loadId === loadRef.current) setTasks((prev) => (prev ?? []));
        })
        .finally(() => {
          if (loadId !== loadRef.current) return;
          setLoading(false);
        });
    }
    return Promise.all([
      getPropertyTasks({ limit: TASK_MISSION_PAGE_SIZE, offset: 0 }),
      fetchTaskStatusCounts(),
    ])
      .then(([page, counts]) => {
        if (loadId !== loadRef.current) return;
        const rows = page && typeof page === 'object' && !Array.isArray(page) ? page.tasks || [] : [];
        const headerTotal =
          page && typeof page === 'object' && Number.isFinite(Number(page.total))
            ? Number(page.total)
            : null;
        const dbTotal = counts && Number.isFinite(Number(counts.total)) ? Number(counts.total) : null;
        if (dbTotal !== null) {
          setTasksTotal(dbTotal);
          setTaskStatusCounts({
            total: dbTotal,
            pending: Number(counts.pending) || 0,
            in_progress: Number(counts.in_progress) || 0,
            done: Number(counts.done) || 0,
          });
        } else if (headerTotal !== null) {
          setTasksTotal(headerTotal);
        } else {
          setTasksTotal(rows.length);
        }
        const totalForMore = dbTotal !== null ? dbTotal : (headerTotal ?? rows.length);
        const hasMore =
          dbTotal !== null
            ? rows.length < dbTotal
            : page && typeof page === 'object' && !Array.isArray(page)
              ? Boolean(page.hasMore)
              : rows.length < totalForMore;
        setHasMoreTasks(hasMore);
        setTasks(rows.map((row) => applyTaskStatusLock(row, statusLocksRef.current)));
      })
      .catch(() => {
        if (loadId === loadRef.current) setTasks((prev) => (prev ?? []));
      })
      .finally(() => {
        if (loadId !== loadRef.current) return;
        setLoading(false);
      });
  }, [authToken, skipMissionFetch]);

  const loadMoreTasks = useCallback(() => {
    if (skipMissionFetch) return Promise.resolve();
    const prev = tasksRef.current ?? [];
    if (!hasMoreTasks || loadingMore) return Promise.resolve();
    setLoadingMore(true);
    const offset = prev.length;
    return getPropertyTasks({ limit: TASK_MISSION_PAGE_SIZE, offset })
      .then((page) => {
        if (!page || typeof page !== 'object' || Array.isArray(page)) return;
        const chunk = page.tasks || [];
        const existing = new Set((prev || []).map((t) => String(t.id)));
        const append = chunk
          .filter((row) => row && !existing.has(String(row.id)))
          .map((row) => applyTaskStatusLock(row, statusLocksRef.current));
        setTasks([...(prev || []), ...append]);
        setHasMoreTasks(Boolean(page.hasMore));
      })
      .catch(() => {})
      .finally(() => setLoadingMore(false));
  }, [skipMissionFetch, hasMoreTasks, loadingMore]);

  /** Background sync — refresh first page + authoritative total; keep deeper scrolled pages merged. */
  const pollTasksQuiet = useCallback((opts = {}) => {
    if (!authToken) return Promise.resolve();
    if (skipMissionFetch) return Promise.resolve();
    if (!opts.force) {
      const now = Date.now();
      if (now - lastQuietPollAtRef.current < TASKS_REFRESH_POLL_MS) {
        return Promise.resolve();
      }
    }
    lastQuietPollAtRef.current = Date.now();
    return Promise.all([
      getPropertyTasks({ limit: TASK_MISSION_PAGE_SIZE, offset: 0 }),
      fetchTaskStatusCounts(),
    ])
      .then(([page, counts]) => {
        if (!page || typeof page !== 'object' || Array.isArray(page)) return;
        const head = (page.tasks || []).map((row) => applyTaskStatusLock(row, statusLocksRef.current));
        const ct = counts && Number.isFinite(Number(counts.total)) ? Number(counts.total) : null;
        if (ct !== null) {
          setTasksTotal(ct);
          setTaskStatusCounts({
            total: ct,
            pending: Number(counts.pending) || 0,
            in_progress: Number(counts.in_progress) || 0,
            done: Number(counts.done) || 0,
          });
        }
        const headLen = head.length;
        setHasMoreTasks(ct !== null ? headLen < ct : Boolean(page.hasMore));
        setTasks((prev) => {
          const p = prev ?? [];
          const tail = p.slice(TASK_MISSION_PAGE_SIZE);
          const headIds = new Set(head.map((t) => String(t.id)));
          const rest = tail.filter((t) => t && !headIds.has(String(t.id)));
          return [...head, ...rest];
        });
      })
      .catch(() => {});
  }, [authToken, skipMissionFetch]);

  const debouncedRefresh = useCallback(() => {
    if (skipMissionFetch) return;
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      pollTasksQuiet();
    }, DEBOUNCE_MS);
  }, [pollTasksQuiet, skipMissionFetch]);

  useEffect(() => {
    if (!authToken || skipMissionFetch) {
      setLoading(false);
      setTasks([]);
      return;
    }
    refresh({ blocking: true });
  }, [authToken, refresh, skipMissionFetch]);

  // Maya explicitly signals that a task was created/completed — force an
  // immediate quiet poll so the board reflects the server state without
  // waiting for the 30-second background interval.
  useEffect(() => {
    if (skipMissionFetch) return undefined;
    const onMayaRefresh = () => pollTasksQuiet({ force: true });
    window.addEventListener('maya-refresh-tasks', onMayaRefresh);
    return () => window.removeEventListener('maya-refresh-tasks', onMayaRefresh);
  }, [skipMissionFetch, pollTasksQuiet]);

  // Cross-tab changes use the normal (throttled) trigger — they are less
  // time-critical and multiple tabs should not pile up simultaneous fetches.
  useEffect(() => {
    if (skipMissionFetch) return undefined;
    return subscribeCrossTabTaskSync(() => setRefreshTrigger((n) => n + 1));
  }, [skipMissionFetch]);

  /** Optimistic board updates from Maya chat / batch API before PATCH returns. */
  useEffect(() => {
    if (skipMissionFetch) return undefined;
    const onSingle = (e) => {
      const { taskId, status } = e?.detail || {};
      if (taskId == null || status == null) return;
      const id = String(taskId);
      setTaskStatusLock(statusLocksRef.current, id, status);
      setTasks((prev) => {
        if (prev == null) return prev;
        return prev.map((t) => (String(t.id) === id ? { ...t, status } : t));
      });
    };
    const onBatch = (e) => {
      const { updates } = e?.detail || {};
      if (!Array.isArray(updates) || !updates.length) return;
      const map = new Map(updates.map((u) => [String(u.taskId), u.status]));
      map.forEach((st, tid) => setTaskStatusLock(statusLocksRef.current, tid, st));
      setTasks((prev) => {
        if (prev == null) return prev;
        return prev.map((t) => (map.has(String(t.id)) ? { ...t, status: map.get(String(t.id)) } : t));
      });
    };
    window.addEventListener('mission-task-local-update', onSingle);
    window.addEventListener('mission-tasks-batch-local-update', onBatch);
    return () => {
      window.removeEventListener('mission-task-local-update', onSingle);
      window.removeEventListener('mission-tasks-batch-local-update', onBatch);
    };
  }, [skipMissionFetch]);

  /** After batch / Maya bulk completion — reload full task list so "הושלם" filter matches server (not only first page). */
  useEffect(() => {
    if (skipMissionFetch) return undefined;
    const onFull = () => {
      const loadId = ++loadRef.current;
      Promise.all([getPropertyTasks({ limit: 0 }), fetchTaskStatusCounts()])
        .then(([list, counts]) => {
          if (loadId !== loadRef.current) return;
          if (!Array.isArray(list)) return;
          setTasks(list.map((row) => applyTaskStatusLock(row, statusLocksRef.current)));
          const t = counts && Number.isFinite(Number(counts.total)) ? Number(counts.total) : list.length;
          setTasksTotal(t);
          if (counts) {
            setTaskStatusCounts({
              total: t,
              pending: Number(counts.pending) || 0,
              in_progress: Number(counts.in_progress) || 0,
              done: Number(counts.done) || 0,
            });
          }
          setHasMoreTasks(false);
        })
        .catch(() => {});
    };
    window.addEventListener('mission-full-tasks-refresh', onFull);
    return () => window.removeEventListener('mission-full-tasks-refresh', onFull);
  }, [skipMissionFetch]);

  /** Cross-tab / Maya events: quiet refetch only (no loading=true) so we do not stack requests or spin "טוען...". */
  useEffect(() => {
    if (skipMissionFetch) return;
    if (refreshTrigger === 0) return;
    pollTasksQuiet({});
  }, [pollTasksQuiet, refreshTrigger, skipMissionFetch]);

  useEffect(() => {
    if (skipMissionFetch) return undefined;
    const unsubs = [
      hotelRealtime.subscribe('task_updated', () => debouncedRefresh()),
      hotelRealtime.subscribe('complaint_created', () => debouncedRefresh()),
      hotelRealtime.subscribe('property_updated', () => debouncedRefresh()),
      hotelRealtime.subscribe('new_guest', () => debouncedRefresh()),
      hotelRealtime.subscribe('maya_event', (data) => {
        const t = data?.type;
        if (t === 'TASK_ASSIGNED' || t === 'GUEST_CREATED' || t === 'TASK_DELAYED') debouncedRefresh();
      }),
    ];
    return () => {
      unsubs.forEach((u) => u());
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [debouncedRefresh, skipMissionFetch]);

  /** TASKS_REFRESH_POLL_MS interval — quiet poll without heavy logs. */
  useEffect(() => {
    if (skipMissionFetch) return undefined;
    tasksPollIntervalRef.current = setInterval(() => {
      pollTasksQuiet({});
    }, TASKS_REFRESH_POLL_MS);
    return () => {
      if (tasksPollIntervalRef.current) {
        clearInterval(tasksPollIntervalRef.current);
        tasksPollIntervalRef.current = null;
      }
    };
  }, [pollTasksQuiet, skipMissionFetch]);

  const prependTask = useCallback((newTask) => {
    if (skipMissionFetch) return;
    if (!newTask?.id) return;
    setTasks((prev) => {
      const p = prev ?? [];
      if (p.some((t) => t.id === newTask.id)) return p;
      return [newTask, ...p];
    });
    syncTotalFromServer().catch(() => {});
  }, [skipMissionFetch, syncTotalFromServer]);

  const updateTaskInList = useCallback((taskId, updater) => {
    setTasks((prev) =>
      (prev ?? []).map((t) => {
        if (t.id !== taskId) return t;
        const n = typeof updater === 'function' ? updater(t) : { ...t, ...updater };
        if (n.status !== t.status) {
          setTaskStatusLock(statusLocksRef.current, taskId, n.status);
        }
        return n;
      })
    );
  }, []);

  /** Header / manual: drop local locks + offline queue, full GET, then DB-backed row total (fixes list vs COUNT drift). */
  const hardRefreshTasks = useCallback(async () => {
    if (skipMissionFetch) return;
    statusLocksRef.current.clear();
    clearTaskUpdateQueue();
    await refresh({ blocking: true });
    await syncTotalFromServer();
  }, [skipMissionFetch, refresh, syncTotalFromServer]);

  const value = {
    tasks: tasks ?? [],
    loading,
    loadingMore,
    hasMoreTasks,
    tasksTotal,
    taskStatusCounts,
    refresh,
    hardRefreshTasks,
    /** Force a full-list quiet merge (same as background poll). */
    quietSyncTasks: () => pollTasksQuiet({ force: true }),
    loadMoreTasks,
    prependTask,
    updateTaskInList,
    /** @deprecated use updateTaskInList — alias for older dashboards */
    updateTaskList: updateTaskInList,
  };
  return <MissionContext.Provider value={value}>{children}</MissionContext.Provider>;
}

export function useMission() {
  const ctx = useContext(MissionContext);
  if (!ctx) {
    throw new Error('useMission must be used within MissionProvider');
  }
  return ctx;
}
