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
import useTranslations from '../hooks/useTranslations';
import {
  localizeWorkerTask,
  formatTaskDate,
  localeDirection,
  translateTaskStatus,
  translatePropertyContext,
  translatePropertyName,
  translateTaskDescription,
  translateStaffLabel,
  formatWorkerDisplayText,
  formatWorkerRoomLine,
} from '../utils/taskDisplayI18n';
import './WorkerView.css';
import './dashboard/TaskCalendar.css';
import { subscribeCrossTabTaskSync } from '../utils/taskSyncBridge';
import { filterCorfuPilotTasks } from '../utils/corfuPilotFilters';
import { mergeWorkerTasksFromServer } from '../utils/taskStatusPriority';
import { PILOT_LANGUAGE_OPTIONS } from '../utils/pilotLanguages';
import hotelRealtime from '../services/hotelRealtime';
import CelebrationOverlay from './worker/CelebrationOverlay';
import XpProgressBar from './worker/XpProgressBar';
import { getWeWorkBranchById } from '../config/weworkBranches';

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

/* ── helpers ─────────────────────────────────────────────── */
function workerNameFromPath() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  if (parts[0] !== 'worker' || !parts[1]) return null;
  const slug = decodeURIComponent(parts[1]).trim();
  return slug.toLowerCase() === 'tasks' ? null : slug;
}

function normalizeWorkerSlug(raw) {
  const s = String(raw || '').trim();
  if (!s || s.toLowerCase() === 'tasks') return '';
  return s;
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
function fmtTime(iso, lang) {
  if (!iso) return '--:--';
  const locale = lang === 'he' ? 'he-IL' : lang === 'el' ? 'el-GR' : lang === 'ar' ? 'ar' : 'en-US';
  try { return new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }); }
  catch { return ''; }
}
function fmtShortDate(iso, lang) {
  if (!iso) return '';
  const locale = lang === 'he' ? 'he-IL' : lang === 'el' ? 'el-GR' : lang === 'ar' ? 'ar' : 'en-US';
  try { return new Date(iso).toLocaleDateString(locale, { day: '2-digit', month: '2-digit' }); }
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
  const base = localizeWorkerTask(task);
  const enriched = {
    ...base,
    property_name: workerPropertyLabel(base),
    hotel_name: workerPropertyLabel(base),
    room: cleanDisplay(base.room) || '',
    room_number: cleanDisplay(base.room_number) || '',
    description: formatWorkerDisplayText(translateTaskDescription(base), formatWorkerDisplayText(base.description, '')),
    staff_name: workerAssigneeLabel(base),
    worker_name: workerAssigneeLabel(base),
    assigned_to: workerAssigneeLabel(base),
    property_context: formatWorkerDisplayText(translatePropertyContext(base.property_context)),
  };
  if (pid.startsWith('christos-')) return enriched;
  if (!pid) return enriched;
  const ww = getWeWorkBranchById(pid);
  if (ww) {
    return {
      ...enriched,
      property_name: cleanDisplay(ww.name) || ww.name,
      hotel_name: cleanDisplay(ww.name) || ww.name,
    };
  }
  return enriched;
}

