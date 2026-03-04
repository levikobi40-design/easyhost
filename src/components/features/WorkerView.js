import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  CheckCircle2, Loader2, BedDouble, User, Clock,
  AlertCircle, Phone, MessageCircle, CalendarDays,
  RefreshCw, ListTodo,
} from 'lucide-react';
import { API_URL } from '../../utils/apiClient';
import './WorkerView.css';

const MAYA_AVATAR = 'https://api.dicebear.com/7.x/personas/svg?seed=MayaManager&backgroundColor=25D366';
const REFRESH_MS  = 30_000; // auto-refresh every 30 s

const STATUS_CONFIG = {
  Pending:   { label: 'ממתין לטיפול', color: '#f59e0b', bg: '#fef3c7' },
  pending:   { label: 'ממתין לטיפול', color: '#f59e0b', bg: '#fef3c7' },
  Accepted:  { label: 'בטיפול',        color: '#3b82f6', bg: '#dbeafe' },
  accepted:  { label: 'בטיפול',        color: '#3b82f6', bg: '#dbeafe' },
  assigned:  { label: 'שויך',           color: '#8b5cf6', bg: '#ede9fe' },
  Done:      { label: 'הושלם ✓',        color: '#16a34a', bg: '#dcfce7' },
  done:      { label: 'הושלם ✓',        color: '#16a34a', bg: '#dcfce7' },
  Completed: { label: 'הושלם ✓',        color: '#16a34a', bg: '#dcfce7' },
};

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' })
       + ' · '
       + d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
}

function isPending(s) {
  return ['Pending', 'pending', 'assigned'].includes(s);
}

// Extract workerId from path: /worker/levikobi → "levikobi"
function getWorkerIdFromPath() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  return parts.length >= 2 ? parts[1] : null;
}

