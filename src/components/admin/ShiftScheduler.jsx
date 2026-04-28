import React, { useState, useCallback } from 'react';
import { CalendarRange, Sparkles, RefreshCw, Clock, User } from 'lucide-react';
import { API_URL } from '../../utils/apiClient';
import './ShiftScheduler.css';

/**
 * Maya-generated shift proposals (backend: POST /scheduler/create-shifts).
 */
export default function ShiftScheduler() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  const run = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`${API_URL}/scheduler/create-shifts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: 'he' }),
      });
      const j = await res.json().catch(() => ({}));
      if (j.ok === false) {
        setErr(j.error || j.raw_preview || 'השרת לא החזיר מערכת משמרות תקינה');
        setData(null);
        return;
      }
      setData(j);
    } catch (e) {
      setErr(e?.message || 'שגיאת רשת');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const shifts = Array.isArray(data?.shifts) ? data.shifts : [];

  return (
    <div className="shift-scheduler">
      <header className="shift-scheduler__hero">
        <div className="shift-scheduler__icon">
          <CalendarRange size={28} strokeWidth={1.75} />
        </div>
        <div>
          <h1 className="shift-scheduler__title">Shift Scheduler</h1>
          <p className="shift-scheduler__sub">
            טיוטות משמרות לפי נכסים, הזמנות וצוות — מופעל על ידי Maya (Gemini).
          </p>
        </div>
      </header>

      <button
        type="button"
        className="shift-scheduler__cta"
        onClick={run}
        disabled={loading}
      >
        {loading ? (
          <>
            <RefreshCw size={18} className="shift-scheduler__spin" /> יוצר משמרות…
          </>
        ) : (
          <>
            <Sparkles size={18} /> צור משמרות מוצעות
          </>
        )}
      </button>

      {err && (
        <div className="shift-scheduler__error" role="alert">
          {err}
        </div>
      )}

      {data?.note && (
        <div
          className="shift-scheduler__summary"
          style={{
            border: '1px solid rgba(251, 191, 36, 0.45)',
            background: 'rgba(251, 191, 36, 0.08)',
          }}
          role="status"
        >
          <h2>הערה</h2>
          <p>{data.note}</p>
        </div>
      )}

      {data?.summary && (
        <section className="shift-scheduler__summary">
          <h2>סיכום</h2>
          <p>{data.summary}</p>
        </section>
      )}

      <ul className="shift-scheduler__list">
        {shifts.map((s, i) => (
          <li key={`${s.date}-${s.staff_name}-${i}`} className="shift-scheduler__card">
            <div className="shift-scheduler__card-top">
              <span className="shift-scheduler__date">{s.date || '—'}</span>
              <span className="shift-scheduler__focus">{s.focus || 'mixed'}</span>
            </div>
            <div className="shift-scheduler__card-mid">
              <User size={16} />
              <strong>{s.staff_name || '—'}</strong>
            </div>
            <div className="shift-scheduler__card-time">
              <Clock size={14} />
              {s.shift_start || '?'} – {s.shift_end || '?'}
            </div>
            {s.notes && <p className="shift-scheduler__notes">{s.notes}</p>}
          </li>
        ))}
      </ul>

      {!loading && shifts.length === 0 && !err && (
        <p className="shift-scheduler__empty">לחץ על הכפתור ליצירת טיוטת משמרות.</p>
      )}
    </div>
  );
}
