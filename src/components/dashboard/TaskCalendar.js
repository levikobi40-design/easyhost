import React, { useState, useEffect, useCallback, useRef } from 'react';
import { CalendarCheck, Phone, CheckCircle, MessageCircle, FileText } from 'lucide-react';
import { toWhatsAppPhone, getTaskWhatsAppPhone } from '../../utils/phone';
import { getPropertyTasks, updatePropertyTaskStatus, sendMayaCommand } from '../../services/api';
import TaskListErrorBoundary from '../common/TaskListErrorBoundary';
import useStore from '../../store/useStore';
import { maya } from '../../services/agentOrchestrator';
import './TaskCalendar.css';

/** Always return a string for rendering - prevents [object Object] crash */
const safeStr = (val, fallback = '') => {
  if (val == null) return fallback;
  if (typeof val === 'string') return val;
  if (typeof val === 'object') return safeStr(val.content ?? val.title ?? val.text, fallback);
  return String(val);
};

/** Build WhatsApp message by staff. Alma: 'היי עלמה, יש בקשה חדשה מחדר X בנכס Y. אנא טפלי בהקדם!' */
const getWhatsAppMessage = (t) => {
  const content = safeStr(t.description ?? t.title ?? t.content).slice(0, 120);
  const property = safeStr(t.property_name ?? t.propertyName);
  const staff = ((t.staff_name ?? t.staffName) || '').toString().toLowerCase();
  if (staff.includes('alma') || staff.includes('עלמה')) {
    const roomMatch = content.match(/חדר\s*(\d+)|room\s*(\d+)|(\d+)/i) || [];
    const room = roomMatch[1] || roomMatch[2] || roomMatch[3] || '—';
    const propName = property || 'הנכס';
    return `היי עלמה, יש בקשה חדשה מחדר ${room} בנכס ${propName}. אנא טפלי בהקדם!`;
  }
  if (staff.includes('kobi') || staff.includes('קובי')) {
    return property ? `היי קובי, יש לך משימה: ${content} ב${property}` : `היי קובי, יש לך משימה: ${content}`;
  }
  if (staff.includes('avi') || staff.includes('אבי')) {
    return property ? `היי אבי, יש לך משימה: ${content} ב${property}` : `היי אבי, יש לך משימה: ${content}`;
  }
  return `היי ${safeStr(t.staff_name ?? t.staffName) || 'שם'}, יש לך משימה: ${content}`;
};

