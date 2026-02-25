/**
 * ManagerPipeline — Manager's live operations centre
 *
 * Tab 1: "Completed Today" — scrolling feed with completion times
 * Tab 2: "Worker Productivity" — glassmorphism table with per-worker stats
 *
 * Polls /api/completed-today (feed) and /api/worker-productivity (table).
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { API_URL } from '../../utils/apiClient';

/* ── CSS ─────────────────────────────────────────────────── */
const CSS = `
  @keyframes mpIn  { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
  @keyframes mpPulse{ 0%,100%{opacity:1} 50%{opacity:.4} }
  @keyframes mpSpin { to{transform:rotate(360deg)} }
  @keyframes mpBar  { from{width:0} to{width:var(--w)} }
`;

/* ── helpers ─────────────────────────────────────────────── */
function fmtTime(iso) {
  if (!iso) return '--:--';
  try { return new Date(iso).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }); }
  catch { return '--:--'; }
}
function roomLabel(t) {
  return t.property_name || t.room || (t.property_id ? `חדר ${t.property_id}` : 'חדר ?');
}
function descShort(t) {
  const s = t.description || t.task_type || t.content || 'משימה';
  return s.length > 55 ? s.slice(0, 53) + '…' : s;
}

/* ── Shared glass styles ─────────────────────────────────── */
const glass = (extra = {}) => ({
  background: 'rgba(15,25,40,0.65)',
  backdropFilter: 'blur(22px)',
  WebkitBackdropFilter: 'blur(22px)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 24,
  overflow: 'hidden',
  boxShadow: '0 8px 40px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06)',
  ...extra,
});

/* ══════════════════════════════════════════════════════
   TAB 1 — Completed-Today feed
═══════════════════════════════════════════════════════ */
function FeedRow({ task, idx }) {
  const worker = task.staff_name || '—';
  const dur    = task.duration_minutes ? `⚡ ${task.duration_minutes} דק'` : null;

  return (
    <div
      style={{
        display: 'flex', gap: 14, alignItems: 'flex-start',
        padding: '11px 16px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        transition: 'background .2s',
        animation: `mpIn .4s ease ${idx * 0.05}s both`,
        cursor: 'default',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
    >
      {/* Timeline spine */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flexShrink: 0, paddingTop: 3 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.38)', whiteSpace: 'nowrap' }}>
          {fmtTime(task.updated_at || task.created_at)}
        </span>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#34d399', boxShadow: '0 0 8px #34d399' }} />
        <div style={{ width: 1, flex: 1, background: 'rgba(255,255,255,0.07)', minHeight: 14 }} />
      </div>

      {/* Content */}
      <div style={{ flex: 1, direction: 'rtl' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 3, flexWrap: 'wrap' }}>
          <span style={{
            background: 'rgba(52,211,153,0.14)', border: '1px solid rgba(52,211,153,0.28)',
            color: '#34d399', fontSize: 10, fontWeight: 800, padding: '2px 9px', borderRadius: 20,
          }}>✅ הושלם</span>
          <span style={{ fontWeight: 800, color: '#fff', fontSize: 14 }}>{roomLabel(task)}</span>
          {dur && <span style={{ fontSize: 11, color: '#fbbf24', fontWeight: 700 }}>{dur}</span>}
        </div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', lineHeight: 1.4 }}>{descShort(task)}</div>
        <div style={{ marginTop: 4, display: 'flex', gap: 5, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>בוצע ע"י</span>
          <span style={{
            fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.65)',
            background: 'rgba(255,255,255,0.07)', padding: '2px 8px', borderRadius: 18,
          }}>👤 {worker}</span>
        </div>
      </div>
    </div>
  );
}

function FeedTab() {
  const [tasks,   setTasks]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [spin,    setSpin]    = useState(false);
  const [sync,    setSync]    = useState(null);
  const timer = useRef(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setSpin(true);
    try {
      const res  = await fetch(`${API_URL}/api/completed-today`);
      if (!res.ok) throw new Error(res.status);
      const data = await res.json();
      setTasks(Array.isArray(data) ? data : data.tasks || []);
      setSync(new Date());
    } catch { /* stale */ }
    finally { setLoading(false); setSpin(false); }
  }, []);

  useEffect(() => {
    load();
    timer.current = setInterval(() => load(true), 12_000);
    return () => clearInterval(timer.current);
  }, [load]);

  return (
    <div>
      {/* Sub-header */}
      <div style={{
        padding: '10px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        borderBottom: '1px solid rgba(255,255,255,0.07)',
      }}>
        <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11 }}>
          {sync ? `עודכן ${sync.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}` : '...'}
        </span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{
            background: tasks.length > 0 ? 'rgba(52,211,153,0.18)' : 'rgba(255,255,255,0.07)',
            border: `1px solid ${tasks.length > 0 ? 'rgba(52,211,153,0.35)' : 'rgba(255,255,255,0.1)'}`,
            color: tasks.length > 0 ? '#34d399' : 'rgba(255,255,255,0.35)',
            fontWeight: 800, fontSize: 12, padding: '2px 11px', borderRadius: 20,
          }}>{tasks.length} ✓</span>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#34d399', display: 'inline-block', animation: 'mpPulse 2s infinite' }} />
          <button onClick={() => load()} style={{
            background: 'rgba(255,255,255,0.08)', border: 'none', color: 'rgba(255,255,255,0.6)',
            width: 28, height: 28, borderRadius: '50%', cursor: 'pointer', fontSize: 14,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span style={{ display: 'inline-block', animation: spin ? 'mpSpin .6s linear infinite' : 'none' }}>↻</span>
          </button>
        </div>
      </div>

      {/* Feed */}
      <div style={{ maxHeight: 380, overflowY: 'auto' }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'rgba(255,255,255,0.35)', fontSize: 13 }}>
            <span style={{ animation: 'mpSpin 1s linear infinite', display: 'inline-block' }}>⏳</span> טוען...
          </div>
        ) : tasks.length === 0 ? (
          <div style={{ padding: '40px 20px', textAlign: 'center', color: 'rgba(255,255,255,0.3)', direction: 'rtl' }}>
            <div style={{ fontSize: 34, marginBottom: 8 }}>📭</div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>אין משימות שהושלמו היום עדיין</div>
          </div>
        ) : (
          tasks.map((t, i) => <FeedRow key={t.id || i} task={t} idx={i} />)
        )}
      </div>

      {tasks.length > 0 && (
        <div style={{
          padding: '8px 16px', background: 'rgba(0,0,0,0.2)',
          borderTop: '1px solid rgba(255,255,255,0.05)',
          textAlign: 'center', color: 'rgba(255,255,255,0.22)', fontSize: 10,
        }}>
          מרענן אוטומטית כל 12 שניות
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   TAB 2 — Worker Productivity table
═══════════════════════════════════════════════════════ */
function SpeedBadge({ mins }) {
  if (mins == null) return <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12 }}>—</span>;
  const m = parseFloat(mins);
  const color = m <= 10 ? '#34d399' : m <= 20 ? '#fbbf24' : '#f87171';
  const label = m <= 10 ? '⚡' : m <= 20 ? '🟡' : '🐢';
  return (
    <span style={{ color, fontWeight: 800, fontSize: 13 }}>{label} {m} דק'</span>
  );
}

