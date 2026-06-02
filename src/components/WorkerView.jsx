/**
 * WorkerView — Agent-grade TikTok worker portal
 *
 * ┌─────────────────────────────────────┐
 * │  App bar: name · task X/N · refresh │
 * ├─────────────────────────────────────┤
 * │                                     │
 * │   ▲ prev     CURRENT TASK     next ▼│
 * │         Room 102 · HUGE text        │
 * │         Description bubble          │
 * │         [Accept] / [✅ Done]        │
 * │                                     │
 * ├─────────────────────────────────────┤
 * │  [📊 My Stats]   [↻ Refresh]        │
 * └─────────────────────────────────────┘
 *
 * Stats drawer slides up from bottom with glassmorphism.
 * Shows: tasks today / done / avg speed / shift duration.
 * History tab shows today's completed tasks.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import confetti from 'canvas-confetti';
import { AnimatePresence, motion } from 'framer-motion';
import { BedDouble, Sparkles, Wrench, MapPin, Building2 } from 'lucide-react';
import { API_URL } from '../utils/apiClient';
import useStore from '../store/useStore';
import './WorkerView.css';
import './dashboard/TaskCalendar.css';
import { subscribeCrossTabTaskSync } from '../utils/taskSyncBridge';
import CelebrationOverlay from './worker/CelebrationOverlay';
import XpProgressBar from './worker/XpProgressBar';
import { getWeWorkBranchById } from '../config/weworkBranches';
import { BAZAAR_JAFFA_PROPERTY_ID } from '../data/propertyData';
import { getInitialTasksForWorker } from '../data/initialTasks';

/* Premium dark palette — native-app feel */
const W = {
  bg: 'transparent',
  page: 'rgba(18, 26, 40, 0.88)',
  border: 'rgba(0, 229, 200, 0.2)',
  text: '#e8eef9',
  muted: 'rgba(200, 214, 235, 0.55)',
  soft: 'rgba(255, 255, 255, 0.07)',
  accent: '#00e5c8',
  accentDark: '#00b89a',
  success: '#34d399',
  warn: '#fbbf24',
  white: '#061018',
};
/* Stats drawer still uses dark surfaces — local tokens */
const D = {
  green: '#25D366',
  accent: '#34d399',
  amber: '#fbbf24',
  blue: '#60a5fa',
  muted: 'rgba(255,255,255,0.45)',
};

/** Polling only (Socket.IO off by default) — 15–20s keeps load light */
const POLL_MS = 15_000;

/* ── helpers ─────────────────────────────────────────────── */
function workerNameFromPath() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  return parts[1] ? decodeURIComponent(parts[1]) : null;
}
function isPending(s = '') {
  return ['pending','Pending','assigned','Assigned','queued','Queued'].includes(s);
}
function isInProgress(s = '') {
  // "Accepted" is the legacy name for In_Progress — treat identically
  return ['In_Progress','in_progress','in progress','InProgress',
          'Accepted','accepted','started','Started','working','Working'].includes(s);
}
// eslint-disable-next-line no-unused-vars
function isDone(s = '') {
  return ['done','Done','completed','Completed','closed','Closed'].includes(s);
}
function fmtTime(iso) {
  if (!iso) return '--:--';
  try { return new Date(iso).toLocaleTimeString('he-IL',{hour:'2-digit',minute:'2-digit'}); }
  catch { return ''; }
}
function fmtShortDate(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString('he-IL',{day:'2-digit',month:'2-digit'}); }
  catch { return ''; }
}

/** Normalize API payload + attach display names for pinned WeWork / Bazaar property UUIDs */
function normalizeWorkerTasksPayload(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') {
    if (Array.isArray(raw.tasks)) return raw.tasks;
    if (Array.isArray(raw.data)) return raw.data;
    if (Array.isArray(raw.items)) return raw.items;
  }
  return [];
}

function enrichWorkerTaskPropertyMeta(task) {
  if (!task) return task;
  const pid = String(task.property_id || '').trim();
  if (!pid) return task;
  const ww = getWeWorkBranchById(pid);
  if (ww) {
    return { ...task, property_name: ww.name, hotel_name: task.hotel_name || ww.name };
  }
  if (pid === BAZAAR_JAFFA_PROPERTY_ID) {
    return {
      ...task,
      property_name: 'Hotel Bazaar Jaffa',
      hotel_name: task.hotel_name || 'Hotel Bazaar Jaffa',
    };
  }
  return task;
}

function safeStr(val, fallback = '') {
  if (val == null) return fallback;
  if (typeof val === 'string') return val;
  if (typeof val === 'object') return safeStr(val.content ?? val.title ?? val.text, fallback);
  return String(val);
}

/** Towels, urgent cleaning, explicit high priority, keywords */
function isHighPriorityTask(t) {
  if (!t) return false;
  const p = String(t.priority || '').toLowerCase();
  if (p === 'high') return true;
  const d = `${t.description || ''} ${t.title || ''} ${t.content || ''}`.toLowerCase();
  if (d.includes('priority alert') || d.includes('⚡')) return true;
  if (d.includes('דחוף') || d.includes('urgent')) return true;
  if (d.includes('towel') || d.includes('מגבת') || d.includes('מגבות')) return true;
  const tt = String(t.task_type || '').toLowerCase();
  if (tt === 'cleaning' && (d.includes('urgent') || d.includes('דחוף'))) return true;
  return false;
}

function getUrgencyMinutesSinceCreated(createdAt) {
  if (!createdAt) return 0;
  try {
    const t = new Date(createdAt).getTime();
    if (Number.isNaN(t)) return 0;
    return (Date.now() - t) / 60000;
  } catch {
    return 0;
  }
}

/** Pending = action needed (red). In-progress = orange (see wv-focus-in-progress-run). Done = green. */
function urgencyClassForPendingMinutes(_m) {
  return 'wv-focus-urgency-red';
}

function roomHebrewLabelForMaya(task) {
  const m = String(task?.room_number || task?.property_name || task?.room || '').match(/(\d{1,4})/);
  if (m) return `חדר ${m[1]}`;
  const p = String(task?.property_name || '').trim();
  return p || 'החדר';
}

function buildMayaInterventionMessageHe(task) {
  const r = roomHebrewLabelForMaya(task);
  return `היי, ${r} דחוף מאוד. את זמינה לזה או שנחפש פתרון אחר?`;
}

function roomEnglishLabel(task) {
  const r = task?.room_number || task?.property_name || task?.room || '';
  const m = String(r).match(/(\d{1,4})/);
  if (m) return `Room ${m[1]}`;
  const s = String(r).trim();
  return s || 'this room';
}

function firstNameFromWorkerKey(name) {
  const s = String(name || '').trim();
  if (!s) return 'there';
  const part = s.split(/[\s/]+/)[0];
  return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
}

function playPriorityChime() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.connect(g);
    g.connect(ctx.destination);
    o.frequency.setValueAtTime(880, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.12);
    g.gain.setValueAtTime(0.12, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.45);
    o.start(ctx.currentTime);
    o.stop(ctx.currentTime + 0.45);
    setTimeout(() => { try { ctx.close(); } catch (_) { /* noop */ } }, 600);
  } catch (_) {
    try {
      const a = new Audio(`${process.env.PUBLIC_URL || ''}/sounds/success.mp3`);
      a.volume = 0.45;
      a.play().catch(() => {});
    } catch (_) { /* noop */ }
  }
}

/* ── Task Board card (matches admin TaskCalendar) ─────────── */
function WorkerTaskBoardCard({ task }) {
  const desc = safeStr(task?.description ?? task?.title ?? task?.content) || '—';
  const propName = safeStr(task?.property_name ?? task?.room ?? task?.room_number);
  const thumb = (task?.property_pictures && task.property_pictures[0]) || task?.photo_url;
  return (
    <div
      className="task-card task-pending wv-modal-board-card"
      style={{ cursor: 'default', direction: 'rtl' }}
    >
      <div className="task-card-thumb">
        <div className="task-card-thumb-fallback" aria-hidden>
          <Building2 size={32} />
        </div>
        {thumb ? (
          <img
            src={thumb}
            alt={propName || 'property'}
            className="task-card-thumb-img"
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />
        ) : null}
      </div>
      <div className="task-card-header">
        <span className="task-status-badge pending">ממתין</span>
        <span className="task-date">
          {task?.created_at ? fmtShortDate(task.created_at) : '—'}
        </span>
      </div>
      <p className="task-description">{desc}</p>
      {safeStr(task?.property_context) && (
        <p className="text-xs text-gray-500 mt-0.5">{safeStr(task.property_context)}</p>
      )}
    </div>
  );
}

