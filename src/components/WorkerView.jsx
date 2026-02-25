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
import { API_URL } from '../utils/apiClient';

/* ── palette ─────────────────────────────────────────────── */
const P = {
  bg:     '#070d1a',
  teal:   '#075E54',
  green:  '#25D366',
  accent: '#34d399',
  amber:  '#fbbf24',
  red:    '#f87171',
  blue:   '#60a5fa',
  white:  '#ffffff',
  muted:  'rgba(255,255,255,0.45)',
  glass:  'rgba(255,255,255,0.06)',
  border: 'rgba(255,255,255,0.12)',
};

const REFRESH_MS = 30_000; // 30 s — auto-refresh interval

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
function isActive(s = '') {
  return isPending(s) || isInProgress(s);
}
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

/* ── Confetti burst ──────────────────────────────────────── */
const CFCOLORS = ['#25D366','#fbbf24','#f87171','#60a5fa','#c084fc','#34d399','#fff'];
function Confetti({ origin }) {
  const pts = Array.from({length:30},(_,i)=>{
    const a=(i/30)*360, d=55+Math.random()*85, r=(a*Math.PI)/180;
    return {
      tx2:`${Math.cos(r)*d}px`, ty2:`${Math.sin(r)*d-55}px`,
      color:CFCOLORS[i%CFCOLORS.length],
      size:5+Math.random()*9, delay:Math.random()*0.18,
      round:Math.random()>0.5,
    };
  });
  return (
    <div style={{position:'absolute',top:origin.y,left:origin.x,pointerEvents:'none',zIndex:60}}>
      {pts.map((p,i)=>(
        <div key={i} style={{
          position:'absolute', width:p.size, height:p.size,
          borderRadius:p.round?'50%':'2px', background:p.color,
          '--tx':'0px','--ty':'0px','--tx2':p.tx2,'--ty2':p.ty2,
          animation:`wvFlyUp 0.85s cubic-bezier(0.22,1,0.36,1) ${p.delay}s forwards`,
        }}/>
      ))}
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
      background:`linear-gradient(135deg,${P.teal},${P.green})`,
      color:'#fff',borderRadius:50,padding:'12px 26px',
      fontWeight:800,fontSize:14,
      boxShadow:'0 8px 30px rgba(37,211,102,0.45)',
      zIndex:9999,whiteSpace:'nowrap',
      animation:'wvToast .3s ease',
    }}>
      {msg}
    </div>
  );
}