function BarCell({ value, max }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{
        flex: 1, height: 6, background: 'rgba(255,255,255,0.08)',
        borderRadius: 3, overflow: 'hidden', minWidth: 60,
      }}>
        <div style={{
          height: '100%', borderRadius: 3,
          background: 'linear-gradient(90deg,#34d399,#25D366)',
          '--w': `${pct}%`, width: `${pct}%`,
          animation: 'mpBar .7s ease',
        }} />
      </div>
      <span style={{ fontSize: 11, color: '#34d399', fontWeight: 700, minWidth: 32 }}>{pct}%</span>
    </div>
  );
}

function ProductivityTab() {
  const [rows,    setRows]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [spin,    setSpin]    = useState(false);
  const [sync,    setSync]    = useState(null);
  const timer = useRef(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setSpin(true);
    try {
      const res = await fetch(`${API_URL}/api/worker-productivity`);
      if (!res.ok) throw new Error(res.status);
      setRows(await res.json());
      setSync(new Date());
    } catch { /* stale */ }
    finally { setLoading(false); setSpin(false); }
  }, []);

  useEffect(() => {
    load();
    timer.current = setInterval(() => load(true), 15_000);
    return () => clearInterval(timer.current);
  }, [load]);

  const maxDone = Math.max(1, ...rows.map(r => r.tasks_done || 0));

  return (
    <div>
      {/* Sub-header */}
      <div style={{
        padding: '10px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        borderBottom: '1px solid rgba(255,255,255,0.07)',
      }}>
        <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11 }}>
          {sync ? `עודכן ${sync.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}` : '...'}
        </span>
        <button onClick={() => load()} style={{
          background: 'rgba(255,255,255,0.08)', border: 'none', color: 'rgba(255,255,255,0.6)',
          width: 28, height: 28, borderRadius: '50%', cursor: 'pointer', fontSize: 14,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <span style={{ display: 'inline-block', animation: spin ? 'mpSpin .6s linear infinite' : 'none' }}>↻</span>
        </button>
      </div>

      <div style={{ overflowX: 'auto', maxHeight: 380, overflowY: 'auto' }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'rgba(255,255,255,0.35)', fontSize: 13 }}>
            <span style={{ animation: 'mpSpin 1s linear infinite', display: 'inline-block' }}>⏳</span> טוען...
          </div>
        ) : rows.length === 0 ? (
          <div style={{ padding: '40px 20px', textAlign: 'center', color: 'rgba(255,255,255,0.3)', direction: 'rtl' }}>
            <div style={{ fontSize: 34, marginBottom: 8 }}>👥</div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>אין נתוני עובדים להיום</div>
            <div style={{ fontSize: 12, marginTop: 4, color: 'rgba(255,255,255,0.2)' }}>
              כשעובד יסמן משימה, הנתונים יופיעו כאן
            </div>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', direction: 'rtl', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                {['עובד', 'הושלם', 'ממתין', 'מהירות ממוצעת', 'ביצועים', 'משמרת', 'פעיל לאחרונה'].map(h => (
                  <th key={h} style={{
                    padding: '9px 12px', textAlign: 'right',
                    color: 'rgba(255,255,255,0.45)', fontWeight: 700,
                    fontSize: 11, letterSpacing: '0.04em', whiteSpace: 'nowrap',
                    borderBottom: '1px solid rgba(255,255,255,0.08)',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.worker || i} style={{
                  animation: `mpIn .4s ease ${i * 0.06}s both`,
                  transition: 'background .2s',
                }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <td style={{ padding: '10px 12px', color: '#fff', fontWeight: 700, whiteSpace: 'nowrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <div style={{
                        width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                        background: `hsl(${(i * 67) % 360},55%,42%)`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 12, fontWeight: 900, color: '#fff',
                      }}>{(r.worker||'?')[0].toUpperCase()}</div>
                      {r.worker}
                    </div>
                  </td>
                  <td style={{ padding: '10px 12px', color: '#34d399', fontWeight: 800, textAlign: 'center' }}>
                    {r.tasks_done || 0}
                  </td>
                  <td style={{ padding: '10px 12px', color: '#fbbf24', fontWeight: 700, textAlign: 'center' }}>
                    {r.tasks_pending || 0}
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <SpeedBadge mins={r.avg_duration_minutes} />
                  </td>
                  <td style={{ padding: '10px 12px', minWidth: 120 }}>
                    <BarCell value={r.tasks_done || 0} max={maxDone} />
                  </td>
                  <td style={{ padding: '10px 12px', color: 'rgba(255,255,255,0.5)', fontSize: 12, whiteSpace: 'nowrap' }}>
                    {r.shift_start || '—'}
                  </td>
                  <td style={{ padding: '10px 12px', color: 'rgba(255,255,255,0.5)', fontSize: 12, whiteSpace: 'nowrap' }}>
                    {r.last_active || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {rows.length > 0 && (
        <div style={{
          padding: '8px 16px', background: 'rgba(0,0,0,0.2)',
          borderTop: '1px solid rgba(255,255,255,0.05)',
          textAlign: 'center', color: 'rgba(255,255,255,0.22)', fontSize: 10,
        }}>
          מרענן אוטומטית כל 15 שניות · ⚡ מהיר ≤10 דק' · 🟡 ממוצע ≤20 · 🐢 איטי
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   Root component
═══════════════════════════════════════════════════════ */
export default function ManagerPipeline() {
  const [tab, setTab] = useState('feed');

  const TABS = [
    { id: 'feed',         label: '🏆 הושלם היום' },
    { id: 'productivity', label: '📊 ביצועי עובדים' },
  ];

  return (
    <>
      <style>{CSS}</style>

      <div style={glass()}>

        {/* Panel header */}
        <div style={{
          padding: '14px 18px 0',
          background: 'rgba(7,94,84,0.32)',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
        }}>
          <div style={{ display: 'flex', gap: 6, paddingBottom: 14 }}>
            {TABS.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)} style={{
                flex: 1, padding: '8px 0',
                background: tab === t.id
                  ? 'linear-gradient(135deg,#075E54,#25D366)'
                  : 'rgba(255,255,255,0.07)',
                border: `1px solid ${tab === t.id ? '#25D366' : 'rgba(255,255,255,0.1)'}`,
                borderRadius: 12, color: '#fff', fontWeight: 700, fontSize: 12,
                cursor: 'pointer', transition: 'all .2s',
              }}>{t.label}</button>
            ))}
          </div>
        </div>

        {/* Tab content */}
        {tab === 'feed'         && <FeedTab />}
        {tab === 'productivity' && <ProductivityTab />}
      </div>
    </>
  );
}
