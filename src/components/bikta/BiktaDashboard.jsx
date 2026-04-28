import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import useStore from '../../store/useStore';
import hotelRealtime from '../../services/hotelRealtime';
import { apiRequest } from '../../utils/apiClient';
import { BIKTA_TENANT_ID } from '../../utils/biktaUser';
import { getNextWorkerFocusRoom } from './biktaWorkerTask';
import BiktaWorkerSingleTask from './BiktaWorkerSingleTask';
import {
  speakBiktaNewTask,
  getBiktaNewTaskSpeechText,
  speakBiktaWorkerPhaseCue,
  speakBiktaPerformancePraise,
  speakBiktaShiftCelebration,
  speakBiktaProactiveStaleRed,
} from '../../utils/mayaVoice';
import { firstName, getDefaultManagerFirstName } from '../../utils/workerMemory';
import BiktaShiftReport from './BiktaShiftReport';
import AdminReport from './AdminReport';
import './BiktaDashboard.css';

/** Cabin / wood textures for the 3×3 grid (fallback when API has no imagery). */
const CABIN_IMAGE_URLS = [
  'https://images.unsplash.com/photo-1518780664697-55e3ad937233?w=640&q=80',
  'https://images.unsplash.com/photo-1449158743715-0a90ebb6d51d?w=640&q=80',
  'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=640&q=80',
  'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=640&q=80',
  'https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?w=640&q=80',
  'https://images.unsplash.com/photo-1600585154526-990dced4db0d?w=640&q=80',
  'https://images.unsplash.com/photo-1600047509807-ba8f99d2cdde?w=640&q=80',
  'https://images.unsplash.com/photo-1600585154084-4e5fe7c39198?w=640&q=80',
  'https://images.unsplash.com/photo-1605276374104-dee2a0ed3cd6?w=640&q=80',
];

function buildBiktaPlaceholderRooms() {
  return Array.from({ length: 9 }, (_, i) => ({
    room_index: i + 1,
    name: `חדר ${i + 1}`,
    admin_mark: false,
    worker_done: false,
    worker_phase: 0,
    photo_url: CABIN_IMAGE_URLS[i % CABIN_IMAGE_URLS.length],
    dirty_marked_at: '',
    reminder_level: 0,
    price_per_hour: '—',
    amenities: '—',
    status: '—',
    _placeholder: true,
  }));
}

/** Short notification beep (worker phone) — Web Audio, no external file. */
function playBiktaBeep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g);
    g.connect(ctx.destination);
    o.frequency.value = 880;
    o.type = 'sine';
    g.gain.setValueAtTime(0.12, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
    o.start(ctx.currentTime);
    o.stop(ctx.currentTime + 0.2);
  } catch (_) {
    /* ignore */
  }
}

function playBiktaBeepDouble() {
  playBiktaBeep();
  window.setTimeout(() => playBiktaBeep(), 200);
}

/** Hebrew (admin) / Thai (worker) — X ✓ remain universal. */
export const BIKTA_TRANSLATION_MAP = {
  'התחלת משמרת': 'เริ่มกะ',
  'מלוכלך': 'สกปรก',
  'בניקיון': 'กำลังทำความสะอาด',
  'מוכן': 'สะอาดแล้ว',
  'חדר': 'ห้อง',
};

