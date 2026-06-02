import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { CalendarCheck, FileText, ChevronDown } from 'lucide-react';
import { updatePropertyTaskStatus, sendMayaCommand, getPropertyStaff, bootstrapOperationalData, fetchDailyPropertyTasksReport } from '../../services/api';
import { API_URL } from '../../utils/apiClient';
import { useProperties } from '../../context/PropertiesContext';
import TaskListErrorBoundary from '../common/TaskListErrorBoundary';
import useStore from '../../store/useStore';
import { useMission } from '../../context/MissionContext';
import { getBazaarHotelRoomCards } from '../../data/bazaarHotelRooms';
import { isLegacyMockHotelTask } from '../../utils/bazaarTasks';
import { maya } from '../../services/agentOrchestrator';
import { toWhatsAppPhone } from '../../utils/phone';
import { taskCalendarSafeStr as safeStr, getTaskCalendarWhatsAppMessage as getWhatsAppMessage } from '../../utils/taskCalendarWhatsApp';
import TaskCalendarTaskCard from './TaskCalendarTaskCard';
import { missionTaskIsInProgress, missionTaskIsSeen, missionTaskIsDone } from '../../utils/taskCalendarStatus';
import { TaskBoardSkeleton } from '../common/DashboardSkeletons';
import './TaskCalendar.css';

