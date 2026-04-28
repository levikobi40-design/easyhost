import React, { useEffect, useState } from 'react';
import { apiRequest } from '../../utils/apiClient';
import './BiktaDashboard.css';

function fmtLocal(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso.slice(0, 16);
    return d.toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

export default function BiktaShiftReport({ onBack }) {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await apiRequest('/bikta/shifts/report', { method: 'GET' });
        if (!cancelled) setRows(Array.isArray(data.shifts) ? data.shifts : []);
      } catch (e) {
        if (!cancelled) setError(e?.message || 'טעינה נכשלה');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="bikta-report" dir="rtl">
      <div className="bikta-report-toolbar">
        <button type="button" className="bikta-link-btn" onClick={onBack}>
          ← חזרה ללוח
        </button>
        <h2 className="bikta-report-title">דוח משמרות</h2>
      </div>
      {error ? <div className="bikta-err">{error}</div> : null}
      {loading ? (
        <div className="bikta-loading">טוען…</div>
      ) : (
        <div className="bikta-table-wrap">
          <table className="bikta-table">
            <thead>
              <tr>
                <th>שם עובד</th>
                <th>התחלת משמרת</th>
                <th>סיום משמרת</th>
                <th>חדרים נקיים</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id}>
                  <td>{s.worker_name}</td>
                  <td>{fmtLocal(s.started_at)}</td>
                  <td>{fmtLocal(s.ended_at)}</td>
                  <td>{s.rooms_cleaned ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length ? <p className="bikta-hint">אין עדיין רשומות משמרת.</p> : null}
        </div>
      )}
    </div>
  );
}