const BIKTA_STRINGS = {
  he: {
    startShift: 'התחלת משמרת',
    saving: 'שומר…',
    workerNamePlaceholder: 'שם העובד/ת',
    adminHint: 'מסך ניהול: הוסף לכתובת ‎?mode=admin‎',
    shiftReport: 'דוח משמרות',
    badgeAdmin: 'מנהל',
    badgeWorker: 'עובד',
    loading: 'טוען…',
    errNameRequired: 'נא להזין שם לפני התחלת משמרת',
    errLoad: 'טעינה נכשלה',
    errStartShift: 'לא ניתן להתחיל משמרת',
    errAction: 'פעולה נכשלה',
    amenities: 'שירותים:',
    status: 'סטטוס:',
    shiftFooter: (name, time, count) =>
      `משמרת: ${name} · התחלה ${time} · נקי: ${count}`,
    labelDirty: 'מלוכלך',
    labelCleaning: 'בניקיון',
    labelReady: 'מוכן',
    roomWord: 'חדר',
    cardAriaAdmin: (idx) => `סימון עזיבה / מלוכלך — חדר ${idx}`,
    cardAriaWorker: (idx) => `עדכון ניקוי חדר ${idx}`,
    spinnerAria: 'בניקוי',
    shiftStartConfirm: 'המשמרת נרשמה',
    endShift: 'סיום משמרת',
    endingShift: 'סוגר…',
  },
  th: {
    startShift: 'เริ่มกะ',
    saving: 'กำลังบันทึก…',
    workerNamePlaceholder: 'ชื่อพนักงาน',
    adminHint: 'สำหรับผู้ดูแล: ใส่ ‎?mode=admin‎ ใน URL',
    shiftReport: 'รายงานกะ',
    badgeAdmin: 'ผู้ดูแล',
    badgeWorker: 'พนักงาน',
    loading: 'กำลังโหลด…',
    errNameRequired: 'กรุณากรอกชื่อก่อนเริ่มกะ',
    errLoad: 'โหลดไม่สำเร็จ',
    errStartShift: 'ไม่สามารถเริ่มกะได้',
    errAction: 'ไม่สามารถทำรายการได้',
    amenities: 'บริการ:',
    status: 'สถานะ:',
    shiftFooter: (name, time, count) => `กะ: ${name} · เริ่ม ${time} · ห้องสะอาด: ${count}`,
    labelDirty: 'สกปรก',
    labelCleaning: 'กำลังทำความสะอาด',
    labelReady: 'สะอาดแล้ว',
    roomWord: 'ห้อง',
    cardAriaAdmin: (idx) => `ทำเครื่องหมายสกปรก — ห้อง ${idx}`,
    cardAriaWorker: (idx) => `อัปเดตทำความสะอาด — ห้อง ${idx}`,
    spinnerAria: 'กำลังทำความสะอาด',
    shiftStartConfirm: 'บันทึกเวลาเริ่มงานแล้ว',
    endShift: 'จบกะ',
    endingShift: 'กำลังบันทึก…',
    workerDeepClean: 'ทำความสะอาดอย่างละเอียด',
    workerInProgress: 'กำลังทำความสะอาด — แตะเมื่อทำเสร็จ',
    workerAllClear: 'ไม่มีงานที่ต้องทำตอนนี้',
    workerAllClearSub: 'ทุกห้องพร้อม หรืองานปัจจุบันเสร็จแล้ว',
    workerBtnStart: 'เริ่มทำความสะอาด',
    workerBtnDone: 'เสร็จแล้ว',
    mayaReconnecting: 'מאיה מתחברת מחדש… נסה שוב בעוד רגע.',
    mayaMicAria: 'พูดคุยกับมายา',
    retryLoad: 'ลองอีกครั้ง',
  },
};

function tStrings(isAdmin) {
  return isAdmin ? BIKTA_STRINGS.he : BIKTA_STRINGS.th;
}

function normalizeRole(r) {
  if (!r) return 'host';
  const map = { owner: 'host', manager: 'admin', staff: 'field', worker: 'field' };
  return map[r] || r;
}

const DEFAULT_BRAND = { business_name: 'הבקתה נס ציונה', phone: '055-939-9999' };

