import React, { useState, useCallback } from 'react';
import { X, Plus } from 'lucide-react';
import { useProperties } from '../../context/PropertiesContext';
import { withAuthFetchInit } from '../../utils/apiClient';
import { API_URL } from '../../utils/apiClient';

const TASK_TYPES = [
  { id: 'cleaning',    label: 'ניקיון' },
  { id: 'maintenance', label: 'תחזוקה' },
  { id: 'service',     label: 'שירות אורחים' },
  { id: 'checkin',     label: 'הכנת צ\'ק-אין' },
  { id: 'other',       label: 'אחר' },
];

/**
 * TaskCreatorModal — manual task creation form.
 *
 * Props:
 *   isOpen   {boolean}
 *   onClose  {() => void}
 *   onSuccess {(task) => void}  called after successful creation
 */
export default function TaskCreatorModal({ isOpen, onClose, onSuccess }) {
  const { properties } = useProperties();
  const propsList = Array.isArray(properties) ? properties : [];

  const [propertyId,   setPropertyId]   = useState('');
  const [description,  setDescription]  = useState('');
  const [taskType,     setTaskType]     = useState('service');
  const [staffName,    setStaffName]    = useState('');
  const [staffPhone,   setStaffPhone]   = useState('');
  const [dueAt,        setDueAt]        = useState('');
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState(null);

  const selectedProp = propsList.find((p) => String(p.id) === propertyId);

  const reset = useCallback(() => {
    setPropertyId('');
    setDescription('');
    setTaskType('service');
    setStaffName('');
    setStaffPhone('');
    setDueAt('');
    setError(null);
    setLoading(false);
  }, []);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    setError(null);

    if (!propertyId) { setError('נא לבחור נכס'); return; }
    if (!description.trim()) { setError('נא להזין תיאור משימה'); return; }

    setLoading(true);
    try {
      const payload = {
        // Pass the string id exactly as stored — backend accepts any string
        property_id:   String(propertyId),
        property_name: selectedProp?.name || propertyId,
        description:   description.trim(),
        task_type:     taskType,
        staff_name:    staffName.trim() || undefined,
        staff_phone:   staffPhone.trim() || undefined,
        due_at:        dueAt || undefined,
        status:        'Pending',
      };

      const res = await fetch(
        `${API_URL}/property-tasks`,
        withAuthFetchInit({
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(payload),
          credentials: 'include',
        }),
      );

      let data = {};
      try { data = await res.json(); } catch (_) { /* empty body is ok */ }

      if (!res.ok) {
        const msg = data?.error || data?.message || `שגיאת שרת (${res.status})`;
        console.error('[TaskCreatorModal] POST /property-tasks failed:', res.status, data);
        throw new Error(msg);
      }

      // Normalise the returned task so the board never crashes on unexpected shapes
      const raw  = data?.task || data;
      const task = {
        id:            raw?.id != null ? String(raw.id) : `tmp-${Date.now()}`,
        property_id:   String(raw?.property_id ?? propertyId),
        property_name: String(raw?.property_name ?? selectedProp?.name ?? propertyId),
        description:   String(raw?.description ?? description),
        title:         String(raw?.title ?? raw?.description ?? description),
        task_type:     String(raw?.task_type ?? taskType),
        staff_name:    String(raw?.staff_name ?? staffName ?? ''),
        staff_phone:   String(raw?.staff_phone ?? staffPhone ?? ''),
        status:        String(raw?.status ?? 'Pending'),
        created_at:    raw?.created_at ?? new Date().toISOString(),
        due_at:        raw?.due_at ?? dueAt ?? null,
        actions:       Array.isArray(raw?.actions) ? raw.actions : [
          { label: 'ראיתי ✅', value: 'seen' },
          { label: 'בוצע 🏁', value: 'done' },
        ],
      };

      // Notify board — both the event-driven listener and the callback
      window.dispatchEvent(new CustomEvent('maya-task-created', { detail: { task } }));
      window.dispatchEvent(new Event('maya-refresh-tasks'));

      typeof onSuccess === 'function' && onSuccess(task);
      reset();
      onClose();
    } catch (err) {
      console.error('[TaskCreatorModal] submit error:', err);
      setError(err?.message || 'שגיאה ביצירת המשימה. נסה שוב.');
    } finally {
      setLoading(false);
    }
  }, [
    propertyId, description, taskType, staffName, staffPhone, dueAt,
    selectedProp, reset, onClose, onSuccess,
  ]);

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
      onClick={handleClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-creator-title"
        dir="rtl"
        style={{
          background: '#111827', borderRadius: 24,
          padding: '28px 28px 24px',
          width: '100%', maxWidth: 480,
          border: '1px solid rgba(0,255,136,0.25)',
          boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22 }}>
          <h2 id="task-creator-title" style={{ color: '#fff', fontWeight: 900, fontSize: 20, margin: 0 }}>
            + הוספת משימה ידנית
          </h2>
          <button
            type="button"
            onClick={handleClose}
            style={{
              background: 'rgba(255,255,255,0.08)', border: 'none',
              color: '#9ca3af', width: 36, height: 36, borderRadius: '50%',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
            aria-label="סגור"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Property dropdown */}
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ color: '#9ca3af', fontSize: 12, fontWeight: 700 }}>נכס *</span>
            <select
              value={propertyId}
              onChange={(e) => setPropertyId(e.target.value)}
              required
              style={inputStyle}
            >
              <option value="">בחר נכס...</option>
              {propsList.map((p) => (
                <option key={p.id} value={String(p.id)}>
                  {p.name || p.id}
                </option>
              ))}
            </select>
          </label>

          {/* Task type */}
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ color: '#9ca3af', fontSize: 12, fontWeight: 700 }}>סוג משימה</span>
            <select
              value={taskType}
              onChange={(e) => setTaskType(e.target.value)}
              style={inputStyle}
            >
              {TASK_TYPES.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
          </label>

          {/* Description */}
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ color: '#9ca3af', fontSize: 12, fontWeight: 700 }}>תיאור המשימה *</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="למשל: ניקיון חדר 12, החלפת מגבות, תקלת מזגן..."
              required
              rows={3}
              style={{ ...inputStyle, resize: 'vertical', minHeight: 80, fontFamily: 'inherit' }}
            />
          </label>

          {/* Staff + phone in one row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ color: '#9ca3af', fontSize: 12, fontWeight: 700 }}>שם עובד (אופציונלי)</span>
              <input
                type="text"
                value={staffName}
                onChange={(e) => setStaffName(e.target.value)}
                placeholder="למשל עלמה"
                style={inputStyle}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ color: '#9ca3af', fontSize: 12, fontWeight: 700 }}>טלפון עובד</span>
              <input
                type="tel"
                value={staffPhone}
                onChange={(e) => setStaffPhone(e.target.value)}
                placeholder="050-1234567"
                inputMode="tel"
                style={inputStyle}
              />
            </label>
          </div>

          {/* Due date */}
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ color: '#9ca3af', fontSize: 12, fontWeight: 700 }}>תאריך יעד (אופציונלי)</span>
            <input
              type="datetime-local"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
              style={inputStyle}
            />
          </label>

          {/* Error */}
          {error && (
            <div style={{
              padding: '10px 14px', borderRadius: 10,
              background: 'rgba(239,68,68,0.12)',
              border: '1px solid rgba(239,68,68,0.3)',
              color: '#fca5a5', fontSize: 13, fontWeight: 600,
            }}>
              {error}
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            style={{
              marginTop: 4,
              padding: '13px 0',
              borderRadius: 14, border: 'none',
              background: loading
                ? 'rgba(0,255,136,0.25)'
                : 'linear-gradient(135deg,#065f46,#00ff88)',
              color: loading ? '#6ee7b7' : '#000',
              fontWeight: 900, fontSize: 15,
              cursor: loading ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              opacity: loading ? 0.75 : 1,
            }}
          >
            {loading ? (
              <>
                <span style={{ display: 'inline-block', animation: 'spin .7s linear infinite' }}>⏳</span>
                שומר...
              </>
            ) : (
              <><Plus size={18} /> צור משימה</>
            )}
          </button>
        </form>
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

const inputStyle = {
  background: 'rgba(255,255,255,0.07)',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 10,
  color: '#f9fafb',
  padding: '10px 12px',
  fontSize: 14,
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
};