export default function TaskCalendar() {
  const {
    tasks,
    loading,
    loadingMore,
    hasMoreTasks,
    tasksTotal,
    taskStatusCounts,
    prependTask,
    updateTaskInList,
    loadMoreTasks,
  } = useMission();
  const { properties } = useProperties();
  const [filter, setFilter] = useState('all'); // 'all' | 'pending' | 'completed'
  const [propertyFilter, setPropertyFilter] = useState('all'); // 'all' | property name
  const [reportLoading, setReportLoading] = useState(false);
  const [managementLoading, setManagementLoading] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState(null);
  const lang = useStore((s) => s.lang) || 'en';
  const activeTenantId = useStore((s) => s.activeTenantId);
  const isBazaarPilot = activeTenantId === 'BAZAAR_JAFFA';
  const setLastSelectedTask = useStore((s) => s.setLastSelectedTask);
  const toggleMayaChat = useStore((s) => s.toggleMayaChat);
  const addMayaMessage = useStore((s) => s.addMayaMessage);
  const addNotification = useStore((s) => s.addNotification);


  const [highlightedTaskId, setHighlightedTaskId] = useState(null);
  const taskListWrapRef = useRef(null);

  useEffect(() => {
    const onBatch = (e) => {
      const { updates } = e?.detail || {};
      if (!Array.isArray(updates)) return;
      if (updates.some((u) => String(u.status || '').toLowerCase() === 'done')) {
        setFilter('completed');
      }
    };
    window.addEventListener('mission-tasks-batch-local-update', onBatch);
    return () => window.removeEventListener('mission-tasks-batch-local-update', onBatch);
  }, []);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await bootstrapOperationalData();
      } catch (_) {
        /* server may have seeded on startup */
      }
      if (!cancelled) window.dispatchEvent(new Event('maya-refresh-tasks'));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onTaskCreated = (e) => {
      const newTask = e?.detail?.task;
      if (newTask && newTask.id) {
        const descFallback = safeStr(newTask.description ?? newTask.title ?? newTask.task_type ?? newTask.content) || 'ביצוע משימה';
        const propFallback = safeStr(newTask.property_name ?? newTask.room ?? newTask.room_number) || 'חדר לא ידוע';
        const staffFallback = safeStr(newTask.staff_name ?? newTask.worker_name) || 'לא ידוע';
        const taskWithActions = {
          ...newTask,
          description:   descFallback,
          title:         descFallback,
          property_name: propFallback,
          staff_name:    staffFallback,
          worker_name:   staffFallback,
          status: newTask.status || 'Pending',
          actions: newTask.actions || [{ label: 'ראיתי ✅', value: 'seen' }, { label: 'בוצע 🏁', value: 'done' }],
        };
        prependTask(taskWithActions);
        setHighlightedTaskId(newTask.id);
        setTimeout(() => setHighlightedTaskId(null), 2500);
      }
    };
    window.addEventListener('maya-task-created', onTaskCreated);
    return () => window.removeEventListener('maya-task-created', onTaskCreated);
  }, [prependTask]);

  const [togglingId, setTogglingId] = useState(null);
  const [cleanerLoading, setCleanerLoading] = useState({});
  const [undoOffer, setUndoOffer] = useState(null);
  const undoTimerRef = useRef(null);

  useEffect(() => () => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
  }, []);

  const openPropertyCleanerWhatsApp = useCallback(async (t, e) => {
    e.stopPropagation();
    const pid = t.property_id;
    if (!pid) return;
    const tid = t.id;
    setCleanerLoading((m) => ({ ...m, [tid]: true }));
    try {
      let staff = await getPropertyStaff(pid, { role: 'cleaning' });
      if (!staff?.length) staff = await getPropertyStaff(pid);
      const withPhone = (staff || []).find((s) => (s.phone_number || s.phone || '').trim());
      const phone = withPhone?.phone_number || withPhone?.phone;
      if (!phone) {
        window.alert('לא נמצא טלפון לניקיון בנכס. הוסיפו עובד ניקיון ב״Staff & Planner״.');
        return;
      }
      const msg = getWhatsAppMessage(t);
      const digits = toWhatsAppPhone(phone);
      window.open(`https://wa.me/${digits}?text=${encodeURIComponent(msg)}`, '_blank', 'noopener,noreferrer');
    } finally {
      setCleanerLoading((m) => ({ ...m, [tid]: false }));
    }
  }, []);
  const handleUndoMarkDone = useCallback(async () => {
    if (!undoOffer) return;
    const { taskId, revertTo } = undoOffer;
    if (undoTimerRef.current) {
      clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
    setUndoOffer(null);
    updateTaskInList(taskId, (t) => ({ ...t, status: revertTo }));
    setTogglingId(null);
    try {
      const res = await updatePropertyTaskStatus(taskId, revertTo);
      if (res?.queued) {
        addNotification({
          type: 'info',
          title: 'מאיה',
          message: 'השינוי נשמר מקומית — יסונכרן כשהחיבור חוזר',
        });
      }
    } catch (e) {
      updateTaskInList(taskId, (t) => ({ ...t, status: 'Done' }));
      window.alert(e?.message || 'עדכון נכשל');
    }
  }, [undoOffer, updateTaskInList, addNotification]);

  const handleToggleStatus = useCallback(async (taskId, newStatus, task) => {
    if (!taskId) return;

    if (undoOffer && undoOffer.taskId !== taskId) {
      if (undoTimerRef.current) {
        clearTimeout(undoTimerRef.current);
        undoTimerRef.current = null;
      }
      setUndoOffer(null);
    }
    if (undoOffer && undoOffer.taskId === taskId && newStatus !== 'Done') {
      if (undoTimerRef.current) {
        clearTimeout(undoTimerRef.current);
        undoTimerRef.current = null;
      }
      setUndoOffer(null);
    }

    const prevStatus = task?.status;
    const staffName = (task?.staff_name ?? task?.staffName ?? 'העובד').trim() || 'העובד';
    updateTaskInList(taskId, (t) => ({ ...t, status: newStatus }));
    if (String(newStatus).toLowerCase() === 'done') {
      setFilter('completed');
    }
    setTogglingId(null);
    try {
      const res = await updatePropertyTaskStatus(taskId, newStatus);
      if (res?.queued) {
        addNotification({
          type: 'info',
          title: 'מאיה',
          message: 'העדכון נשמר מקומית ויסונכרן כשהחיבור חוזר',
        });
      }
      if (newStatus === 'Done') {
        if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
        setUndoOffer({
          taskId,
          revertTo: prevStatus && String(prevStatus).toLowerCase() !== 'done' ? prevStatus : 'In_Progress',
        });
        undoTimerRef.current = setTimeout(() => {
          undoTimerRef.current = null;
          setUndoOffer((cur) => (cur?.taskId === taskId ? null : cur));
        }, 5000);
      }
      if (newStatus === 'In_Progress') {
        try {
          await fetch(`${API_URL}/staff/acknowledge`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ task_id: taskId, staff_name: staffName }),
          });
        } catch (_) { /* non-critical */ }
        addMayaMessage({ role: 'assistant', content: `${staffName} אישר את המשימה ✅ הטיימר הופסק.` });
        toggleMayaChat(true);
      } else if (newStatus === 'Done') {
        addMayaMessage({ role: 'assistant', content: `${staffName} סיים את המשימה ✅` });
        addNotification({ type: 'success', title: 'מאיה', message: `${staffName} סיים את המשימה` });
        toggleMayaChat(true);
      }
    } catch (e) {
      updateTaskInList(taskId, (t) => ({ ...t, status: prevStatus }));
      setUndoOffer((cur) => (cur?.taskId === taskId ? null : cur));
      window.alert(e?.message || 'עדכון נכשל');
    }
  }, [addMayaMessage, addNotification, toggleMayaChat, updateTaskInList, undoOffer]);

  const isDone = (task) => missionTaskIsDone(task);
  const isInProgress = (task) => missionTaskIsInProgress(task);
  const isSeen = (task) => missionTaskIsSeen(task);

  const filteredTasks = (tasks ?? []).filter((t) => {
    if (isLegacyMockHotelTask(t)) return false;
    if ((t?.status || '').toLowerCase() === 'archived') return false;
    // Status filter
    if (filter === 'pending' && isDone(t)) return false;
    if (filter === 'completed' && !isDone(t)) return false;
    // Property filter
    if (propertyFilter !== 'all') {
      const pName = (t.property_name ?? t.propertyName ?? '').toString().trim();
      if (pName !== propertyFilter) return false;
    }
    return true;
  });

  /** True when due_at is within the next 4 hours — pins to top via urgency score */
  const isCheckinSoonPinned = (t) => {
    if (isDone(t) || !t?.due_at) return false;
    const due = new Date(t.due_at);
    if (Number.isNaN(due.getTime())) return false;
    const hours = (due.getTime() - Date.now()) / 3600000;
    return hours >= 0 && hours <= 4;
  };

  /** Urgency score: imminent check-in due_at > room ready / check-in prep > leaks/urgent > cleaning */
  const taskUrgencyScore = (t) => {
    if (isCheckinSoonPinned(t)) return 300;
    const d = safeStr(t.description ?? t.title ?? t.content).toLowerCase();
    const tt = (t.task_type || '').toLowerCase();
    if (t?.due_at && !isDone(t)) {
      const due = new Date(t.due_at);
      if (!Number.isNaN(due.getTime())) {
        const hours = (due.getTime() - Date.now()) / 3600000;
        if (hours > 0 && hours <= 24) return 120;
      }
    }
    if (/check-in|צ'ק-אין|checkin|room ready|הכנה|מוכן לצ|מוכן לחדר|אורח מגיע/.test(d)) return 100;
    if (/דחוף|urgent|קריטי|דליפה|leak|flood|מים/.test(d)) return 92;
    if (tt === 'cleaning' || (t.task_type || '') === 'ניקיון חדר' || /ניקיון|clean|מיטה|מצעים/.test(d)) return 75;
    if (/lightbulb|נורה|תאורה|lamp|מנורה|מפסק/.test(d)) return 28;
    if (/דחוף/.test(d)) return 85;
    return 50;
  };

  const sortedTasks = [...filteredTasks].sort((a, b) => {
    const sa = taskUrgencyScore(a);
    const sb = taskUrgencyScore(b);
    if (sb !== sa) return sb - sa;
    // Newest-first within the same urgency tier: descending created_at.
    // ISO-8601 strings sort lexicographically, so reversing localeCompare
    // gives correct newest-first without a Date parse on every comparison.
    const ta = safeStr(a.created_at || a.due_at || '');
    const tb = safeStr(b.created_at || b.due_at || '');
    return tb.localeCompare(ta);
  });
  const tasksForDisplay = sortedTasks;

  const TASK_RENDER_BATCH = 48;
  const [renderLimit, setRenderLimit] = useState(TASK_RENDER_BATCH);
  const filterScrollKey = `${filter}\0${propertyFilter}`;
  const filterScrollKeyRef = useRef(filterScrollKey);
  useEffect(() => {
    if (filterScrollKeyRef.current !== filterScrollKey) {
      filterScrollKeyRef.current = filterScrollKey;
      setRenderLimit(TASK_RENDER_BATCH);
    }
  }, [filterScrollKey]);

  useEffect(() => {
    setRenderLimit((l) => Math.min(l, Math.max(tasksForDisplay.length, TASK_RENDER_BATCH)));
  }, [tasksForDisplay.length]);

  const visibleTasks = useMemo(
    () => tasksForDisplay.slice(0, Math.min(renderLimit, tasksForDisplay.length)),
    [tasksForDisplay, renderLimit],
  );

  const renderBatchSentinelRef = useRef(null);
  const canShowMoreCards = visibleTasks.length < tasksForDisplay.length;
  useEffect(() => {
    const el = renderBatchSentinelRef.current;
    if (!el || !canShowMoreCards) return undefined;
    const ob = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setRenderLimit((n) => Math.min(n + TASK_RENDER_BATCH, tasksForDisplay.length));
        }
      },
      { root: null, rootMargin: '400px', threshold: 0 },
    );
    ob.observe(el);
    return () => ob.disconnect();
  }, [canShowMoreCards, tasksForDisplay.length, renderLimit]);

  /** Fetch next server page when the virtualized list has caught up and more rows exist remotely. */
  const apiPageSentinelRef = useRef(null);
  const needApiPage =
    hasMoreTasks &&
    !loadingMore &&
    !canShowMoreCards &&
    visibleTasks.length >= tasksForDisplay.length &&
    tasksForDisplay.length > 0;
  useEffect(() => {
    const el = apiPageSentinelRef.current;
    if (!el || !needApiPage) return undefined;
    const ob = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) loadMoreTasks();
      },
      { root: null, rootMargin: '600px', threshold: 0 },
    );
    ob.observe(el);
    return () => ob.disconnect();
  }, [needApiPage, loadMoreTasks, tasksForDisplay.length, visibleTasks.length]);

  const barFromSql =
    Number(taskStatusCounts?.total) === Number(tasksTotal) && Number(tasksTotal) >= 0;
  const totalCount = tasksTotal > 0 ? tasksTotal : tasks?.length ?? 0;
  const inProgressCount = barFromSql
    ? Number(taskStatusCounts.in_progress) || 0
    : tasks.filter((t) => isInProgress(t) || isSeen(t)).length;
  const completedCount = barFromSql
    ? Number(taskStatusCounts.done) || 0
    : tasks.filter((t) => isDone(t)).length;

  const handleManagementAnalysis = useCallback(async () => {
    setManagementLoading(true);
    try {
      const tasksForAnalysis = (tasks ?? []).map((t) => ({
        desc: safeStr(t.description ?? t.title ?? t.content),
        staff: safeStr(t.staff_name ?? t.staffName),
        property: safeStr(t.property_name ?? t.propertyName),
        status: t.status || 'Pending',
      }));
      const result = await sendMayaCommand('בוא נראה אותה מנהלת', tasksForAnalysis, [], lang);
      toggleMayaChat(true);
      addMayaMessage({
        role: 'assistant',
        content: result?.displayMessage ?? result?.message ?? 'ניתוח הושלם.',
      });
    } catch (e) {
      toggleMayaChat(true);
      addMayaMessage({
        role: 'assistant',
        content: `שגיאה: ${e?.message || 'לא ניתן לנתח כרגע'}`,
        isError: true,
      });
    } finally {
      setManagementLoading(false);
    }
  }, [tasks, toggleMayaChat, addMayaMessage, lang]);

  const handleDailyReport = useCallback(async () => {
    setReportLoading(true);
    try {
      const report = await fetchDailyPropertyTasksReport();
      const base = report?.summary_text || 'אין נתונים לדוח.';
      let content = base;
      try {
        const refined = await maya.processCommand(
          `זהו דוח נתונים גולמי מהמערכת (24 שעות אחרונות). נסח אותו בשני פסקאות קצרות בעברית מקצועית לבעל נכס, בלי לשנות מספרים או לשבח את המערכת:\n\n${base}`,
        );
        content = refined?.displayMessage ?? refined?.message ?? base;
      } catch (_) {
        content = base;
      }
      toggleMayaChat(true);
      addMayaMessage({ role: 'assistant', content });
    } catch (e) {
      toggleMayaChat(true);
      addMayaMessage({
        role: 'assistant',
        content: `שגיאה: ${e?.message || 'לא ניתן להפיק דוח כרגע'}`,
        isError: true,
      });
    } finally {
      setReportLoading(false);
    }
  }, [toggleMayaChat, addMayaMessage]);

  const bazaarImageFallback =
    'https://images.unsplash.com/photo-1613977257363-707ba9348227?w=800&q=80';

  if (isBazaarPilot) {
    const bazaarRooms = getBazaarHotelRoomCards();
    return (
      <div className="task-calendar task-calendar--bazaar p-10 bg-[#FBFBFB] min-h-screen" dir="rtl">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6 mb-10">
          <div className="flex items-center gap-3">
            <div className="w-14 h-14 rounded-2xl bg-amber-100 flex items-center justify-center">
              <CalendarCheck size={28} className="text-amber-600" />
            </div>
            <div>
              <h1 className="text-3xl font-black text-gray-900">לוח משימות</h1>
              <p className="text-gray-500 mt-1">מלון בזאר יפו — חדרים לפי סוג (Superior, Deluxe וכו׳). תמונות: public/assets/images/hotels/bazaar</p>
            </div>
          </div>
        </div>
        <div className="bazaar-hotel-grid">
          {bazaarRooms.map((room) => (
            <div key={room.id} className="bazaar-hotel-card">
              <div className="bazaar-hotel-card-thumb">
                <img
                  src={room.imageSrc}
                  alt=""
                  loading="lazy"
                  onError={(e) => {
                    e.currentTarget.src = bazaarImageFallback;
                  }}
                />
              </div>
              <p className="bazaar-hotel-card-label">{room.labelHe}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="task-calendar p-10 bg-[#FBFBFB] min-h-screen" dir="rtl">
      <div className="task-status-bar">
        <span className="task-status-total">
          <strong>{totalCount}</strong> משימות סה"כ
        </span>
        <span className="task-status-in-progress">
          <strong>{inProgressCount}</strong> בתהליך
        </span>
        <span className="task-status-completed">
          <strong>{completedCount}</strong> הושלמו
        </span>
      </div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6 mb-10">
        <div className="flex items-center gap-3">
          <div className="w-14 h-14 rounded-2xl bg-amber-100 flex items-center justify-center">
            <CalendarCheck size={28} className="text-amber-600" />
          </div>
          <div>
            <h1 className="text-3xl font-black text-gray-900">לוח משימות</h1>
            <p className="text-gray-500 mt-1">משימות שנוצרו על ידי מאיה – ניקיון, תחזוקה ושירות</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {/* Property dropdown */}
          <div className="task-property-select-wrap">
            <ChevronDown size={14} className="task-property-select-icon" aria-hidden="true" />
            <select
              className="task-property-select"
              value={propertyFilter}
              onChange={(e) => setPropertyFilter(e.target.value)}
              aria-label="סנן לפי נכס"
            >
              <option value="all">כל הנכסים</option>
              {properties.map((p) => (
                <option key={p.id ?? p.name} value={(p.name ?? '').toString()}>
                  {p.name}
                </option>
              ))}
              {/* Also show any property names found in tasks but not in the properties list */}
              {[...new Set((tasks ?? [])
                .map((t) => (t.property_name ?? t.propertyName ?? '').toString().trim())
                .filter(Boolean)
              )]
                .filter((n) => !properties.some((p) => p.name === n))
                .map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))
              }
            </select>
          </div>

          <div className="task-calendar-filters">
            <button
              type="button"
              className={`task-filter-btn ${filter === 'all' ? 'active' : ''}`}
              onClick={() => setFilter('all')}
            >
              הכל
            </button>
            <button
              type="button"
              className={`task-filter-btn ${filter === 'pending' ? 'active' : ''}`}
              onClick={() => setFilter('pending')}
            >
              ממתין
            </button>
            <button
              type="button"
              className={`task-filter-btn ${filter === 'completed' ? 'active' : ''}`}
              onClick={() => setFilter('completed')}
            >
              הושלם
            </button>
          </div>
          <button
            type="button"
            onClick={handleManagementAnalysis}
            disabled={managementLoading}
            className="task-management-btn"
            title="מאיה מנתחת את הלוח ומציעה תזכורות"
          >
            {managementLoading ? 'מנתחת...' : 'בוא נראה אותה מנהלת'}
          </button>
          <button
            type="button"
            onClick={handleDailyReport}
            disabled={reportLoading}
            className="task-daily-report-btn"
          >
            <FileText size={18} />
            {reportLoading ? 'מייצר...' : 'דוח יומי'}
          </button>
        </div>
      </div>

      <TaskListErrorBoundary>
      {loading ? (
        <TaskBoardSkeleton rows={8} />
      ) : filteredTasks.length === 0 ? (
        <div className="task-calendar-empty bg-white rounded-2xl p-12 text-center border border-gray-100">
          <CalendarCheck size={48} className="text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500 font-bold">אין משימות כרגע</p>
          <p className="text-sm text-gray-400 mt-1">כשמאיה תשלח הודעה לעובד, המשימה תופיע כאן</p>
        </div>
      ) : (
        <div ref={taskListWrapRef} className="task-calendar-virtual-host">
          <div className="task-calendar-grid">
            {visibleTasks.map((t, index) => {
              const cardKey =
                t?.id != null && typeof t.id !== 'object' ? String(t.id) : `task-${index}`;
              return (
                <TaskCalendarTaskCard
                  key={cardKey}
                  task={t}
                  properties={properties}
                  highlightedTaskId={highlightedTaskId}
                  setLastSelectedTask={setLastSelectedTask}
                  setLightboxUrl={setLightboxUrl}
                  cleanerLoading={cleanerLoading}
                  openPropertyCleanerWhatsApp={openPropertyCleanerWhatsApp}
                  handleUndoMarkDone={handleUndoMarkDone}
                  handleToggleStatus={handleToggleStatus}
                  togglingId={togglingId}
                  undoOffer={undoOffer}
                />
              );
            })}
          </div>
          {canShowMoreCards ? (
            <div ref={renderBatchSentinelRef} className="task-calendar-scroll-sentinel" aria-hidden style={{ minHeight: 24 }} />
          ) : null}
          {needApiPage ? (
            <div ref={apiPageSentinelRef} className="task-calendar-scroll-sentinel" aria-hidden style={{ minHeight: 32 }} />
          ) : null}
          {loadingMore ? (
            <p className="text-xs text-slate-500 py-3 text-center" dir="rtl">טוען משימות נוספות…</p>
          ) : null}
        </div>
      )}
      </TaskListErrorBoundary>

      {/* ── Photo Lightbox ───────────────────────────────────────── */}
      {lightboxUrl && (
        <div className="tc-lightbox-backdrop" onClick={() => setLightboxUrl(null)}>
          <div className="tc-lightbox" onClick={e => e.stopPropagation()}>
            <button className="tc-lightbox-close" onClick={() => setLightboxUrl(null)}>✕</button>
            <img
              src={lightboxUrl}
              alt="תמונת משימה מוגדלת"
              className="tc-lightbox-img"
              onError={e => { e.currentTarget.alt = 'תמונה לא נמצאה'; }}
            />
            <a
              href={lightboxUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="tc-lightbox-open"
            >פתח בחלון חדש ↗</a>
          </div>
        </div>
      )}
    </div>
  );
}