function MayaWorkerChat({
  workerName,
  task,
  onYes,
  onBusy,
  onTransfer,
  onNotAvailable,
  interventionMessageHe,
  onDismissIntervention,
  disabled,
}) {
  const room = roomEnglishLabel(task);
  const first = firstNameFromWorkerKey(workerName);
  const msg = `Hi ${first}, can you handle ${room} right now? It's urgent.`;
  return (
    <div className="wv-maya-chat" dir="rtl">
      <div className="wv-maya-chat-header">
        <span className="wv-maya-chat-avatar">✨</span>
        <span className="wv-maya-chat-title">Maya</span>
      </div>
      <p className="wv-maya-chat-msg" dir="ltr" style={{ textAlign: 'left' }}>{msg}</p>
      {interventionMessageHe && (
        <div className="wv-maya-intervention" role="status">
          <p className="wv-maya-intervention-text">{interventionMessageHe}</p>
          {typeof onDismissIntervention === 'function' && (
            <button type="button" className="wv-maya-intervention-dismiss" onClick={onDismissIntervention}>
              הבנתי
            </button>
          )}
        </div>
      )}
      <div className="wv-maya-chat-actions">
        <button type="button" className="wv-maya-btn wv-maya-btn-primary" disabled={disabled} onClick={onYes}>
          בדרך
        </button>
        <button type="button" className="wv-maya-btn wv-maya-btn-muted" disabled={disabled} onClick={onBusy}>
          עדיין עסוקה
        </button>
        <button type="button" className="wv-maya-btn wv-maya-btn-outline" disabled={disabled} onClick={onTransfer}>
          העברה למישהו אחר
        </button>
        <button type="button" className="wv-maya-btn wv-maya-btn-not-available" disabled={disabled} onClick={onNotAvailable}>
          לא זמינה
        </button>
      </div>
    </div>
  );
}

function PriorityAlertModal({ task, onDismiss }) {
  if (!task) return null;
  return (
    <div className="wv-priority-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="wv-priority-title">
      <div className="wv-priority-modal-panel">
        <div className="wv-priority-modal-badge">Priority Alert</div>
        <h2 id="wv-priority-title" className="wv-priority-modal-title">New urgent task</h2>
        <p className="wv-priority-modal-sub">Please review and respond below.</p>
        <WorkerTaskBoardCard task={task} />
        <button type="button" className="wv-priority-modal-ok" onClick={onDismiss}>
          Got it
        </button>
      </div>
    </div>
  );
}

/* ── CSS ─────────────────────────────────────────────────── */
const STYLES = `
  @keyframes wvIn {
    0%  { opacity:0; transform:scale(0.82) translateY(32px); }
    65% { transform:scale(1.03) translateY(-3px); }
    100%{ opacity:1; transform:scale(1) translateY(0); }
  }
  @keyframes wvOut {
    to  { opacity:0; transform:translateX(110%) rotate(7deg); }
  }
  @keyframes wvPrev {
    to  { opacity:0; transform:translateX(-110%) rotate(-7deg); }
  }
  @keyframes wvFlyUp {
    0%  { opacity:1; transform:translate(var(--tx),var(--ty)) scale(1); }
    100%{ opacity:0; transform:translate(var(--tx2),var(--ty2)) scale(0.3); }
  }
  @keyframes wvPulse {
    0%,100%{ box-shadow:0 0 0 0 rgba(37,211,102,0.55); }
    50%    { box-shadow:0 0 0 16px rgba(37,211,102,0); }
  }
  @keyframes wvSpin  { to{ transform:rotate(360deg); } }
  @keyframes wvBounce {
    0%,100%{ transform:scale(1); }
    40%    { transform:scale(1.14); }
    70%    { transform:scale(0.93); }
  }
  @keyframes wvSlideUp {
    from{ transform:translateY(100%); }
    to  { transform:translateY(0); }
  }
  @keyframes wvSlideDown {
    from{ transform:translateY(0); }
    to  { transform:translateY(100%); }
  }
  @keyframes wvToast {
    from{ opacity:0; transform:translateX(-50%) translateY(14px); }
    to  { opacity:1; transform:translateX(-50%) translateY(0); }
  }
  @keyframes wvFadeIn {
    from{ opacity:0; transform:translateY(8px); }
    to  { opacity:1; transform:translateY(0); }
  }
  body { margin:0; }
`;

/* ── Toast ───────────────────────────────────────────────── */
function Toast({ msg, onClose }) {
  useEffect(()=>{ const t=setTimeout(onClose,3000); return ()=>clearTimeout(t); },[onClose]);
  return (
    <div style={{
      position:'fixed',bottom:32,left:'50%',
      transform:'translateX(-50%)',
      background: W.page,
      color: W.text,
      border: `1px solid ${W.border}`,
      borderRadius:12,
      padding:'14px 28px',
      fontWeight:700,
      fontSize:14,
      boxShadow:'0 6px 24px rgba(0,0,0,0.12)',
      zIndex:9999,
      whiteSpace:'nowrap',
      animation:'wvToast .3s ease',
    }}>
      {msg}
    </div>
  );
}

/* ── Stat card (glassmorphism) ───────────────────────────── */
function StatCard({ label, value, sub, color = D.accent, icon }) {
  return (
    <div style={{
      background:'rgba(255,255,255,0.07)',
      backdropFilter:'blur(18px)', WebkitBackdropFilter:'blur(18px)',
      border:'1px solid rgba(255,255,255,0.14)',
      borderRadius:20, padding:'14px 16px',
      animation:'wvFadeIn 0.4s ease both',
    }}>
      <div style={{fontSize:22,marginBottom:4}}>{icon}</div>
      <div style={{fontSize:26,fontWeight:900,color,lineHeight:1}}>
        {value ?? '—'}
      </div>
      <div style={{fontSize:12,fontWeight:700,color:'rgba(255,255,255,0.75)',marginTop:3}}>
        {label}
      </div>
      {sub && <div style={{fontSize:11,color:'rgba(255,255,255,0.38)',marginTop:2}}>{sub}</div>}
    </div>
  );
}

