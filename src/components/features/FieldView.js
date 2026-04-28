import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, QrCode, MapPin, Zap, User } from 'lucide-react';
import useStore from '../../store/useStore';
import { isBiktaForcePhone, BIKTA_TENANT_ID, parseJwtPayload } from '../../utils/biktaUser';
import { isDashboardAdmin } from '../../utils/dashboardRoles';
import useTranslations from '../../hooks/useTranslations';
import {
  setWorkerLanguage, registerStaff, getStaffTasks,
  updateStaffTaskStatus, subscribeToStaff, updateStaffLocation,
} from '../../services/api';
import { API_URL } from '../../utils/apiClient';
import { notifyFieldStaffStatusTap } from '../../utils/mayaBrain';
import './FieldView.css';

/* --- Constants --- */
const MARKET_LANGUAGES = {
  US: [{ code: 'en', label: 'EN' }, { code: 'es', label: 'ES' }],
  IL: [{ code: 'he', label: 'HE' }, { code: 'th', label: 'TH' }, { code: 'hi', label: 'HI' }],
};

/* Issue categories: ASCII icons only */
const ISSUE_CATEGORIES = [
  { id: 'ac',          icon: 'A',  label: 'מיזוג אוויר' },
  { id: 'plumbing',    icon: 'P',  label: 'אינסטלציה'   },
  { id: 'furniture', icon: 'F',  label: 'ריהוט'       },
  { id: 'carpet',      icon: 'C',  label: 'קרע בשטיח'   },
  { id: 'electricity', icon: 'E',  label: 'חשמל'        },
  { id: 'other',       icon: 'O',  label: 'אחר'          },
];

/* --- Confetti --- */
function triggerConfetti() {
  const container = document.createElement('div');
  container.className = 'fv-confetti-container';
  document.body.appendChild(container);
  const colors = ['#00ff88','#00c875','#ffd700','#ff4444','#4488ff','#ff66cc','#ffaa00'];
  const shapes = ['2px','50%','0'];
  for (let i = 0; i < 70; i++) {
    const p = document.createElement('div');
    p.className = 'fv-confetti-particle';
    const size = 6 + Math.random() * 10;
    p.style.setProperty('--left', `${Math.random() * 100}%`);
    p.style.setProperty('--color', colors[Math.floor(Math.random() * colors.length)]);
    p.style.setProperty('--delay', `${Math.random() * 0.6}s`);
    p.style.setProperty('--duration', `${0.9 + Math.random() * 0.9}s`);
    p.style.setProperty('--rotate', `${Math.random() * 360}deg`);
    p.style.setProperty('--size', `${size}px`);
    p.style.setProperty('--radius', shapes[Math.floor(Math.random() * shapes.length)]);
    container.appendChild(p);
  }
  setTimeout(() => container.remove(), 2500);
}

/* --- Star confetti (level up): ASCII glyphs only --- */
function triggerStarConfetti() {
  const container = document.createElement('div');
  container.className = 'fv-confetti-container';
  document.body.appendChild(container);
  const symbols = ['*', '+', '.', 'x', 'v', '^'];
  for (let i = 0; i < 55; i++) {
    const p = document.createElement('div');
    p.className = 'fv-confetti-particle fv-star-particle';
    p.textContent = symbols[Math.floor(Math.random() * symbols.length)];
    p.style.setProperty('--left',     `${Math.random() * 100}%`);
    p.style.setProperty('--delay',    `${Math.random() * 0.9}s`);
    p.style.setProperty('--duration', `${1.1 + Math.random() * 1.1}s`);
    p.style.setProperty('--size',     `${14 + Math.random() * 22}px`);
    container.appendChild(p);
  }
  setTimeout(() => container.remove(), 3500);
}

/* --- Fire particles (streak 3+) --- */
let _fireContainer = null;
let _fireInterval  = null;

function startFireParticles() {
  if (_fireContainer) return;
  _fireContainer = document.createElement('div');
  _fireContainer.className = 'fv-fire-container';
  document.body.appendChild(_fireContainer);
  const add = () => {
    if (!_fireContainer) return;
    const p = document.createElement('div');
    p.className = 'fv-fire-particle';
    p.textContent = ['*', '*', '*', '.', '.'][Math.floor(Math.random() * 5)];
    p.style.setProperty('--x',    `${Math.random() > 0.5 ? Math.random() * 12 : 88 + Math.random() * 12}%`);
    p.style.setProperty('--dur',  `${0.9 + Math.random() * 0.7}s`);
    p.style.setProperty('--size', `${14 + Math.random() * 16}px`);
    _fireContainer.appendChild(p);
    setTimeout(() => p.remove(), 1600);
  };
  _fireInterval = setInterval(add, 160);
}

function stopFireParticles() {
  if (_fireInterval) { clearInterval(_fireInterval); _fireInterval = null; }
  if (_fireContainer) { _fireContainer.remove(); _fireContainer = null; }
}

const XP_PER_MISSION = 100;
const XP_PER_LEVEL   = 500;

const FIELD_HERO_FALLBACK =
  'https://images.unsplash.com/photo-1582719508461-905c673771fd?w=800&q=80';

