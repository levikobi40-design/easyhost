import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Users,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Plus,
  MessageCircle,
  Link2,
  Loader2,
} from 'lucide-react';
import {
  listGuestBookings,
  createGuestBooking,
  getPropertyStaff,
  addPropertyStaff,
  removePropertyStaff,
} from '../../services/api';
import { useProperties } from '../../context/PropertiesContext';
import { toWhatsAppPhone } from '../../utils/phone';
import './ManualOperationsHub.css';

function mondayOfWeek(d) {
  const dt = new Date(d);
  const w = dt.getDay();
  const diff = dt.getDate() - (w === 0 ? 6 : w - 1);
  const m = new Date(dt);
  m.setDate(diff);
  m.setHours(12, 0, 0, 0);
  return m;
}

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function fmtISO(d) {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${day}`;
}

const ROLE_PRESETS = ['Cleaning', 'Maintenance', 'Service', 'Front desk', 'Manager'];

export default function ManualOperationsHub() {
  const { properties, refresh } = useProperties();
  const propsList = Array.isArray(properties) ? properties : [];

  const [tab, setTab] = useState('staff'); // staff | planner

  /* ── Staff ───────────────────────────────────────── */
  const [staffPropertyId, setStaffPropertyId] = useState('');
  const [staffList, setStaffList] = useState([]);
  const [staffLoading, setStaffLoading] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newRole, setNewRole] = useState('Cleaning');
  const [staffErr, setStaffErr] = useState(null);

  const loadStaff = useCallback(async () => {
    if (!staffPropertyId) {
      setStaffList([]);
      return;
    }
    setStaffLoading(true);
    setStaffErr(null);
    try {
      const rows = await getPropertyStaff(staffPropertyId);
      setStaffList(Array.isArray(rows) ? rows : []);
    } catch (e) {
      setStaffErr(e?.message || 'Failed to load staff');
      setStaffList([]);
    } finally {
      setStaffLoading(false);
    }
  }, [staffPropertyId]);

  useEffect(() => {
    loadStaff();
  }, [loadStaff]);

  const handleAddStaff = async (e) => {
    e.preventDefault();
    if (!staffPropertyId || !newName.trim()) return;
    setStaffErr(null);
    try {
      await addPropertyStaff(staffPropertyId, {
        name: newName.trim(),
        role: newRole,
        phone_number: newPhone.trim() || undefined,
      });
      setNewName('');
      setNewPhone('');
      setNewRole('Cleaning');
      await loadStaff();
      await refresh(true);
    } catch (err) {
      setStaffErr(err?.message || 'Could not add staff');
    }
  };

  /* ── Weekly planner ─────────────────────────────── */
  const [weekAnchor, setWeekAnchor] = useState(() => mondayOfWeek(new Date()));
  const weekStart = useMemo(() => mondayOfWeek(weekAnchor), [weekAnchor]);
  const weekEnd = useMemo(() => addDays(weekStart, 6), [weekStart]);
  const rangeFrom = fmtISO(weekStart);
  const rangeTo = fmtISO(weekEnd);

  const [bookings, setBookings] = useState([]);
  const [bookLoading, setBookLoading] = useState(false);

  const loadBookings = useCallback(async () => {
    setBookLoading(true);
    try {
      const rows = await listGuestBookings({ from: rangeFrom, to: rangeTo });
      setBookings(rows);
    } catch {
      setBookings([]);
    } finally {
      setBookLoading(false);
    }
  }, [rangeFrom, rangeTo]);

  useEffect(() => {
    loadBookings();
  }, [loadBookings]);

  const [plannerProp, setPlannerProp] = useState('');
  const [gName, setGName] = useState('');
  const [gPhone, setGPhone] = useState('');
  const [gRoom, setGRoom] = useState('');
  const [gIn, setGIn] = useState(rangeFrom);
  const [gOut, setGOut] = useState(rangeFrom);
  const [notifyGuest, setNotifyGuest] = useState(true);
  const [plannerBusy, setPlannerBusy] = useState(false);
  const [plannerMsg, setPlannerMsg] = useState(null);
  const [lastGuestUrl, setLastGuestUrl] = useState('');

  useEffect(() => {
    setGIn(rangeFrom);
    setGOut(rangeFrom);
  }, [rangeFrom]);

  const selectedPlannerProp = propsList.find((p) => p.id === plannerProp);

  const submitPlanner = async (e) => {
    e.preventDefault();
    if (!plannerProp || !gName.trim() || !gIn) return;
    setPlannerBusy(true);
    setPlannerMsg(null);
    try {
      const res = await createGuestBooking({
        guest_name: gName.trim(),
        guest_phone: gPhone.trim(),
        phone: gPhone.trim(),
        check_in: gIn,
        check_out: gOut || gIn,
        room_composition: 'זוג',
        composition: 'זוג',
        property_id: plannerProp,
        property_name: selectedPlannerProp?.name || '',
        room_number: gRoom.trim(),
        notify_guest: notifyGuest,
      });
      const b = res?.booking || res;
      const url = b?.guest_url;
      setLastGuestUrl(url || '');
      setPlannerMsg(url ? 'נשמר! הלינק מוכן לשיתוף.' : 'נשמר.');
      setGName('');
      setGRoom('');
      await loadBookings();
      window.dispatchEvent(new Event('properties-refresh'));
    } catch (err) {
      setPlannerMsg(err?.message || 'שגיאה');
    } finally {
      setPlannerBusy(false);
    }
  };

  const shareWhatsAppGuest = () => {
    const phone = gPhone.trim() || '';
    if (!phone || !lastGuestUrl) return;
    const digits = toWhatsAppPhone(phone);
    if (!digits) return;
    const text = `היי! הנה הלינק לאפליקציית האורחים שלנו: ${lastGuestUrl}`;
    window.open(`https://wa.me/${digits}?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
  };

  const bookingsByProperty = useMemo(() => {
    const m = {};
    bookings.forEach((b) => {
      const k = b.property_id || b.property_name || '_';
      if (!m[k]) m[k] = [];
      m[k].push(b);
    });
    return m;
  }, [bookings]);

  return (
    <div className="manual-ops" dir="rtl">
      <header className="manual-ops-header">
        <h1>ניהול ידני — ללא סנכרון</h1>
        <p className="manual-ops-sub">צוות נכסים, תכנון שבועי, ולינק אורח לוואטסאפ</p>
      </header>

      <div className="manual-ops-tabs">
        <button
          type="button"
          className={`manual-ops-tab ${tab === 'staff' ? 'active' : ''}`}
          onClick={() => setTab('staff')}
        >
          <Users size={18} /> צוות (Staff)
        </button>
        <button
          type="button"
          className={`manual-ops-tab ${tab === 'planner' ? 'active' : ''}`}
          onClick={() => setTab('planner')}
        >
          <CalendarDays size={18} /> מתכנן שבועי
        </button>
      </div>

      {tab === 'staff' && (
        <section className="manual-ops-panel">
          <label className="manual-ops-label">
            נכס
            <select
              className="manual-ops-input"
              value={staffPropertyId}
              onChange={(e) => setStaffPropertyId(e.target.value)}
            >
              <option value="">בחר נכס</option>
              {propsList.map((p) => (
                <option key={p.id} value={p.id}>{p.name || p.id}</option>
              ))}
            </select>
          </label>

          {staffLoading ? (
            <p className="manual-ops-muted"><Loader2 className="spin" size={18} /> טוען…</p>
          ) : (
            <ul className="manual-ops-staff-list">
              {staffList.map((s) => (
                <li key={s.id} className="manual-ops-staff-row">
                  <div>
                    <strong>{s.name}</strong>
                    <span className="manual-ops-muted"> · {s.role || 'Staff'}</span>
                    {s.phone_number && (
                      <div className="manual-ops-phone">{s.phone_number}</div>
                    )}
                  </div>
                  <button
                    type="button"
                    className="manual-ops-btn ghost"
                    onClick={async () => {
                      if (!window.confirm('להסיר עובד מהנכס?')) return;
                      try {
                        await removePropertyStaff(staffPropertyId, s.id);
                        await loadStaff();
                      } catch (err) {
                        setStaffErr(err?.message);
                      }
                    }}
                  >
                    הסר
                  </button>
                </li>
              ))}
            </ul>
          )}

          <form className="manual-ops-form" onSubmit={handleAddStaff}>
            <h3>הוספת עובד</h3>
            <div className="manual-ops-grid">
              <label>
                שם
                <input
                  className="manual-ops-input"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="למשל עלמה"
                  required
                  autoComplete="name"
                />
              </label>
              <label>
                טלפון
                <input
                  className="manual-ops-input"
                  type="tel"
                  inputMode="tel"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  placeholder="050-1234567"
                  autoComplete="tel"
                />
              </label>
              <label>
                תפקיד
                <select
                  className="manual-ops-input"
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value)}
                >
                  {ROLE_PRESETS.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </label>
            </div>
            {staffErr && <p className="manual-ops-error">{staffErr}</p>}
            <button type="submit" className="manual-ops-btn primary" disabled={!staffPropertyId}>
              <Plus size={18} /> שמור עובד
            </button>
          </form>
        </section>
      )}

      {tab === 'planner' && (
        <section className="manual-ops-panel">
          <div className="manual-ops-week-nav">
            <button
              type="button"
              className="manual-ops-icon-btn"
              onClick={() => setWeekAnchor(addDays(weekStart, -7))}
              aria-label="שבוע קודם"
            >
              <ChevronRight size={22} />
            </button>
            <span className="manual-ops-week-label">
              {weekStart.toLocaleDateString('he-IL')} — {weekEnd.toLocaleDateString('he-IL')}
            </span>
            <button
              type="button"
              className="manual-ops-icon-btn"
              onClick={() => setWeekAnchor(addDays(weekStart, 7))}
              aria-label="שבוע הבא"
            >
              <ChevronLeft size={22} />
            </button>
          </div>

          {bookLoading ? (
            <p className="manual-ops-muted"><Loader2 className="spin" size={18} /> טוען הזמנות…</p>
          ) : (
            <div className="manual-ops-bookings">
              {Object.keys(bookingsByProperty).length === 0 && (
                <p className="manual-ops-muted">אין הזמנות ידניות לטווח זה</p>
              )}
              {Object.entries(bookingsByProperty).map(([pk, rows]) => (
                <div key={pk} className="manual-ops-book-block">
                  <h4>{rows[0]?.property_name || pk}</h4>
                  <ul>
                    {rows.map((b) => (
                      <li key={b.id}>
                        <strong>{b.guest_name}</strong>
                        {' · '}
                        {b.check_in}
                        {b.check_out && b.check_out !== b.check_in ? ` → ${b.check_out}` : ''}
                        {b.room_number && ` · חדר ${b.room_number}`}
                        {b.guest_url && (
                          <a href={b.guest_url} className="manual-ops-link" target="_blank" rel="noreferrer">
                            <Link2 size={14} /> לינק אורח
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}

          <form className="manual-ops-form manual-ops-planner-form" onSubmit={submitPlanner}>
            <h3>הזנה ידנית — אורח חדש</h3>
            <div className="manual-ops-grid">
              <label>
                נכס
                <select
                  className="manual-ops-input"
                  value={plannerProp}
                  onChange={(e) => setPlannerProp(e.target.value)}
                  required
                >
                  <option value="">בחר נכס</option>
                  {propsList.map((p) => (
                    <option key={p.id} value={p.id}>{p.name || p.id}</option>
                  ))}
                </select>
              </label>
              <label>
                שם אורח
                <input
                  className="manual-ops-input"
                  value={gName}
                  onChange={(e) => setGName(e.target.value)}
                  required
                  placeholder="שם מלא"
                />
              </label>
              <label>
                טלפון (לוואטסאפ)
                <input
                  className="manual-ops-input"
                  type="tel"
                  inputMode="tel"
                  value={gPhone}
                  onChange={(e) => setGPhone(e.target.value)}
                  placeholder="050-1234567"
                />
              </label>
              <label>
                מספר חדר
                <input
                  className="manual-ops-input"
                  value={gRoom}
                  onChange={(e) => setGRoom(e.target.value)}
                  placeholder="למשל 60"
                  inputMode="numeric"
                />
              </label>
              <label>
                צ׳ק-אין
                <input
                  className="manual-ops-input"
                  type="date"
                  value={gIn}
                  onChange={(e) => setGIn(e.target.value)}
                  required
                />
              </label>
              <label>
                צ׳ק-אאוט
                <input
                  className="manual-ops-input"
                  type="date"
                  value={gOut}
                  onChange={(e) => setGOut(e.target.value)}
                />
              </label>
            </div>
            <label className="manual-ops-check">
              <input
                type="checkbox"
                checked={notifyGuest}
                onChange={(e) => setNotifyGuest(e.target.checked)}
              />
              שלח הודעת פתיחה אוטומטית (וואטסאפ/SMS) כשנשמר
            </label>
            {plannerMsg && <p className="manual-ops-success">{plannerMsg}</p>}
            {lastGuestUrl && (
              <div className="manual-ops-url-row">
                <code className="manual-ops-url">{lastGuestUrl}</code>
                <button
                  type="button"
                  className="manual-ops-btn wa"
                  onClick={shareWhatsAppGuest}
                  disabled={!gPhone.trim()}
                >
                  <MessageCircle size={18} /> שתף בוואטסאפ
                </button>
              </div>
            )}
            <button type="submit" className="manual-ops-btn primary" disabled={plannerBusy}>
              {plannerBusy ? <Loader2 className="spin" size={18} /> : <Plus size={18} />}
              שמור הזמנה
            </button>
          </form>
        </section>
      )}
    </div>
  );
}