/* ── Stats drawer (slide-up sheet) ──────────────────────── */
function StatsDrawer({ workerName, completedTasks, onClose }) {
  const [stats,    setStats]   = useState(null);
  const [tab,      setTab]     = useState('stats'); // 'stats' | 'history'
  const [closing,  setClosing] = useState(false);

  useEffect(()=>{
    fetch(`${API_URL}/worker-stats/${encodeURIComponent(workerName)}`)
      .then(r=>r.json()).then(setStats).catch(()=>{});
  },[workerName]);

  const close = ()=>{
    setClosing(true);
    setTimeout(onClose, 300);
  };

  const avgMin = stats?.avg_duration_minutes;
  const avgLabel = avgMin != null ? `${avgMin} דק'` : '—';

  const shiftStart = stats?.shift_start;
  const shiftDur = (() => {
    if (!shiftStart) return '—';
    try {
      const start = new Date(`1970-01-01T${shiftStart}:00Z`);
      const now   = new Date();
      const nowUTC= new Date(`1970-01-01T${now.toISOString().slice(11,16)}:00Z`);
      const diff  = Math.round((nowUTC - start) / 60000);
      if (diff < 0 || diff > 720) return '—';
      const h = Math.floor(diff/60), m = diff%60;
      return h > 0 ? `${h}ש' ${m}ד'` : `${m} דק'`;
    } catch { return '—'; }
  })();

  return (
    <>
      {/* Backdrop */}
      <div onClick={close} style={{
        position:'fixed',inset:0,
        background:'rgba(0,0,0,0.55)',
        backdropFilter:'blur(4px)', WebkitBackdropFilter:'blur(4px)',
        zIndex:200,
      }}/>

      {/* Sheet */}
      <div style={{
        position:'fixed', bottom:0, left:0, right:0, zIndex:201,
        background:'linear-gradient(180deg,rgba(10,18,35,0.97) 0%,rgba(7,94,84,0.25) 100%)',
        backdropFilter:'blur(28px)', WebkitBackdropFilter:'blur(28px)',
        borderTop:'1px solid rgba(255,255,255,0.15)',
        borderRadius:'28px 28px 0 0',
        maxHeight:'80vh', display:'flex', flexDirection:'column',
        animation: closing ? 'wvSlideDown .3s ease forwards' : 'wvSlideUp .35s cubic-bezier(0.32,0.72,0,1)',
      }}>

        {/* Handle */}
        <div style={{display:'flex',justifyContent:'center',padding:'12px 0 4px'}}>
          <div style={{width:44,height:4,borderRadius:4,background:'rgba(255,255,255,0.25)'}}/>
        </div>

        {/* Sheet header */}
        <div style={{
          padding:'0 20px 12px',
          display:'flex', alignItems:'center', justifyContent:'space-between',
        }}>
          <div>
            <div style={{color:'#fff',fontWeight:800,fontSize:17}}>📊 הביצועים שלי</div>
            <div style={{color:'rgba(255,255,255,0.4)',fontSize:12}}>{workerName} · היום</div>
          </div>
          <button onClick={close} style={{
            background:'rgba(255,255,255,0.1)',border:'none',color:'#fff',
            width:34,height:34,borderRadius:'50%',cursor:'pointer',
            fontSize:18,display:'flex',alignItems:'center',justifyContent:'center',
          }}>✕</button>
        </div>

        {/* Tabs */}
        <div style={{display:'flex',gap:8,padding:'0 20px 14px'}}>
          {[['stats','📈 סטטיסטיקות'],['history','📋 היסטוריה']].map(([id,lbl])=>(
            <button key={id} onClick={()=>setTab(id)} style={{
              flex:1, padding:'8px 0',
              background: tab===id ? D.green : 'rgba(255,255,255,0.07)',
              border:`1px solid ${tab===id ? D.green : 'rgba(255,255,255,0.12)'}`,
              borderRadius:12, color:'#fff', fontWeight:700, fontSize:13, cursor:'pointer',
            }}>{lbl}</button>
          ))}
        </div>

        {/* Content */}
        <div style={{flex:1,overflowY:'auto',padding:'0 16px 24px'}}>
          {tab === 'stats' ? (
            !stats ? (
              <div style={{textAlign:'center',padding:40,color:'rgba(255,255,255,0.4)'}}>
                <span style={{animation:'wvSpin 1s linear infinite',display:'inline-block'}}>⏳</span>
                {' '}טוען...
              </div>
            ) : (
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                <StatCard icon="✅" label="הושלמו היום" value={stats.tasks_done ?? 0} color={D.accent}/>
                <StatCard icon="⏳" label="ממתינות"     value={stats.tasks_pending ?? 0} color={D.amber}/>
                <StatCard icon="⚡" label="מהירות ממוצעת" value={avgLabel} sub="לכל משימה" color={D.blue}/>
                <StatCard icon="🕐" label="משמרת"       value={shiftDur} sub={`החל מ-${shiftStart||'—'}`} color="#c084fc"/>
              </div>
            )
          ) : (
            /* History tab */
            completedTasks.length === 0 ? (
              <div style={{textAlign:'center',padding:'36px 0',color:'rgba(255,255,255,0.4)',fontSize:14}}>
                <div style={{fontSize:36,marginBottom:8}}>📭</div>
                אין משימות שהושלמו היום עדיין
              </div>
            ) : (
              <div>
                {completedTasks.map((t,i)=>{
                  const room=t.property_name||`חדר ${t.property_id||'?'}`;
                  const dur=t.duration_minutes?`${t.duration_minutes} דק'`:null;
                  return (
                    <div key={t.id||i} style={{
                      display:'flex',alignItems:'center',gap:12,
                      padding:'10px 12px',marginBottom:6,
                      background:'rgba(52,211,153,0.08)',
                      border:'1px solid rgba(52,211,153,0.18)',
                      borderRadius:14,
                      animation:`wvFadeIn .35s ease ${i*0.06}s both`,
                      direction:'rtl',
                    }}>
                      <div style={{
                        width:36,height:36,borderRadius:10,
                        background:'rgba(52,211,153,0.2)',
                        display:'flex',alignItems:'center',justifyContent:'center',
                        fontSize:16,flexShrink:0,
                      }}>✅</div>
                      <div style={{flex:1}}>
                        <div style={{fontWeight:700,color:'#fff',fontSize:13}}>{room}</div>
                        <div style={{fontSize:11,color:'rgba(255,255,255,0.45)',marginTop:2}}>
                          {fmtTime(t.completed_at||t.updated_at)}
                          {dur && <span style={{color:D.accent,marginRight:8}}> ⚡ {dur}</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          )}
        </div>
      </div>
    </>
  );
}

/* ── Single Task Card — one task at a time (oldest in queue) ─ */
function FocusCard({
  task,
  workerName,
  onOptimisticStart,
  onOptimisticComplete,
  onBusy: _onBusy,
  queueSize = 0,
  shiftActive = true,
  isThai = false,
  onShowToast,
}) {
  const L = isThai
    ? {
        hotel: 'โรงแรม',
        room: 'ห้อง',
        request: 'คำขอ',
        saw: 'ฉันเห็นแล้ว',
        notDone: 'ยังไม่เสร็จ',
        done: 'เสร็จแล้ว',
        sla: 'เวลา',
        shiftFirst: 'เริ่มกะก่อน',
        taskOpen: 'งานยังเปิดอยู่',
        stayActive: 'งานยังใช้งานอยู่ — ต่อเวลา 3 นาที',
        startFirstToast: 'เริ่มงานก่อน (กด ฉันเห็นแล้ว)',
        unknownRoom: 'ไม่ทราบ',
        defaultDesc: 'ปฏิบัติงาน',
        badgeDone: 'เสร็จแล้ว',
        badgeIP: 'กำลังทำ',
        badgeWait: 'รอ',
        taskType: 'ประเภทงาน',
        service: 'บริการ',
        currentTask: 'งานปัจจุบัน',
        queueLine: n => `อีก ${n} งานในคิว`,
      }
    : {
        hotel: 'מלון',
        room: 'חדר',
        request: 'בקשה',
        saw: 'ראיתי',
        notDone: 'עוד לא סיימתי',
        done: 'בוצע',
        sla: 'טיימר',
        shiftFirst: 'התחל משמרת',
        taskOpen: 'המשימה נשארת פתוחה',
        stayActive: 'המשימה נשארת פעילה — הארכת זמן 3 דק׳',
        startFirstToast: 'התחל קודם (לחץ ראיתי)',
        unknownRoom: 'לא ידוע',
        defaultDesc: 'ביצוע משימה',
        badgeDone: 'הושלם',
        badgeIP: 'בביצוע',
        badgeWait: 'ממתין',
        taskType: 'סוג משימה',
        service: 'שירות',
        currentTask: 'המשימה הנוכחית · חדר / נכס',
        queueLine: n => `עוד ${n} בתור`,
      };

  const [localStatus, setLocalStatus] = useState(task.status || 'Pending');
  const [elapsed,     setElapsed]     = useState('0:00');
  const [slaEndMs, setSlaEndMs] = useState(null);

  const btnRef   = useRef(null);
  const startRef = useRef(task.started_at ? new Date(task.started_at) : null);
  const timerRef = useRef(null);

  const hotelName =
    task.property_name || task.hotel_name || task.property_context || task.tenant_name || L.hotel;

  let photoUrl = task.photo_url || task.room_photo_url || task.image_url;
  if (!photoUrl && task.property_pictures) {
    try {
      const pp = typeof task.property_pictures === 'string'
        ? JSON.parse(task.property_pictures)
        : task.property_pictures;
      if (Array.isArray(pp) && pp[0]) photoUrl = pp[0];
      else if (pp && typeof pp === 'object' && pp.url) photoUrl = pp.url;
    } catch { /* ignore */ }
  }

  // Build room display value — strip "חדר " / "room " prefix so the card
  // label "חדר / נכס" + value don't produce the duplicate "חדר חדר".
  const rawRoom = task.room_id || task.room_number || task.property_name || task.room
                  || (task.property_id ? `חדר ${task.property_id}` : '');
  const room = rawRoom
    ? rawRoom.replace(/^(חדר|room)\s*/i, '').trim() || rawRoom
    : L.unknownRoom;

  const desc  = task.description || task.content || task.task_type || L.defaultDesc;
  const staff = task.staff_name || task.assigned_to || workerName  || '';

  useEffect(() => {
    setLocalStatus(task.status || 'Pending');
  }, [task.id, task.status]);

  useEffect(() => {
    startRef.current = task.started_at ? new Date(task.started_at) : null;
    setSlaEndMs(null);
  }, [task.id, task.started_at]);

  useEffect(() => {
    const st = task.status || '';
    if (isInProgress(st) && task.started_at) {
      const start = new Date(task.started_at).getTime();
      if (!Number.isNaN(start)) setSlaEndMs(start + 3 * 60 * 1000);
    }
  }, [task.id, task.started_at, task.status]);

  /* live elapsed timer — runs while In_Progress */
  useEffect(() => {
    if (isInProgress(localStatus)) {
      const tick = () => {
        if (!startRef.current) return;
        const s = Math.floor((Date.now() - startRef.current.getTime()) / 1000);
        setElapsed(`${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`);
      };
      tick();
      timerRef.current = setInterval(tick, 1000);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [localStatus]);

  /* 3-minute SLA countdown from "ראיתי" / saw */
  const [, slaBump] = useState(0);
  useEffect(() => {
    if (!slaEndMs) return undefined;
    const iv = setInterval(() => slaBump((x) => x + 1), 1000);
    return () => clearInterval(iv);
  }, [slaEndMs]);

  const slaRemainingSec = slaEndMs ? Math.max(0, Math.ceil((slaEndMs - Date.now()) / 1000)) : null;
  const slaMmSs = slaRemainingSec != null
    ? `${Math.floor(slaRemainingSec / 60)}:${String(slaRemainingSec % 60).padStart(2, '0')}`
    : null;

  /* traffic-light palette */
  const isIP = isInProgress(localStatus);
  const isD = isDone(localStatus);

  const TL = isD
    ? { border: W.success, bar: W.success, badge: 'rgba(52,211,153,0.2)', badgeC: W.success, label: L.badgeDone }
    : isIP
      ? { border: W.warn, bar: W.warn, badge: 'rgba(251,191,36,0.2)', badgeC: W.warn, label: L.badgeIP }
      : {
          border: '#ef4444',
          bar: '#ef4444',
          badge: 'rgba(239,68,68,0.2)',
          badgeC: '#f87171',
          label: L.badgeWait,
        };

  const taskTypeStr = (task.task_type || task.description || '').toLowerCase();
  const TypeIcon = taskTypeStr.includes('maintenance') || taskTypeStr.includes('תחזוק') || taskTypeStr.includes('fix')
    ? Wrench
    : taskTypeStr.includes('clean') || taskTypeStr.includes('ניק') || taskTypeStr.includes('towel')
      ? Sparkles
      : BedDouble;

  const [, forceTick] = useState(0);
  useEffect(() => {
    if (isDone(localStatus)) return undefined;
    const iv = setInterval(() => forceTick((x) => x + 1), 1000);
    return () => clearInterval(iv);
  }, [task.id, task.created_at, localStatus]);

  const urgencyMin = getUrgencyMinutesSinceCreated(task.created_at);
  let urgencyClass = '';
  const isEscalated = Boolean(task.escalated) && !isDone(localStatus);

  if (!isDone(localStatus)) {
    if (isPending(localStatus)) {
      urgencyClass = urgencyClassForPendingMinutes(urgencyMin);
    } else if (isInProgress(localStatus)) {
      urgencyClass = 'wv-focus-in-progress-run';
    }
  }
  const pendingClock = (() => {
    const totalSec = Math.floor(urgencyMin * 60);
    const mm = Math.floor(totalSec / 60);
    const ss = totalSec % 60;
    return `${mm}:${String(ss).padStart(2, '0')}`;
  })();

  /* Start — In Progress + 3-minute SLA timer */
  const doStart = () => {
    if (!shiftActive) return;
    startRef.current = new Date();
    setLocalStatus('In_Progress');
    setSlaEndMs(Date.now() + 3 * 60 * 1000);
    onOptimisticStart(task);
  };

  const doNotFinished = () => {
    if (!shiftActive) return;
    if (!isIP) {
      if (typeof onShowToast === 'function') onShowToast(L.startFirstToast);
      return;
    }
    setSlaEndMs(Date.now() + 3 * 60 * 1000);
    if (typeof onShowToast === 'function') onShowToast(L.stayActive);
  };

  const doComplete = () => {
    if (!shiftActive) return;
    setSlaEndMs(null);
    onOptimisticComplete(task);
  };

  const dateLocale = isThai ? 'th-TH' : 'he-IL';
  const createdLine = (() => {
    if (!task.created_at) return '';
    try {
      const d = new Date(task.created_at);
      return `${d.toLocaleDateString(dateLocale, { day: '2-digit', month: '2-digit' })} ${d.toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit' })}`;
    } catch {
      return `${fmtShortDate(task.created_at)} ${fmtTime(task.created_at)}`;
    }
  })();

  return (
    <div
      data-fc
      className={`${urgencyClass || ''} ${isEscalated ? 'wv-task-escalated-pulse' : ''}`.trim()}
      style={{
      position:'relative',
      background: W.page,
      border: isEscalated ? undefined : (urgencyClass ? undefined : `1px solid ${TL.border}`),
      borderRadius:20,
      overflow:'hidden',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      boxShadow: urgencyClass ? undefined : '0 8px 40px rgba(0,0,0,0.45)',
      animation: 'wvIn 0.55s cubic-bezier(0.175,0.885,0.32,1.275) both',
      transition:'border-color .3s, box-shadow .3s',
      opacity: shiftActive ? 1 : 0.65,
    }}
    >

      <div style={{ height: 4, background: TL.bar, transition: 'background .3s', boxShadow: `0 0 12px ${TL.bar}66` }} />

      {/* Hotel + meta */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '16px 22px 0', direction: isThai ? 'ltr' : 'rtl' }}>
        <div style={{
          width: 48, height: 48, borderRadius: 14, flexShrink: 0,
          background: 'rgba(0, 229, 200, 0.12)',
          border: `1px solid ${W.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Building2 size={24} color="#00e5c8" strokeWidth={2} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, color: W.muted, fontWeight: 700, letterSpacing: '0.06em' }}>{L.hotel}</div>
          <div style={{ fontSize: 18, color: W.text, fontWeight: 800, lineHeight: 1.25 }}>{hotelName}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 8, alignItems: 'center' }}>
            <span style={{
              background:TL.badge, color:TL.badgeC,
              border:`1px solid ${W.border}`,
              fontSize:12, fontWeight:700, padding:'6px 12px', borderRadius:8,
            }}>{TL.label}</span>
            {isIP && (
              <span style={{
                fontSize:12, fontWeight:700, color: W.warn,
                background:'#fff8e6', border:`1px solid ${W.border}`,
                padding:'4px 10px', borderRadius:8,
              }}>⏱ {elapsed}</span>
            )}
            {isIP && slaMmSs != null && (
              <span style={{
                fontSize:12, fontWeight:700, color: W.accent,
                background:'rgba(0,229,200,0.12)', border:`1px solid ${W.border}`,
                padding:'4px 10px', borderRadius:8,
              }}>{L.sla} 3:00 → {slaMmSs}</span>
            )}
            {queueSize > 0 && !isIP && (
              <span style={{ fontSize:12, color: W.muted, fontWeight:600 }}>
                {L.queueLine(queueSize)}
              </span>
            )}
            {isPending(localStatus) && (
              <span style={{
                fontSize:12, fontWeight:700, color: W.accent,
                background:'rgba(0,229,200,0.1)', border:`1px solid ${W.border}`,
                padding:'4px 10px', borderRadius:8,
              }}>
                ⏱ {pendingClock}
              </span>
            )}
          </div>
        </div>
        {createdLine && (
          <span style={{ fontSize:12, color: W.muted, whiteSpace: 'nowrap' }}>{createdLine}</span>
        )}
      </div>

      {/* Room photo */}
      <div style={{ padding: '14px 22px 0' }}>
        <div style={{
          width: '100%',
          aspectRatio: '16 / 10',
          borderRadius: 16,
          overflow: 'hidden',
          border: `1px solid ${W.border}`,
          background: 'rgba(0,0,0,0.35)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          {photoUrl ? (
            <img
              src={photoUrl}
              alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            <div style={{ color: W.muted, fontSize: 14, fontWeight: 600, padding: 24 }}>
              <TypeIcon size={40} color={W.muted} strokeWidth={1.5} style={{ display: 'block', margin: '0 auto 8px' }} />
              {isThai ? 'ไม่มีรูปห้อง' : 'אין תמונת חדר'}
            </div>
          )}
        </div>
      </div>

      {/* Room number + request */}
      <div style={{ padding: '16px 22px 0', direction: isThai ? 'ltr' : 'rtl' }}>
        <div style={{ fontSize:13, color: W.muted, fontWeight:700, marginBottom:6, display:'flex', alignItems:'center', gap:6 }}>
          <MapPin size={14} color="#00e5c8" /> {L.room} · {L.currentTask}
        </div>
        <div style={{
          fontSize:'clamp(36px,11vw,56px)',
          fontWeight:800,
          color: W.text,
          lineHeight:1.05,
          letterSpacing:'-0.02em',
          textShadow: '0 0 40px rgba(0,229,200,0.15)',
          animation: isD ? 'wvBounce 0.5s ease' : 'none',
        }}>{room}</div>
      </div>

      <div style={{ padding: '14px 22px 0', direction: isThai ? 'ltr' : 'rtl' }}>
        <div style={{ fontSize: 11, color: W.muted, fontWeight: 700, marginBottom: 6 }}>{L.request}</div>
        <div style={{
          background: W.bg,
          borderRadius:12,
          padding:'16px 18px',
          fontSize:16,
          color: W.text,
          lineHeight:1.55,
          border:`1px solid ${W.border}`,
        }}>{desc}</div>
      </div>

      {staff && (
        <div style={{ padding:'8px 18px 0', direction: isThai ? 'ltr' : 'rtl' }}>
          <span style={{ fontSize:13, color: W.muted, background: W.bg, borderRadius:8, padding:'6px 14px', border: `1px solid ${W.border}` }}>
            👤 {staff}
          </span>
        </div>
      )}

      <div style={{ padding: '24px 22px 28px', direction: isThai ? 'ltr' : 'rtl' }}>

        {isD ? (
          <div style={{
            textAlign:'center', padding:'20px',
            background:'#e6f7f5', borderRadius:12,
            border:`1px solid ${W.success}`,
            color: W.success, fontWeight:800, fontSize:17,
            animation:'wvBounce 0.5s ease',
          }}>{isThai ? '🎉 เสร็จแล้ว!' : '🎉 Task completed!'}</div>

        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'stretch' }}>

            {!shiftActive && (
              <div style={{
                textAlign: 'center', fontSize: 14, fontWeight: 600, color: W.muted,
                background: W.bg, borderRadius: 12, padding: '14px 16px',
                border: `1px solid ${W.border}`,
              }}>
                {L.shiftFirst}
              </div>
            )}

            <button
              type="button"
              onClick={doStart}
              disabled={!shiftActive || isIP}
              aria-label={L.saw}
              style={{
                width: '100%',
                padding: '18px 24px',
                minHeight: 56,
                background: isIP ? W.bg : W.page,
                border: `2px solid ${isIP ? W.border : W.text}`,
                borderRadius: 12,
                color: W.text,
                fontWeight: 700,
                fontSize: 18,
                cursor: (!shiftActive || isIP) ? 'not-allowed' : 'pointer',
                opacity: !shiftActive ? 0.5 : 1,
              }}
            >
              {isIP ? `${L.badgeIP}…` : L.saw}
            </button>

            <button
              type="button"
              onClick={doNotFinished}
              disabled={!shiftActive}
              aria-label={L.notDone}
              style={{
                width: '100%',
                padding: '16px 22px',
                minHeight: 52,
                background: W.bg,
                border: `1px solid ${W.border}`,
                borderRadius: 12,
                color: W.muted,
                fontWeight: 700,
                fontSize: 16,
                cursor: !shiftActive ? 'not-allowed' : 'pointer',
                opacity: !shiftActive ? 0.5 : 1,
              }}
            >
              {L.notDone}
            </button>

            <button
              ref={btnRef}
              type="button"
              className="wv-btn-complete wv-btn-done-he"
              onClick={doComplete}
              disabled={!shiftActive || !isIP}
              aria-label={L.done}
              style={{
                width: '100%',
                maxWidth: 480,
                margin: '0 auto',
                padding: '22px 26px',
                minHeight: 68,
                border: 'none',
                borderRadius: 18,
                fontWeight: 900,
                fontSize: 22,
                letterSpacing: '0.02em',
                cursor: (!shiftActive || !isIP) ? 'not-allowed' : 'pointer',
                opacity: (!shiftActive || !isIP) ? 0.45 : 1,
              }}
            >
              {L.done}
            </button>

            {queueSize > 0 && (
              <div style={{ textAlign:'center', fontSize:13, color: W.muted }}>
                {isThai ? `อีก ${queueSize} งานในคิว` : `עוד ${queueSize} משימות בתור`}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Dot pager indicator ─────────────────────────────────── */
// eslint-disable-next-line no-unused-vars
function Pager({ total, current }) {
  if (total <= 1) return null;
  return (
    <div style={{display:'flex',justifyContent:'center',gap:7,marginTop:14}}>
      {Array.from({length:total}).map((_,i)=>(
        <div key={i} style={{
          width: i===current?20:7, height:7, borderRadius:4,
          background: i===current ? W.success : W.border,
          transition:'all .3s',
        }}/>
      ))}
    </div>
  );
}

/* ── Main ─────────────────────────────────────────────────── */
export default function WorkerView() {
  const { id: routeWorkerId } = useParams();
  const role = useStore((s) => s.role);
  const isWorkerThai = role === 'worker';
  const workerName = (routeWorkerId || workerNameFromPath() || 'עובד').toString();

  const workerAreaUi = isWorkerThai
    ? {
        loading: 'กำลังโหลดงาน...',
        noOpen: 'ไม่มีงานเปิด',
        noOpenHint: 'เมื่อมีงานใหม่จะแสดงที่นี่อัตโนมัติ',
        refresh: 'รีเฟรช',
        moreInQueue: (n) => `อีก ${n} งานในคิว`,
      }
    : {
        loading: 'טוען משימות...',
        noOpen: 'אין משימה פתוחה',
        noOpenHint: 'כשתתקבל משימה חדשה היא תופיע כאן אוטומטית.',
        refresh: 'רענן',
        moreInQueue: (n) => `עוד ${n} משימות בתור`,
      };

  const [pending,   setPending]   = useState([]);   // pending tasks
  const [completed, setCompleted] = useState([]);   // done tasks today
  const [_idx,      setIdx]       = useState(0); // eslint-disable-line no-unused-vars
  const [loading,   setLoading]   = useState(true);
  const [spin,      setSpin]      = useState(false);
  const [toast,     setToast]     = useState(null);
  const [lastSync,  setLastSync]  = useState(null);
  const [drawer,    setDrawer]    = useState(false);
  const [xp, setXp] = useState(0);
  const [streak, setStreak] = useState(0);
  const [celebration, setCelebration] = useState(null); // null | 'task' | 'level'
  /** not_started | active | finished */
  const [shiftPhase, setShiftPhase] = useState('not_started');
  const [syncCount, setSyncCount] = useState(0);
  const [showSyncHint, setShowSyncHint] = useState(false);
  const timer = useRef(null);
  const mayaNoticeAckRef = useRef(0);
  const [mayaNotice, setMayaNotice] = useState(null);
  const seenPriorityAlertRef = useRef(new Set());
  const [priorityAlertTask, setPriorityAlertTask] = useState(null);
  const dismissedMayaInterventionRef = useRef(new Set());
  const [mayaIvDismissedBump, setMayaIvDismissedBump] = useState(0);
  const [workerUrgencyTick, setWorkerUrgencyTick] = useState(0);
  const refreshDebounceRef = useRef(null);

  const queueHeadPending = pending[0];
  useEffect(() => {
    const t = queueHeadPending;
    if (!t || !isPending(t.status)) return undefined;
    const iv = setInterval(() => setWorkerUrgencyTick((x) => x + 1), 1000);
    return () => clearInterval(iv);
    /* id+status only — full task object is replaced on each poll; re-subscribing every fetch would reset the clock */
  }, [queueHeadPending?.id, queueHeadPending?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const level = Math.floor(xp / 100) + 1;
  const shiftActive = shiftPhase === 'active';

  const playCompletionSound = useCallback(() => {
    try {
      const src = `${process.env.PUBLIC_URL || ''}/sounds/success.mp3`;
      const audio = new Audio(src);
      audio.volume = 0.5;
      audio.play().catch((err) => console.log('Sound play blocked by browser', err));
    } catch (error) {
      console.error('Error playing sound:', error);
    }
  }, []);

  useEffect(() => {
    if (syncCount <= 0) {
      setShowSyncHint(false);
      return;
    }
    const t = setTimeout(() => setShowSyncHint(true), 500);
    return () => clearTimeout(t);
  }, [syncCount]);

  /** Instant feedback (XP, confetti, sound) — does not wait on the server */
  const applyCompletionRewards = useCallback((opts = {}) => {
    const skipSound = Boolean(opts.skipSound);
    setXp((x) => {
      const nx = x + 10;
      const oldL = Math.floor(x / 100) + 1;
      const newL = Math.floor(nx / 100) + 1;
      if (newL > oldL) {
        setCelebration('level');
        try {
          confetti({ particleCount: 160, spread: 92, startVelocity: 48, origin: { y: 0.62 } });
        } catch (_) { /* noop */ }
        if (!skipSound) {
          playCompletionSound();
          setTimeout(() => playCompletionSound(), 140);
        }
      } else {
        setCelebration('task');
        try {
          confetti({ particleCount: 100, spread: 72, origin: { y: 0.72 } });
        } catch (_) { /* noop */ }
        if (!skipSound) playCompletionSound();
      }
      return nx;
    });
    setStreak((s) => s + 1);
    setToast('🎉 משימה הושלמה בהצלחה!');
  }, [playCompletionSound]);

  const syncShiftFromServer = useCallback(async () => {
    try {
      const r = await fetch(`${API_URL}/active-workers`);
      const d = await r.json().catch(() => ({}));
      const activeIds = new Set((d.workers || []).map((w) => String(w.worker_id)));
      if (activeIds.has(String(workerName))) {
        setShiftPhase((p) => (p === 'finished' ? p : 'active'));
      } else {
        setShiftPhase((p) => (p === 'finished' ? 'finished' : 'not_started'));
      }
    } catch { /* keep local */ }
  }, [workerName]);

  const startShift = async () => {
    try {
      const r = await fetch(`${API_URL}/start-shift`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ worker_id: workerName }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || r.status);
      setShiftPhase('active');
      setToast('✅ משמרת פעילה — משימות נפתחו');
    } catch {
      setToast('❌ לא ניתן להתחיל משמרת');
    }
  };

  const endShift = async () => {
    try {
      await fetch(`${API_URL}/end-shift`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ worker_id: workerName }),
      });
      setShiftPhase('finished');
      setToast('משמרת הסתיימה');
    } catch {
      setToast('שגיאה בסיום משמרת');
    }
  };

  /* ── load tasks (20s timeout to avoid Supabase/network hangs) ── */
  const load = useCallback(async (silent=false) => {
    if (!silent) setLoading(true);
    setSpin(true);
    try {
      const base = (API_URL || '').replace(/\/$/, '');
      const url = `${base}/worker/tasks?worker_id=${encodeURIComponent(workerName)}&active_only=1`;
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 20000);
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(timeout);
      if (!res.ok) throw new Error(res.status);
      let rawList = [];
      if (res.status === 204) {
        rawList = getInitialTasksForWorker(workerName);
      } else {
        const raw = await res.json().catch(() => ({}));
        rawList = normalizeWorkerTasksPayload(raw);
        if (!rawList.length) {
          rawList = getInitialTasksForWorker(workerName);
        }
      }
      const seen = new Set();
      const tasks = [];
      for (const t of rawList) {
        const id = t && t.id != null ? String(t.id) : '';
        if (!id || seen.has(id)) continue;
        seen.add(id);
        tasks.push(enrichWorkerTaskPropertyMeta(t));
      }

      // Separate active vs completed — treat ANYTHING not explicitly Done as active.
      // This ensures tasks with legacy/unknown statuses still appear.
      const DONE_STATUSES = new Set(['done','Done','completed','Completed','closed','Closed']);
      const newActive    = tasks.filter(t => !DONE_STATUSES.has(t.status));
      const newCompleted = tasks.filter(t =>  DONE_STATUSES.has(t.status));

      // Sort active: In_Progress first → Pending → others → oldest within group
      newActive.sort((a, b) => {
        const rank = s => isInProgress(s) ? 0 : isPending(s) ? 1 : 2;
        const dr = rank(a.status) - rank(b.status);
        if (dr !== 0) return dr;
        return (a.created_at || '') < (b.created_at || '') ? -1 : 1;
      });

      if (!silent) setIdx(0);
      else setIdx(i => Math.min(i, Math.max(0, newActive.length - 1)));

      setPending(newActive);
      setCompleted(newCompleted);
      setLastSync(new Date());
    } catch (err) {
      if (err?.name === 'AbortError') {
        console.warn('[WorkerView] Request timed out — retry manually');
      }
      /* keep stale data on network error */
    }
    finally { setLoading(false); setSpin(false); }
  }, [workerName]);

  useEffect(() => {
    syncShiftFromServer();
  }, [syncShiftFromServer]);

  useEffect(() => {
    let cancelled = false;
    const pollMaya = async () => {
      try {
        const r = await fetch(
          `${API_URL}/worker/maya-notice?worker_id=${encodeURIComponent(workerName)}`,
        );
        const d = await r.json().catch(() => ({}));
        if (cancelled || !d.ok || !d.message) return;
        const seq = parseInt(d.seq, 10) || 0;
        if (seq > mayaNoticeAckRef.current) {
          setMayaNotice({ message: d.message, seq });
        }
      } catch (_) { /* noop */ }
    };
    pollMaya();
    const iv = setInterval(pollMaya, 8000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [workerName]);

  const dismissMayaNotice = useCallback(async () => {
    if (!mayaNotice?.seq) {
      setMayaNotice(null);
      return;
    }
    mayaNoticeAckRef.current = Math.max(mayaNoticeAckRef.current, mayaNotice.seq);
    try {
      await fetch(`${API_URL}/worker/maya-notice/ack`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ worker_id: workerName, seq: mayaNotice.seq }),
      });
    } catch (_) { /* noop */ }
    setMayaNotice(null);
  }, [mayaNotice, workerName]);

  useEffect(()=>{
    load();
    timer.current = setInterval(() => load(true), POLL_MS);
    return ()=>clearInterval(timer.current);
  },[load]);

  /* Instant refresh when Maya/guest creates a task — debounced to avoid fetch storms */
  useEffect(() => {
    const schedule = () => {
      if (refreshDebounceRef.current) clearTimeout(refreshDebounceRef.current);
      refreshDebounceRef.current = setTimeout(() => {
        refreshDebounceRef.current = null;
        load(true);
      }, 450);
    };
    window.addEventListener('maya-refresh-tasks', schedule);
    window.addEventListener('maya-task-created', schedule);
    const unsubCross = subscribeCrossTabTaskSync(schedule);
    return () => {
      if (refreshDebounceRef.current) clearTimeout(refreshDebounceRef.current);
      window.removeEventListener('maya-refresh-tasks', schedule);
      window.removeEventListener('maya-task-created', schedule);
      unsubCross();
    };
  }, [load]);

  /* safety clamp — fires any time active list shrinks for any reason */
  useEffect(()=>{
    setIdx(i => Math.min(i, Math.max(0, pending.length - 1)));
  },[pending.length]); // `pending` holds all active (Pending + In_Progress) tasks

  /* High-priority task → modal + chime (once per task id) */
  useEffect(() => {
    for (const t of pending) {
      if (!isHighPriorityTask(t)) continue;
      if (seenPriorityAlertRef.current.has(t.id)) continue;
      seenPriorityAlertRef.current.add(t.id);
      setPriorityAlertTask(t);
      playPriorityChime();
      break;
    }
  }, [pending]);

  const handleOptimisticStart = useCallback(
    (task) => {
      const prev = { ...task };
      setPending((p) =>
        p.map((t) => (t.id === task.id ? { ...t, status: 'In_Progress' } : t))
      );
      setSyncCount((c) => c + 1);
      fetch(`${API_URL}/property-tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'In_Progress' }),
      })
        .then(async (res) => {
          if (!res.ok) {
            const d = await res.json().catch(() => ({}));
            setPending((p) =>
              p.map((t) => (t.id === prev.id ? { ...t, status: prev.status } : t))
            );
            setToast(`❌ ${d.error || 'לא ניתן להתחיל משימה'}`);
          } else {
            load(true);
          }
        })
        .catch(() => {
          setPending((p) =>
            p.map((t) => (t.id === prev.id ? { ...t, status: prev.status } : t))
          );
          setToast('❌ שגיאת חיבור');
        })
        .finally(() => setSyncCount((c) => Math.max(0, c - 1)));
    },
    [load],
  );

  const handleBusyOrDecline = useCallback(
    (task) => {
      setSyncCount((c) => c + 1);
      fetch(`${API_URL}/property-tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cannot_take', worker_id: workerName }),
      })
        .then(async (res) => {
          if (!res.ok) {
            const d = await res.json().catch(() => ({}));
            setToast(`❌ ${d.error || 'לא ניתן לעדכן'}`);
            load(true);
            return;
          }
          setToast('המשימה הועברה — תודה שעדכנת');
          load(true);
        })
        .catch(() => {
          setToast('❌ שגיאת חיבור');
          load(true);
        })
        .finally(() => setSyncCount((c) => Math.max(0, c - 1)));
    },
    [load, workerName],
  );

  const handleOptimisticComplete = useCallback(
    (task) => {
      const id = task.id;
      playCompletionSound();
      applyCompletionRewards({ skipSound: true });

      setPending((p) => {
        const next = p.filter((t) => t.id !== id);
        setIdx((i) => Math.min(i, Math.max(0, next.length - 1)));
        return next;
      });

      setSyncCount((c) => c + 1);
      fetch(`${API_URL}/property-tasks/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed' }),
      })
        .then(async (res) => {
          if (!res.ok) {
            const d = await res.json().catch(() => ({}));
            setPending((p) => (p.some((t) => t.id === id) ? p : [task, ...p]));
            setXp((x) => Math.max(0, x - 10));
            setStreak((s) => Math.max(0, s - 1));
            setCelebration(null);
            setToast(`❌ ${d.error || 'שמירה נכשלה — המשימה הוחזרה'}`);
            return;
          }
          load(true);
        })
        .catch(() => {
          setPending((p) => (p.some((t) => t.id === id) ? p : [task, ...p]));
          setXp((x) => Math.max(0, x - 10));
          setStreak((s) => Math.max(0, s - 1));
          setCelebration(null);
          setToast('❌ שגיאת חיבור — המשימה הוחזרה');
        })
        .finally(() => setSyncCount((c) => Math.max(0, c - 1)));
    },
    [applyCompletionRewards, load, playCompletionSound],
  );

  // Single-task mode: always show the first task (In_Progress floated to top).
  // The worker never manually browses; next task auto-slides in after Done.
  const currentTask = pending[0] || null;
  const queueSize   = Math.max(0, pending.length - 1); // tasks waiting after current
  const hasIP       = pending.length > 0 && isInProgress(pending[0]?.status);
  const taskTotal   = pending.length;
  const shiftLabel  = shiftPhase === 'active' ? 'פעיל' : shiftPhase === 'finished' ? 'הסתיים' : 'לא התחיל';
  const clearCelebration = useCallback(() => setCelebration(null), []);

  const dismissMayaIntervention = useCallback(() => {
    if (currentTask?.id) dismissedMayaInterventionRef.current.add(currentTask.id);
    setMayaIvDismissedBump((x) => x + 1);
  }, [currentTask?.id]);

  const interventionHe = (() => {
    void mayaIvDismissedBump;
    void workerUrgencyTick;
    if (!currentTask || !shiftActive || !isPending(currentTask.status)) return null;
    if (getUrgencyMinutesSinceCreated(currentTask.created_at) < 5) return null;
    if (dismissedMayaInterventionRef.current.has(currentTask.id)) return null;
    return buildMayaInterventionMessageHe(currentTask);
  })();

  return (
    <>
      <style>{STYLES}</style>

      <div className="wv-premium-root" style={{ direction: 'rtl' }}>
        <div className="wv-premium-content" style={{ paddingBottom: 48 }}>

        {/* ── App bar ── */}
        <div style={{
          position:'sticky',top:0,zIndex:100,
          background: 'rgba(12, 18, 28, 0.82)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          borderBottom:`1px solid ${W.border}`,
          padding:'16px 20px',
          display:'flex',alignItems:'center',gap:14,
          boxShadow:'0 8px 32px rgba(0,0,0,0.35)',
        }}>
          <div style={{
            width:48,height:48,borderRadius:12,
            background: W.bg,
            display:'flex',alignItems:'center',justifyContent:'center',
            fontSize:22,
            border:`1px solid ${W.border}`,
            flexShrink:0,
          }}>✨</div>

          <div style={{flex:1}}>
            <div style={{color: W.text, fontWeight:800, fontSize:17, lineHeight:1.2}}>
              שלום · {workerName}
            </div>
            <div style={{display:'flex',alignItems:'center',gap:8,marginTop:8,flexWrap:'wrap'}}>
              <span style={{
                fontSize:12, fontWeight:700, padding:'4px 10px', borderRadius:8,
                background: shiftPhase === 'active' ? '#e6f7f5' : W.bg,
                color: shiftPhase === 'active' ? W.success : W.muted,
                border: `1px solid ${W.border}`,
              }}>
                משמרת: {shiftLabel}
              </span>
              <span style={{ color: W.muted, fontSize: 12, fontWeight: 600 }}>
                שלב {level} · {xp} נק׳ · רצף {streak}
              </span>
              {taskTotal > 0 && shiftActive && (
                <span style={{ fontSize: 12, color: W.text, fontWeight: 700 }}>
                  משימה 1 מתוך {taskTotal}
                </span>
              )}
              <span style={{
                width:8, height:8, borderRadius:'50%', flexShrink:0,
                background: hasIP ? W.warn : currentTask ? W.accent : W.success,
              }}/>
              <span style={{color: W.muted, fontSize:12}}>
                {hasIP ? 'בביצוע' : currentTask ? 'ממתין' : 'אין משימה פתוחה'}
              </span>
              {showSyncHint && syncCount > 0 && (
                <span style={{
                  display:'inline-flex', alignItems:'center', gap:6,
                  fontSize:11, color: W.muted, fontWeight:600,
                }}>
                  <span style={{ display:'inline-block', animation:'wvSpin 0.9s linear infinite' }}>⏳</span>
                  מסנכרן...
                </span>
              )}
              {lastSync && (
                <span style={{color: W.muted, fontSize:11}}>
                  {lastSync.toLocaleTimeString('he-IL',{hour:'2-digit',minute:'2-digit'})}
                </span>
              )}
            </div>
          </div>

          <button type="button" onClick={()=>setDrawer(true)} title="סטטיסטיקות" style={{
            background: W.page,
            border:`1px solid ${W.border}`,
            color: W.text,
            height:40,
            padding:'0 14px',
            borderRadius:10,
            cursor:'pointer',
            fontSize:13,
            fontWeight:700,
          }}>
            דוחות
          </button>

          <button type="button" onClick={()=>load()} title="רענן" style={{
            background: W.bg,
            border:`1px solid ${W.border}`,
            color: W.text,
            width:40,
            height:40,
            borderRadius:10,
            cursor:'pointer',
            fontSize:18,
            display:'flex',
            alignItems:'center',
            justifyContent:'center',
          }}>
            <span style={{display:'inline-block',animation:spin?'wvSpin 0.7s linear infinite':'none'}}>↻</span>
          </button>
        </div>

        {mayaNotice?.message && (
          <div style={{ maxWidth: 520, margin: '0 auto', padding: '12px 20px 0' }}>
            <div
              className="wv-neon-glow"
              style={{
                background: 'linear-gradient(135deg, rgba(0,229,200,0.14) 0%, rgba(12,18,28,0.96) 100%)',
                border: `1px solid ${W.border}`,
                borderRadius: 14,
                padding: '14px 40px 14px 16px',
                position: 'relative',
              }}
            >
              <div style={{
                fontSize: 11,
                fontWeight: 800,
                color: W.accent,
                letterSpacing: '0.08em',
                marginBottom: 8,
              }}>
                לוח מודעות
              </div>
              <div style={{ fontSize: 11, color: W.muted, fontWeight: 600, marginBottom: 6 }}>
                הודעות ממאיה ומהמערכת
              </div>
              <div style={{ fontSize: 14, color: W.text, lineHeight: 1.55, fontWeight: 600 }}>
                {mayaNotice.message}
              </div>
              <button
                type="button"
                onClick={dismissMayaNotice}
                aria-label="סגור הודעה"
                style={{
                  position: 'absolute',
                  top: 10,
                  right: 10,
                  background: 'rgba(255,255,255,0.08)',
                  border: 'none',
                  color: W.muted,
                  width: 30,
                  height: 30,
                  borderRadius: 8,
                  cursor: 'pointer',
                  fontSize: 16,
                  lineHeight: 1,
                }}
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {/* ── Shift + XP strip ── */}
        <div style={{
          maxWidth: 520, margin: '0 auto', padding: '16px 20px 0',
        }}>
          <div style={{
            background: W.page,
            border: `1px solid ${W.border}`,
            borderRadius: 12,
            padding: '20px 22px',
            boxShadow:'0 1px 4px rgba(0,0,0,0.04)',
          }}>
            <XpProgressBar xp={xp} level={level} variant="light" />
            <div style={{ display: 'flex', gap: 12, marginTop: 16, flexWrap: 'wrap' }}>
              {(shiftPhase === 'not_started' || shiftPhase === 'finished') && (
                <button
                  type="button"
                  onClick={startShift}
                  style={{
                    flex: 1, minWidth: 160,
                    padding: '16px 16px', borderRadius: 12, border: 'none', cursor: 'pointer',
                    fontWeight: 700, fontSize: 16, color: W.white,
                    background: W.text,
                  }}
                >
                  התחל משמרת
                </button>
              )}
              {shiftPhase === 'active' && (
                <button
                  type="button"
                  onClick={endShift}
                  style={{
                    flex: 1, minWidth: 140,
                    padding: '14px 14px', borderRadius: 12, cursor: 'pointer',
                    fontWeight: 700, fontSize: 14, color: W.text,
                    background: W.bg,
                    border: `1px solid ${W.border}`,
                  }}
                >
                  סיים משמרת
                </button>
              )}
            </div>
            {shiftPhase === 'finished' && (
              <p style={{ margin: '12px 0 0', fontSize: 13, color: W.muted, textAlign: 'center' }}>
                המשמרת הסתיימה. התחל משמרת חדשה כדי להמשיך.
              </p>
            )}
          </div>
        </div>

        {/* ── Main area ── */}
        <div style={{ maxWidth: 520, margin: '0 auto', padding: '24px 20px 0' }}>
          {loading ? (
            <div style={{ textAlign:'center', paddingTop: 80, color: W.muted }}>
              <div style={{ fontSize: 36, animation:'wvSpin 1s linear infinite', display:'inline-block' }}>⏳</div>
              <div style={{ marginTop: 12, fontSize: 15 }}>{workerAreaUi.loading}</div>
            </div>
          ) : !currentTask ? (
            <div style={{ textAlign:'center', padding: '56px 24px', color: W.muted }}>
              <div style={{ fontSize: 52, marginBottom: 16 }}>✓</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: W.text, marginBottom: 8 }}>{workerAreaUi.noOpen}</div>
              <div style={{ fontSize: 15, lineHeight: 1.6, maxWidth: 320, margin: '0 auto' }}>
                {workerAreaUi.noOpenHint}
              </div>
              <button type="button" onClick={()=>load()} style={{
                marginTop: 28,
                background: W.text,
                border: 'none',
                borderRadius: 12,
                color: W.white,
                fontWeight: 700,
                padding: '14px 32px',
                cursor: 'pointer',
                fontSize: 15,
              }}>{workerAreaUi.refresh}</button>

              {/* One-click reset: reactivates all Done tasks for this worker */}
              <button onClick={async()=>{
                try {
                  const r = await fetch(
                    `${API_URL}/dev/reset-worker-tasks/${encodeURIComponent(workerName)}`,
                    { method:'POST' }
                  );
                  const d = await r.json();
                  if (d.ok) { setToast(`✅ ${d.reset_count} משימות אופסו ל-Pending`); load(); }
                  else setToast('❌ ' + (d.error || 'שגיאה'));
                } catch { setToast('❌ שגיאת חיבור'); }
              }} style={{
                marginTop:10, display:'block', width:'100%',
                background:'rgba(249,115,22,0.15)',
                border:'1px solid rgba(249,115,22,0.4)',
                borderRadius:16, color:'#f97316', fontWeight:700,
                padding:'11px 0', cursor:'pointer', fontSize:13,
              }}>
                🔄 הפעל מחדש את כל המשימות ({completed.length} הושלמו)
              </button>

              {completed.length > 0 && (
                <button onClick={()=>setDrawer(true)} style={{
                  marginTop:10, display:'block', width:'100%',
                  background: W.bg,
                  border:`1px solid ${W.border}`,
                  borderRadius:12, color: W.success, fontWeight:700,
                  padding:'11px 0', cursor:'pointer', fontSize:13,
                }}>
                  📊 ראה {completed.length} משימות שהושלמו היום
                </button>
              )}
            </div>
          ) : (
            /* Single-task mode — always shows pending[0] only */
            <>
              <AnimatePresence mode="wait">
                {currentTask && (
                  <motion.div
                    key={currentTask.id}
                    initial={{ opacity: 0, x: 36, scale: 0.97 }}
                    animate={{ opacity: 1, x: 0, scale: 1 }}
                    exit={{ opacity: 0, x: -40, scale: 0.96 }}
                    transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                  >
                    <FocusCard
                      task={currentTask}
                      workerName={workerName}
                      onOptimisticStart={handleOptimisticStart}
                      onOptimisticComplete={handleOptimisticComplete}
                      onBusy={handleBusyOrDecline}
                      queueSize={queueSize}
                      shiftActive={shiftActive}
                      isThai={isWorkerThai}
                      onShowToast={(msg) => setToast(msg)}
                    />
                  </motion.div>
                )}
              </AnimatePresence>

              {queueSize > 0 && (
                <div style={{
                  textAlign:'center', marginTop: 20,
                  color: W.muted, fontSize: 14,
                }}>
                  {workerAreaUi.moreInQueue(queueSize)}
                </div>
              )}

              {currentTask && shiftActive && isPending(currentTask.status) && !isWorkerThai && (
                <div style={{ marginTop: 20 }}>
                  <MayaWorkerChat
                    workerName={workerName}
                    task={currentTask}
                    disabled={!shiftActive}
                    onYes={() => handleOptimisticStart(currentTask)}
                    onBusy={() => handleBusyOrDecline(currentTask)}
                    onTransfer={() => handleBusyOrDecline(currentTask)}
                    onNotAvailable={() => handleBusyOrDecline(currentTask)}
                    interventionMessageHe={interventionHe}
                    onDismissIntervention={dismissMayaIntervention}
                  />
                </div>
              )}
            </>
          )}
        </div>

        <p style={{ textAlign:'center', color: W.muted, fontSize: 11, marginTop: 32 }}>
          EasyHost · פורטל עובדים
        </p>
        </div>
      </div>

      {/* Stats drawer */}
      {drawer && (
        <StatsDrawer
          workerName={workerName}
          completedTasks={completed}
          onClose={()=>setDrawer(false)}
        />
      )}

      {toast && <Toast msg={toast} onClose={()=>setToast(null)}/>}

      {priorityAlertTask && (
        <PriorityAlertModal
          task={priorityAlertTask}
          onDismiss={() => setPriorityAlertTask(null)}
        />
      )}

      {celebration && (
        <CelebrationOverlay kind={celebration} onDone={clearCelebration} />
      )}
    </>
  );
}