/**
 * 3-state field workflow from API task.status:
 * default -> on_my_way ("אני בדרך") -> started/in_progress ("נכנסתי לחדר") -> finished ("סיימתי - החדר מוכן").
 */
function getFieldPrimaryAction(task) {
  const s = String(task.status || '').toLowerCase();
  if (s === 'finished' || s === 'done') return null;
  if (s === 'on_my_way') {
    return { next: 'started', label: 'נכנסתי לחדר', variant: 'orange' };
  }
  if (s === 'in_progress' || s === 'started') {
    return { next: 'finished', label: 'סיימתי - החדר מוכן', variant: 'green' };
  }
  return { next: 'on_my_way', label: 'אני בדרך', variant: 'blue' };
}

const CHEERS = [
  { main: 'The Guests Love You!', sub: 'Keep it up, champion!' },
  { main: "You're the Cleaning King!", sub: 'Royalty status!' },
  { main: 'Speed Demon!', sub: 'Fastest hands in the hotel!' },
  { main: 'מקצוען מדרגה ראשונה', sub: 'Professional grade performance' },
  { main: 'Unstoppable Force!', sub: 'Nothing can stop you now!' },
  { main: 'Room Hero', sub: 'Saving stays, one room at a time' },
  { main: 'Pure Excellence!', sub: "They'll remember this stay forever" },
  { main: 'Legend in the Making', sub: 'Hall of fame material!' },
];

const getSkin = (xpLevel) => xpLevel >= 10 ? 'legend' : xpLevel >= 5 ? 'pro' : 'rookie';
const getXPLevel = (xp) => Math.floor((xp || 0) / XP_PER_LEVEL) + 1;

const getLevel = (pts) => Math.max(1, Math.floor((pts || 0) / 20) + 1);
const getLevelTitle = (pts) => {
  const lvl = getLevel(pts);
  if (lvl >= 10) return 'Property Legend';
  if (lvl >= 7) return 'Mission Master';
  if (lvl >= 5) return 'Property Hero';
  if (lvl >= 3) return 'Rising Star';
  return 'Rookie';
};
const getEnergyPct = (pts) => ((pts || 0) % 20) * 5;

