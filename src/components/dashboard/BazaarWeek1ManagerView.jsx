import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarRange, RefreshCw, Sparkles } from 'lucide-react';
import { getBookings, listGuestBookings } from '../../services/api';
import { getDealHighlightForDay, startOfDay, isDateInRange } from '../../utils/bazaarWeek1Schedule';
import './BazaarWeek1ManagerView.css';

function formatHebrewDate(d) {
  return d.toLocaleDateString('he-IL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export default function BazaarWeek1ManagerView() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [rows, setRows] = useState([]);

  const range = useMemo(() => {
    const from = startOfDay(new Date());
    const to = new Date(from);
    to.setDate(to.getDate() + 7);
    to.setHours(23, 59, 59, 999);
    return { from, to };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const fromIso = range.from.toISOString().slice(0, 10);
      const toIso = range.to.toISOString().slice(0, 10);
      let list = [];
      try {
        const a = await getBookings();
        const arr = Array.isArray(a) ? a : (a?.bookings && Array.isArray(a.bookings) ? a.bookings : []);
        list = list.concat(arr);
      } catch (_) {}
      try {
        const b = await listGuestBookings({ from: fromIso, to: toIso });
        if (Array.isArray(b)) list = list.concat(b);
      } catch (_) {}

      const seen = new Set();
      const deduped = [];
      for (const x of list) {
        const id = x?.id != null ? String(x.id) : `${x?.guest_name || ''}-${x?.check_in || ''}-${x?.room || ''}`;
        if (seen.has(id)) continue;
        seen.add(id);
        deduped.push(x);
      }

      const days = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(range.from);
        d.setDate(d.getDate() + i);
        const dayStart = startOfDay(d);
        const dayEnd = new Date(dayStart);
        dayEnd.setHours(23, 59, 59, 999);

        const bookings = deduped.filter((b) => {
          const cin = b.check_in || b.checkIn || b.start_date || b.checkin;
          const cout = b.check_out || b.checkOut || b.end_date;
          if (cin && isDateInRange(cin, dayStart, dayEnd)) return true;
          if (cin && cout) {
            const a = Date.parse(cin);
            const b2 = Date.parse(cout);
            if (Number.isFinite(a) && Number.isFinite(b2)) {
              return dayStart.getTime() >= a && dayStart.getTime() < b2;
            }
          }
          return false;
        });

        days.push({
          date: d,
          dayIndex: i,
          dealLine: getDealHighlightForDay(d, i),
          bookings,
        });
      }
      setRows(days);
    } catch (e) {
      setError(e?.message || 'טעינה נכשלה');
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="bw1-root" dir="rtl">
      <header className="bw1-header">
        <div>
          <h1 className="bw1-title">
            <CalendarRange size={28} className="bw1-title-icon" aria-hidden />
            מלון בזאר יפו — תצוגת מנהלים: 7 ימים קדימה
          </h1>
          <p className="bw1-sub">
            הזמנות לפי מערכת + שורת מבצע/חבילה לכל יום (ספא, קולינריה, ברבי, מילואים).
          </p>
        </div>
        <button type="button" className="bw1-refresh" onClick={load} disabled={loading}>
          <RefreshCw size={16} className={loading ? 'bw1-spin' : ''} />
          רענן
        </button>
      </header>

      {error && (
        <div className="bw1-error" role="alert">
          {error}
        </div>
      )}

      {loading ? (
        <div className="bw1-loading">טוען לוח שבועי…</div>
      ) : (
        <div className="bw1-grid">
          {rows.map((row) => (
            <section key={row.date.toISOString()} className="bw1-card">
              <div className="bw1-card-head">
                <span className="bw1-date">{formatHebrewDate(row.date)}</span>
                <span className="bw1-badge">
                  <Sparkles size={14} aria-hidden /> מבצע / חבילה היום
                </span>
              </div>
              <p className="bw1-deal">{row.dealLine}</p>
              <h3 className="bw1-bh">הזמנות / אורחים (חופף ליום)</h3>
              {row.bookings.length === 0 ? (
                <p className="bw1-empty">אין רישום הזמנה ליום זה בחלון — ניתן לייבא מ-Guest / הזמנות ידניות.</p>
              ) : (
                <ul className="bw1-list">
                  {row.bookings.map((b, idx) => (
                    <li key={b.id || idx} className="bw1-li">
                      <strong>{b.guest_name || b.customer_name || b.guestName || 'אורח'}</strong>
                      {b.room || b.room_number ? ` · חדר ${b.room || b.room_number}` : ''}
                      {b.property_name ? ` · ${b.property_name}` : ''}
                      {(b.check_in || b.checkIn) && (
                        <span className="bw1-meta">
                          {' '}
                          צ׳ק-אין: {String(b.check_in || b.checkIn).slice(0, 10)}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