function sanitizeWorkerDisplayText(raw) {
  if (!raw) return '';
  return String(raw)
    .replace(/\[(?:booking_ref|ical_uid)[^\]]*\]/gi, '')
    .replace(/\[SIM-ENGINE\]\s*/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function safeStr(val, fallback = '') {
  if (val == null) return fallback;
  if (typeof val === 'string') return val;
  if (typeof val === 'object') return safeStr(val.content ?? val.title ?? val.text, fallback);
  return String(val);
}

const DIRTY_DISPLAY_RE = /i18n:|worker\.properties|worker\.tasks|worker\.taskTypes|\.properties\.|@/i;

function isDirtyDisplay(value) {
  const s = String(value ?? '').trim();
  return !s || DIRTY_DISPLAY_RE.test(s);
}

/** Suppress i18n keys, property refs, and email-like identifiers from UI. */
function cleanDisplay(value, fallback = '') {
  return formatWorkerDisplayText(value, fallback);
}

function workerRoomLine(task) {
  return formatWorkerRoomLine(task);
}

function workerPropertyLabel(task) {
  const pid = String(task?.property_id || '').trim();
  const translated = translatePropertyName(
    pid,
    task?.property_name || task?.hotel_name || task?.room || '',
  );
  return formatWorkerDisplayText(translated, translatePropertyName(pid, '') || '');
}

function workerAssigneeLabel(task) {
  const raw = task?.staff_name || task?.worker_name || task?.assigned_to || '';
  return formatWorkerDisplayText(translateStaffLabel(raw), '');
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
  return workerRoomLine(task);
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
function WorkerTaskBoardCard({ task, t: tProp, lang: langProp, openTaskDetails, selected }) {
  const { t: tHook } = useTranslations();
  const langStore = useStore((s) => s.lang) || 'he';
  const t = tProp || tHook;
  const lang = langProp || langStore;
  const propName = workerPropertyLabel(task);
  const roomLine = workerRoomLine(task);
  const desc = translateTaskDescription(task) || 'משימה חדשה';
  if (typeof console !== 'undefined' && console.debug) {
    console.debug('[TaskCard] rendered title/description', { id: task?.id, title: task?.title, description: desc });
  }
  const propContext = formatWorkerDisplayText(translatePropertyContext(task?.property_context));
  const assignee = workerAssigneeLabel(task);
  const thumb = (task?.property_pictures && task.property_pictures[0]) || task?.photo_url;
  const dir = localeDirection(lang);

  return (
    <div
      role="button"
      tabIndex={0}
      className={`task-card task-pending wv-modal-board-card wv-board-card-rtl wv-mission-card${selected ? ' wv-mission-card-selected' : ''}`}
      style={{ cursor: 'pointer', direction: dir, textAlign: dir === 'rtl' ? 'right' : 'left' }}
      onClick={() => {
        if (typeof openTaskDetails === 'function') openTaskDetails(task);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (typeof openTaskDetails === 'function') openTaskDetails(task);
        }
      }}
    >
      <div className="task-card-thumb">
        <div className="task-card-thumb-fallback" aria-hidden>
          <Building2 size={32} />
        </div>
        {thumb ? (
          <img
            src={thumb}
            alt={propName}
            className="task-card-thumb-img"
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />
        ) : null}
      </div>
      <div className="task-card-header">
        <span className="task-status-badge pending">{translateTaskStatus(task?.status || 'pending')}</span>
        <span className="task-date">
          {task?.created_at ? formatTaskDate(task.created_at, lang, { includeTime: false }) : '—'}
        </span>
      </div>
      <p className="wv-mission-card-property">{propName}</p>
      <p className="wv-mission-card-room">{roomLine}</p>
      <p className="task-description wv-card-line-clamp">{desc}</p>
      {propContext && (
        <p className="wv-mission-card-context wv-card-line-clamp">{propContext}</p>
      )}
      {assignee && (
        <p className="wv-mission-card-staff">👤 {assignee}</p>
      )}
    </div>
  );
}

function MissionDetailModal({ onClose, children, t }) {
  return (
    <>
      <div className="wv-mission-detail-backdrop" onClick={onClose} aria-hidden />
      <div className="wv-mission-detail-panel" role="dialog" aria-modal="true">
        <button
          type="button"
          className="wv-mission-detail-close"
          onClick={onClose}
          aria-label={t('worker.portal.closeNotice')}
        >
          ✕
        </button>
        {children}
      </div>
    </>
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

function PriorityAlertModal({ task, onDismiss, t, lang }) {
  if (!task) return null;
  const localized = localizeWorkerTask(task);
  return (
    <div className="wv-priority-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="wv-priority-title">
      <div className="wv-priority-modal-panel">
        <div className="wv-priority-modal-badge">Priority Alert</div>
        <h2 id="wv-priority-title" className="wv-priority-modal-title">New urgent task</h2>
        <p className="wv-priority-modal-sub">Please review and respond below.</p>
        <WorkerTaskBoardCard task={localized} t={t} lang={lang} />
        <button type="button" className="wv-priority-modal-ok" onClick={onDismiss}>
          Got it
        </button>
      </div>
    </div>
  );
}

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
function StatsDrawer({ workerName, completedTasks, onClose, t, lang }) {
  const dir = localeDirection(lang);
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
  const avgLabel = avgMin != null ? t('worker.stats.minutes', { m: avgMin }) : '—';

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
      return h > 0 ? t('worker.stats.hoursMinutes', { h, m }) : t('worker.stats.minutes', { m });
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
            <div style={{color:'#fff',fontWeight:800,fontSize:17}}>📊 {t('worker.stats.title')}</div>
            <div style={{color:'rgba(255,255,255,0.4)',fontSize:12}}>{workerName} · {t('worker.stats.today')}</div>
          </div>
          <button onClick={close} style={{
            background:'rgba(255,255,255,0.1)',border:'none',color:'#fff',
            width:34,height:34,borderRadius:'50%',cursor:'pointer',
            fontSize:18,display:'flex',alignItems:'center',justifyContent:'center',
          }}>✕</button>
        </div>

        {/* Tabs */}
        <div style={{display:'flex',gap:8,padding:'0 20px 14px'}}>
          {[['stats', `📈 ${t('worker.stats.statsTab')}`], ['history', `📋 ${t('worker.stats.historyTab')}`]].map(([id,lbl])=>(
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
                {' '}{t('worker.stats.loading')}
              </div>
            ) : (
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                <StatCard icon="✅" label={t('worker.stats.completedToday')} value={stats.tasks_done ?? 0} color={D.accent}/>
                <StatCard icon="⏳" label={t('worker.stats.pending')}     value={stats.tasks_pending ?? 0} color={D.amber}/>
                <StatCard icon="⚡" label={t('worker.stats.avgSpeed')} value={avgLabel} sub={t('worker.stats.perTask')} color={D.blue}/>
                <StatCard icon="🕐" label={t('worker.stats.shift')}       value={shiftDur} sub={t('worker.stats.since', { time: shiftStart||'—' })} color="#c084fc"/>
              </div>
            )
          ) : (
            /* History tab */
            completedTasks.length === 0 ? (
              <div style={{textAlign:'center',padding:'36px 0',color:'rgba(255,255,255,0.4)',fontSize:14}}>
                <div style={{fontSize:36,marginBottom:8}}>📭</div>
                {t('worker.stats.noCompleted')}
              </div>
            ) : (
              <div>
                {completedTasks.map((taskRow,i)=>{
                  const room = workerPropertyLabel(taskRow);
                  const dur=taskRow.duration_minutes?t('worker.stats.minutes', { m: taskRow.duration_minutes }):null;
                  return (
                    <div key={taskRow.id||i} style={{
                      display:'flex',alignItems:'center',gap:12,
                      padding:'10px 12px',marginBottom:6,
                      background:'rgba(52,211,153,0.08)',
                      border:'1px solid rgba(52,211,153,0.18)',
                      borderRadius:14,
                      animation:`wvFadeIn .35s ease ${i*0.06}s both`,
                      direction: dir,
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
                          {fmtTime(taskRow.completed_at||taskRow.updated_at, lang)}
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
  onShowToast,
  onOpenDetail,
  t,
  lang,
  dir,
}) {
  const [localStatus, setLocalStatus] = useState(task.status || 'Pending');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [elapsed,     setElapsed]     = useState('0:00');
  const [slaEndMs, setSlaEndMs] = useState(null);

  const btnRef   = useRef(null);
  const startRef = useRef(task.started_at ? new Date(task.started_at) : null);
  const timerRef = useRef(null);

  const hotelName = workerPropertyLabel(task);

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

  const roomLine = workerRoomLine(task);
  const propContextLine = formatWorkerDisplayText(translatePropertyContext(task.property_context));
  const desc = translateTaskDescription(task) || 'משימה חדשה';
  if (typeof console !== 'undefined' && console.debug) {
    console.debug('[TaskCard] rendered title/description', { id: task?.id, title: task?.title, description: desc });
  }
  const assignee = workerAssigneeLabel(task);

  useEffect(() => {
    setLocalStatus(task.status || 'Pending');
    setIsSubmitting(false);
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
    ? { border: W.success, bar: W.success, badge: 'rgba(52,211,153,0.2)', badgeC: W.success, label: t('worker.card.badgeDone') }
    : isIP
      ? { border: W.warn, bar: W.warn, badge: 'rgba(251,191,36,0.2)', badgeC: W.warn, label: t('worker.card.badgeIP') }
      : {
          border: '#ef4444',
          bar: '#ef4444',
          badge: 'rgba(239,68,68,0.2)',
          badgeC: '#f87171',
          label: t('worker.card.badgeWait'),
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
    if (!shiftActive || isSubmitting || isIP) return;
    const prevSt = task.status || 'Pending';
    setIsSubmitting(true);
    onOptimisticStart(task, {
      onFailed: () => {
        setLocalStatus(prevSt);
        setIsSubmitting(false);
      },
      onSuccess: () => {
        setLocalStatus('In_Progress');
        startRef.current = new Date();
        setSlaEndMs(Date.now() + 3 * 60 * 1000);
        setIsSubmitting(false);
      },
    });
  };

  const doNotFinished = () => {
    if (!shiftActive) return;
    if (!isIP) {
      if (typeof onShowToast === 'function') onShowToast(t('worker.card.startFirstToast'));
      return;
    }
    setSlaEndMs(Date.now() + 3 * 60 * 1000);
    if (typeof onShowToast === 'function') onShowToast(t('worker.card.stayActive'));
  };

  const doComplete = () => {
    if (!shiftActive) return;
    setSlaEndMs(null);
    onOptimisticComplete(task);
  };

  const createdLine = task.created_at ? formatTaskDate(task.created_at, lang) : '';

  const handleCardActivate = () => {
    if (typeof onOpenDetail === 'function') onOpenDetail(task);
  };

  return (
    <div
      data-fc
      className={`wv-focus-card ${urgencyClass || ''} ${isEscalated ? 'wv-task-escalated-pulse' : ''}`.trim()}
      dir={dir}
      role={onOpenDetail ? 'button' : undefined}
      tabIndex={onOpenDetail ? 0 : undefined}
      onClick={onOpenDetail ? handleCardActivate : undefined}
      onKeyDown={onOpenDetail ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleCardActivate();
        }
      } : undefined}
      style={{
        position: 'relative',
        background: W.page,
        border: isEscalated ? undefined : (urgencyClass ? undefined : `1px solid ${TL.border}`),
        borderRadius: 20,
        overflow: 'visible',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        boxShadow: urgencyClass ? undefined : '0 8px 40px rgba(0,0,0,0.45)',
        animation: 'wvIn 0.55s cubic-bezier(0.175,0.885,0.32,1.275) both',
        transition: 'border-color .3s, box-shadow .3s',
        opacity: shiftActive ? 1 : 0.65,
        textAlign: dir === 'rtl' ? 'right' : 'left',
        maxWidth: '100%',
        cursor: onOpenDetail ? 'pointer' : undefined,
      }}
    >

      <div style={{ height: 4, background: TL.bar, transition: 'background .3s', boxShadow: `0 0 12px ${TL.bar}66` }} />

      {/* Hotel + meta */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '16px 22px 0', direction: dir }}>
        <div style={{
          width: 48, height: 48, borderRadius: 14, flexShrink: 0,
          background: 'rgba(0, 229, 200, 0.12)',
          border: `1px solid ${W.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Building2 size={24} color="#00e5c8" strokeWidth={2} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, color: W.muted, fontWeight: 700, letterSpacing: '0.06em' }}>{t('worker.card.hotel')}</div>
          <div className="wv-hotel-name-line" style={{ fontSize: 18, color: W.text, fontWeight: 800, lineHeight: 1.25 }}>{hotelName}</div>
          {propContextLine && (
            <div className="wv-mission-card-context" style={{ fontSize: 12, color: W.muted, marginTop: 4, fontWeight: 600 }}>
              {propContextLine}
            </div>
          )}
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
              }}>{t('worker.portal.sla')} 3:00 → {slaMmSs}</span>
            )}
            {queueSize > 0 && !isIP && (
              <span style={{ fontSize:12, color: W.muted, fontWeight:600 }}>
                {t('worker.card.moreInQueue', { count: queueSize })}
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
              {t('worker.portal.noPhoto')}
            </div>
          )}
        </div>
      </div>

      {/* Room number + request */}
      <div style={{ padding: '16px 22px 0', direction: dir }}>
        <div style={{ fontSize:13, color: W.muted, fontWeight:700, marginBottom:6, display:'flex', alignItems:'center', gap:6 }}>
          <MapPin size={14} color="#00e5c8" /> {t('worker.card.room')} · {t('worker.card.currentTask')}
        </div>
        <div className="wv-room-line" style={{
          fontSize:'clamp(36px,11vw,56px)',
          fontWeight:800,
          color: W.text,
          lineHeight:1.05,
          letterSpacing:0,
          textShadow: '0 0 40px rgba(0,229,200,0.15)',
          animation: isD ? 'wvBounce 0.5s ease' : 'none',
          whiteSpace: 'nowrap',
          overflow: 'visible',
          maxWidth: '100%',
        }}>{roomLine}</div>
      </div>

      <div style={{ padding: '14px 22px 0', direction: dir }}>
        <div style={{ fontSize: 11, color: W.muted, fontWeight: 700, marginBottom: 6 }}>{t('worker.card.request')}</div>
        <div style={{
          background: W.bg,
          borderRadius:12,
          padding:'16px 18px',
          fontSize:16,
          color: W.text,
          lineHeight:1.55,
          border:`1px solid ${W.border}`,
          wordBreak: 'break-word',
          overflowWrap: 'anywhere',
        }}>{desc}</div>
      </div>

      {assignee && (
        <div style={{ padding:'8px 18px 0', direction: dir }}>
          <span className="wv-staff-pill" style={{ fontSize:13, color: W.muted, background: W.bg, borderRadius:8, padding:'6px 14px', border: `1px solid ${W.border}`, display: 'inline-block', maxWidth: '100%' }}>
            👤 {assignee}
          </span>
        </div>
      )}

      <div
        className="wv-focus-actions"
        style={{ padding: '24px 22px 28px', direction: dir }}
      >

        {isD ? (
          <div style={{
            textAlign:'center', padding:'20px',
            background:'#e6f7f5', borderRadius:12,
            border:`1px solid ${W.success}`,
            color: W.success, fontWeight:800, fontSize:17,
            animation:'wvBounce 0.5s ease',
          }}>🎉 {t('worker.portal.completedBanner')}</div>

        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'stretch' }}>

            {!shiftActive && (
              <div style={{
                textAlign: 'center', fontSize: 14, fontWeight: 600, color: W.muted,
                background: W.bg, borderRadius: 12, padding: '14px 16px',
                border: `1px solid ${W.border}`,
              }}>
                {t('worker.card.shiftFirst')}
              </div>
            )}

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                doStart();
              }}
              disabled={!shiftActive || isSubmitting || isIP}
              aria-label={t('worker.card.saw')}
              style={{
                width: '100%',
                padding: '18px 24px',
                minHeight: 56,
                background: (isSubmitting || isIP) ? W.bg : W.page,
                border: `2px solid ${(isSubmitting || isIP) ? W.border : W.text}`,
                borderRadius: 12,
                color: W.text,
                fontWeight: 700,
                fontSize: 18,
                cursor: (!shiftActive || isSubmitting || isIP) ? 'not-allowed' : 'pointer',
                opacity: !shiftActive ? 0.5 : 1,
              }}
            >
              {isSubmitting ? `${t('worker.card.badgeIP')}…` : isIP ? t('worker.card.taskOpen') : t('worker.card.saw')}
            </button>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                doNotFinished();
              }}
              disabled={!shiftActive}
              aria-label={t('worker.card.notDone')}
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
              {t('worker.card.notDone')}
            </button>

            <button
              ref={btnRef}
              type="button"
              className="wv-btn-complete wv-btn-done-he"
              onClick={(e) => {
                e.stopPropagation();
                doComplete();
              }}
              disabled={!shiftActive || !isIP}
              aria-label="בוצע"
              title="בוצע"
              style={{
                alignSelf: 'center',
                margin: '0 auto',
                cursor: (!shiftActive || !isIP) ? 'not-allowed' : 'pointer',
                opacity: (!shiftActive || !isIP) ? 0.45 : 1,
              }}
            >
              בוצע
            </button>

            {queueSize > 0 && (
              <div style={{ textAlign:'center', fontSize:13, color: W.muted }}>
                {t('worker.card.moreInQueue', { count: queueSize })}
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
  const { t } = useTranslations();
  const lang = useStore((s) => s.lang) || 'he';
  const setLang = useStore((s) => s.setLang);
  const dir = localeDirection(lang);
  const workerName = normalizeWorkerSlug(routeWorkerId)
    || normalizeWorkerSlug(workerNameFromPath())
    || t('worker.portal.defaultWorker');

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
  const [pilotTaskTotal, setPilotTaskTotal] = useState(0);
  const [syncCount, setSyncCount] = useState(0);
  const [showSyncHint, setShowSyncHint] = useState(false);
  const mayaNoticeAckRef = useRef(0);
  const [mayaNotice, setMayaNotice] = useState(null);
  const seenPriorityAlertRef = useRef(new Set());
  const [priorityAlertTask, setPriorityAlertTask] = useState(null);
  const dismissedMayaInterventionRef = useRef(new Set());
  const [mayaIvDismissedBump, setMayaIvDismissedBump] = useState(0);
  const [workerUrgencyTick, setWorkerUrgencyTick] = useState(0);
  const [loadingTaskId, setLoadingTaskId] = useState(null);
  const [detailTask, setDetailTask] = useState(null);
  const refreshDebounceRef = useRef(null);
  const lastWorkerTasksRef = useRef([]);

  useEffect(() => {
    setPending((p) => p.map((row) => enrichWorkerTaskPropertyMeta(row)));
    setCompleted((c) => c.map((row) => enrichWorkerTaskPropertyMeta(row)));
  }, [lang]);

  useEffect(() => {
    if (detailTask && !pending.some((row) => row.id === detailTask.id)) {
      setDetailTask(null);
    }
  }, [pending, detailTask]);

  const queueHeadPending = pending[0];
  useEffect(() => {
    const headTask = queueHeadPending;
    if (!headTask || !isPending(headTask.status)) return undefined;
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
    setToast(`🎉 ${t('worker.portal.taskDoneToast')}`);
  }, [playCompletionSound, t]);

  const syncShiftFromServer = useCallback(async () => {
    try {
      const r = await fetch(`${API_URL}/active-workers`);
      const d = await r.json().catch(() => ({}));
      const activeIds = new Set((d.workers || []).map((w) => String(w.worker_id)));
      if (activeIds.has(String(workerName))) {
        setShiftPhase((p) => (p === 'finished' ? p : 'active'));
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
      setToast(`✅ ${t('worker.portal.shiftActiveToast')}`);
    } catch {
      setShiftPhase('active');
      setToast(`✅ ${t('worker.card.shiftActive')}`);
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
      setToast(t('worker.portal.shiftEndedToast'));
    } catch {
      setToast(t('worker.portal.shiftErrorToast'));
    }
  };

  /* ── load tasks (20s timeout to avoid Supabase/network hangs) ── */
  const refreshWorkerMissions = useCallback(async (silent = true) => {
    if (!silent) setLoading(true);
    setSpin(true);
    try {
      const url = `${API_URL}/worker/tasks?worker_id=${encodeURIComponent(workerName)}&portfolio=corfu`;
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 20000);
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(timeout);
      if (!res.ok) throw new Error(res.status);
      let rawList = [];
      if (res.status !== 204) {
        const raw = await res.json().catch(() => ({}));
        rawList = normalizeWorkerTasksPayload(raw);
      }
      rawList = filterCorfuPilotTasks(rawList);
      const tasks = mergeWorkerTasksFromServer(
        rawList.map((taskRow) => enrichWorkerTaskPropertyMeta(taskRow)),
        lastWorkerTasksRef.current,
      );
      lastWorkerTasksRef.current = tasks;

      setPilotTaskTotal(tasks.length);

      // Separate active vs completed — treat ANYTHING not explicitly Done as active.
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

  const refreshWorkerMissionsRef = useRef(refreshWorkerMissions);
  refreshWorkerMissionsRef.current = refreshWorkerMissions;

  useEffect(() => {
    syncShiftFromServer();
  }, [syncShiftFromServer]);

  /* /api/worker/maya-notice polling removed — route no longer exists on backend */

  const dismissMayaNotice = useCallback(() => {
    if (mayaNotice?.seq) {
      mayaNoticeAckRef.current = Math.max(mayaNoticeAckRef.current, mayaNotice.seq);
    }
    setMayaNotice(null);
  }, [mayaNotice]);

  useEffect(() => {
    refreshWorkerMissionsRef.current(false);

    const interval = setInterval(() => {
      refreshWorkerMissionsRef.current(true);
    }, 6000);

    return () => clearInterval(interval);
  }, [workerName]);

  /* Instant refresh — Socket.IO task_updated + cross-tab + Maya events */
  useEffect(() => {
    const schedule = () => {
      if (refreshDebounceRef.current) clearTimeout(refreshDebounceRef.current);
      refreshDebounceRef.current = setTimeout(() => {
        refreshDebounceRef.current = null;
        refreshWorkerMissionsRef.current(true);
      }, 300);
    };
    const unsubSocket = hotelRealtime.subscribe('task_updated', schedule);
    window.addEventListener('maya-refresh-tasks', schedule);
    window.addEventListener('maya-task-created', schedule);
    const unsubCross = subscribeCrossTabTaskSync(schedule);
    return () => {
      unsubSocket();
      if (refreshDebounceRef.current) clearTimeout(refreshDebounceRef.current);
      window.removeEventListener('maya-refresh-tasks', schedule);
      window.removeEventListener('maya-task-created', schedule);
      unsubCross();
    };
  }, [workerName]);

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
    (task, callbacks) => {
      const prev = { ...task };
      const onFailed = callbacks?.onFailed;
      const onSuccess = callbacks?.onSuccess;
      setLoadingTaskId(task.id);
      setSyncCount((c) => c + 1);
      fetch(`${API_URL}/worker/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'In_Progress' }),
      })
        .then(async (res) => {
          const d = await res.json().catch(() => ({}));
          if (!res.ok || (d.status && d.status !== 'success')) {
            setPending((p) =>
              p.map((t) => (t.id === prev.id ? { ...t, status: prev.status } : t))
            );
            if (typeof onFailed === 'function') onFailed();
            setToast(`❌ ${d.error || t('worker.errors.startFailed')}`);
            return;
          }
          setPending((p) =>
            p.map((t) =>
              t.id === task.id
                ? {
                    ...t,
                    status: 'In_Progress',
                    started_at: d.task?.started_at || t.started_at,
                  }
                : t
            )
          );
          if (typeof onSuccess === 'function') onSuccess();
          refreshWorkerMissions(true);
        })
        .catch(() => {
          setPending((p) =>
            p.map((t) => (t.id === prev.id ? { ...t, status: prev.status } : t))
          );
          if (typeof onFailed === 'function') onFailed();
          setToast(`❌ ${t('worker.errors.connection')}`);
        })
        .finally(() => {
          setSyncCount((c) => Math.max(0, c - 1));
          setLoadingTaskId(null);
        });
    },
    [refreshWorkerMissions, t],
  );

  const handleBusyOrDecline = useCallback(
    (task) => {
      setSyncCount((c) => c + 1);
      fetch(`${API_URL}/worker/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cannot_take', worker_id: workerName }),
      })
        .then(async (res) => {
          const d = await res.json().catch(() => ({}));
          if (!res.ok || (d.status && d.status !== 'success')) {
            setToast(`❌ ${d.error || t('worker.errors.updateFailed')}`);
            refreshWorkerMissions(true);
            return;
          }
          setToast(t('worker.portal.taskTransferred'));
          refreshWorkerMissions(true);
        })
        .catch(() => {
          setToast(`❌ ${t('worker.errors.connection')}`);
          refreshWorkerMissions(true);
        })
        .finally(() => setSyncCount((c) => Math.max(0, c - 1)));
    },
    [refreshWorkerMissions, workerName, t],
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
      const completedRow = {
        ...task,
        status: 'completed',
        completed_at: new Date().toISOString(),
        completed_by: workerName,
      };
      setCompleted((c) => [completedRow, ...c.filter((t) => t.id !== id)]);
      lastWorkerTasksRef.current = [
        completedRow,
        ...lastWorkerTasksRef.current.filter((t) => t.id !== id),
      ];

      setSyncCount((c) => c + 1);
      fetch(`${API_URL}/worker/tasks/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'completed',
          completed_at: completedRow.completed_at,
          completed_by: workerName,
          worker_id: workerName,
        }),
      })
        .then(async (res) => {
          const d = await res.json().catch(() => ({}));
          if (!res.ok || (d.status && d.status !== 'success')) {
            setPending((p) => (p.some((t) => t.id === id) ? p : [task, ...p]));
            setXp((x) => Math.max(0, x - 10));
            setStreak((s) => Math.max(0, s - 1));
            setCelebration(null);
            setToast(`❌ ${d.error || t('worker.errors.saveFailed')}`);
            return;
          }
          refreshWorkerMissions(true);
        })
        .catch(() => {
          setPending((p) => (p.some((t) => t.id === id) ? p : [task, ...p]));
          setXp((x) => Math.max(0, x - 10));
          setStreak((s) => Math.max(0, s - 1));
          setCelebration(null);
          setToast(`❌ ${t('worker.errors.connection')}`);
        })
        .finally(() => setSyncCount((c) => Math.max(0, c - 1)));
    },
    [applyCompletionRewards, refreshWorkerMissions, playCompletionSound, workerName, t],
  );

  // Single-task mode: always show the first task (In_Progress floated to top).
  // The worker never manually browses; next task auto-slides in after Done.
  const currentTask = pending[0] || null;
  const queueSize   = Math.max(0, pending.length - 1); // tasks waiting after current
  const hasIP       = pending.length > 0 && isInProgress(pending[0]?.status);
  const taskTotal   = pilotTaskTotal > 0 ? pilotTaskTotal : pending.length + completed.length;
  const shiftLabel = shiftPhase === 'active'
    ? t('worker.card.shiftActive')
    : shiftPhase === 'finished'
      ? t('worker.card.shiftFinished')
      : t('worker.card.shiftNotStarted');
  const dateLocale = lang === 'he' ? 'he-IL' : lang === 'el' ? 'el-GR' : lang === 'ar' ? 'ar' : 'en-US';
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

  const openTaskDetails = useCallback((task) => {
    if (!task?.id) return;
    console.log('[WorkerView] open task', task.id);
    const fresh = pending.find((row) => row.id === task.id) || task;
    setDetailTask(enrichWorkerTaskPropertyMeta(fresh));
  }, [pending]);

  return (
    <>
      <div className="wv-premium-root" style={{ direction: dir }}>
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
              {t('worker.portal.greeting', { name: workerName })}
            </div>
            <div style={{display:'flex',alignItems:'center',gap:8,marginTop:8,flexWrap:'wrap'}}>
              <span style={{
                fontSize:12, fontWeight:700, padding:'4px 10px', borderRadius:8,
                background: shiftPhase === 'active' ? '#e6f7f5' : W.bg,
                color: shiftPhase === 'active' ? W.success : W.muted,
                border: `1px solid ${W.border}`,
              }}>
                {t('worker.portal.shift')}: {shiftLabel}
              </span>
              <span style={{ color: W.muted, fontSize: 12, fontWeight: 600 }}>
                {t('worker.portal.level', { level, xp, streak })}
              </span>
              {taskTotal > 0 && shiftActive && (
                <span style={{ fontSize: 12, color: W.text, fontWeight: 700 }}>
                  {t('worker.portal.taskOf', { total: taskTotal })}
                </span>
              )}
              <span style={{
                width:8, height:8, borderRadius:'50%', flexShrink:0,
                background: hasIP ? W.warn : currentTask ? W.accent : W.success,
              }}/>
              <span style={{color: W.muted, fontSize:12}}>
                {hasIP ? t('worker.portal.statusIP') : currentTask ? t('worker.portal.statusWait') : t('worker.portal.statusNone')}
              </span>
              {showSyncHint && syncCount > 0 && (
                <span style={{
                  display:'inline-flex', alignItems:'center', gap:6,
                  fontSize:11, color: W.muted, fontWeight:600,
                }}>
                  <span style={{ display:'inline-block', animation:'wvSpin 0.9s linear infinite' }}>⏳</span>
                  {t('worker.portal.syncing')}
                </span>
              )}
              {lastSync && (
                <span style={{color: W.muted, fontSize:11}}>
                  {lastSync.toLocaleTimeString(dateLocale,{hour:'2-digit',minute:'2-digit'})}
                </span>
              )}
            </div>
          </div>

          <button type="button" onClick={()=>setDrawer(true)} title={t('worker.stats.title')} style={{
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
            {t('worker.portal.reports')}
          </button>

          <button type="button" onClick={()=>refreshWorkerMissions()} title={t('worker.card.refresh')} style={{
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

          <div className="wv-lang-pill" role="group" aria-label="Language">
            {PILOT_LANGUAGE_OPTIONS.map((l) => (
              <button
                key={l.code}
                type="button"
                className={`wv-lang-btn${lang === l.code ? ' wv-lang-btn-active' : ''}`}
                onClick={() => setLang(l.code)}
                aria-pressed={lang === l.code}
              >
                {l.label}
              </button>
            ))}
          </div>
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
                {t('worker.portal.bulletin')}
              </div>
              <div style={{ fontSize: 11, color: W.muted, fontWeight: 600, marginBottom: 6 }}>
                {t('worker.portal.bulletinSub')}
              </div>
              <div style={{ fontSize: 14, color: W.text, lineHeight: 1.55, fontWeight: 600 }}>
                {mayaNotice.message}
              </div>
              <button
                type="button"
                onClick={dismissMayaNotice}
                aria-label={t('worker.portal.closeNotice')}
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
                  {t('worker.portal.startShift')}
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
                  {t('worker.portal.endShift')}
                </button>
              )}
            </div>
            {shiftPhase === 'finished' && (
              <p style={{ margin: '12px 0 0', fontSize: 13, color: W.muted, textAlign: 'center' }}>
                {t('worker.portal.shiftEndedHint')}
              </p>
            )}
          </div>
        </div>

        {/* ── Main area ── */}
        <div style={{ maxWidth: 520, margin: '0 auto', padding: '24px 20px 0' }}>
          {loading ? (
            <div style={{ textAlign:'center', paddingTop: 80, color: W.muted }}>
              <div style={{ fontSize: 36, animation:'wvSpin 1s linear infinite', display:'inline-block' }}>⏳</div>
              <div style={{ marginTop: 12, fontSize: 15 }}>{t('worker.card.loading')}</div>
            </div>
          ) : !currentTask ? (
            <div style={{ textAlign:'center', padding: '56px 24px', color: W.muted }}>
              <div style={{ fontSize: 52, marginBottom: 16 }}>✓</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: W.text, marginBottom: 8 }}>{t('worker.card.noOpen')}</div>
              <div style={{ fontSize: 15, lineHeight: 1.6, maxWidth: 320, margin: '0 auto' }}>
                {t('worker.card.noOpenHint')}
              </div>
              <button type="button" onClick={()=>refreshWorkerMissions()} style={{
                marginTop: 28,
                background: W.text,
                border: 'none',
                borderRadius: 12,
                color: W.white,
                fontWeight: 700,
                padding: '14px 32px',
                cursor: 'pointer',
                fontSize: 15,
              }}>{t('worker.card.refresh')}</button>

              {/* One-click reset: reactivates all Done tasks for this worker */}
              <button onClick={async()=>{
                try {
                  const r = await fetch(
                    `${API_URL}/dev/reset-worker-tasks/${encodeURIComponent(workerName)}`,
                    { method:'POST' }
                  );
                  const d = await r.json();
                  if (d.ok) { setToast(`✅ ${d.reset_count} משימות אופסו ל-Pending`); refreshWorkerMissions(); }
                  else setToast('❌ ' + (d.error || 'שגיאה'));
                } catch { setToast('❌ שגיאת חיבור'); }
              }} style={{
                marginTop:10, display:'block', width:'100%',
                background:'rgba(249,115,22,0.15)',
                border:'1px solid rgba(249,115,22,0.4)',
                borderRadius:16, color:'#f97316', fontWeight:700,
                padding:'11px 0', cursor:'pointer', fontSize:13,
              }}>
                🔄 {t('worker.portal.resetTasks', { count: completed.length })}
              </button>

              {completed.length > 0 && (
                <button onClick={()=>setDrawer(true)} style={{
                  marginTop:10, display:'block', width:'100%',
                  background: W.bg,
                  border:`1px solid ${W.border}`,
                  borderRadius:12, color: W.success, fontWeight:700,
                  padding:'11px 0', cursor:'pointer', fontSize:13,
                }}>
                  📊 {t('worker.portal.viewCompleted', { count: completed.length })}
                </button>
              )}
            </div>
          ) : (
            <>
              {pending.length > 0 && (
                <div className="wv-mission-queue" dir={dir}>
                  {pending.map((taskRow) => (
                    <WorkerTaskBoardCard
                      key={taskRow.id}
                      task={taskRow}
                      t={t}
                      lang={lang}
                      selected={detailTask?.id === taskRow.id}
                      openTaskDetails={openTaskDetails}
                    />
                  ))}
                </div>
              )}

              {!detailTask && (
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
                        onOptimisticComplete={(taskRow) => {
                          setDetailTask(null);
                          handleOptimisticComplete(taskRow);
                        }}
                        onBusy={handleBusyOrDecline}
                        queueSize={queueSize}
                        shiftActive={shiftActive}
                        onShowToast={(msg) => setToast(msg)}
                        onOpenDetail={() => setDetailTask(currentTask)}
                        t={t}
                        lang={lang}
                        dir={dir}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              )}

              {detailTask && (
                <MissionDetailModal onClose={() => setDetailTask(null)} t={t}>
                  <FocusCard
                    task={detailTask}
                    workerName={workerName}
                    onOptimisticStart={handleOptimisticStart}
                    onOptimisticComplete={(taskRow) => {
                      setDetailTask(null);
                      handleOptimisticComplete(taskRow);
                    }}
                    onBusy={handleBusyOrDecline}
                    queueSize={Math.max(0, pending.length - 1)}
                    shiftActive={shiftActive}
                    onShowToast={(msg) => setToast(msg)}
                    t={t}
                    lang={lang}
                    dir={dir}
                  />
                </MissionDetailModal>
              )}

              {queueSize > 0 && !detailTask && (
                <div style={{
                  textAlign:'center', marginTop: 20,
                  color: W.muted, fontSize: 14,
                }}>
                  {t('worker.card.moreInQueue', { count: queueSize })}
                </div>
              )}

              {currentTask && shiftActive && isPending(currentTask.status) && lang === 'he' && !detailTask && (
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
          {t('worker.portal.footer')}
        </p>
        </div>
      </div>

      {/* Stats drawer */}
      {drawer && (
        <StatsDrawer
          workerName={workerName}
          completedTasks={completed}
          onClose={()=>setDrawer(false)}
          t={t}
          lang={lang}
        />
      )}

      {toast && <Toast msg={toast} onClose={()=>setToast(null)}/>}

      {priorityAlertTask && (
        <PriorityAlertModal
          task={priorityAlertTask}
          onDismiss={() => setPriorityAlertTask(null)}
          t={t}
          lang={lang}
        />
      )}

      {celebration && (
        <CelebrationOverlay kind={celebration} onDone={clearCelebration} />
      )}
    </>
  );
}