/* --- FieldView component --- */
const FieldView = ({ clockInOnly = false, autoClockInOnScan = false, clockInRedirectPath = null }) => {
  const navigate = useNavigate();
  const { t } = useTranslations();
  const {
    fieldLanguage, setFieldLanguage, market,
    staffProfile, setStaffProfile, addNotification,
    setActiveTenantIdKeepAuth,
    loginSuccess,
    role: storeRole,
  } = useStore();

  const marketKey = market === 'IL' ? 'IL' : 'US';
  const languages  = MARKET_LANGUAGES[marketKey] || MARKET_LANGUAGES.US;

  const [staffIdInput,    setStaffIdInput]    = useState(staffProfile.staffId || '');
  const [staffNameInput,  setStaffNameInput]  = useState(staffProfile.name   || '');
  const [staffPhoneInput, setStaffPhoneInput] = useState(staffProfile.phone  || '');

  const [tasks,           setTasks]           = useState([]);
  const [loadingTasks,    setLoadingTasks]    = useState(false);
  const [taskActionLoading, setTaskActionLoading] = useState({});
  const [cameraOn,        setCameraOn]        = useState(false);
  const [isSyncing,       setIsSyncing]       = useState(false);
  const [syncReady,       setSyncReady]       = useState(false);
  const [isConnecting,    setIsConnecting]    = useState(false);
  const [loginError,      setLoginError]      = useState('');
  const [toast,           setToast]           = useState('');
  const [pointsToast,     setPointsToast]     = useState('');
  const [levelToast,      setLevelToast]      = useState('');

  const [showIssueModal, setShowIssueModal] = useState(false);
  const [issueTask,      setIssueTask]      = useState(null);
  const [issueNote,      setIssueNote]      = useState('');
  const [issueCategory,  setIssueCategory]  = useState(null);
  const [issueSending,   setIssueSending]   = useState(false);

  const [employeeXP,      setEmployeeXP]      = useState(0);
  const [showLevelUpOver, setShowLevelUpOver] = useState(false);
  const [levelUpTo,       setLevelUpTo]       = useState(1);
  const [streak,          setStreak]          = useState(0);
  const [missionsDone,    setMissionsDone]    = useState(0);
  const [showCheer,       setShowCheer]       = useState(null);
  const [victoryData,     setVictoryData]     = useState(null);
  const [radarPhase,      setRadarPhase]      = useState(0);

  const [onBreak,          setOnBreak]          = useState(false);
  const [briefingVisible,  setBriefingVisible]  = useState(false);
  const [briefingTyping,   setBriefingTyping]   = useState(false);
  const [briefingLines,    setBriefingLines]    = useState([]);
  const [breakBoostLabel,  setBreakBoostLabel]  = useState('');
  const [spotlightTaskId,  setSpotlightTaskId]  = useState(null);

  const videoRef          = useRef(null);
  const scanLoopRef       = useRef(null);
  const autoClockInRef    = useRef(false);
  const staffProfileRef   = useRef(staffProfile);
  const prevTaskCountRef  = useRef(0);
  const prevGoldRef       = useRef(staffProfile.goldPoints || 0);

  useEffect(() => { staffProfileRef.current = staffProfile; }, [staffProfile]);

  useEffect(() => {
    if (staffProfile.staffId) return;
    let token = null;
    try {
      token = localStorage.getItem('admin_token');
      if (!token) {
        const alt = localStorage.getItem('easyhost_auth_token');
        if (alt && !String(alt).startsWith('demo-offline-')) {
          const p = parseJwtPayload(alt);
          if (isDashboardAdmin(p?.role)) token = alt;
        }
      }
    } catch {
      return;
    }
    if (!token || String(token).startsWith('demo-offline-')) return;
    try {
      const payload = parseJwtPayload(token);
      const tid = payload?.tenant_id || useStore.getState().activeTenantId || 'demo';
      const r = String(payload?.role || 'host').trim() || 'host';
      loginSuccess(token, tid, r);
      navigate('/', { replace: true });
    } catch {
      /* ignore */
    }
  }, [staffProfile.staffId, loginSuccess, navigate]);

  useEffect(() => {
    const allowed = languages.map(l => l.code);
    if (!allowed.includes(fieldLanguage)) setFieldLanguage(allowed[0]);
  }, [fieldLanguage, languages, setFieldLanguage]);

  useEffect(() => {
    setWorkerLanguage(fieldLanguage).catch(() => {});
  }, [fieldLanguage]);

  useEffect(() => {
    const stop = () => {
      if (scanLoopRef.current) cancelAnimationFrame(scanLoopRef.current);
      const stream = videoRef.current?.srcObject;
      if (stream) { stream.getTracks().forEach(t => t.stop()); if (videoRef.current) videoRef.current.srcObject = null; }
    };
    if (!cameraOn) { stop(); return; }
    const start = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (!videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        if ('BarcodeDetector' in window) {
          const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
          const scan = async () => {
            if (!videoRef.current) return;
            try {
              const barcodes = await detector.detect(videoRef.current);
              if (barcodes?.length > 0) {
                const val = barcodes[0].rawValue || '';
                if (val) {
                  setStaffIdInput(val);
                  showToast('QR נסרק');
                  if (autoClockInOnScan && !autoClockInRef.current) { autoClockInRef.current = true; handleClockIn(val); }
                  setCameraOn(false);
                  return;
                }
              }
            } catch (_) {}
            scanLoopRef.current = requestAnimationFrame(scan);
          };
          scanLoopRef.current = requestAnimationFrame(scan);
        }
      } catch (_) { showToast('מצלמה לא זמינה'); setCameraOn(false); }
    };
    start();
    return stop;
  }, [cameraOn]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!staffProfile.staffId) return;
    const load = async () => {
      setLoadingTasks(true);
      try { setTasks(await getStaffTasks(staffProfile.staffId)); }
      catch (_) {}
      finally { setLoadingTasks(false); }
    };
    load();
  }, [staffProfile.staffId]);

  useEffect(() => {
    if (!staffProfile.staffId || clockInOnly) return;
    const iv = setInterval(async () => {
      try { setTasks(await getStaffTasks(staffProfile.staffId)); } catch (_) {}
    }, 5000);
    return () => clearInterval(iv);
  }, [staffProfile.staffId, clockInOnly]);

  useEffect(() => {
    const count = tasks.length;
    if (count > prevTaskCountRef.current) {
      if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const g   = ctx.createGain();
        osc.type = 'sine'; osc.frequency.value = 880; g.gain.value = 0.05;
        osc.connect(g); g.connect(ctx.destination); osc.start();
        setTimeout(() => { osc.stop(); ctx.close(); }, 150);
      } catch (_) {}
      showToast('משימה חדשה נכנסה!');
    }
    prevTaskCountRef.current = count;
  }, [tasks]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const prev = prevGoldRef.current;
    const cur  = staffProfile.goldPoints || 0;
    if (getLevel(prev) < getLevel(cur)) {
      setLevelToast(`Level Up! ${getLevelTitle(cur)}`);
      setTimeout(() => setLevelToast(''), 3000);
    }
    prevGoldRef.current = cur;
  }, [staffProfile.goldPoints]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!staffProfile.staffId) return;
    const src = subscribeToStaff((update) => {
      const cur = staffProfileRef.current;
      if (update?.id !== cur.staffId) return;
      setStaffProfile({ ...cur, goldPoints: update.gold_points ?? cur.goldPoints, rank: update.rank ?? cur.rank, rankTier: update.rank_tier ?? cur.rankTier });
    });
    return () => { if (src?.close) src.close(); };
  }, [staffProfile.staffId, setStaffProfile]);

  useEffect(() => {
    if (!staffProfile.staffId || !navigator.geolocation) return;
    const ping = () => navigator.geolocation.getCurrentPosition(
      (p) => updateStaffLocation(staffProfile.staffId, p.coords.latitude, p.coords.longitude).catch(() => {}),
      () => {}
    );
    ping();
    const iv = setInterval(ping, 120000);
    return () => clearInterval(iv);
  }, [staffProfile.staffId]);

  const showToast = useCallback((msg, type = '') => {
    setToast(msg);
    setTimeout(() => setToast(''), 2200);
  }, []);

  const handleClockIn = useCallback(async (overrideId) => {
    const id    = overrideId || staffIdInput.trim();
    const phone = staffPhoneInput.trim();
    const name  = staffNameInput.trim();

    if (!phone && !id) {
      setLoginError('נא להזין מספר טלפון כדי להתחבר');
      return;
    }

    setLoginError('');
    setIsConnecting(true);
    setIsSyncing(true);
    setSyncReady(false);

    try {
      const payload = {
        phone:    phone    || undefined,
        staff_id: id       || undefined,
        name:     name     || undefined,
      };
      if (!staffProfile.language) payload.language = fieldLanguage;
      if (clockInOnly && clockInRedirectPath && String(clockInRedirectPath).includes('bikta')) {
        payload.tenant_id = BIKTA_TENANT_ID;
      }
      payload.register_if_missing = true;

      const result = await registerStaff(payload);

      if (result.token) {
        loginSuccess(result.token, result.tenant_id || useStore.getState().activeTenantId || 'demo', result.role || 'worker');
      }

      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => updateStaffLocation(result.id, pos.coords.latitude, pos.coords.longitude).catch(() => {}),
          () => {}
        );
      }

      setStaffProfile({
        staffId:   result.id,
        name:      result.name,
        phone:     result.phone,
        goldPoints: result.gold_points ?? result.points ?? 0,
        rank:      result.rank ?? null,
        rankTier:  result.rank_tier || staffProfile.rankTier || 'starter',
        language:  result.language || staffProfile.language || fieldLanguage,
      });
      if (result.language) setFieldLanguage(result.language);

      const phoneForTenant = (phone || result.phone || '').trim();
      if (isBiktaForcePhone(phoneForTenant) || isBiktaForcePhone(result.phone)) {
        setActiveTenantIdKeepAuth('BIKTA_NESS_ZIONA');
      }

      if (!clockInOnly) {
        setLoadingTasks(true);
        try {
          const list = await getStaffTasks(result.id);
          setTasks(Array.isArray(list) ? list : []);
        } catch (loadErr) {
          console.error('[FieldView] load tasks after register:', loadErr);
          setTasks([]);
          setLoginError('התחברות הצליחה, אך טעינת המשימות נכשלה. נסו לרענן.');
        } finally {
          setLoadingTasks(false);
        }
      }

      if (clockInOnly && result.id) {
        if (clockInRedirectPath) {
          navigate(clockInRedirectPath, { replace: true });
        } else {
          window.location.href = `/worker/${result.id}`;
        }
        return;
      }

      setRadarPhase(1);
      setTimeout(() => {
        setRadarPhase(2);
        setSyncReady(true);
        setTimeout(() => { setIsSyncing(false); setSyncReady(false); setRadarPhase(0); }, 900);
      }, 600);
      autoClockInRef.current = false;
      setIsConnecting(false);

    } catch (err) {
      setIsSyncing(false);
      setIsConnecting(false);
      autoClockInRef.current = false;
      console.error('[FieldView] Clock-in failed:', err);

      const status = err.status || 0;
      let msg = 'שגיאה בהתחברות - נסה שנית';
      if (status === 400) msg = 'נא להזין מספר טלפון או קוד עובד';
      else if (status === 404) msg = 'עובד לא נמצא במערכת - בדוק מספר טלפון';
      else if (status === 401 || status === 403) msg = 'אין הרשאה - פנה למנהל המערכת';
      else if (status === 503) msg = 'שגיאת חיבור לשרת - נסה שנית';
      else if (status === 0) {
        msg = err.message || 'שרת ה-Python לא זמין - הפעל את ה-backend (python app.py, פורט 1000) ונסה שוב.';
      } else if (err.message) msg = err.message;
      setLoginError(msg);
    }
  }, [staffIdInput, staffNameInput, staffPhoneInput, staffProfile, fieldLanguage, clockInOnly, clockInRedirectPath, navigate, setStaffProfile, setFieldLanguage, setActiveTenantIdKeepAuth, loginSuccess]);

  const awardXP = useCallback((amount) => {
    setEmployeeXP(prev => {
      const newXP   = prev + amount;
      const prevLvl = getXPLevel(prev);
      const newLvl  = getXPLevel(newXP);
      if (newLvl > prevLvl) {
        triggerStarConfetti();
        setLevelUpTo(newLvl);
        setShowLevelUpOver(true);
        setTimeout(() => setShowLevelUpOver(false), 4200);
      }
      return newXP;
    });
  }, []);

  const handleTaskUpdate = useCallback(async (taskId, status) => {
    const task = tasks.find(t => t.id === taskId);
    const key  = `${taskId}-${status}`;
    setTaskActionLoading(prev => ({ ...prev, [key]: true }));
    try {
      const result = await updateStaffTaskStatus(taskId, status);
      notifyFieldStaffStatusTap({
        taskId,
        status,
        staffId: staffProfile.staffId,
        staffName: staffProfile.name,
        room: task?.room || task?.property_name,
        atMs: Date.now(),
      });
      setTasks(await getStaffTasks(staffProfile.staffId));
      if (result?.gold_points !== undefined || result?.rank !== undefined) {
        setStaffProfile({
          ...staffProfile,
          goldPoints: result.gold_points ?? staffProfile.goldPoints,
          rank:       result.rank        ?? staffProfile.rank,
          rankTier:   result.rank_tier   ?? staffProfile.rankTier,
        });
      }
      if (status === 'finished') {
        triggerConfetti();
        const xpGain = XP_PER_MISSION;
        awardXP(xpGain);
        setStreak(prev => {
          const next = prev + 1;
          if (next >= 3) startFireParticles();
          return next;
        });

        setMissionsDone(prev => {
          const next = prev + 1;
          if (next % 2 === 0) {
            const cheer = CHEERS[Math.floor(Math.random() * CHEERS.length)];
            setShowCheer(cheer);
            setTimeout(() => setShowCheer(null), 2800);
          }
          return next;
        });

        const pts = result?.points_awarded;
        if (pts !== undefined) {
          setPointsToast(`+${pts} נקודות זהב - +${xpGain} XP`);
          setTimeout(() => setPointsToast(''), 2400);
        }
        showToast('MISSION COMPLETE! החדר מוכן!');
        if (task?.room) {
          addNotification({ type: 'success', action: status, room: task.room, title: `חדר ${task.room} מוכן` });
        }
        setVictoryData({ xp: xpGain, room: task?.room || task?.property_name || 'Mission', type: task?.task_type || 'Mission' });
        setTimeout(() => setVictoryData(null), 3800);
      } else {
        showToast(status === 'on_my_way' ? 'בדרך!' : 'התחלת!');
      }
    } catch (_) { console.error('Task update failed'); }
    finally { setTaskActionLoading(prev => ({ ...prev, [key]: false })); }
  }, [tasks, staffProfile, addNotification, setStaffProfile, showToast, awardXP]);

  const openIssueModal = useCallback((task) => {
    setIssueTask(task);
    setIssueNote('');
    setIssueCategory(null);
    setShowIssueModal(true);
  }, []);

  const handleIssueSubmit = async () => {
    if (!issueCategory) return;
    setIssueSending(true);
    try {
      const catLabel = ISSUE_CATEGORIES.find(c => c.id === issueCategory)?.label || issueCategory;
      const description = issueNote
        ? `${catLabel} - ${issueNote}`
        : catLabel;

      const res = await fetch(`${API_URL}/report-issue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category:     issueCategory,
          description,
          room_name:    issueTask?.room      || issueTask?.property_name || 'General',
          room_id:      issueTask?.room_id   || '',
          task_id:      issueTask?.id        || '',
          reported_by:  staffProfile?.name    || staffNameInput || 'Staff',
        }),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(errText || `HTTP ${res.status}`);
      }

      if (issueTask?.room) {
        addNotification({
          type: 'damage', action: 'damage_reported',
          room: issueTask.room,
          title: `דיווח תקלה: ${issueTask.room}`,
          message: description,
        });
      }

      awardXP(50);
      showToast('תודה על הערנות! +50 XP');
      setShowIssueModal(false);
      setIssueCategory(null);
      setIssueNote('');
    } catch (_) {
      console.error('Issue report failed');
      showToast('שגיאה בשליחה - נסה שוב');
    } finally {
      setIssueSending(false);
    }
  };

  const handleStartBreak = useCallback(() => {
    setOnBreak(true);
    setStreak(0);
    stopFireParticles();
    showToast('הפסקה מגיעה לך! חזור טעון!');
  }, [showToast]);

  const handleEndBreak = useCallback(async () => {
    setOnBreak(false);

    const boosts = [10, 20, 30];
    const boost  = boosts[Math.floor(Math.random() * boosts.length)];
    setBreakBoostLabel(`+${boost} XP Well-Rested`);
    awardXP(boost);
    setTimeout(() => setBreakBoostLabel(''), 3000);

    let fresh = tasks;
    try { fresh = await getStaffTasks(staffProfile.staffId); setTasks(fresh); } catch (_) {}

    const pending  = fresh.filter(t => t.status !== 'finished');
    const sorted   = [...pending].sort((a, b) => {
      const pa = (a.priority || '').toLowerCase() === 'high' ? 0 : 1;
      const pb = (b.priority || '').toLowerCase() === 'high' ? 0 : 1;
      return pa - pb;
    });
    const rec = sorted[0];
    if (rec) {
      setSpotlightTaskId(rec.id);
      const firstName = (staffProfile.name || 'Hero').split(' ')[0];
      const room      = rec.room || rec.property_name || 'הנכס';
      const isHigh    = (rec.priority || '').toLowerCase() === 'high';
      const lines = [
        `ברו�� שובך, ${firstName}!`,
        `ניתחתי ${pending.length} משימות בזמן שנחת ושתית קפה.`,
        isHigh
          ? `יש משימה דחופה: ${room}. האורח מגיע בקרוב - התחל שם!`
          : `המלצה שלי: התחל ב-${room}. זה הנכס עם העדיפות הגבו��ה ביותר ברשימה.`,
        `עוד ${Math.max(1, 2 - (missionsDone % 2))} משימות לבונוס המשמרת הבא. קדימה!`,
      ];
      setBriefingLines(lines);
      setBriefingTyping(true);
      setBriefingVisible(true);
      setTimeout(() => setBriefingTyping(false), 2200);
    }
  }, [tasks, staffProfile, awardXP, missionsDone, showToast]); // eslint-disable-line react-hooks/exhaustive-deps

  const goldPoints = staffProfile.goldPoints || 0;
  const goldTier   = goldPoints >= 100 ? 3 : goldPoints >= 50 ? 2 : goldPoints >= 10 ? 1 : 0;
  const energyPct  = getEnergyPct(goldPoints);
  const levelNum   = getLevel(goldPoints);
  const levelTitle = getLevelTitle(goldPoints);
  const isLoggedIn = Boolean(staffProfile.staffId);

  const xpLevel    = getXPLevel(employeeXP);
  const skin       = getSkin(xpLevel);
  const xpInLevel  = employeeXP % XP_PER_LEVEL;
  const xpBarPct   = Math.round((xpInLevel / XP_PER_LEVEL) * 100);

  return (
    <div className={`field-view gold-tier-${goldTier} skin-${skin} ${streak >= 3 ? 'streak-fire' : ''}`}>
      {showLevelUpOver && (
        <div className="fv-overlay fv-levelup-overlay">
          <div className="fv-levelup-box">
            <div className="fv-levelup-stars">{'*'.repeat(Math.min(levelUpTo, 5))}</div>
            <div className="fv-levelup-badge">LEVEL UP!</div>
            <div className="fv-levelup-num">Level {levelUpTo}</div>
            <div className="fv-levelup-skin">
              {levelUpTo >= 10 ? 'NEON LEGEND SKIN UNLOCKED!' : levelUpTo >= 5 ? 'PRO SKIN UNLOCKED!' : 'Keep climbing!'}
            </div>
          </div>
        </div>
      )}

      {victoryData && (
        <div className="fv-overlay fv-victory-overlay" onClick={() => setVictoryData(null)}>
          <div className="fv-victory-box">
            <div className="fv-victory-stars">***</div>
            <div className="fv-victory-title">MISSION COMPLETE!</div>
            <div className="fv-victory-room">{victoryData.room}</div>
            <div className="fv-victory-xp">+{victoryData.xp} XP</div>
            <div className="fv-victory-sub">
              {xpBarPct >= 90 ? 'LEVEL UP almost here!' : `${100 - xpBarPct}% to next level`}
            </div>
            <div className="fv-victory-tap">tap to continue</div>
          </div>
        </div>
      )}

      {showCheer && (
        <div className="fv-overlay fv-cheer-overlay" onClick={() => setShowCheer(null)}>
          <div className="fv-cheer-box">
            <div className="fv-cheer-main">{showCheer.main}</div>
            <div className="fv-cheer-sub">{showCheer.sub}</div>
          </div>
        </div>
      )}
      {briefingVisible && (
        <div className="fv-overlay fv-briefing-overlay">
          <div className="fv-briefing-box">
            <div className="fv-briefing-avatar">
              <img
                src="https://api.dicebear.com/7.x/personas/svg?seed=MayaManager&backgroundColor=25D366"
                alt="Maya"
              />
              <span className="fv-briefing-online" />
            </div>
            <div className="fv-briefing-header">
              <span className="fv-briefing-name">Maya AI</span>
              {briefingTyping
                ? <span className="fv-briefing-status">מנתחת משימות...</span>
                : <span className="fv-briefing-status ready">ניתוח הושלם</span>}
            </div>

            {briefingTyping ? (
              <div className="fv-briefing-typing">
                <span /><span /><span />
              </div>
            ) : (
              <div className="fv-briefing-lines">
                {briefingLines.map((line, i) => (
                  <p key={i} className="fv-briefing-line" style={{ animationDelay: `${i * 0.18}s` }}>
                    {line}
                  </p>
                ))}
              </div>
            )}

            {breakBoostLabel && !briefingTyping && (
              <div className="fv-briefing-bonus">{breakBoostLabel}</div>
            )}

            {!briefingTyping && (
              <button
                className="fv-briefing-cta"
                onClick={() => setBriefingVisible(false)}
              >
                READY TO DOMINATE
              </button>
            )}
          </div>
        </div>
      )}

      <div className="fv-level-bar">
        <div className="fv-level-info">
          <Zap size={13} style={{ color: '#00ff88', flexShrink: 0 }} />
          <span className="fv-level-label">LVL {xpLevel}</span>
          <span className="fv-level-title">{levelTitle || skin}</span>
        </div>

        <div className="fv-energy-track" title={`${xpInLevel}/${XP_PER_LEVEL} XP - Gold energy: ${energyPct}%`}>
          <div className="fv-energy-fill" style={{ width: `${xpBarPct}%` }} />
        </div>
        <span className="fv-energy-pct">{xpBarPct}%</span>

        {streak > 0 && (
          <span className="fv-streak-chip" title={`${streak} missions in a row!`}>
            x{streak}
          </span>
        )}

        {isLoggedIn && staffProfile.rank && (
          <div className="fv-rank-chip">
            <span className="fv-rank-name">{staffProfile.rank}</span>
            <span className="fv-rank-pts"> - {goldPoints} pts</span>
          </div>
        )}

        <div className="fv-lang-row">
          {languages.map(l => (
            <button key={l.code} className={`fv-lang-btn ${fieldLanguage === l.code ? 'active' : ''}`} onClick={() => setFieldLanguage(l.code)}>
              {l.label}
            </button>
          ))}
        </div>
      </div>

      <div className="fv-scroll">

        {!isLoggedIn && (
          <div className="fv-mission-start">
            {(process.env.NODE_ENV === 'development' || isDashboardAdmin(storeRole)) && !clockInOnly && (
              <button
                type="button"
                className="fv-back-admin-btn"
                onClick={() => navigate('/', { replace: true })}
              >
                Back to Admin
              </button>
            )}
            <h2 className="fv-mission-heading">START MISSION</h2>
            <p className="fv-mission-sub">הזן ID כדי לקבל משימות</p>

            {isSyncing ? (
              <div className={`fv-syncing phase-${radarPhase}`}>
                {radarPhase === 2 && syncReady ? (
                  <div className="fv-ready-badge">MISSIONS LOADED!</div>
                ) : (
                  <>
                    <div className="fv-radar-wrap">
                      <div className="fv-radar-ring r1" />
                      <div className="fv-radar-ring r2" />
                      <div className="fv-radar-ring r3" />
                      <div className={`fv-radar-core ${radarPhase === 1 ? 'locked' : ''}`}>
                        {radarPhase === 0 ? '...' : 'OK'}
                      </div>
                    </div>
                    <div className="fv-sync-text">
                      {radarPhase === 0 ? 'Syncing with Maya Brain...' : 'TARGET LOCKED - Loading Missions...'}
                    </div>
                    <div className="fv-sync-dots"><span /><span /><span /></div>
                  </>
                )}
              </div>
            ) : (
              <>
                <div className="fv-staff-fields">
                  <input
                    className="fv-field-input"
                    type="tel"
                    placeholder="מספר טלפון (נדרש)"
                    value={staffPhoneInput}
                    onChange={e => setStaffPhoneInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleClockIn()}
                    style={{ fontWeight: 800, color: '#000000' }}
                  />
                  <input
                    className="fv-field-input"
                    type="text"
                    placeholder="שם (אופציונלי)"
                    value={staffNameInput}
                    onChange={e => setStaffNameInput(e.target.value)}
                    style={{ fontWeight: 800, color: '#000000' }}
                  />
                  <input
                    className="fv-field-input"
                    type="text"
                    placeholder="Staff ID / QR Code (אופציונלי)"
                    value={staffIdInput}
                    onChange={e => setStaffIdInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleClockIn()}
                    style={{ fontWeight: 800, color: '#000000' }}
                  />
                  <button className="fv-qr-btn" onClick={() => setCameraOn(v => !v)}>
                    <QrCode size={16} />
                    {cameraOn ? 'סגור מצלמה' : 'סרוק QR'}
                  </button>
                  {cameraOn && (
                    <div className="fv-camera">
                      <video ref={videoRef} muted playsInline />
                    </div>
                  )}
                </div>
                {loginError && (
                  <div style={{
                    color: '#000', fontWeight: 800, fontSize: 13,
                    background: '#fee2e2', border: '1.5px solid #ef4444',
                    borderRadius: 10, padding: '8px 14px', textAlign: 'center',
                  }}>
                    {loginError}
                  </div>
                )}

                <button
                  className="fv-start-btn"
                  onClick={() => handleClockIn()}
                  disabled={isConnecting || (!staffPhoneInput.trim() && !staffIdInput.trim())}
                >
                  {isConnecting ? 'מתחבר...' : 'START MISSION'}
                </button>
                <button
                  type="button"
                  className="fv-admin-login-link"
                  onClick={() => navigate('/', { replace: true })}
                >
                  Admin login - חזרה ללוח מנהל
                </button>
              </>
            )}
          </div>
        )}

        {isLoggedIn && (
          <div className="fv-mission-start" style={{ padding: '14px 18px', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                <User size={28} strokeWidth={2} />
              </span>
              <div>
                <div className="fv-mission-heading" style={{ fontSize: 16, gap: 4 }}>
                  {staffProfile.name || staffProfile.staffId}
                </div>
                <div className="fv-mission-sub" style={{ marginTop: 0 }}>
                  <MapPin size={11} style={{ display: 'inline', marginRight: 3 }} />
                  Online - Level {levelNum}
                </div>
              </div>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                {onBreak ? (
                  <button type="button" className="fv-end-break-btn" onClick={handleEndBreak}>
                    END BREAK
                  </button>
                ) : (
                  <button type="button" className="fv-break-btn" onClick={handleStartBreak}>
                    הפסקה
                  </button>
                )}
                <button
                  type="button"
                  style={{ fontSize: 11, fontWeight: 800, padding: '5px 12px', borderRadius: 99, border: '1px solid rgba(0,0,0,0.12)', background: '#f3f4f6', color: '#000', cursor: 'pointer' }}
                  onClick={() => { stopFireParticles(); setStaffProfile({ staffId: '', name: '', phone: '', goldPoints: 0, rank: null, rankTier: 'starter' }); }}
                >
                  יציאה
                </button>
              </div>
            </div>
          </div>
        )}

        {isLoggedIn && !clockInOnly && (
          <>
            <div className="fv-feed-header">
              <span className="fv-feed-title">ACTIVE MISSIONS</span>
              <span className="fv-feed-count">{tasks.filter(t => t.status !== 'finished').length} פעילות</span>
            </div>

            {loadingTasks && (
              <div className="fv-loading">
                {[...Array(3)].map((_, i) => <div key={i} className="fv-skeleton" />)}
              </div>
            )}

            {!loadingTasks && tasks.length === 0 && (
              <div className="fv-empty">
                <div className="fv-empty-emoji">OK</div>
                <div className="fv-empty-title">כל המשימות הושלמו!</div>
                <div className="fv-empty-sub">אין משימות פתוחות כרגע. כל הכבוד!</div>
              </div>
            )}

            <div className="fv-simple-mission-list">
              {tasks.map((task, idx) => {
                const rawStatus = String(task.status || '').toLowerCase();
                const isFinished = rawStatus === 'finished' || rawStatus === 'done';
                const roomLabel = task.room || task.property_name || task.room_id || '-';
                const heroUrl = (task.property_photo_url && String(task.property_photo_url).trim()) || FIELD_HERO_FALLBACK;
                const primary = getFieldPrimaryAction(task);
                const isSpot = task.id === spotlightTaskId;
                const statusClass = String(task.status || 'pending').replace(/[^a-zA-Z0-9_-]/g, '_');

                return (
                  <div
                    key={task.id}
                    className={`fv-simple-card status-${statusClass}${isSpot ? ' spotlight' : ''}${isFinished ? ' done' : ''}`}
                    style={{ animationDelay: `${idx * 0.06}s` }}
                  >
                    <div className="fv-simple-hero">
                      <img
                        src={heroUrl}
                        alt=""
                        onError={(e) => { e.currentTarget.src = FIELD_HERO_FALLBACK; }}
                      />
                      <div className="fv-simple-room">{roomLabel}</div>
                    </div>

                    {!isFinished && primary && (
                      <button
                        type="button"
                        className={`fv-status-action fv-status-action--${primary.variant}`}
                        onClick={() => handleTaskUpdate(task.id, primary.next)}
                        disabled={!!taskActionLoading[`${task.id}-${primary.next}`]}
                      >
                        {taskActionLoading[`${task.id}-${primary.next}`] ? '...' : primary.label}
                      </button>
                    )}

                    {isFinished && (
                      <div className="fv-mission-done-badge">
                        {(t('staffView.missionComplete') || 'המשימה הושלמה')} - +{XP_PER_MISSION} XP
                      </div>
                    )}

                    <button
                      type="button"
                      className="fv-report-issue-btn fv-report-issue-btn--danger"
                      onClick={() => openIssueModal(task)}
                      title="דיווח על תקלה - ללא צורך בתמונה"
                    >
                      <AlertTriangle size={14} />
                      <span>דיווח על תקלה</span>
                    </button>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {toast      && <div className="fv-toast">{toast}</div>}
      {pointsToast && <div className="fv-toast points">{pointsToast}</div>}
      {levelToast  && <div className="fv-toast levelup">{levelToast}</div>}

      {showIssueModal && (
        <div className="fv-modal-backdrop" onClick={() => { setShowIssueModal(false); setIssueCategory(null); setIssueNote(''); }}>
          <div className="fv-modal fv-issue-modal" onClick={e => e.stopPropagation()}>
            <div className="fv-modal-header">
              <h3 className="fv-modal-title">מה סוג התקלה?</h3>
              <button type="button" className="fv-modal-close" onClick={() => { setShowIssueModal(false); setIssueCategory(null); setIssueNote(''); }}>x</button>
            </div>

            <div className="fv-issue-grid">
              {ISSUE_CATEGORIES.map(cat => (
                <button
                  type="button"
                  key={cat.id}
                  className={`fv-issue-cat${issueCategory === cat.id ? ' selected' : ''}`}
                  onClick={() => setIssueCategory(cat.id)}
                >
                  <span className="fv-issue-cat-icon">{cat.icon}</span>
                  <span className="fv-issue-cat-label">{cat.label}</span>
                </button>
              ))}
            </div>

            <textarea
              className="fv-modal-textarea"
              placeholder="פרטים נוספים (אופציונלי)..."
              value={issueNote}
              onChange={e => setIssueNote(e.target.value)}
              rows={2}
            />

            <button
              type="button"
              className="fv-modal-submit fv-issue-submit"
              onClick={handleIssueSubmit}
              disabled={issueSending || !issueCategory}
            >
              {issueSending ? 'שולח...' : 'דיווח על תקלה'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default FieldView;