// ─────────────────────────────────────────────────────────────
// Single-task PATCH helper
// ─────────────────────────────────────────────────────────────
async function patchTask(taskId, status) {
  const res = await fetch(`${API_URL}/api/property-tasks/${taskId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'עדכון נכשל');
  return data;
}

// ─────────────────────────────────────────────────────────────
// TaskCard — used in both list and single views
// ─────────────────────────────────────────────────────────────
function TaskCard({ task, workerName, onStatusChange, compact = false }) {
  const [busy, setBusy]   = useState(false);
  const [done, setDone]   = useState(['Done', 'done', 'Completed'].includes(task.status));
  const [status, setStatus] = useState(task.status);

  const params    = new URLSearchParams(window.location.search);
  const guestPhone = params.get('guest_phone') || task.guest_phone || '';

  const roomLabel   = task.property_name || task.room || 'חדר לא ידוע';
  const taskContent = task.content || task.description || task.task_type || 'משימה';
  const staffName   = task.staff_name || workerName;
  const statusCfg   = STATUS_CONFIG[status] || { label: status, color: '#6b7280', bg: '#f3f4f6' };

  const whatsappLink = guestPhone
    ? `https://wa.me/${guestPhone.replace(/\D/g, '')}?text=${encodeURIComponent(`שלום, אני ${workerName || staffName}. אני בדרך לחדר ${roomLabel}.`)}`
    : null;

  const handleAction = async (newStatus) => {
    if (busy) return;
    setBusy(true);
    try {
      await patchTask(task.id, newStatus);
      setStatus(newStatus);
      if (newStatus === 'Done' || newStatus === 'Completed') setDone(true);
      onStatusChange?.(task.id, newStatus);
    } catch (e) {
      alert('שגיאה: ' + e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`wv-card ${done ? 'wv-card-done' : ''}`} style={compact ? { marginTop: '0.5rem' } : {}}>
      {/* Header */}
      <div className="wv-card-header">
        <span className="wv-status-pill" style={{ color: statusCfg.color, background: statusCfg.bg }}>
          {statusCfg.label}
        </span>
        <div className="wv-card-header-time">
          <CalendarDays size={13} />
          <span>{fmtDate(task.created_at)}</span>
        </div>
      </div>

      <div className="wv-card-divider" />

      {/* Room */}
      <div className="wv-room-block">
        <BedDouble size={compact ? 20 : 26} className="wv-room-icon" />
        <div>
          <div className="wv-room-label">חדר / נכס</div>
          <div className="wv-room-number" style={compact ? { fontSize: '1.15rem' } : {}}>{roomLabel}</div>
        </div>
      </div>

      {/* Task */}
      <div className="wv-detail-row">
        <div className="wv-detail-key">משימה</div>
        <div className="wv-detail-val">{taskContent}</div>
      </div>

      {/* Staff */}
      {staffName && (
        <div className="wv-detail-row">
          <div className="wv-detail-key">
            <User size={13} style={{ marginLeft: 3 }} />שויך ל
          </div>
          <div className="wv-detail-val">{staffName}</div>
        </div>
      )}

      <div className="wv-card-divider" />

      {/* Contact */}
      <div className="wv-contact-strip">
        <span className="wv-contact-label">
          <Clock size={13} style={{ marginLeft: 4 }} />צור קשר עם האורח
        </span>
        <div className="wv-contact-btns">
          {whatsappLink ? (
            <a href={whatsappLink} target="_blank" rel="noreferrer" className="wv-contact-btn wv-wa-btn">
              <MessageCircle size={18} /><span>וואטסאפ</span>
            </a>
          ) : (
            <span className="wv-contact-btn wv-wa-btn wv-disabled">
              <MessageCircle size={18} /><span>וואטסאפ</span>
            </span>
          )}
          {guestPhone ? (
            <a href={`tel:${guestPhone}`} className="wv-contact-btn wv-phone-btn">
              <Phone size={18} /><span>התקשר</span>
            </a>
          ) : (
            <span className="wv-contact-btn wv-phone-btn wv-disabled">
              <Phone size={18} /><span>התקשר</span>
            </span>
          )}
        </div>
      </div>

      {/* Action buttons */}
      {done ? (
        <div className="wv-done-banner wv-done-banner-inline">
          <CheckCircle2 size={28} />
          <div>
            <div className="wv-done-title">הושלמה ✓</div>
            {workerName && <div className="wv-done-sub">כל הכבוד {workerName} 🎉</div>}
          </div>
        </div>
      ) : (
        <div className="wv-actions-row" style={{ margin: '0.75rem 0.75rem 0.85rem' }}>
          {!['Accepted', 'accepted'].includes(status) && (
            <button
              className="wv-action-btn wv-btn-accept"
              onClick={() => handleAction('Accepted')}
              disabled={busy}
              aria-label="קבל משימה — סמן כמתקדמת"
              aria-busy={busy}
            >
              {busy ? <Loader2 size={18} className="wv-spin" aria-hidden="true" /> : <><span className="wv-btn-icon" aria-hidden="true">✅</span>קבלת משימה</>}
            </button>
          )}
          <button
            className="wv-action-btn wv-btn-done"
            onClick={() => handleAction('Done')}
            disabled={busy}
            aria-label="סיים משימה — סמן כבוצע"
            aria-busy={busy}
          >
            {busy ? <Loader2 size={18} className="wv-spin" aria-hidden="true" /> : <><span className="wv-btn-icon" aria-hidden="true">🏁</span>סיום</>}
          </button>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// LIST VIEW — /worker/levikobi (no task_id in URL)
// ─────────────────────────────────────────────────────────────
function WorkerListView({ workerId, workerName }) {
  const [tasks,   setTasks]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastFetch, setLast]  = useState(null);
  const timerRef              = useRef(null);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch(`${API_URL}/api/property-tasks`);
      const data = await res.json();
      const all  = Array.isArray(data) ? data : [];
      // Show pending + accepted for this worker (or all if workerId matches everyone)
      const relevant = all.filter((t) => isPending(t.status) || ['Accepted','accepted'].includes(t.status));
      setTasks(relevant);
      setLast(new Date());
    } catch {
      /* silent — keep old list */
    } finally {
      setLoading(false);
    }
  }, []);

  // initial + auto-refresh
  useEffect(() => {
    fetchTasks();
    timerRef.current = setInterval(fetchTasks, REFRESH_MS);
    return () => clearInterval(timerRef.current);
  }, [fetchTasks]);

  const handleStatusChange = (id, newStatus) => {
    setTasks((prev) => prev.map((t) => t.id === id ? { ...t, status: newStatus } : t));
  };

  const pendingCount = tasks.filter((t) => isPending(t.status)).length;

  return (
    <div className="wv-shell" dir="rtl">
      {/* App Bar */}
      <div className="wv-appbar">
        <img src={MAYA_AVATAR} alt="Maya" className="wv-appbar-avatar" />
        <div style={{ flex: 1 }}>
          <div className="wv-appbar-title">Maya Hotel AI</div>
          <div className="wv-appbar-sub">פורטל עובדים — {workerName || workerId}</div>
        </div>
        <button className="wv-refresh-btn" onClick={fetchTasks} title="רענן">
          <RefreshCw size={18} className={loading ? 'wv-spin' : ''} />
        </button>
      </div>

      {/* Greeting + count */}
      <div className="wv-greeting">
        שלום <strong>{workerName || workerId}</strong>
        {pendingCount > 0
          ? <>, יש לך <strong style={{ color: '#f59e0b' }}>{pendingCount} משימות פתוחות</strong> 👇</>
          : <>, אין משימות פתוחות כרגע ✅</>}
      </div>

      {lastFetch && (
        <div className="wv-last-update">
          <Clock size={11} /> עודכן: {lastFetch.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}
          <span style={{ marginRight: 8, opacity: 0.6 }}>· מתרענן אוטומטית</span>
        </div>
      )}

      {/* Task list */}
      {loading && tasks.length === 0 ? (
        <div className="wv-center">
          <Loader2 size={42} className="wv-spin" />
          <p>טוען משימות...</p>
        </div>
      ) : tasks.length === 0 ? (
        <div className="wv-center">
          <ListTodo size={52} style={{ opacity: 0.4 }} />
          <p style={{ opacity: 0.6 }}>אין משימות פתוחות כרגע</p>
          <button className="wv-action-btn wv-btn-accept" style={{ marginTop: '1rem', flex: 'unset', padding: '0.65rem 1.5rem' }} onClick={fetchTasks}>
            רענן
          </button>
        </div>
      ) : (
        <div className="wv-list">
          {tasks.map((t) => (
            <TaskCard
              key={t.id}
              task={t}
              workerName={workerName || workerId}
              onStatusChange={handleStatusChange}
              compact
            />
          ))}
        </div>
      )}

      <p className="wv-footer">מופעל ע"י Maya AI • Arizona Hotel</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// SINGLE-TASK VIEW — /worker?task_id=XXX
// ─────────────────────────────────────────────────────────────
function WorkerSingleView({ taskId, workerName: initName }) {
  const [task,     setTask]    = useState(null);
  const [loading,  setLoading] = useState(true);
  const [error,    setError]   = useState(null);
  const [workerName, setWName] = useState(initName || '');
  const [nameOk,   setNameOk] = useState(!!initName);
  const [successAnim, setPop]  = useState(false);

  const fetchTask = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch(`${API_URL}/api/property-tasks/${taskId}`);
      const data = await res.json();
      if (res.ok && data.task) { setTask(data.task); }
      else setError(data.error || 'המשימה לא נמצאה.');
    } catch { setError('שגיאת חיבור לשרת.'); }
    finally  { setLoading(false); }
  }, [taskId]);

  useEffect(() => { if (taskId) fetchTask(); }, [fetchTask, taskId]);

  const handleStatusChange = (id, newStatus) => {
    if (newStatus === 'Done' || newStatus === 'Completed') setPop(true);
    fetchTask();
  };

  if (loading) return <div className="wv-shell"><div className="wv-center"><Loader2 size={42} className="wv-spin" /><p>טוען משימה...</p></div></div>;
  if (error)   return <div className="wv-shell"><div className="wv-center wv-error-box"><AlertCircle size={48} /><h2>שגיאה</h2><p>{error}</p></div></div>;

  if (!nameOk) return (
    <div className="wv-shell">
      <div className="wv-name-card">
        <img src={MAYA_AVATAR} alt="Maya" className="wv-logo" />
        <h2>שלום! מי את/ה?</h2>
        <p className="wv-sub">הכנס/י שם כדי לקבל את המשימה</p>
        <input
          className="wv-name-input" placeholder="שם מלא" value={workerName} dir="rtl" autoFocus
          onChange={(e) => setWName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && workerName.trim() && setNameOk(true)}
        />
        <button className="wv-action-btn wv-btn-accept"
          onClick={() => workerName.trim() && setNameOk(true)} disabled={!workerName.trim()}>
          המשך →
        </button>
      </div>
    </div>
  );

  return (
    <div className="wv-shell" dir="rtl">
      <div className="wv-appbar">
        <img src={MAYA_AVATAR} alt="Maya" className="wv-appbar-avatar" />
        <div>
          <div className="wv-appbar-title">Maya Hotel AI</div>
          <div className="wv-appbar-sub">פורטל עובדים</div>
        </div>
      </div>
      <div className="wv-greeting">
        שלום <strong>{workerName}</strong>, יש לך משימה חדשה 👇
      </div>
      {task && (
        <TaskCard
          task={task}
          workerName={workerName}
          onStatusChange={handleStatusChange}
        />
      )}
      {successAnim && (
        <div className={`wv-done-banner ${successAnim ? 'wv-pop' : ''}`} style={{ margin: '1.25rem auto 0', width: 'calc(100% - 2rem)', maxWidth: 460 }}>
          <CheckCircle2 size={40} />
          <div>
            <div className="wv-done-title">משימה הושלמה!</div>
            <div className="wv-done-sub">כל הכבוד {workerName} 🎉</div>
          </div>
        </div>
      )}
      <p className="wv-footer">מופעל ע"י Maya AI • Arizona Hotel</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// ROOT COMPONENT — decides which view to render
// ─────────────────────────────────────────────────────────────
const WorkerView = () => {
  const params     = new URLSearchParams(window.location.search);
  const taskId     = params.get('task_id') || params.get('taskId') || params.get('id');
  const workerParam = params.get('worker') || params.get('staff');

  // /worker/levikobi → workerId = "levikobi"
  const workerId   = getWorkerIdFromPath();

  if (taskId) {
    // Single-task mode: ?task_id=XXX
    return <WorkerSingleView taskId={taskId} workerName={workerParam || workerId || ''} />;
  }

  // List mode: /worker/levikobi
  return <WorkerListView workerId={workerId || 'worker'} workerName={workerParam || ''} />;
};

export default WorkerView;
