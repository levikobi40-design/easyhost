import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { RefreshCw, BedDouble, Users, CheckCircle2, AlertCircle, Clock } from 'lucide-react';
import { API_URL } from '../../utils/apiClient';
import useCurrency from '../../hooks/useCurrency';
import './RoomInventoryDashboard.css';

/* ── helpers ── */
const getAuthHeaders = () => {
  try {
    const raw = localStorage.getItem('hotel-enterprise-storage');
    const token = raw ? JSON.parse(raw)?.state?.authToken : null;
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch { return {}; }
};

const STATUS_META = {
  ready:    { label: 'מוכן',      labelEn: 'Ready',    color: '#16a34a', bg: '#dcfce7', border: '#bbf7d0', dot: '🟢' },
  occupied: { label: 'תפוס',      labelEn: 'Occupied', color: '#dc2626', bg: '#fee2e2', border: '#fecaca', dot: '🔴' },
  dirty:    { label: 'בניקיון',   labelEn: 'Cleaning', color: '#b45309', bg: '#fef3c7', border: '#fde68a', dot: '🟡' },
};

const fmtDate = (iso) => {
  if (!iso) return '—';
  try {
    return new Date(iso + 'T00:00:00').toLocaleDateString('he-IL', {
      weekday: 'short', day: 'numeric', month: 'short',
    });
  } catch { return iso; }
};

/** Group rooms by portfolio site (Bazaar / City Tower / ROOMS). */
function inferInventoryBucket(room) {
  const n = `${room?.property_name || ''} ${room?.name || ''}`.toLowerCase();
  if (/bazaar|בזאר|יפו|jaffa|מלון בזאר/.test(n)) return 'bazaar';
  if (/city tower|leonardo|סיטי|רמת גן|ramat gan|בורסה|diamond/.test(n)) return 'citytower';
  if (/rooms sky|sky tower|רומס|cowork|fattal|workspace/.test(n)) return 'rooms';
  return 'other';
}

/** Reliable Unsplash fallbacks — match app.py BOUTIQUE_HOTEL_PLACEHOLDER / Bazaar seed (no /assets 404s). */
const DEFAULT_BOUTIQUE_HOTEL_URL =
  'https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?w=800&auto=format&fit=crop&q=85';
/** Match app.py BAZAAR_IMG_* — Hotel Bazaar Jaffa room categories */
const BAZAAR_STANDARD_URL =
  'https://images.unsplash.com/photo-1611892440504-42a792e24d32?w=1200&auto=format&fit=crop&q=85';
const BAZAAR_DELUXE_URL =
  'https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?w=1200&auto=format&fit=crop&q=85';
const BAZAAR_SUITE_URL =
  'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=1200&auto=format&fit=crop&q=85';
const DEFAULT_BAZAAR_HOTEL_URL = BAZAAR_DELUXE_URL;
const DEFAULT_ROOMS_WORKSPACE_URL =
  'https://images.unsplash.com/photo-1497366216548-37526070297c?w=1200&auto=format&fit=crop&q=85';

/** Treat stock/placeholder URLs as missing so we swap to HTTPS fallbacks. */
const GENERIC_ROOM_IMAGE = /placeholder|via\.placeholder|picsum|unsplash\.com\/random|dummy|generic|default-hotel/i;

function resolveRoomPhotoUrl(room) {
  const raw = (room?.photo_url || '').trim();
  if (raw && !GENERIC_ROOM_IMAGE.test(raw)) return raw;
  const n = `${room?.name || ''} ${room?.property_name || ''}`;
  if (/standard queen/i.test(n)) return BAZAAR_STANDARD_URL;
  if (/deluxe gallery/i.test(n)) return BAZAAR_DELUXE_URL;
  if (/jaffa suite/i.test(n)) return BAZAAR_SUITE_URL;
  const b = inferInventoryBucket(room);
  if (b === 'bazaar') return DEFAULT_BAZAAR_HOTEL_URL;
  if (b === 'citytower') return DEFAULT_BOUTIQUE_HOTEL_URL;
  if (b === 'rooms') return DEFAULT_ROOMS_WORKSPACE_URL;
  return DEFAULT_BOUTIQUE_HOTEL_URL;
}

const INVENTORY_SECTIONS = [
  { id: 'bazaar', title: 'בזאר יפו — 32 חדרי בוטיק' },
  { id: 'citytower', title: 'סיטי טאוור — דלוקס, אקזקוטיב, קלאב, סוויטות (ג׳וניור/ג׳קוזי), נגיש' },
  { id: 'rooms', title: 'ROOMS — משרדים (לפי קיבולת), חדרי ישיבות, חללי אירוע' },
  { id: 'other', title: 'נכסים נוספים' },
];

const POLL_MS = 20_000;

/* ── sub-components ── */
function SummaryPill({ count, status }) {
  const meta = STATUS_META[status];
  if (!meta) return null;
  return (
    <div className="ri-pill" style={{ background: meta.bg, border: `1px solid ${meta.border}` }}>
      <span className="ri-pill-dot" style={{ background: meta.color }} />
      <span className="ri-pill-count" style={{ color: meta.color }}>{count}</span>
      <span className="ri-pill-label" style={{ color: meta.color }}>{meta.label}</span>
    </div>
  );
}

function RoomCard({ room }) {
  const primary =
    room && typeof room === 'object' ? resolveRoomPhotoUrl(room) : '';
  const [photoSrc, setPhotoSrc] = useState(primary);
  useEffect(() => {
    setPhotoSrc(primary);
  }, [primary]);
  if (!room || typeof room !== 'object') return null;
  const meta = STATUS_META[room.status] || STATUS_META.ready;
  const roomName = room.name != null ? String(room.name) : '—';
  return (
    <div className="ri-room-card" data-status={room.status || 'ready'} style={{ borderTop: `4px solid ${meta.color}` }}>
      {photoSrc ? (
        <div className="ri-room-photo-wrap">
          <img
            src={photoSrc}
            alt={roomName}
            className="ri-room-photo"
            loading="lazy"
            decoding="async"
            onError={() => setPhotoSrc(DEFAULT_BOUTIQUE_HOTEL_URL)}
          />
        </div>
      ) : (
        <div className="ri-room-photo-placeholder">
          <BedDouble size={28} color="#94a3b8" />
        </div>
      )}
      <div className="ri-room-body">
        <div className="ri-room-name">{roomName}</div>
        <div className="ri-room-meta">
          <BedDouble size={12} /> {room.beds || 1} מיטות
          {room.bedrooms > 1 && <> · {room.bedrooms} חדרי שינה</>}
        </div>
        {room.guest && room.status === 'occupied' && (
          <div className="ri-room-guest">
            <Users size={11} /> {room.guest}
          </div>
        )}
        <span
          className="ri-room-badge"
          style={{ background: meta.bg, color: meta.color, border: `1px solid ${meta.border}` }}
        >
          {meta.dot} {meta.label}
        </span>
      </div>
    </div>
  );
}

function BookingRow({ booking }) {
  const { format } = useCurrency();
  if (!booking || typeof booking !== 'object') return null;
  const isToday = booking.check_in === new Date().toISOString().split('T')[0];
  return (
    <tr className={`ri-booking-row ${isToday ? 'ri-booking-row--today' : ''}`}>
      <td className="ri-td ri-td-guest">
        <span className="ri-guest-avatar">{(booking.guest_name || '?')[0].toUpperCase()}</span>
        {booking.guest_name}
      </td>
      <td className="ri-td ri-td-room">{booking.property_name}</td>
      <td className="ri-td">
        <span className={`ri-checkin-date ${isToday ? 'ri-checkin--today' : ''}`}>
          {isToday && <span className="ri-today-badge">היום!</span>}
          {fmtDate(booking.check_in)}
        </span>
      </td>
      <td className="ri-td ri-td-nights">{booking.nights} לילות</td>
      <td className="ri-td ri-td-price">
        {booking.total_price ? format(booking.total_price) : '—'}
      </td>
    </tr>
  );
}

/* ── main component ── */
export default function RoomInventoryDashboard() {
  const [rooms, setRooms] = useState([]);
  const [summary, setSummary] = useState({ ready: 0, occupied: 0, dirty: 0, total: 0 });
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastFetch, setLastFetch] = useState(null);
  const [filter, setFilter] = useState('all'); // all | ready | occupied | dirty
  const [seeding, setSeeding] = useState(false);
  const seedingRef = useRef(false);
  const rootRef = useRef(null);

  const seedAndRefresh = useCallback(async () => {
    if (seedingRef.current) return;
    seedingRef.current = true;
    setSeeding(true);
    try {
      await fetch(`${API_URL}/seed-rooms-status`, { method: 'POST' });
    } catch (_) {}
    seedingRef.current = false;
    setSeeding(false);
  }, []);

  const fetchDashboardData = useCallback(async (forceRefresh = false) => {
    const headers = { 'Content-Type': 'application/json', ...getAuthHeaders() };
    const gridQ = forceRefresh ? '?refresh=1' : '';
    const gridUrl = `${API_URL}/rooms/status-grid${gridQ}`;
    const bookingsUrl = `${API_URL}/bookings/upcoming`;
    try {
      const [gridRes, upcomingRes] = await Promise.all([
        fetch(gridUrl, { headers, credentials: 'include' }),
        fetch(bookingsUrl, { headers, credentials: 'include' }),
      ]);
      if (!gridRes.ok) {
        const snippet = await gridRes.text().catch(() => '');
        console.warn(
          '[RoomInventory] status-grid not OK',
          gridRes.status,
          gridUrl,
          typeof window !== 'undefined' ? window.__EASYHOST_API_URL__ : '',
          snippet?.slice?.(0, 200),
        );
      }
      if (!upcomingRes.ok) {
        const snippet = await upcomingRes.text().catch(() => '');
        console.warn(
          '[RoomInventory] bookings/upcoming not OK',
          upcomingRes.status,
          bookingsUrl,
          snippet?.slice?.(0, 200),
        );
      }
      if (gridRes.ok) {
        let gd = null;
        try {
          gd = await gridRes.json();
        } catch {
          gd = null;
        }
        if (gd && typeof gd === 'object') {
          const roomList = Array.isArray(gd.rooms) ? gd.rooms : [];
          if (roomList.length === 0 && (gd.summary == null || Object.keys(gd.summary || {}).length === 0)) {
            const base = typeof window !== 'undefined' ? window.__EASYHOST_API_URL__ : '';
            console.warn('[RoomInventory] empty grid payload — wrong API URL?', base || API_URL, gd);
          }
          setRooms(roomList);
          const s = gd.summary && typeof gd.summary === 'object' ? gd.summary : {};
          setSummary({
            ready: Number(s.ready) || 0,
            occupied: Number(s.occupied) || 0,
            dirty: Number(s.dirty) || 0,
            total: Number(s.total) || 0,
          });
        }
      }
      if (upcomingRes.ok) {
        let ud = null;
        try {
          ud = await upcomingRes.json();
        } catch {
          ud = null;
        }
        if (ud && typeof ud === 'object' && Array.isArray(ud.bookings)) {
          setBookings(ud.bookings);
        } else if (ud && typeof ud === 'object') {
          setBookings([]);
        }
      }
      setLastFetch(new Date());
    } catch (err) {
      console.error('[RoomInventory] fetch error — backend URL:', API_URL, err);
      /* keep previous rooms/summary/bookings — do not wipe UI on transient failures */
    } finally {
      setLoading(false);
    }
  }, []);

  /* Initial load + polling + cross-tab refresh — single effect to avoid hook-order / stale issues */
  useEffect(() => {
    fetchDashboardData();
    const id = setInterval(() => fetchDashboardData(), POLL_MS);
    const bump = () => fetchDashboardData(true);
    window.addEventListener('properties-refresh', bump);
    window.addEventListener('maya-refresh-tasks', bump);
    return () => {
      clearInterval(id);
      window.removeEventListener('properties-refresh', bump);
      window.removeEventListener('maya-refresh-tasks', bump);
    };
  }, [fetchDashboardData]);

  const safeRooms = Array.isArray(rooms) ? rooms : [];
  const safeSummary = {
    ready: Number(summary?.ready) || 0,
    occupied: Number(summary?.occupied) || 0,
    dirty: Number(summary?.dirty) || 0,
    total: Number(summary?.total) || 0,
  };
  const safeBookings = Array.isArray(bookings) ? bookings.filter(Boolean) : [];

  const filteredRooms = filter === 'all' ? safeRooms : safeRooms.filter((r) => r && r.status === filter);

  const roomsBySection = useMemo(() => {
    const m = { bazaar: [], citytower: [], rooms: [], other: [] };
    filteredRooms.forEach((room) => {
      const b = inferInventoryBucket(room);
      if (m[b]) m[b].push(room);
      else m.other.push(room);
    });
    return m;
  }, [filteredRooms]);

  return (
    <div className="ri-root" ref={rootRef}>

      {/* ── Header ── */}
      <div className="ri-header">
        <div className="ri-header-left">
          <h1 className="ri-title">לוח חדרים</h1>
          {lastFetch && (
            <span className="ri-last-fetch">
              <RefreshCw size={11} />
              עודכן {lastFetch.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
        <button
          className="ri-refresh-btn"
          onClick={() => fetchDashboardData(true)}
          title="רענון מלא — דילוג על מטמון"
        >
          <RefreshCw size={15} />
          רענן
        </button>
      </div>

      {/* ── Summary pills ── */}
      <div className="ri-summary-row">
        <SummaryPill count={safeSummary.ready}    status="ready" />
        <SummaryPill count={safeSummary.occupied} status="occupied" />
        <SummaryPill count={safeSummary.dirty}    status="dirty" />
        <div className="ri-pill ri-pill-total">
          <BedDouble size={14} color="#374151" />
          <span className="ri-pill-count" style={{ color: '#374151' }}>{safeSummary.total}</span>
          <span className="ri-pill-label" style={{ color: '#374151' }}>סה״כ חדרים</span>
        </div>
      </div>

      {/* ── Filter bar ── */}
      <div className="ri-filter-bar">
        {['all', 'ready', 'occupied', 'dirty'].map((f) => (
          <button
            key={f}
            className={`ri-filter-btn ${filter === f ? 'ri-filter-btn--active' : ''}`}
            onClick={() => setFilter(f)}
            style={filter === f && f !== 'all'
              ? { background: STATUS_META[f]?.bg, color: STATUS_META[f]?.color, borderColor: STATUS_META[f]?.border }
              : {}
            }
          >
            {f === 'all' ? 'הכל' : STATUS_META[f]?.dot + ' ' + STATUS_META[f]?.label}
          </button>
        ))}
      </div>

      {/* ── Room Grid ── */}
      {loading ? (
        <div className="ri-loading">
          <div className="ri-spinner" />
          <span>טוען חדרים…</span>
        </div>
      ) : filteredRooms.length === 0 ? (
        <div className="ri-empty">
          <AlertCircle size={32} color="#d1d5db" />
          {safeRooms.length === 0 ? (
            <p>Please add a property first.</p>
          ) : (
            <>
              <p>No rooms in this status.</p>
              <button
                onClick={seedAndRefresh}
                disabled={seeding}
                style={{
                  marginTop: 12, padding: '8px 20px', borderRadius: 8,
                  background: seeding ? '#4b5563' : '#00ff88',
                  color: '#000', fontWeight: 900, border: 'none', cursor: 'pointer',
                }}
              >
                {seeding ? '⏳ Seeding...' : '⚡ Seed Rooms (demo data)'}
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="ri-sections">
          {INVENTORY_SECTIONS.map((sec) => {
            const list = roomsBySection[sec.id] || [];
            if (!list.length) return null;
            return (
              <section key={sec.id} className="ri-inventory-section">
                <h2 className="ri-inventory-section-title">{sec.title}</h2>
                <div className="ri-grid">
                  {list.map((room, idx) => (
                    <RoomCard
                      key={room?.id != null ? String(room.id) : `${sec.id}-room-${idx}`}
                      room={room}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* ── Upcoming Bookings ── */}
      <div className="ri-bookings-section">
        <div className="ri-section-header">
          <Clock size={16} />
  <h2 className="ri-section-title">צ׳ק-אין הקרובים — 7 ימים</h2>
          <span className="ri-booking-count">{safeBookings.length}</span>
        </div>

        {safeBookings.length === 0 ? (
          <div className="ri-empty-small">
            <CheckCircle2 size={20} color="#d1d5db" />
            <span>אין הזמנות קרובות ל-7 הימים הבאים</span>
          </div>
        ) : (
          <div className="ri-table-wrap">
            <table className="ri-table">
              <thead>
                <tr>
                  <th className="ri-th">אורח</th>
                  <th className="ri-th">חדר / נכס</th>
                  <th className="ri-th">צ׳ק-אין</th>
                  <th className="ri-th">לילות</th>
                  <th className="ri-th">מחיר</th>
                </tr>
              </thead>
              <tbody>
                {safeBookings.map((b, i) => (
                  <BookingRow key={b?.id != null ? String(b.id) : `bk-${i}`} booking={b} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  );
}