export default function TaskCalendar() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all'); // 'all' | 'pending' | 'completed'
  const [reportLoading, setReportLoading] = useState(false);
  const [managementLoading, setManagementLoading] = useState(false);
  const loadRef = useRef(0);
  const setLastSelectedTask = useStore((s) => s.setLastSelectedTask);
  const toggleMayaChat = useStore((s) => s.toggleMayaChat);
  const addMayaMessage = useStore((s) => s.addMayaMessage);
  const addNotification = useStore((s) => s.addNotification);

  useEffect(() => {
    let cancelled = false;
    const loadId = ++loadRef.current;
    setLoading(true);
    getPropertyTasks()
      .then((list) => {
        if (!cancelled && loadId === loadRef.current) {
          setTasks(Array.isArray(list) ? list : []);
        }
      })
      .catch(() => {
        if (!cancelled && loadId === loadRef.current) setTasks([]);
      })
      .finally(() => {
        if (!cancelled && loadId === loadRef.current) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const [highlightedTaskId, setHighlightedTaskId] = useState(null);
  useEffect(() => {
    const onTaskCreated = (e) => {
      const newTask = e?.detail?.task;
      if (newTask && newTask.id) {
        const taskWithActions = {
          ...newTask,
          status: newTask.status || 'Pending',
          actions: newTask.actions || [{ label: 'ראיתי ✅', value: 'seen' }, { label: 'בוצע 🏁', value: 'done' }],
        };
        setTasks((prev) => {
          if (prev.some((t) => t.id === newTask.id)) return prev;
          return [taskWithActions, ...prev];
        });
        setHighlightedTaskId(newTask.id);
        setTimeout(() => setHighlightedTaskId(null), 2500);
        getPropertyTasks()
          .then((list) => {
            setTasks((prev) => {
              const merged = Array.isArray(list) ? list : [];
              const hasNew = merged.some((t) => t.id === newTask.id);
              if (!hasNew) return [taskWithActions, ...merged];
              return merged;
            });
          })
          .catch(() => {});
      }
    };
    window.addEventListener('maya-task-created', onTaskCreated);
    return () => window.removeEventListener('maya-task-created', onTaskCreated);
  }, []);

  const [togglingId, setTogglingId] = useState(null);
  const handleToggleStatus = useCallback(async (taskId, newStatus, task) => {
    if (!taskId) return;
    setTogglingId(taskId);
    let prevStatus;
    const staffName = (task?.staff_name ?? task?.staffName ?? 'העובד').trim() || 'העובד';
    setTasks((prev) => {
      const t = prev.find((x) => x.id === taskId);
      prevStatus = t?.status;
      return prev.map((x) => (x.id === taskId ? { ...x, status: newStatus } : x));
    });
    try {
      await updatePropertyTaskStatus(taskId, newStatus);
      if (newStatus === 'Seen') {
        addMayaMessage({ role: 'assistant', content: `${staffName} אישר את המשימה` });
        toggleMayaChat(true);
      } else if (newStatus === 'Done') {
        addMayaMessage({ role: 'assistant', content: `${staffName} סיים את המשימה ✅` });
        addNotification({ type: 'success', title: 'מאיה', message: `${staffName} סיים את המשימה` });
        toggleMayaChat(true);
      }
    } catch (e) {
      setTasks((prev) =>
        prev.map((x) => (x.id === taskId ? { ...x, status: prevStatus } : x))
      );
      window.alert(e?.message || 'Failed to update');
    } finally {
      setTogglingId(null);
    }
  }, [addMayaMessage, addNotification, toggleMayaChat]);

  const isDone = (task) => (task?.status || '').toLowerCase() === 'done';
  const isSeen = (task) => (task?.status || '').toLowerCase() === 'seen';

  const formatDate = (str) => {
    if (!str) return '—';
    try {
      const d = new Date(str);
      return d.toLocaleDateString('he-IL', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return str;
    }
  };

  const filteredTasks = (tasks ?? []).filter((t) => {
    if (filter === 'pending') return !isDone(t);
    if (filter === 'completed') return isDone(t);
    return true;
  });

  /** Smart sort: urgent keywords (דחוף, קריטי, דליפה) first */
  const urgentKeywords = /דחוף|קריטי|דליפה|urgent|critical|leak/i;
  const sortedTasks = [...filteredTasks].sort((a, b) => {
    const descA = safeStr(a.description ?? a.title ?? a.content);
    const descB = safeStr(b.description ?? b.title ?? b.content);
    const aUrgent = urgentKeywords.test(descA);
    const bUrgent = urgentKeywords.test(descB);
    if (aUrgent && !bUrgent) return -1;
    if (!aUrgent && bUrgent) return 1;
    return 0;
  });

  const totalCount = tasks.length;
  const inProgressCount = tasks.filter((t) => !isDone(t)).length;
  const completedCount = tasks.filter((t) => isDone(t)).length;

  const handleManagementAnalysis = useCallback(async () => {
    setManagementLoading(true);
    try {
      const tasksForAnalysis = (tasks ?? []).map((t) => ({
        desc: safeStr(t.description ?? t.title ?? t.content),
        staff: safeStr(t.staff_name ?? t.staffName),
        property: safeStr(t.property_name ?? t.propertyName),
        status: t.status || 'Pending',
      }));
      const result = await sendMayaCommand('בוא נראה אותה מנהלת', tasksForAnalysis);
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
  }, [tasks, toggleMayaChat, addMayaMessage]);

  const handleDailyReport = useCallback(async () => {
    setReportLoading(true);
    try {
      const result = await maya.processCommand('Generate daily report - summarize tasks done today and what is left for tomorrow');
      toggleMayaChat(true);
      addMayaMessage({
        role: 'assistant',
        content: result?.displayMessage ?? result?.message ?? 'Report generated.',
      });
    } catch (e) {
      toggleMayaChat(true);
      addMayaMessage({
        role: 'assistant',
        content: `Error: ${e?.message || 'Could not generate report'}`,
        isError: true,
      });
    } finally {
      setReportLoading(false);
    }
  }, [toggleMayaChat, addMayaMessage]);

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
        <p className="text-gray-400 py-12 text-center">טוען משימות...</p>
      ) : filteredTasks.length === 0 ? (
        <div className="task-calendar-empty bg-white rounded-2xl p-12 text-center border border-gray-100">
          <CalendarCheck size={48} className="text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500 font-bold">אין משימות כרגע</p>
          <p className="text-sm text-gray-400 mt-1">כשמאיה תשלח הודעה לעובד, המשימה תופיע כאן</p>
        </div>
      ) : (
        <div className="task-calendar-grid">
          {sortedTasks.map((t, i) => (
            <div
              key={t?.id != null && typeof t.id !== 'object' ? String(t.id) : `task-${i}`}
              className={`task-card ${isDone(t) ? 'task-done' : isSeen(t) ? 'task-seen' : 'task-pending'} ${highlightedTaskId === t.id ? 'task-card-pop' : ''}`}
              onClick={() => setLastSelectedTask(t)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && setLastSelectedTask(t)}
            >
              <div className="task-card-header">
                <span className={`task-status-badge ${isDone(t) ? 'done' : isSeen(t) ? 'seen' : 'pending'}`}>
                  {isDone(t) ? 'הושלם' : isSeen(t) ? 'ראיתי' : 'ממתין'}
                </span>
                <span className="task-date">{formatDate(t.created_at)}</span>
              </div>
              <p className="task-description">{safeStr(t.description) || safeStr(t.title) || safeStr(t.content) || ''}</p>
              {safeStr(t.property_context) && (
                <p className="text-xs text-gray-500 mt-0.5">{safeStr(t.property_context)}</p>
              )}
              <div className="task-meta">
                {(t.property_name ?? t.propertyName) && (
                  <div className="task-meta-row">
                    <span className="task-meta-icon" aria-hidden>🏠</span>
                    <span>{safeStr(t.property_name ?? t.propertyName)}</span>
                  </div>
                )}
                {(t.staff_name ?? t.staffName) && (
                  <div className="task-meta-row flex items-center gap-2">
                    <span className="task-meta-icon" aria-hidden>👤</span>
                    <span>{safeStr(t.staff_name ?? t.staffName)}</span>
                    {((t.staff_phone ?? t.staffPhone) || getTaskWhatsAppPhone(t)) && (
                      <>
                        <a href={`tel:+${getTaskWhatsAppPhone(t) || toWhatsAppPhone(t.staff_phone ?? t.staffPhone)}`} className="task-phone-link" title="Call" onClick={(e) => e.stopPropagation()}>
                          <Phone size={14} />
                        </a>
                        <a
                          href={`https://wa.me/${getTaskWhatsAppPhone(t) || toWhatsAppPhone(t.staff_phone ?? t.staffPhone)}?text=${encodeURIComponent(getWhatsAppMessage(t))}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="task-whatsapp-btn"
                          title="שליחת וואטסאפ"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <MessageCircle size={22} />
                        </a>
                      </>
                    )}
                  </div>
                )}
                {((t.staff_phone ?? t.staffPhone) || getTaskWhatsAppPhone(t)) && !(t.staff_name ?? t.staffName) && (
                  <div className="task-meta-row task-phone">
                    <Phone size={16} />
                    <a href={`tel:${safeStr(t.staff_phone ?? t.staffPhone).replace(/\D/g, '')}`} className="task-phone-link" onClick={(e) => e.stopPropagation()}>{safeStr(t.staff_phone ?? t.staffPhone)}</a>
                    <a href={`https://wa.me/${getTaskWhatsAppPhone(t) || toWhatsAppPhone(t.staff_phone ?? t.staffPhone)}?text=${encodeURIComponent(getWhatsAppMessage(t))}`} target="_blank" rel="noopener noreferrer" className="task-whatsapp-btn" title="שליחת וואטסאפ" onClick={(e) => e.stopPropagation()}>
                      <MessageCircle size={22} />
                    </a>
                  </div>
                )}
              </div>
              <div className="task-card-actions" onClick={(e) => e.stopPropagation()}>
                {!isDone(t) && (
                  <>
                    {(t.actions || [{ label: 'ראיתי ✅', value: 'confirmed' }, { label: 'בוצע 🏁', value: 'done' }])
                      .filter((a) => (a.value === 'confirmed' && !isSeen(t)) || a.value === 'done')
                      .map((a) => {
                        const status = a.value === 'confirmed' ? 'Seen' : 'Done';
                        const isConfirm = a.value === 'confirmed';
                        return (
                          <button
                            key={a.value}
                            type="button"
                            disabled={togglingId === t.id}
                            onClick={() => handleToggleStatus(t.id, status, t)}
                            className={`task-action-btn ${isConfirm ? 'task-action-seen' : 'task-action-done'} ${togglingId === t.id ? 'loading' : ''}`}
                            title={isConfirm ? 'אישור קבלה' : 'סמן כהושלם'}
                          >
                            {togglingId === t.id ? <span className="task-toggle-spinner" /> : a.label}
                          </button>
                        );
                      })}
                  </>
                )}
                {isDone(t) && (
                  <button
                    type="button"
                    disabled={togglingId === t.id}
                    onClick={() => handleToggleStatus(t.id, 'Pending', t)}
                    className={`task-action-btn task-action-revert ${togglingId === t.id ? 'loading' : ''}`}
                    title="חזרה לממתין"
                  >
                    {togglingId === t.id ? <span className="task-toggle-spinner" /> : 'חזרה לממתין'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      </TaskListErrorBoundary>
    </div>
  );
}