export default function BiktaDashboard() {
  const [opError, setOpError] = useState(null);
  const { role, activeTenantId, setMayaChatOpen, addMayaMessage } = useStore();
  const [searchParams] = useSearchParams();
  const modeParam = (searchParams.get('mode') || '').toLowerCase();

  const nr = normalizeRole(role);
  let isAdminView = true;
  if (modeParam === 'worker') isAdminView = false;
  else if (modeParam === 'admin') isAdminView = true;
  else isAdminView = nr === 'host' || nr === 'admin';

  const asWorkerUi = !isAdminView;

  const [matrix, setMatrix] = useState({
    rooms: [],
    active_shift: null,
    tenant_id: null,
    branding: DEFAULT_BRAND,
    dirty_alerts: [],
    worker_insights: null,
  });
  const [thaiAlert, setThaiAlert] = useState(null);
  const [adminPage, setAdminPage] = useState('grid');
  const [loading, setLoading] = useState(true);
  const [matrixFetchFailed, setMatrixFetchFailed] = useState(false);
  const [workerName, setWorkerName] = useState('');
  const [starting, setStarting] = useState(false);
  const [patching, setPatching] = useState(null);
  const [endingShift, setEndingShift] = useState(false);
  const [shiftConfirm, setShiftConfirm] = useState(false);
  const prevRoomsRef = useRef(null);
  const proactiveStaleRef = useRef(new Set());

  const PROACTIVE_STALE_MINUTES = 10;

  const tx = useMemo(() => tStrings(isAdminView), [isAdminView]);

  /* No-scroll full viewport on matrix / shift gate; reports stay scrollable */
  useEffect(() => {
    if (adminPage !== 'grid') {
      document.documentElement.classList.remove('bikta-body-lock');
      document.body.classList.remove('bikta-body-lock');
      return undefined;
    }
    document.documentElement.classList.add('bikta-body-lock');
    document.body.classList.add('bikta-body-lock');
    return () => {
      document.documentElement.classList.remove('bikta-body-lock');
      document.body.classList.remove('bikta-body-lock');
    };
  }, [adminPage]);

  /* Keyboard / dynamic toolbar: keep layout inside visible viewport */
  useEffect(() => {
    if (adminPage !== 'grid') return undefined;
    const setVh = () => {
      const h = window.visualViewport?.height ?? window.innerHeight;
      document.documentElement.style.setProperty('--bikta-vh', `${h}px`);
    };
    setVh();
    const vv = window.visualViewport;
    vv?.addEventListener('resize', setVh);
    vv?.addEventListener('scroll', setVh);
    window.addEventListener('resize', setVh);
    return () => {
      vv?.removeEventListener('resize', setVh);
      vv?.removeEventListener('scroll', setVh);
      window.removeEventListener('resize', setVh);
    };
  }, [adminPage]);

  const applyPayload = useCallback((data) => {
    const raw = Array.isArray(data.rooms) ? data.rooms : [];
    const rooms = raw.length ? raw : buildBiktaPlaceholderRooms();
    setMatrix({
      rooms,
      active_shift: data.active_shift || null,
      tenant_id: data.tenant_id,
      branding: data.branding && typeof data.branding === 'object' ? { ...DEFAULT_BRAND, ...data.branding } : DEFAULT_BRAND,
      dirty_alerts: Array.isArray(data.dirty_alerts) ? data.dirty_alerts : [],
      worker_insights: data.worker_insights && typeof data.worker_insights === 'object' ? data.worker_insights : null,
    });
  }, []);

  const loadMatrix = useCallback(async () => {
    setOpError(null);
    const tid = activeTenantId || BIKTA_TENANT_ID;
    const data = await apiRequest(`/bikta/matrix?tenant_id=${encodeURIComponent(tid)}`, { method: 'GET' });
    applyPayload(data);
  }, [applyPayload, activeTenantId]);

  const retryMatrix = useCallback(async () => {
    setOpError(null);
    setMatrixFetchFailed(false);
    setLoading(true);
    try {
      await loadMatrix();
      setMatrixFetchFailed(false);
    } catch (e) {
      setMatrixFetchFailed(true);
      setOpError(e?.message || tStrings(isAdminView).errLoad);
    } finally {
      setLoading(false);
    }
  }, [loadMatrix, isAdminView]);

  // Fetch matrix when tenant or admin/worker mode changes — do not depend on authToken (was causing re-fetch loops).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        await loadMatrix();
        if (!cancelled) {
          setMatrixFetchFailed(false);
        }
      } catch (e) {
        if (!cancelled) {
          setMatrixFetchFailed(true);
          setOpError(e?.message || tStrings(isAdminView).errLoad);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeTenantId, isAdminView, loadMatrix]);

  useEffect(() => {
    const w = matrix.active_shift?.worker_name;
    if (w) {
      try {
        sessionStorage.setItem('bikta_shift_worker_name', String(w).trim());
      } catch (_) {
        /* ignore */
      }
    }
  }, [matrix.active_shift?.worker_name]);

  useEffect(() => {
    const unsub = hotelRealtime.subscribe('bikta_matrix_update', (payload) => {
      if (!payload || typeof payload !== 'object') return;
      applyPayload(payload);
    });
    return unsub;
  }, [applyPayload]);

  /* Maya auto-close / manual close requests fresh matrix from API */
  useEffect(() => {
    const onRefresh = () => {
      void loadMatrix();
    };
    window.addEventListener('bikta-matrix-refresh-request', onRefresh);
    return () => window.removeEventListener('bikta-matrix-refresh-request', onRefresh);
  }, [loadMatrix]);

  useEffect(() => {
    const tid = activeTenantId || BIKTA_TENANT_ID;
    const unsub = hotelRealtime.subscribe('bikta_reminder', (payload) => {
      if (!payload || typeof payload !== 'object') return;
      if (payload.tenant_id && payload.tenant_id !== tid) return;
      if (isAdminView) return;
      if (payload.kind === 'beep_second') {
        playBiktaBeepDouble();
        try {
          if (typeof navigator !== 'undefined' && navigator.vibrate) {
            navigator.vibrate([120, 80, 120]);
          }
        } catch (_) {
          /* ignore */
        }
        return;
      }
      if (payload.kind === 'thai_popup' && payload.message) {
        setThaiAlert({
          message: String(payload.message),
          room_index: payload.room_index,
        });
      }
    });
    return unsub;
  }, [activeTenantId, isAdminView]);

  useEffect(() => {
    if (isAdminView || !matrix.rooms?.length) return;
    const prev = prevRoomsRef.current;
    if (prev && prev.length) {
      for (const r of matrix.rooms) {
        const pr = prev.find((x) => x.room_index === r.room_index);
        if (r.admin_mark && (!pr || !pr.admin_mark)) {
          const speechText = getBiktaNewTaskSpeechText(r.room_index, true);
          setMayaChatOpen(true);
          addMayaMessage({ role: 'assistant', content: speechText });
          speakBiktaNewTask(r.room_index, true, {
            onComplete: () => window.dispatchEvent(new CustomEvent('maya-bikta-arm-auto-close')),
          });
          try {
            if (typeof navigator !== 'undefined' && navigator.vibrate) {
              navigator.vibrate(200);
            }
          } catch (_) {
            /* ignore */
          }
          break;
        }
      }
    }
    prevRoomsRef.current = matrix.rooms;
  }, [matrix.rooms, isAdminView, setMayaChatOpen, addMayaMessage]);

  useEffect(() => {
    if (!shiftConfirm) return undefined;
    const id = window.setTimeout(() => setShiftConfirm(false), 4500);
    return () => clearTimeout(id);
  }, [shiftConfirm]);

  const handleStartShift = async () => {
    const name = workerName.trim();
    if (!name) {
      setOpError(tx.errNameRequired);
      return;
    }
    setStarting(true);
    setOpError(null);
    setShiftConfirm(false);
    try {
      const data = await apiRequest('/bikta/shift/start', {
        method: 'POST',
        body: { worker_name: name },
      });
      applyPayload(data);
      if (!isAdminView) {
        setShiftConfirm(true);
      }
    } catch (e) {
      setOpError(e?.message || tx.errStartShift);
    } finally {
      setStarting(false);
    }
  };

  const handleEndShift = async () => {
    const name = matrix.active_shift?.worker_name;
    if (!name) return;
    setEndingShift(true);
    setOpError(null);
    try {
      const data = await apiRequest('/bikta/shift/end', {
        method: 'POST',
        body: {},
        headers: { 'X-Bikta-Ui-Mode': 'worker' },
      });
      applyPayload(data);
      if (data.shift_celebration) {
        speakBiktaShiftCelebration(data.shift_celebration, true);
      }
    } catch (e) {
      setOpError(e?.message || tx.errAction);
    } finally {
      setEndingShift(false);
    }
  };

  const patchRoom = async (roomIndex, action) => {
    setPatching(roomIndex);
    setOpError(null);
    const prevRoom = matrix.rooms.find((r) => r.room_index === roomIndex);
    const prevPhase = prevRoom
      ? prevRoom.worker_phase ?? (prevRoom.worker_done ? 2 : 0)
      : 0;
    try {
      const headers =
        asWorkerUi && (action === 'worker_advance' || action === 'worker_done')
          ? { 'X-Bikta-Ui-Mode': 'worker' }
          : {};
      const data = await apiRequest(`/bikta/matrix/room/${roomIndex}`, {
        method: 'PATCH',
        body: { action },
        headers,
      });
      applyPayload(data);
      if (asWorkerUi && action === 'worker_advance') {
        const rooms = Array.isArray(data.rooms) ? data.rooms : [];
        const nr = rooms.find((r) => r.room_index === roomIndex);
        const np = nr ? nr.worker_phase ?? (nr.worker_done ? 2 : 0) : prevPhase;
        if (prevPhase === 0 && np === 1) speakBiktaWorkerPhaseCue('orange');
        if (prevPhase === 1 && np === 2) {
          if (data.performance_event?.level_up) {
            speakBiktaPerformancePraise(data.performance_event, true);
          } else {
            speakBiktaWorkerPhaseCue('green');
          }
        }
      }
    } catch (e) {
      setOpError(e?.message || tx.errAction);
    } finally {
      setPatching(null);
    }
  };

  const onCardActivate = (room) => {
    if (room._placeholder) return;
    if (patching !== null) return;
    if (isAdminView) {
      patchRoom(room.room_index, 'toggle_admin');
      return;
    }
    const phase = room.worker_phase ?? (room.worker_done ? 2 : 0);
    if (phase >= 2) return;
    if (!room.admin_mark && phase === 0) return;
    patchRoom(room.room_index, 'worker_advance');
  };

  const showShiftGate = !isAdminView && !matrix.active_shift;
  const showMatrixGrid = !loading && !showShiftGate && adminPage === 'grid';

  /* Proactive TTS: red room waiting too long (admin = Hebrew nudge; worker = Thai) */
  useEffect(() => {
    if (!showMatrixGrid || matrixFetchFailed || loading) return undefined;
    const tick = () => {
      const rooms = matrix.rooms || [];
      for (const r of rooms) {
        if (r._placeholder) continue;
        const ph = r.worker_phase ?? (r.worker_done ? 2 : 0);
        if (!r.admin_mark || ph !== 0) continue;
        const dirtyAt = r.dirty_marked_at;
        if (!dirtyAt) continue;
        const ts = Date.parse(dirtyAt);
        if (Number.isNaN(ts)) continue;
        const mins = (Date.now() - ts) / 60000;
        if (mins < PROACTIVE_STALE_MINUTES) continue;
        const key = `stale-${r.room_index}-${String(dirtyAt).slice(0, 19)}`;
        if (proactiveStaleRef.current.has(key)) continue;
        proactiveStaleRef.current.add(key);
        const mgr = getDefaultManagerFirstName();
        const wn = matrix.active_shift?.worker_name;
        speakBiktaProactiveStaleRed({
          isAdmin: isAdminView,
          roomIndex: r.room_index,
          managerFirstName: mgr,
          workerFirstName: wn ? firstName(wn) : '',
        });
        break;
      }
    };
    tick();
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, [
    showMatrixGrid,
    matrixFetchFailed,
    loading,
    matrix.rooms,
    matrix.active_shift,
    isAdminView,
  ]);

  const roomsSorted = [...(matrix.rooms || [])].sort((a, b) => (a.room_index || 0) - (b.room_index || 0));
  const nextWorkerRoom = useMemo(() => {
    if (isAdminView || matrixFetchFailed) return null;
    return getNextWorkerFocusRoom(matrix.rooms);
  }, [isAdminView, matrix.rooms, matrixFetchFailed]);
  const nwPhase = nextWorkerRoom
    ? nextWorkerRoom.worker_phase ?? (nextWorkerRoom.worker_done ? 2 : 0)
    : 0;
  const brand = matrix.branding || DEFAULT_BRAND;

  if (isAdminView && adminPage === 'report') {
    return <BiktaShiftReport onBack={() => setAdminPage('grid')} />;
  }
  if (isAdminView && adminPage === 'daily') {
    return <AdminReport onBack={() => setAdminPage('grid')} />;
  }

  const rootDir = isAdminView ? 'rtl' : 'ltr';
  const rootClass = [
    'bikta-root',
    isAdminView ? '' : 'bikta-root--worker',
    showMatrixGrid ? 'bikta-root--matrix' : '',
    showShiftGate && adminPage === 'grid' ? 'bikta-root--gate' : '',
    !isAdminView && showMatrixGrid ? 'bikta-root--worker-single' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={rootClass} dir={rootDir} id="main-content" lang={isAdminView ? 'he' : 'th'}>
      <div className="bikta-shell">
      <header className="bikta-header bikta-header--compact">
        <div className="bikta-header-text">
          <div className="bikta-title-row">
            <div className="bikta-title">{brand.business_name}</div>
            {isAdminView && matrix.active_shift?.worker_name ? (
              <div className="bikta-active-worker">
                <span className="bikta-active-worker-name">{matrix.active_shift.worker_name}</span>
                {matrix.worker_insights?.top_improver ? (
                  <span className="bikta-top-improver-badge" title="ממוצע זמן ניקוי משתפר — שבוע אחרון">
                    ⭐ Top Improver
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
          <a className="bikta-phone" href={`tel:${String(brand.phone).replace(/\s/g, '')}`}>
            {brand.phone}
          </a>
        </div>
        <div className="bikta-header-actions">
          {isAdminView ? (
            <>
              <button type="button" className="bikta-tab-btn" onClick={() => setAdminPage('daily')}>
                סיכום יומי
              </button>
              <button type="button" className="bikta-tab-btn" onClick={() => setAdminPage('report')}>
                {tx.shiftReport}
              </button>
            </>
          ) : null}
          {!isAdminView && matrix.active_shift && adminPage === 'grid' ? (
            <button
              type="button"
              className="bikta-header-end-shift"
              disabled={endingShift}
              onClick={handleEndShift}
            >
              {endingShift ? tx.endingShift : tx.endShift}
            </button>
          ) : null}
          <div className="bikta-badge">{isAdminView ? tx.badgeAdmin : tx.badgeWorker}</div>
        </div>
      </header>

      {!isAdminView && showMatrixGrid && matrix.active_shift && !matrixFetchFailed ? (
        <p className="bikta-worker-shift-line">
          {tx.shiftFooter(
            matrix.active_shift.worker_name,
            matrix.active_shift.started_at?.slice(11, 16) || '',
            matrix.active_shift.rooms_cleaned ?? 0
          )}
        </p>
      ) : null}

      {shiftConfirm && !isAdminView ? (
        <div className="bikta-toast" role="status">
          {BIKTA_STRINGS.th.shiftStartConfirm}
        </div>
      ) : null}

      {opError && !matrixFetchFailed ? <div className="bikta-err">{opError}</div> : null}

      {loading ? (
        <div className="bikta-main bikta-main--fill bikta-loading">{tx.loading}</div>
      ) : showShiftGate ? (
        <div className="bikta-main bikta-main--fill bikta-shift-panel-wrap">
          {matrixFetchFailed ? (
            <div className="bikta-maya-reconnect-strip" role="status">
              <span className="bikta-maya-reconnect-msg">{tx.mayaReconnecting}</span>
              <button type="button" className="bikta-btn-retry" onClick={retryMatrix}>
                {tx.retryLoad}
              </button>
            </div>
          ) : null}
          <div className="bikta-shift-panel">
            <input
              type="text"
              placeholder={tx.workerNamePlaceholder}
              value={workerName}
              onChange={(e) => setWorkerName(e.target.value)}
              autoComplete="name"
            />
            <button type="button" className="bikta-btn-primary" disabled={starting} onClick={handleStartShift}>
              {starting ? tx.saving : tx.startShift}
            </button>
            {isAdminView ? <p className="bikta-hint">{tx.adminHint}</p> : null}
          </div>
        </div>
      ) : (
        <main className="bikta-main bikta-main--matrix">
          {matrixFetchFailed ? (
            <div className="bikta-maya-reconnect-fill" role="alert">
              <p className="bikta-maya-reconnect-text">{tx.mayaReconnecting}</p>
              <button type="button" className="bikta-btn-primary" onClick={retryMatrix}>
                {tx.retryLoad}
              </button>
            </div>
          ) : isAdminView ? (
            <div className="bikta-grid">
              {roomsSorted.map((room) => {
                const idx = room.room_index;
                const phase = room.worker_phase ?? (room.worker_done ? 2 : 0);
                const showV = phase >= 2;
                const showOrange = phase === 1;
                const showRed = Boolean(room.admin_mark) && phase === 0;
                const showClean = !room.admin_mark && phase === 0;
                const adminClickable = isAdminView && !room._placeholder;
                const workerClickable = !isAdminView && room.admin_mark && phase < 2 && !room._placeholder;
                const clickable = adminClickable || workerClickable;
                const photoUrl =
                  room.photo_url || CABIN_IMAGE_URLS[(Math.max(0, idx - 1) % CABIN_IMAGE_URLS.length)];
                const statusCaption = showV
                  ? tx.labelReady
                  : showOrange
                    ? tx.labelCleaning
                    : showRed
                      ? tx.labelDirty
                      : '';

                return (
                  <div
                    key={`bikta-${idx}`}
                    className={`bikta-card ${clickable ? 'bikta-card--clickable' : ''}${
                      room._placeholder ? ' bikta-card--placeholder' : ''
                    }${showRed ? ' bikta-card--state-red' : ''}${showOrange ? ' bikta-card--state-orange' : ''}${
                      showV ? ' bikta-card--state-green' : ''
                    }${showClean ? ' bikta-card--state-clean' : ''}`}
                    role="presentation"
                  >
                    <div
                      className="bikta-card-bg"
                      style={{ backgroundImage: `url(${photoUrl})` }}
                      aria-hidden
                    />
                    <div className="bikta-card-body">
                      <div className="bikta-room-digit" aria-hidden>
                        {idx}
                      </div>
                      <div className="bikta-card-name" title={room.name || `${tx.roomWord} ${idx}`}>
                        {room.name || `${tx.roomWord} ${idx}`}
                      </div>
                      <div className="bikta-price-pill">{room.price_per_hour || '—'}</div>
                      <div className="bikta-card-meta">
                        <div>
                          <strong>{tx.amenities}</strong> {room.amenities || '—'}
                        </div>
                        <div>
                          <strong>{tx.status}</strong> {room.status || '—'}
                        </div>
                      </div>
                    </div>

                    {showClean && (
                      <div className="bikta-overlay bikta-overlay--clean" aria-hidden>
                        <span className="bikta-neon-clean" title="Clean" />
                      </div>
                    )}

                    {(showRed || showOrange || showV) && (
                      <div className="bikta-overlay bikta-overlay--labeled" aria-hidden={!clickable}>
                        <div className="bikta-overlay-symbol">
                          {showV ? (
                            <span className="bikta-mark-ready" title="מוכן" aria-hidden />
                          ) : (
                            <span
                              className={`bikta-mark-x ${showOrange ? 'bikta-mark-x--orange' : 'bikta-mark-x--red'}`}
                            >
                              ✕
                            </span>
                          )}
                        </div>
                        {statusCaption ? (
                          <span className="bikta-overlay-caption">{statusCaption}</span>
                        ) : null}
                      </div>
                    )}

                    {clickable ? (
                      <button
                        type="button"
                        className="bikta-hit-layer"
                        aria-label={tx.cardAriaAdmin(idx)}
                        disabled={patching !== null}
                        onClick={() => onCardActivate(room)}
                      />
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <>
              <BiktaWorkerSingleTask
                room={nextWorkerRoom}
                photoUrl={
                  nextWorkerRoom
                    ? nextWorkerRoom.photo_url ||
                      CABIN_IMAGE_URLS[
                        (Math.max(0, nextWorkerRoom.room_index - 1) % CABIN_IMAGE_URLS.length)
                      ]
                    : ''
                }
                phase={nwPhase}
                isRed={Boolean(nextWorkerRoom?.admin_mark) && nwPhase === 0}
                isOrange={nwPhase === 1}
                taskLine={
                  nextWorkerRoom
                    ? nwPhase === 0 && nextWorkerRoom.admin_mark
                      ? tx.workerDeepClean
                      : tx.workerInProgress
                    : ''
                }
                completeLabel={
                  nextWorkerRoom ? (nwPhase === 1 ? tx.workerBtnDone : tx.workerBtnStart) : '—'
                }
                onComplete={() => nextWorkerRoom && onCardActivate(nextWorkerRoom)}
                completeDisabled={patching !== null || !nextWorkerRoom}
                onMic={() => window.dispatchEvent(new CustomEvent('maya-external-mic-toggle'))}
                micAriaLabel={tx.mayaMicAria}
                emptyTitle={tx.workerAllClear}
                emptySubtitle={tx.workerAllClearSub}
              />
            </>
          )}
        </main>
      )}

      </div>

      {thaiAlert ? (
        <div className="bikta-thai-backdrop" role="dialog" aria-modal="true" aria-labelledby="bikta-thai-title">
          <div className="bikta-thai-modal">
            <p id="bikta-thai-title" className="bikta-thai-text">
              {thaiAlert.message}
            </p>
            {thaiAlert.room_index != null ? (
              <p className="bikta-thai-room">ห้อง {thaiAlert.room_index}</p>
            ) : null}
            <button type="button" className="bikta-thai-dismiss" onClick={() => setThaiAlert(null)}>
              ตกลง
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
