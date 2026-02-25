import React, { useState, useEffect, useCallback } from 'react';
import { CheckCircle, Flag, Clock, Loader2, AlertCircle, Hotel } from 'lucide-react';
import { API_URL } from '../../utils/apiClient';
import './WorkerPortal.css';

/**
 * WorkerPortal – mobile-first staff view.
 * Access via: /worker?task=<TASK_ID>&name=<STAFF_NAME>
 * When the worker clicks "Accept" or "Complete", it PATCHes
 * /api/property-tasks/<id> → status: Seen | Done.
 * The main dashboard table auto-refreshes and shows the updated status.
 */
const STATUS_COLORS = {
  Pending: '#f59e0b',
  Seen:    '#3b82f6',
  Done:    '#22c55e',
};

const WorkerPortal = () => {
  const params = new URLSearchParams(window.location.search);
  const taskId   = params.get('task')  || '';
  const workerName = params.get('name') || 'עובד';

  const [task, setTask]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState('');
  const [busy, setBusy]     = useState(false);
  const [done, setDone]     = useState(false);

  const fetchTask = useCallback(async () => {
    if (!taskId) {
      setError('לא סופק מזהה משימה ב-URL (task=...)');
      setLoading(false);
      return;
    }
    try {
      const res  = await fetch(`${API_URL}/api/property-tasks/${taskId}`);
      const data = await res.json();
      if (!res.ok || !data.task) throw new Error(data.error || 'משימה לא נמצאה');
      setTask(data.task);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => { fetchTask(); }, [fetchTask]);

  const updateStatus = async (newStatus) => {
    if (!taskId || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`${API_URL}/api/property-tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'שגיאה בעדכון');
      setTask((t) => ({ ...t, status: data.task?.status || newStatus }));
      if (newStatus === 'Done') setDone(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="wp-shell wp-center">
        <Loader2 size={48} className="wp-spin" />
        <p className="wp-loading-text">טוען משימה...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="wp-shell wp-center">
        <AlertCircle size={52} color="#ef4444" />
        <p className="wp-error-text">{error}</p>
        <button className="wp-retry-btn" onClick={fetchTask}>נסה שוב</button>
      </div>
    );
  }

  if (done) {
    return (
      <div className="wp-shell wp-center wp-done">
        <div className="wp-done-icon-wrap">
          <CheckCircle size={80} color="#22c55e" />
        </div>
        <h2 className="wp-done-title">!כל הכבוד</h2>
        <p className="wp-done-sub">המשימה סומנה כ-<strong>הושלמה</strong> ✅</p>
        <p className="wp-done-sub-small">הלקוח והמנהל קיבלו עדכון אוטומטי.</p>
      </div>
    );
  }

  const statusLabel =
    task.status === 'Done'    ? 'הושלם ✅' :
    task.status === 'Seen'    ? 'בטיפול 🔵' :
    'ממתין ⏳';

  return (
    <div className="wp-shell" dir="rtl">
      {/* Header */}
      <div className="wp-header">
        <Hotel size={28} color="#fff" />
        <div className="wp-header-text">
          <span className="wp-hotel-name">Arizona Hotel</span>
          <span className="wp-header-sub">פורטל עובדים</span>
        </div>
      </div>

      {/* Worker greeting */}
      <div className="wp-greeting">
        <p>שלום, <strong>{workerName}</strong> 👋</p>
        <p className="wp-greeting-sub">יש לך משימה חדשה:</p>
      </div>

      {/* Task card */}
      <div className="wp-task-card">
        <div className="wp-task-badge" style={{ background: STATUS_COLORS[task.status] || '#6b7280' }}>
          {statusLabel}
        </div>

        <h2 className="wp-task-title">{task.content || task.description || 'פרטי משימה'}</h2>

        {task.property_name && (
          <p className="wp-task-meta">📍 מיקום: <strong>{task.property_name}</strong></p>
        )}
        {task.created_at && (
          <p className="wp-task-meta">🕐 נפתחה: {new Date(task.created_at).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}</p>
        )}
      </div>

      {/* Action buttons */}
      <div className="wp-actions">
        {task.status === 'Pending' && (
          <button
            className="wp-btn wp-btn-accept"
            onClick={() => updateStatus('Seen')}
            disabled={busy}
          >
            {busy ? <Loader2 size={24} className="wp-spin" /> : <CheckCircle size={28} />}
            <span>✅ קבלת משימה</span>
          </button>
        )}

        {(task.status === 'Pending' || task.status === 'Seen') && (
          <button
            className="wp-btn wp-btn-complete"
            onClick={() => updateStatus('Done')}
            disabled={busy}
          >
            {busy ? <Loader2 size={24} className="wp-spin" /> : <Flag size={28} />}
            <span>🏁 סיום משימה</span>
          </button>
        )}

        {task.status === 'Done' && (
          <div className="wp-already-done">
            <CheckCircle size={40} color="#22c55e" />
            <p>משימה זו כבר הושלמה</p>
          </div>
        )}
      </div>

      {/* Timer display */}
      <div className="wp-footer">
        <Clock size={14} />
        <span>המנהל מקבל עדכון בזמן אמת</span>
      </div>
    </div>
  );
};

export default WorkerPortal;