/* ── Stat card (glassmorphism) ───────────────────────────── */
function StatCard({ label, value, sub, color = P.accent, icon }) {
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
    fetch(`${API_URL}/api/worker-stats/${encodeURIComponent(workerName)}`)
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
              background: tab===id ? P.green : 'rgba(255,255,255,0.07)',
              border:`1px solid ${tab===id ? P.green : 'rgba(255,255,255,0.12)'}`,
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
                <StatCard icon="✅" label="הושלמו היום" value={stats.tasks_done ?? 0} color={P.accent}/>
                <StatCard icon="⏳" label="ממתינות"     value={stats.tasks_pending ?? 0} color={P.amber}/>
                <StatCard icon="⚡" label="מהירות ממוצעת" value={avgLabel} sub="לכל משימה" color={P.blue}/>
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
                          {dur && <span style={{color:P.accent,marginRight:8}}> ⚡ {dur}</span>}
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

/* ── Single Task Card — Smart Traffic Light ──────────────── */
function FocusCard({ task, workerName, onDone, queueSize = 0 }) {
  // 'idle' | 'starting' | 'completing' | 'done' | 'exit'
  const [phase,       setPhase]       = useState('idle');
  const [localStatus, setLocalStatus] = useState(task.status || 'Pending');
  const [confetti,    setConfetti]    = useState(null);
  const [elapsed,     setElapsed]     = useState('0:00');

  const btnRef   = useRef(null);
  const startRef = useRef(task.started_at ? new Date(task.started_at) : null);
  const timerRef = useRef(null);

  // Build room display value — strip "חדר " / "room " prefix so the card
  // label "חדר / נכס" + value don't produce the duplicate "חדר חדר".
  const rawRoom = task.room_id || task.property_name || task.room
                  || (task.property_id ? `חדר ${task.property_id}` : '');
  const room = rawRoom
    ? rawRoom.replace(/^(חדר|room)\s*/i, '').trim() || rawRoom
    : 'לא ידוע';

  const desc  = task.task_type || task.description  || task.content || 'ביצוע משימה';
  const staff = task.staff_name || task.assigned_to || workerName  || '';

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

  /* traffic-light palette */
  const isIP = isInProgress(localStatus);
  const isD  = phase === 'done' || phase === 'exit';
  const isE  = phase === 'exit';
  const isL  = phase === 'starting' || phase === 'completing';

  const TL = isD  ? { border:'#25D366', glow:'rgba(37,211,102,0.3)',  bar:`linear-gradient(90deg,#25D366,#34d399)`,      badge:'rgba(37,211,102,0.18)',  badgeC:'#34d399', label:'✅ הושלם'   }
           : isIP ? { border:'#f97316', glow:'rgba(249,115,22,0.3)', bar:'linear-gradient(90deg,#f97316,#fb923c)',     badge:'rgba(249,115,22,0.15)', badgeC:'#f97316', label:'🟠 בביצוע' }
           :        { border:'#ef4444', glow:'rgba(239,68,68,0.28)',  bar:'linear-gradient(90deg,#ef4444,#f97316)',     badge:'rgba(239,68,68,0.13)',  badgeC:'#fbbf24', label:'🔴 ממתין'  };

  /* shared PATCH helper */
  const patch = async (status) => {
    const res = await fetch(`${API_URL}/api/property-tasks/${task.id}`, {
      method:'PATCH', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      const d = await res.json().catch(()=>({}));
      alert('שגיאה: ' + (d.error || res.status));
      return false;
    }
    return true;
  };

  /* 🟠 Start Working */
  const doStart = async () => {
    if (phase !== 'idle') return;
    setPhase('starting');
    try {
      const ok = await patch('In_Progress');
      if (ok) {
        startRef.current = new Date();
        setLocalStatus('In_Progress');
      }
    } catch { alert('שגיאת חיבור — נסה שוב'); }
    setPhase('idle');
  };

  /* 🏁 Mark as Done */
  const doComplete = async () => {
    if (phase !== 'idle') return;
    setPhase('completing');
    if (btnRef.current) {
      const r  = btnRef.current.getBoundingClientRect();
      const cr = btnRef.current.closest('[data-fc]')?.getBoundingClientRect() || r;
      setConfetti({ x: r.left-cr.left+r.width/2, y: r.top-cr.top+r.height/2 });
    }
    try {
      const ok = await patch('Done');
      if (ok) {
        setPhase('done');
        setTimeout(()=>{ setPhase('exit'); setTimeout(()=>onDone(task.id), 550); }, 1500);
      } else {
        setPhase('idle'); setConfetti(null);
      }
    } catch {
      alert('שגיאת חיבור — נסה שוב');
      setPhase('idle'); setConfetti(null);
    }
  };

  return (
    <div data-fc style={{
      position:'relative',
      background:'linear-gradient(145deg,rgba(255,255,255,0.09) 0%,rgba(255,255,255,0.04) 100%)',
      border: `2px solid ${TL.border}`,
      borderRadius:32, overflow:'hidden',
      boxShadow: `0 0 32px ${TL.glow}, 0 12px 40px rgba(0,0,0,0.5)`,
      animation: isE ? 'wvOut 0.5s cubic-bezier(0.4,0,1,1) forwards'
                     : 'wvIn 0.55s cubic-bezier(0.175,0.885,0.32,1.275) both',
      backdropFilter:'blur(14px)', WebkitBackdropFilter:'blur(14px)',
      transition:'border-color .4s, box-shadow .4s',
    }}>
      {confetti && <Confetti origin={confetti}/>}

      {/* Traffic-light accent bar */}
      <div style={{height:5, background:TL.bar, transition:'background .5s'}}/>

      {/* Top row */}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'14px 18px 0'}}>
        <div style={{display:'flex',alignItems:'center',gap:7,flexWrap:'wrap'}}>
          <span style={{
            background:TL.badge, color:TL.badgeC,
            border:`1px solid ${TL.border}66`,
            fontSize:10,fontWeight:800,padding:'4px 11px',borderRadius:30,letterSpacing:'0.07em',
          }}>{TL.label}</span>

          {/* live timer when in progress */}
          {isIP && (
            <span style={{
              fontSize:11,fontWeight:800,color:'#f97316',
              background:'rgba(249,115,22,0.12)',border:'1px solid rgba(249,115,22,0.3)',
              padding:'2px 10px',borderRadius:20,
            }}>⏱ {elapsed}</span>
          )}

          {queueSize > 0 && !isIP && (
            <span style={{fontSize:11,color:'rgba(255,255,255,0.35)',fontWeight:600}}>
              +{queueSize} בתור
            </span>
          )}
        </div>
        <span style={{fontSize:11,color:P.muted}}>{fmtShortDate(task.created_at)} {fmtTime(task.created_at)}</span>
      </div>

      {/* ROOM hero */}
      <div style={{padding:'10px 18px 0',direction:'rtl'}}>
        <div style={{fontSize:11,color:P.muted,fontWeight:700,letterSpacing:'0.1em',textTransform:'uppercase',marginBottom:2}}>
          חדר / נכס
        </div>
        <div style={{
          fontSize:'clamp(54px,15vw,90px)',fontWeight:900,color:P.white,
          lineHeight:1,letterSpacing:'-0.03em',
          textShadow:`0 0 45px ${TL.glow}`,
          animation: isD?'wvBounce 0.5s ease':'none',
          transition:'text-shadow .4s',
        }}>{room}</div>
      </div>

      {/* Description */}
      <div style={{padding:'10px 18px 0',direction:'rtl'}}>
        <div style={{
          background:'rgba(255,255,255,0.07)',borderRadius:14,
          padding:'10px 14px',fontSize:14,color:'rgba(255,255,255,0.82)',
          lineHeight:1.6,border:'1px solid rgba(255,255,255,0.08)',
        }}>{desc}</div>
      </div>

      {/* Staff chip */}
      {staff && (
        <div style={{padding:'8px 18px 0',direction:'rtl'}}>
          <span style={{fontSize:12,color:P.muted,background:'rgba(255,255,255,0.06)',borderRadius:20,padding:'4px 12px'}}>
            👤 {staff}
          </span>
        </div>
      )}

      {/* ── Action area ── */}
      <div style={{padding:'14px 18px 18px',direction:'rtl'}}>

        {/* ✅ Done banner — shown after worker marks complete */}
        {isD ? (
          <div style={{
            textAlign:'center', padding:'16px',
            background:'rgba(37,211,102,0.12)', borderRadius:18,
            border:'1px solid rgba(37,211,102,0.3)',
            color:P.accent, fontWeight:800, fontSize:16,
            animation:'wvBounce 0.5s ease',
          }}>🎉 כל הכבוד! משימה הושלמה</div>

        ) : (
          /* Both buttons always visible — worker can Start then Done, or skip straight to Done */
          <div style={{display:'flex', flexDirection:'column', gap:10}}>

            {/* Row: 🟠 Start  +  🏁 Done */}
            <div style={{display:'flex', gap:10}}>

              {/* 🟠 Start Working — orange, left button */}
              <button onClick={doStart} disabled={isL || isIP} style={{
                flex: isIP ? '0 0 44px' : 1,
                padding:'15px 0',
                background: isIP
                  ? 'rgba(249,115,22,0.18)'
                  : isL
                    ? 'rgba(249,115,22,0.3)'
                    : 'linear-gradient(135deg,#c2410c 0%,#f97316 55%,#fb923c 100%)',
                border: isIP ? '1px solid rgba(249,115,22,0.35)' : 'none',
                borderRadius:16, color: isIP ? '#f97316' : '#fff',
                fontWeight:900, fontSize: isIP ? 20 : 15,
                cursor: (isL||isIP) ? 'default' : 'pointer',
                letterSpacing:'0.03em',
                boxShadow: isIP ? 'none' : '0 6px 18px rgba(249,115,22,0.5)',
                display:'flex', alignItems:'center', justifyContent:'center', gap:6,
                transition:'all .3s',
              }}
                onMouseDown={e=>{ if(!isIP&&!isL) e.currentTarget.style.transform='scale(0.96)'; }}
                onMouseUp={e=>e.currentTarget.style.transform='scale(1)'}
                title={isIP ? 'כבר בביצוע' : 'התחל ביצוע'}
              >
                {isIP ? '🟠' : isL ? <span style={{animation:'wvSpin 0.7s linear infinite',display:'inline-block'}}>⏳</span> : <>{`🟠`}<span>התחל ביצוע</span></>}
              </button>

              {/* 🏁 Mark as Done — green, right button (main CTA) */}
              <button ref={btnRef} onClick={doComplete} disabled={isL} style={{
                flex:1, padding:'15px 0',
                background: isL
                  ? 'rgba(37,211,102,0.3)'
                  : `linear-gradient(135deg,#16a34a 0%,${P.green} 55%,#34d399 100%)`,
                border:'none', borderRadius:16, color:'#fff',
                fontWeight:900, fontSize:15,
                cursor:isL?'wait':'pointer', letterSpacing:'0.03em',
                boxShadow: isL ? 'none' : '0 6px 22px rgba(37,211,102,0.5)',
                animation: isIP ? 'wvPulse 2.2s infinite' : 'none',
                display:'flex', alignItems:'center', justifyContent:'center', gap:6,
              }}
                onMouseDown={e=>{ if(!isL) e.currentTarget.style.transform='scale(0.96)'; }}
                onMouseUp={e=>e.currentTarget.style.transform='scale(1)'}
              >
                {isL
                  ? <><span style={{animation:'wvSpin 0.7s linear infinite',display:'inline-block'}}>⏳</span><span>שומר...</span></>
                  : <><span>✅</span><span>סיים משימה</span></>}
              </button>
            </div>

            {/* Queue info */}
            {queueSize > 0 && (
              <div style={{textAlign:'center', fontSize:11, color:'rgba(255,255,255,0.3)'}}>
                🔴 {queueSize} משימ{queueSize===1?'ה':'ות'} נוספ{queueSize===1?'ת':'ות'} ממתינ{queueSize===1?'ת':'ות'} בתור
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Dot pager indicator ─────────────────────────────────── */
function Pager({ total, current }) {
  if (total <= 1) return null;
  return (
    <div style={{display:'flex',justifyContent:'center',gap:7,marginTop:14}}>
      {Array.from({length:total}).map((_,i)=>(
        <div key={i} style={{
          width: i===current?20:7, height:7, borderRadius:4,
          background: i===current ? P.green : 'rgba(255,255,255,0.2)',
          transition:'all .3s',
        }}/>
      ))}
    </div>
  );
}

/* ── Main ─────────────────────────────────────────────────── */
export default function WorkerView() {
  const workerName = workerNameFromPath() || 'עובד';

  const [pending,   setPending]   = useState([]);   // pending tasks
  const [completed, setCompleted] = useState([]);   // done tasks today
  const [idx,       setIdx]       = useState(0);
  const [loading,   setLoading]   = useState(true);
  const [spin,      setSpin]      = useState(false);
  const [toast,     setToast]     = useState(null);
  const [lastSync,  setLastSync]  = useState(null);
  const [drawer,    setDrawer]    = useState(false);
  const timer = useRef(null);

  /* ── load tasks ── */
  const load = useCallback(async (silent=false) => {
    if (!silent) setLoading(true);
    setSpin(true);
    try {
      const url = `${API_URL}/api/property-tasks?worker=${encodeURIComponent(workerName)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(res.status);
      const raw = await res.json();
      const tasks = Array.isArray(raw) ? raw : [];

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
    } catch { /* keep stale data on network error */ }
    finally { setLoading(false); setSpin(false); }
  }, [workerName]);

  useEffect(()=>{
    load();
    timer.current = setInterval(()=>load(true), REFRESH_MS);
    return ()=>clearInterval(timer.current);
  },[load]);

  /* instant refresh when Maya creates a task via /test-task command */
  useEffect(()=>{
    const onNewTask = () => load(true);
    window.addEventListener('maya-refresh-tasks', onNewTask);
    window.addEventListener('maya-task-created', onNewTask);
    return ()=>{
      window.removeEventListener('maya-refresh-tasks', onNewTask);
      window.removeEventListener('maya-task-created', onNewTask);
    };
  },[load]);

  /* safety clamp — fires any time active list shrinks for any reason */
  useEffect(()=>{
    setIdx(i => Math.min(i, Math.max(0, pending.length - 1)));
  },[pending.length]); // `pending` holds all active (Pending + In_Progress) tasks

  const handleDone = useCallback((id)=>{
    setToast('🎉 משימה הושלמה בהצלחה!');
    // Wait for the card's exit animation (≈1.5 s done glow + 0.5 s slide-out),
    // then atomically remove it from state and advance to the next card.
    setTimeout(()=>{
      setPending(p => {
        const next = p.filter(t => t.id !== id);
        // clamp idx inside the same state batch — prevents the "3/1" flash
        setIdx(i => Math.min(i, Math.max(0, next.length - 1)));
        return next;
      });
      load(true); // re-fetch so completed list & stats also update
    }, 1800); // slightly shorter = snappier feel after confetti
  },[load]);

  // Single-task mode: always show the first task (In_Progress floated to top).
  // The worker never manually browses; next task auto-slides in after Done.
  const currentTask = pending[0] || null;
  const queueSize   = Math.max(0, pending.length - 1); // tasks waiting after current
  const hasIP       = pending.length > 0 && isInProgress(pending[0]?.status);

  return (
    <>
      <style>{STYLES}</style>

      <div style={{
        minHeight:'100vh',
        background:`linear-gradient(160deg,${P.bg} 0%,#0c1f12 45%,#0f1535 100%)`,
        fontFamily:"-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
        paddingBottom:56,
      }}>

        {/* ── App bar ── */}
        <div style={{
          position:'sticky',top:0,zIndex:100,
          background:'rgba(7,94,84,0.9)',
          backdropFilter:'blur(18px)',WebkitBackdropFilter:'blur(18px)',
          borderBottom:'1px solid rgba(255,255,255,0.1)',
          padding:'12px 16px',
          display:'flex',alignItems:'center',gap:12,
        }}>
          <div style={{
            width:42,height:42,borderRadius:'50%',
            background:`linear-gradient(135deg,${P.teal},${P.green})`,
            display:'flex',alignItems:'center',justifyContent:'center',
            fontSize:20,border:'2px solid rgba(255,255,255,0.28)',flexShrink:0,
          }}>🧹</div>

          <div style={{flex:1}}>
            <div style={{color:'#fff',fontWeight:800,fontSize:14,lineHeight:1.1}}>
              שלום, {workerName} 👋
            </div>
            <div style={{display:'flex',alignItems:'center',gap:7,marginTop:2,flexWrap:'wrap'}}>
              {/* Traffic-light dot */}
              <span style={{
                width:9,height:9,borderRadius:'50%',flexShrink:0,
                background: hasIP ? '#f97316' : currentTask ? '#ef4444' : '#25D366',
                boxShadow: hasIP ? '0 0 6px #f97316' : currentTask ? '0 0 6px #ef4444' : '0 0 6px #25D366',
              }}/>
              <span style={{color:'rgba(255,255,255,0.55)',fontSize:11}}>
                {hasIP   ? <span style={{color:'#f97316',fontWeight:700}}>בביצוע</span>
                : currentTask ? <span style={{color:'#fbbf24',fontWeight:700}}>ממתין</span>
                : <span style={{color:P.accent}}>פנוי ✓</span>}
              </span>
              {queueSize > 0 && (
                <span style={{
                  fontSize:10,fontWeight:800,padding:'2px 8px',borderRadius:20,
                  background:'rgba(239,68,68,0.18)',color:'#f87171',
                  border:'1px solid rgba(239,68,68,0.3)',
                }}>{queueSize} בתור</span>
              )}
              {lastSync && (
                <span style={{color:'rgba(255,255,255,0.22)',fontSize:10}}>
                  · {lastSync.toLocaleTimeString('he-IL',{hour:'2-digit',minute:'2-digit'})}
                </span>
              )}
            </div>
          </div>

          {/* My Stats button */}
          <button onClick={()=>setDrawer(true)} title="הסטטיסטיקות שלי" style={{
            background:'rgba(255,255,255,0.12)',border:'1px solid rgba(255,255,255,0.18)',
            color:'#fff',height:36,padding:'0 12px',borderRadius:12,
            cursor:'pointer',fontSize:12,fontWeight:700,
            display:'flex',alignItems:'center',gap:5,
          }}>
            📊 <span>Stats</span>
          </button>

          {/* Refresh */}
          <button onClick={()=>load()} title="רענן" style={{
            background:'rgba(255,255,255,0.1)',border:'none',color:'#fff',
            width:36,height:36,borderRadius:'50%',cursor:'pointer',
            fontSize:18,display:'flex',alignItems:'center',justifyContent:'center',
          }}>
            <span style={{display:'inline-block',animation:spin?'wvSpin 0.7s linear infinite':'none'}}>↻</span>
          </button>
        </div>

        {/* ── Main area ── */}
        <div style={{maxWidth:480,margin:'0 auto',padding:'20px 14px 0'}}>
          {loading ? (
            <div style={{textAlign:'center',paddingTop:100,color:'rgba(255,255,255,0.4)'}}>
              <div style={{fontSize:38,animation:'wvSpin 1s linear infinite',display:'inline-block'}}>⏳</div>
              <div style={{marginTop:10,fontSize:14}}>טוען משימות...</div>
            </div>
          ) : !currentTask ? (
            /* Empty state */
            <div style={{textAlign:'center',padding:'64px 20px',color:'rgba(255,255,255,0.5)'}}>
              <div style={{fontSize:60,marginBottom:12}}>🎉</div>
              <div style={{fontSize:22,fontWeight:800,color:'#fff',marginBottom:6}}>כל הכבוד!</div>
              <div style={{fontSize:14,lineHeight:1.6}}>
                אין משימות פתוחות כרגע.<br/>
                המנהל ישלח לך הודעה כשמשימה חדשה תגיע.
              </div>
              <button onClick={()=>load()} style={{
                marginTop:26,
                background:`linear-gradient(135deg,${P.teal},${P.green})`,
                border:'none',borderRadius:16,color:'#fff',fontWeight:800,
                padding:'12px 30px',cursor:'pointer',fontSize:14,
                boxShadow:'0 6px 22px rgba(37,211,102,0.4)',
              }}>↻ רענן</button>

              {/* One-click reset: reactivates all Done tasks for this worker */}
              <button onClick={async()=>{
                try {
                  const r = await fetch(
                    `${API_URL}/api/dev/reset-worker-tasks/${encodeURIComponent(workerName)}`,
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
                  background:'rgba(52,211,153,0.15)',
                  border:'1px solid rgba(52,211,153,0.3)',
                  borderRadius:16, color:P.accent, fontWeight:700,
                  padding:'11px 0', cursor:'pointer', fontSize:13,
                }}>
                  📊 ראה {completed.length} משימות שהושלמו היום
                </button>
              )}
            </div>
          ) : (
            /* Single-task mode — always shows pending[0] only */
            <>
              <FocusCard
                key={currentTask.id}
                task={currentTask}
                workerName={workerName}
                onDone={handleDone}
                queueSize={queueSize}
              />

              {/* Queue peek — shown below the card */}
              {queueSize > 0 && (
                <div style={{
                  textAlign:'center', marginTop:14,
                  color:'rgba(255,255,255,0.3)', fontSize:12,
                }}>
                  🔴 עוד {queueSize} משימ{queueSize===1?'ה':'ות'} ממתינ{queueSize===1?'ת':'ות'} בתור
                </div>
              )}
            </>
          )}
        </div>

        <p style={{textAlign:'center',color:'rgba(255,255,255,0.13)',fontSize:10,marginTop:30}}>
          Maya Hotel AI · Worker Portal · v2
        </p>
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
    </>
  );
}
