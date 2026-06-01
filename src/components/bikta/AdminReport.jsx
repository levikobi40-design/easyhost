import React, { useCallback, useEffect, useMemo, useState } from 'react';
import useStore from '../../store/useStore';
import { apiRequest } from '../../utils/apiClient';
import { isBiktaNessZionaUser } from '../../utils/biktaUser';
import './BiktaDashboard.css';

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function buildWhatsAppSummary(data) {
  if (!data?.date) return '';
  const { date, rows = [], totals = {} } = data;
  const rooms = totals.rooms_cleaned ?? 0;
  const pay = totals.estimated_pay_ils ?? 0;
  const workers = (rows || [])
    .map((r) => `${r.worker_name} (${r.rooms_cleaned ?? 0} rooms)`)
    .join('; ');
  const workerLine =
    (rows || []).length === 1
      ? `Worker: ${rows[0].worker_name}`
      : (rows || []).length > 1
        ? `Workers: ${(rows || []).map((r) => r.worker_name).join(', ')}`
        : 'Worker: —';
  const en = `Summary for ${date}: ${rooms} Rooms cleaned, ${workerLine}, Total Pay: ${pay}₪.`;
  const he = `סיכום לתאריך ${date}: ${rooms} חדרים נוקו. ${workers ? `פרטים: ${workers}` : ''} שכר משוער: ${pay}₪.`;
  return `${en}\n${he}`;
}

export default function AdminReport({ onBack }) {
  const { authToken, activeTenantId } = useStore();
  const allowed = useMemo(
    () => isBiktaNessZionaUser(authToken, activeTenantId),
    [authToken, activeTenantId]
  );
  const [date, setDate] = useState(todayISO);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!allowed) return;
    setError('');
    setLoading(true);
    try {
      const q = new URLSearchParams({ date });
      const res = await apiRequest(`/bikta/admin/daily-summary?${q}`, { method: 'GET' });
      setData(res);
    } catch (e) {
      setError(e?.message || 'טעינה נכשלה');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [allowed, date]);

  useEffect(() => {
    if (allowed) load();
  }, [allowed, load]);

  const shareWhatsApp = () => {
    if (!data) return;
    const text = buildWhatsAppSummary(data);
    const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  if (!allowed) {
    return (
      <div className="bikta-report" dir="rtl" lang="he">
        <p className="bikta-err">אין הרשאה לצפות בדוח זה.</p>
        <button type="button" className="bikta-link-btn" onClick={onBack}>
          ← חזרה
        </button>
      </div>
    );
  }

  return (
    <div className="bikta-report bikta-admin-report" dir="rtl" lang="he">
      <div className="bikta-report-toolbar">
        <button type="button" className="bikta-link-btn" onClick={onBack}>
          ← חזרה ללוח
        </button>
        <h2 className="bikta-report-title">סיכום יומי — הבקתה נס ציונה</h2>
      </div>

      <div className="bikta-daily-toolbar">
        <label className="bikta-daily-date">
          <span>תאריך</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <button type="button" className="bikta-tab-btn" onClick={load} disabled={loading}>
          {loading ? 'טוען…' : 'רענן'}
        </button>
        <button type="button" className="bikta-share-btn" onClick={shareWhatsApp} disabled={loading || !data}>
          שתף בוואטסאפ
        </button>
      </div>

      <p className="bikta-hint" style={{ marginBottom: '0.75rem' }}>
        הנתונים מבוססים על יומן משמרות וספירת חדרים שנוקו (מסד bikta_shifts).
      </p>

      {error ? <div className="bikta-err">{error}</div> : null}

      {loading ? (
        <div className="bikta-loading">טוען…</div>
      ) : (
        <>
          <div className="bikta-table-wrap">
            <table className="bikta-table">
              <thead>
                <tr>
                  <th>שם עובד</th>
                  <th>חדרים שנוקו</th>
                  <th>זמן כולל</th>
                  <th>שכר משוער (₪)</th>
                </tr>
              </thead>
              <tbody>
                {(data?.rows || []).map((r) => (
                  <tr key={r.shift_id}>
                    <td>{r.worker_name}</td>
                    <td>{r.rooms_cleaned}</td>
                    <td>{r.total_time_display ?? '—'}</td>
                    <td>{r.estimated_pay_ils}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data?.totals ? (
            <div className="bikta-daily-totals">
              <strong>סה״כ חדרים:</strong> {data.totals.rooms_cleaned} ·{' '}
              <strong>שכר משוער כולל:</strong> {data.totals.estimated_pay_ils}₪ ·{' '}
              <strong>תעריף לחדר:</strong> {data.pay_per_room_nis ?? '—'}₪
            </div>
          ) : null}
          {!data?.rows?.length ? (
            <p className="bikta-hint">אין נתונים לתאריך זה.</p>
          ) : null}
        </>
      )}
    </div>
  );
}
