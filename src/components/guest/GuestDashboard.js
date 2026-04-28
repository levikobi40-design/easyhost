import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  X,
  Home,
  ClipboardList,
  User,
  MessageCircle,
} from 'lucide-react';
import {
  getGuestRoomInfo,
  getGuestBookingContext,
  getGuestPropertyTasks,
  createGuestTask,
  sendGuestMayaMessage,
} from '../../services/guestApi';
import GuestErrorBoundary from '../common/GuestErrorBoundary';
import { notifyTasksChanged } from '../../utils/taskSyncBridge';
import easyhostLogoDark from '../../assets/easyhost-logo-dark.svg';
import {
  GUEST_LAST_REQUEST_ACK_HE,
  getInstantMayaForGuestTask,
  guestFacingRequestStatusHe,
  sanitizeGuestVisibleMessage,
} from './guestFastReplies';
import { speakMayaReply } from '../../utils/mayaVoice';
import { inferGuestViewMode, inferGuestPropertyTemplate, buildMayaPersonaWelcomeHe } from '../../utils/guestViewMode';
import { BAZAAR_JAFFA_PROPERTY_ID } from '../../data/propertyData';
import {
  GUEST_ROOM_SERVICE_MENU,
  GUEST_SPA_SERVICES,
  openGuestManagerWhatsAppPrefilled,
  getGuestManagerWhatsAppDigits,
} from '../../data/guestIndustryMenus';
import './GuestDashboard.css';

const BG_IMAGE = 'https://images.unsplash.com/photo-1514565131-fce0801e5785?w=1920&auto=format&fit=crop';

/* Realistic tile images — each key is a distinct Unsplash hero (no duplicates across hotel tiles). */
const TILE_IMAGES = {
  towels: 'https://images.unsplash.com/photo-1552321554-5fefe8c9ef14?w=400&auto=format&fit=crop',
  dining: 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=400&auto=format&fit=crop',
  ice: 'https://images.unsplash.com/photo-1609951651556-5334e2706168?w=400&auto=format&fit=crop',
  coffee: 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=400&auto=format&fit=crop',
  maintenance: 'https://images.unsplash.com/photo-1581092160562-40aa08e78837?w=400&auto=format&fit=crop',
  pool: 'https://images.unsplash.com/photo-1576013551627-0cc20b96c2a7?w=400&auto=format&fit=crop',
  gym: 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=400&auto=format&fit=crop',
  spa: 'https://images.unsplash.com/photo-1540555700478-4be289fbecef?w=400&auto=format&fit=crop',
  checkout: 'https://images.unsplash.com/photo-1631049307264-da0ec9d70304?w=400&auto=format&fit=crop',
  map: 'https://images.unsplash.com/photo-1526778548025-fa2f459cd5c1?w=400&auto=format&fit=crop',
  schedule: 'https://images.unsplash.com/photo-1501139083538-0139583c060f?w=400&auto=format&fit=crop',
  info: 'https://images.unsplash.com/photo-1557804506-669a67965ba0?w=400&auto=format&fit=crop',
  wifi: 'https://images.unsplash.com/photo-1544197150-b99a580bb7a8?w=400&auto=format&fit=crop',
  room_service: 'https://images.unsplash.com/photo-1559339352-11d035aa65de?w=400&auto=format&fit=crop',
  reception: 'https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=400&auto=format&fit=crop',
};

/** Hotel: 2×4 grid — checkout, housekeeping, F&B, ops */
const HOTEL_TILES = [
  { id: 'checkout', imageKey: 'checkout', label: "צ'ק-אאוט", modal: 'checkout' },
  {
    id: 'room_cleaning',
    imageKey: 'schedule',
    label: 'ניקיון',
    taskType: 'Cleaning',
    description: 'בקשת ניקיון חדר',
    staff_name: 'צוות ניקיון',
  },
  {
    id: 'towels',
    imageKey: 'towels',
    label: 'מגבות',
    taskType: 'Cleaning',
    description: 'בקשת מגבות',
    staff_name: 'צוות ניקיון',
  },
  {
    id: 'maintenance_tile',
    imageKey: 'maintenance',
    label: 'תחזוקה',
    taskType: 'Maintenance',
    description: 'בקשת תחזוקה',
    staff_name: 'קובי',
  },
  {
    id: 'spa_guest',
    imageKey: 'spa',
    label: 'ספא',
    taskType: 'Service',
    description: 'בקשת שירות ספא',
  },
  {
    id: 'room_service',
    imageKey: 'room_service',
    label: 'שירות חדר',
    taskType: 'Service',
    description: 'בקשת שירות חדר',
  },
  {
    id: 'wifi_help',
    imageKey: 'wifi',
    label: 'Wi‑Fi',
    taskType: 'Service',
    description: 'בקשת עזרה ב-WiFi / אינטרנט',
  },
  {
    id: 'reception',
    imageKey: 'reception',
    label: 'קבלה',
    taskType: 'Service',
    description: 'בקשה לדסק קבלה',
  },
];

/** WeWork / ROOMS workspace — Coffee, Meeting Room Tech, Printer */
const WORKSPACE_TILES = [
  {
    id: 'coffee_workspace',
    imageKey: 'coffee',
    label: 'קפה',
    taskType: 'Service',
    description: 'בקשת קפה',
  },
  {
    id: 'meeting_room_tech',
    imageKey: 'maintenance',
    label: 'חדר ישיבות — טכנולוגיה',
    taskType: 'Service',
    description: '[דחוף] תמיכה טכנית בחדר ישיבות — התראה למנהל הקהילה',
    staff_name: 'מנהל קהילה',
  },
  {
    id: 'printer',
    imageKey: 'schedule',
    label: 'מדפסת',
    taskType: 'Service',
    description: 'בקשת הדפסה / מדפסת',
  },
];

const TAB_ITEMS = [
  { id: 'home', icon: Home, label: 'בית' },
  { id: 'requests', icon: ClipboardList, label: 'היסטוריה' },
  { id: 'profile', icon: User, label: 'פרופיל' },
];

const GUEST_WELCOME_KEY = 'guest_welcome_room';

function buildDisplayTiles(propertyTemplate) {
  const maintenanceLike = {
    id: 'maintenance_tile',
    imageKey: 'maintenance',
    label: 'תחזוקה',
    action: 'maintenance_modal',
  };
  if (propertyTemplate === 'hotel') {
    return HOTEL_TILES.map((t) => {
      if (t.id === 'maintenance_tile') return { ...t, action: 'maintenance_modal' };
      if (t.id === 'room_service') return { ...t, action: 'room_service_menu' };
      if (t.id === 'spa_guest') return { ...t, action: 'spa_menu' };
      return { ...t };
    });
  }
  const checkoutTile = {
    id: 'checkout',
    imageKey: 'checkout',
    label: 'סיום מפגש',
    modal: 'checkout',
  };
  const extras = [
    maintenanceLike,
    { id: 'room_service', imageKey: 'room_service', label: 'שירות חדר', action: 'room_service_menu' },
    { id: 'spa_guest', imageKey: 'spa', label: 'ספא', action: 'spa_menu' },
  ];
  return [checkoutTile, ...WORKSPACE_TILES, ...extras];
}

/** Maya line when a grid tile is active (in progress) — chat + voice */
const GUEST_PROGRESS_ACK_HE = 'רשמתי לעצמי, העזרה בדרך.';

const MAYA_STAFF_DONE_LINE = 'מצוין! סימנו את הבקשה כבוצעה. משהו נוסף?';

function guestRoomNumberLabel(room) {
  const n = String(room?.name || '').trim();
  if (/^\d+$/.test(n)) return n;
  const m = n.match(/(\d{1,4})/);
  return m ? m[1] : '';
}

function GuestToast({ message, onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 3500);
    return () => clearTimeout(t);
  }, [onClose]);
  return (
    <div className="guest-toast" role="alert">
      {message}
    </div>
  );
}

function GuestDashboard({ roomId }) {
  const [room, setRoom] = useState({ id: '', name: '', description: '', property_type: '', branchSlug: '' });
  const [bookingCtx, setBookingCtx] = useState(null);
  const [guestContextLoading, setGuestContextLoading] = useState(true);
  const [guestContextError, setGuestContextError] = useState(null);
  const mayaWelcomedRef = useRef(false);
  const guestWelcomeKeyRef = useRef('');
  const guestActionDebounceRef = useRef(0);
  const [toast, setToast] = useState(null);
  const [modal, setModal] = useState(null);
  const [maintenanceNotes, setMaintenanceNotes] = useState('');
  const [guestSessionActive, setGuestSessionActive] = useState(false);
  /** Tile id / busyKey that just received instant "✓ נשלח" feedback */
  const [instantAckTileId, setInstantAckTileId] = useState(null);
  const [guestTileBusy, setGuestTileBusy] = useState(null);
  const [activeTab, setActiveTab] = useState('home');
  const [guestChatOpen, setGuestChatOpen] = useState(false);
  const [mayaMessages, setMayaMessages] = useState([]);
  const [mayaInput, setMayaInput] = useState('');
  const [mayaSending, setMayaSending] = useState(false);
  const [guestTasks, setGuestTasks] = useState([]);
  const [guestTasksLoading, setGuestTasksLoading] = useState(false);
  /** Trailing debounce for task-related Maya lines — coalesces bursts into one ack */
  const mayaTaskAckTimerRef = useRef(null);
  const mayaAppendAckTimerRef = useRef(null);
  const guestChatPanelRef = useRef(null);
  /** Tile ids with active staff request — red tile + staff completion in chat */
  const [pendingTiles, setPendingTiles] = useState({});

  const showToast = useCallback((msg) => setToast(msg), []);

  useEffect(
    () => () => {
      if (mayaTaskAckTimerRef.current) clearTimeout(mayaTaskAckTimerRef.current);
      if (mayaAppendAckTimerRef.current) clearTimeout(mayaAppendAckTimerRef.current);
    },
    [],
  );

  const canProceedGuestAction = useCallback(() => {
    const now = Date.now();
    if (now - guestActionDebounceRef.current < 2000) return false;
    guestActionDebounceRef.current = now;
    return true;
  }, []);

  const slugFromUrl = String(roomId || '').trim();
  /** When route has no :roomId, default to Hotel Bazaar Jaffa so the UI always works */
  const slugForFetch = slugFromUrl || BAZAAR_JAFFA_PROPERTY_ID;
  const fromBookingPid = (bookingCtx?.property_id || '').trim();
  const roomIdFromApi = String(room?.id || '').trim();
  const resolvedRoomPropertyId =
    roomIdFromApi && !(/^\d{1,6}$/.test(slugFromUrl) && roomIdFromApi === slugFromUrl)
      ? roomIdFromApi
      : '';
  const effectivePropertyId = fromBookingPid || resolvedRoomPropertyId;
  const guestDisplayName = (bookingCtx?.guest_name || '').trim();
  const roomNumberForMaya = (bookingCtx?.room_number || '').trim() || guestRoomNumberLabel(room);
  const hotelLabel = (bookingCtx?.hotel_name || 'קיסריה').trim();

  const guestViewMode = useMemo(
    () => inferGuestViewMode({ bookingCtx, room, slugFromUrl }),
    [bookingCtx, room, slugFromUrl],
  );
  const propertyTemplate = useMemo(
    () => inferGuestPropertyTemplate({ bookingCtx, room, slugFromUrl }),
    [bookingCtx, room, slugFromUrl],
  );
  const guestSessionKey = useMemo(() => {
    const sid = (effectivePropertyId || slugForFetch || '').trim();
    return sid ? `guest_active_${sid}` : '';
  }, [effectivePropertyId, slugForFetch]);

  useEffect(() => {
    if (!guestSessionKey || typeof sessionStorage === 'undefined') return;
    const stored = sessionStorage.getItem(guestSessionKey) === '1';
    const apiActive =
      String(bookingCtx?.status || bookingCtx?.guest_status || '').toLowerCase() === 'active';
    setGuestSessionActive(stored || apiActive);
  }, [guestSessionKey, bookingCtx]);

  const displayTiles = useMemo(
    () => buildDisplayTiles(propertyTemplate),
    [propertyTemplate],
  );

  useEffect(() => {
    mayaWelcomedRef.current = false;
    guestWelcomeKeyRef.current = '';
    let cancelled = false;
    setGuestContextLoading(true);
    setGuestContextError(null);
    setBookingCtx(null);
    setRoom({ id: '', name: '', description: '', property_type: '', branchSlug: '' });
    (async () => {
      const [b, ri] = await Promise.all([
        getGuestBookingContext(slugForFetch),
        getGuestRoomInfo(slugForFetch),
      ]);
      if (cancelled) return;
      const fromBooking = b.ok && b.property_id;
      if (fromBooking) setBookingCtx(b);
      else setBookingCtx(null);
      setRoom(ri);
      const rid = String(ri?.id || '').trim();
      if (/^\d{1,6}$/.test(slugFromUrl) && rid === slugFromUrl && !fromBooking) {
        setGuestContextError('לא נמצא חדר במערכת. בדקו את הקישור.');
      } else {
        setGuestContextError(null);
      }
      setGuestContextLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [slugForFetch, slugFromUrl]);

  useEffect(() => {
    if (effectivePropertyId && !guestContextLoading) {
      setGuestContextError(null);
    }
  }, [effectivePropertyId, guestContextLoading]);

  const refreshGuestTasks = useCallback(async () => {
    if (!effectivePropertyId || activeTab !== 'requests' || guestContextLoading) {
      return;
    }
    setGuestTasks([]);
    setGuestTasksLoading(true);
    try {
      const list = await getGuestPropertyTasks(effectivePropertyId, { status: 'pending' });
      const seen = new Set();
      const uniq = [];
      for (const t of Array.isArray(list) ? list : []) {
        const id = t?.id != null ? String(t.id) : '';
        if (!id || seen.has(id)) continue;
        seen.add(id);
        uniq.push(t);
      }
      setGuestTasks(uniq);
    } finally {
      setGuestTasksLoading(false);
    }
  }, [effectivePropertyId, activeTab, guestContextLoading]);

  useEffect(() => {
    void refreshGuestTasks();
  }, [refreshGuestTasks]);

  const scheduleDebouncedReplaceInstantAck = useCallback(() => {
    if (mayaTaskAckTimerRef.current) clearTimeout(mayaTaskAckTimerRef.current);
    mayaTaskAckTimerRef.current = setTimeout(() => {
      mayaTaskAckTimerRef.current = null;
      setMayaMessages((prev) => {
        const next = [...prev];
        for (let i = next.length - 1; i >= 0; i -= 1) {
          if (next[i].role === 'maya' && next[i].instant) {
            const cur = next[i];
            if (cur.pendingTileId) {
              next[i] = {
                role: 'maya',
                text: cur.text,
                instant: false,
                pendingTileId: cur.pendingTileId,
                staffCompleteBtn: true,
              };
            } else {
              next[i] = { role: 'maya', text: GUEST_LAST_REQUEST_ACK_HE, instant: false };
            }
            return next;
          }
        }
        return [...next, { role: 'maya', text: GUEST_LAST_REQUEST_ACK_HE }];
      });
    }, 2000);
  }, []);

  const scheduleDebouncedAppendTaskAck = useCallback(() => {
    if (mayaAppendAckTimerRef.current) clearTimeout(mayaAppendAckTimerRef.current);
    mayaAppendAckTimerRef.current = setTimeout(() => {
      mayaAppendAckTimerRef.current = null;
      setMayaMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === 'maya' && last?.text === GUEST_LAST_REQUEST_ACK_HE) return prev;
        return [...prev, { role: 'maya', text: GUEST_LAST_REQUEST_ACK_HE }];
      });
    }, 2000);
  }, []);

  useEffect(() => {
    if (!guestDisplayName) return;
    const key = `${guestViewMode}|${guestDisplayName}|${hotelLabel}`;
    if (guestWelcomeKeyRef.current === key) return;
    guestWelcomeKeyRef.current = key;
    const line = buildMayaPersonaWelcomeHe(guestDisplayName, guestViewMode, hotelLabel);
    setMayaMessages((prev) => {
      if (prev.some((m) => m.role === 'guest')) return prev;
      return [{ role: 'maya', text: line }];
    });
    mayaWelcomedRef.current = true;
  }, [guestDisplayName, guestViewMode, hotelLabel]);

  useEffect(() => {
    const sid = effectivePropertyId || slugForFetch;
    if (sid && room.name) {
      try {
        const stored = JSON.parse(sessionStorage.getItem(GUEST_WELCOME_KEY) || '{}');
        stored[sid] = { roomName: room.name, lastVisit: Date.now() };
        sessionStorage.setItem(GUEST_WELCOME_KEY, JSON.stringify(stored));
      } catch (_) {}
    }
  }, [slugForFetch, effectivePropertyId, room.name]);

  const createTask = useCallback(
    async (payload, options = {}) => {
      const { busyKey = null, kobiTileId: kobiTileIdOpt = null } = options;
      if (!canProceedGuestAction() || !effectivePropertyId || guestContextLoading) return null;
      const rn = guestRoomNumberLabel(room);
      const p = {
        property_id: effectivePropertyId,
        property_name: room.name,
        ...(rn ? { room_number: rn } : {}),
        ...(guestDisplayName ? { guest_name: guestDisplayName } : {}),
        ...payload,
      };
      const taskKey = payload.description || 'task';
      const bKey = busyKey || taskKey;
      const kobiId = kobiTileIdOpt || (typeof busyKey === 'string' ? busyKey : null);
      const kobiLine = kobiId ? GUEST_PROGRESS_ACK_HE : null;
      const instantText = kobiLine || getInstantMayaForGuestTask(payload);
      const mayaExtra =
        kobiId && kobiLine
          ? { pendingTileId: kobiId, staffCompleteBtn: true }
          : {};

      if (kobiId && kobiLine) {
        setPendingTiles((prev) => ({ ...prev, [kobiId]: true }));
        speakMayaReply(instantText, 'guest', {});
      }
      setInstantAckTileId(bKey);
      setMayaMessages((prev) => [
        ...prev,
        { role: 'maya', text: instantText, instant: true, ...mayaExtra },
      ]);
      setGuestTileBusy(bKey);
      try {
        const created = await createGuestTask(p);
        if (created?.duplicate) {
          if (mayaTaskAckTimerRef.current) {
            clearTimeout(mayaTaskAckTimerRef.current);
            mayaTaskAckTimerRef.current = null;
          }
          const dupMsg =
            created.guest_reply ||
            created.message ||
            'כבר רשמתי את הבקשה הקודמת, זה בטיפול!';
          setMayaMessages((prev) => {
            const next = [...prev];
            for (let i = next.length - 1; i >= 0; i -= 1) {
              if (next[i].role === 'maya' && next[i].instant) {
                next[i] = {
                  role: 'maya',
                  text: dupMsg,
                  instant: false,
                  ...(next[i].pendingTileId
                    ? {
                        pendingTileId: next[i].pendingTileId,
                        staffCompleteBtn: true,
                      }
                    : {}),
                };
                break;
              }
            }
            return next;
          });
          showToast(dupMsg);
          return created;
        }
        setToast(null);
        scheduleDebouncedReplaceInstantAck();
        notifyTasksChanged({ task: created?.task });
        void refreshGuestTasks();
        return created;
      } catch (e) {
        if (mayaTaskAckTimerRef.current) {
          clearTimeout(mayaTaskAckTimerRef.current);
          mayaTaskAckTimerRef.current = null;
        }
        setMayaMessages((prev) => prev.filter((m) => !(m.role === 'maya' && m.instant)));
        if (kobiId) {
          setPendingTiles((prev) => {
            const next = { ...prev };
            delete next[kobiId];
            return next;
          });
        }
        showToast(sanitizeGuestVisibleMessage(e?.message));
        return null;
      } finally {
        setGuestTileBusy(null);
        setTimeout(() => setInstantAckTileId(null), 2600);
      }
    },
    [
      canProceedGuestAction,
      effectivePropertyId,
      room,
      guestDisplayName,
      showToast,
      guestContextLoading,
      scheduleDebouncedReplaceInstantAck,
      refreshGuestTasks,
    ]
  );

  const completeStaffTile = useCallback((tileId) => {
    if (!tileId) return;
    setPendingTiles((prev) => {
      const next = { ...prev };
      delete next[tileId];
      return next;
    });
    setMayaMessages((prev) => {
      const mapped = prev.map((m) =>
        m.pendingTileId === tileId
          ? { ...m, pendingTileId: undefined, staffCompleteBtn: false }
          : m,
      );
      return [...mapped, { role: 'maya', text: MAYA_STAFF_DONE_LINE }];
    });
    speakMayaReply(MAYA_STAFF_DONE_LINE, 'guest', {});
  }, []);

  const sendMayaChat = useCallback(async () => {
    const text = (mayaInput || '').trim();
    if (
      !text
      || mayaSending
      || !effectivePropertyId
      || guestContextLoading
      || !canProceedGuestAction()
    ) {
      return;
    }
    const staffDoneShort = /^(בוצע|סיימנו|טופל|הושלם|בוצעה|סיימתי)$/i;
    const pendingKeys = Object.keys(pendingTiles);
    if (pendingKeys.length === 1 && staffDoneShort.test(text.trim())) {
      completeStaffTile(pendingKeys[0]);
      setMayaInput('');
      return;
    }
    setMayaSending(true);
    setGuestTileBusy('maya-chat');
    setMayaMessages((prev) => [...prev, { role: 'guest', text }]);
    setMayaInput('');
    try {
      const out = await sendGuestMayaMessage({
        message: text,
        property_id: effectivePropertyId,
        room_number: roomNumberForMaya,
        language: 'he',
        guest_name: guestDisplayName || undefined,
        booking_id: bookingCtx?.booking_id || undefined,
        hotel_name: hotelLabel,
      });
      const replyRaw =
        out.reply ?? out.message ?? out.displayMessage ?? out.maya_reply ?? '';
      const replyLine = sanitizeGuestVisibleMessage(replyRaw);
      if (replyLine) {
        setMayaMessages((prev) => [...prev, { role: 'maya', text: replyLine }]);
      }
      if (out.task_created && !out.duplicate) {
        scheduleDebouncedAppendTaskAck();
        notifyTasksChanged({ task: out.task });
        void refreshGuestTasks();
        showToast('Request sent — הבקשה נשלחה');
      } else if (out.task_created) {
        notifyTasksChanged({ task: out.task });
        void refreshGuestTasks();
      }
    } catch (e) {
      if (mayaAppendAckTimerRef.current) {
        clearTimeout(mayaAppendAckTimerRef.current);
        mayaAppendAckTimerRef.current = null;
      }
      showToast(sanitizeGuestVisibleMessage(e?.message));
    } finally {
      setMayaSending(false);
      setGuestTileBusy(null);
    }
  }, [
    mayaInput,
    mayaSending,
    effectivePropertyId,
    roomNumberForMaya,
    guestDisplayName,
    bookingCtx,
    hotelLabel,
    showToast,
    canProceedGuestAction,
    guestContextLoading,
    scheduleDebouncedAppendTaskAck,
    refreshGuestTasks,
    pendingTiles,
    completeStaffTile,
  ]);

  const handleGuestCheckIn = useCallback(() => {
    if (!guestSessionKey || !effectivePropertyId) return;
    try {
      sessionStorage.setItem(guestSessionKey, '1');
    } catch (_) {
      /* noop */
    }
    setGuestSessionActive(true);
    void createTask(
      {
        description: `צ'ק-אין אורח — ${guestDisplayName || 'אורח'} (${roomNumberForMaya || room.name || ''})`,
        task_type: 'Service',
        staff_name: 'קבלה',
      },
      { busyKey: 'checkin' },
    );
  }, [
    guestSessionKey,
    effectivePropertyId,
    guestDisplayName,
    roomNumberForMaya,
    room.name,
    createTask,
  ]);

  const handleTileClick = useCallback(
    (tile) => {
      if (!effectivePropertyId || guestContextLoading) return;
      if (tile.id === 'checkout' && !guestSessionActive) {
        if (!canProceedGuestAction()) return;
        handleGuestCheckIn();
        return;
      }
      if (tile.action === 'maintenance_modal') {
        if (!canProceedGuestAction()) return;
        setMaintenanceNotes('');
        setModal('maintenance');
        return;
      }
      if (tile.action === 'room_service_menu') {
        if (!canProceedGuestAction()) return;
        setModal('room_service');
        return;
      }
      if (tile.action === 'spa_menu') {
        if (!canProceedGuestAction()) return;
        setModal('spa');
        return;
      }
      if (tile.modal) {
        if (!canProceedGuestAction()) return;
        if (tile.id === 'checkout' && !guestSessionActive) return;
        setModal(tile.modal);
        return;
      }
      if (!tile.taskType || !canProceedGuestAction()) return;
      createTask(
        {
          description: tile.description || tile.label,
          task_type: tile.taskType,
          ...(tile.staff_name ? { staff_name: tile.staff_name } : {}),
        },
        { busyKey: tile.id, kobiTileId: tile.id },
      );
    },
    [
      effectivePropertyId,
      guestContextLoading,
      canProceedGuestAction,
      createTask,
      guestSessionActive,
      handleGuestCheckIn,
    ],
  );

  const handleCheckoutRequest = useCallback(() => {
    const isOfficeLike = propertyTemplate === 'office' || propertyTemplate === 'meeting_room';
    createTask(
      {
        description: isOfficeLike ? 'בקשת סיום מפגש / End session' : 'בקשת צ\'ק-אאוט',
        task_type: 'Service',
      },
      { busyKey: 'checkout', kobiTileId: 'checkout' },
    );
    setModal(null);
  }, [createTask, propertyTemplate]);

  const submitMaintenanceIntake = useCallback(async () => {
    const text = (maintenanceNotes || '').trim();
    if (!text || !canProceedGuestAction()) return;
    await createTask(
      {
        description: `תחזוקה (אורח): ${text}`,
        task_type: 'Maintenance',
        status: 'Waiting',
      },
      { busyKey: 'maintenance_intake' },
    );
    setMaintenanceNotes('');
    setModal(null);
  }, [maintenanceNotes, canProceedGuestAction, createTask]);

  const orderRoomServiceItem = useCallback(
    async (item) => {
      if (!item?.description || !canProceedGuestAction()) return;
      await createTask(
        {
          description: item.description,
          task_type: 'Service',
          priority: 'high',
        },
        { busyKey: item.id },
      );
    },
    [canProceedGuestAction, createTask],
  );

  const orderSpaWhatsApp = useCallback(
    (item) => {
      if (!item?.labelHe) return;
      const head = `${hotelLabel} — ${guestDisplayName || 'אורח'} — חדר ${roomNumberForMaya || room.name || ''}`;
      const msg = `בקשת ספא: ${item.labelHe}\n${head}`;
      const ok = openGuestManagerWhatsAppPrefilled(msg);
      if (!ok) {
        showToast(
          getGuestManagerWhatsAppDigits()
            ? 'לא ניתן לפתוח וואטסאפ'
            : 'מספר מנהל לא הוגדר (REACT_APP_GUEST_MANAGER_WHATSAPP) — פנו לקבלה.',
        );
      } else {
        showToast('נפתח וואטסאפ למנהל');
      }
      setModal(null);
    },
    [hotelLabel, guestDisplayName, roomNumberForMaya, room.name, showToast],
  );

  const roomDisplay = room.name || effectivePropertyId || slugForFetch || '';
  const headerWelcome = guestDisplayName
    ? `ברוך הבא, ${guestDisplayName} — חדר ${roomNumberForMaya || roomDisplay}`
    : `ברוך הבא לחדר ${roomDisplay}!`;

  useEffect(() => {
    if (guestChatOpen && guestChatPanelRef.current) {
      try {
        guestChatPanelRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } catch (_) {
        /* noop */
      }
    }
  }, [guestChatOpen]);

  return (
    <div className="guest-dashboard" dir="rtl">
      <div className="guest-bg" style={{ backgroundImage: `url(${BG_IMAGE})` }} />
      <div className="guest-overlay" />
      <div className="guest-content">
        <header className="guest-header guest-header-centered">
          <div className="guest-header-row">
            <img src={easyhostLogoDark} alt="" className="guest-logo guest-logo-dark" />
            <h1 className="guest-title">EasyHost AI</h1>
          </div>
          <div className="guest-welcome">
            <p className="guest-welcome-line1">{headerWelcome}</p>
            <p className="guest-welcome-line2">מאיה והצוות {hotelLabel} לשירותך</p>
          </div>
        </header>

        {guestContextLoading ? (
          <div className="guest-context-loading">
            <div className="guest-spinner" aria-hidden />
            <p>טוען…</p>
          </div>
        ) : !effectivePropertyId && guestContextError ? (
          <div className="guest-context-loading">
            <p className="guest-context-error" role="alert">
              {guestContextError}
            </p>
          </div>
        ) : activeTab === 'requests' ? (
          <div style={{ width: '100%', maxWidth: 520, padding: '8px 16px 100px', boxSizing: 'border-box' }}>
            <p style={{ color: '#fff', fontSize: 15, fontWeight: 700, margin: '0 0 12px', textAlign: 'center' }}>
              בקשות פתוחות לחדר
            </p>
            {guestTasksLoading ? (
              <div className="guest-context-loading" style={{ minHeight: 120 }}>
                <div className="guest-spinner" aria-hidden />
                <p>טוען…</p>
              </div>
            ) : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {(!Array.isArray(guestTasks) || guestTasks.length === 0) && (
                  <li style={{ color: 'rgba(255,255,255,0.85)', textAlign: 'center', padding: 24, fontSize: 14 }}>
                    אין בקשות ממתינות כרגע.
                  </li>
                )}
                {Array.isArray(guestTasks) &&
                  guestTasks
                    .filter((t) => t && t.id != null && String(t.id).trim() !== '')
                    .map((t) => {
                    const tid = String(t.id);
                    const desc = String(t?.description ?? t?.title ?? '').trim() || 'בקשה';
                    return (
                      <li
                        key={tid}
                        style={{
                          background: 'rgba(255,255,255,0.12)',
                          borderRadius: 12,
                          padding: '12px 14px',
                          marginBottom: 10,
                          color: '#fff',
                          fontSize: 14,
                        }}
                      >
                        <div style={{ fontWeight: 700, marginBottom: 4 }}>{desc}</div>
                        <div style={{ fontSize: 12, opacity: 0.85 }}>{guestFacingRequestStatusHe(t?.status)}</div>
                      </li>
                    );
                  })}
              </ul>
            )}
          </div>
        ) : activeTab === 'profile' ? (
          <div
            className="guest-profile-wrap"
            style={{ width: '100%', maxWidth: 520, padding: '8px 16px 100px', boxSizing: 'border-box' }}
          >
            <p style={{ color: '#fff', fontSize: 15, fontWeight: 700, margin: '0 0 16px', textAlign: 'center' }}>
              פרופיל אורח
            </p>
            <div
              style={{
                background: 'rgba(255,255,255,0.12)',
                borderRadius: 16,
                padding: '16px 18px',
                color: '#fff',
                fontSize: 14,
                lineHeight: 1.6,
              }}
            >
              <p style={{ margin: '0 0 8px' }}>
                <strong>שם:</strong> {guestDisplayName || 'אורח'}
              </p>
              <p style={{ margin: '0 0 8px' }}>
                <strong>חדר:</strong> {roomNumberForMaya || roomDisplay || '—'}
              </p>
              <p style={{ margin: 0 }}>
                <strong>מלון:</strong> {hotelLabel}
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className="guest-home-center">
              <div className="guest-unified-grid-wrap guest-unified-grid-wrap--solo">
                <div
                  className="guest-grid guest-grid--responsive"
                >
                  {displayTiles.map((tile) => {
                    const isOfficeLike =
                      propertyTemplate === 'office' || propertyTemplate === 'meeting_room';
                    const isChameleonCheckout = tile.id === 'checkout';
                    let displayLabel = tile.label;
                    let imageKeyForUrl = tile.imageKey;
                    if (isChameleonCheckout) {
                      if (!guestSessionActive) {
                        displayLabel = isOfficeLike ? 'התחלת מפגש' : "צ'ק-אין";
                        imageKeyForUrl = 'reception';
                      } else {
                        displayLabel = isOfficeLike ? 'סיום מפגש' : "צ'ק-אאוט";
                        imageKeyForUrl = 'checkout';
                      }
                    }
                    const imgSrc = TILE_IMAGES[imageKeyForUrl] || TILE_IMAGES.dining;
                    const taskKey = tile.description || tile.label;
                    const tileBusy =
                      guestTileBusy === tile.id
                      || (tile.id === 'checkout' && guestTileBusy === 'checkin');
                    const isPending = Boolean(pendingTiles[tile.id]);
                    const showInstantSent =
                      !isPending
                      && (instantAckTileId === tile.id || instantAckTileId === taskKey);
                    return (
                      <button
                        key={tile.id}
                        type="button"
                        className={`guest-tile ${
                          isPending ? 'guest-tile--pending' : ''
                        } ${
                          isChameleonCheckout && guestSessionActive && !isPending
                            ? 'guest-tile--checkout-armed'
                            : ''
                        }`}
                        onClick={() => handleTileClick(tile)}
                        disabled={
                          Boolean(guestTileBusy) || guestContextLoading || !effectivePropertyId
                        }
                        aria-label={displayLabel}
                        aria-busy={tileBusy}
                      >
                        <div
                          className="guest-tile-img-wrap guest-tile-img-wrap--cover"
                          style={{ backgroundImage: `url(${imgSrc})` }}
                          role="presentation"
                        />
                        <span className="guest-tile-label">{displayLabel}</span>
                        {showInstantSent && <span className="guest-tile-sent">✓ נשלח</span>}
                        {tileBusy && !showInstantSent && (
                          <span className="guest-tile-loading">טוען…</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {!guestChatOpen && (
              <button
                type="button"
                className="guest-chat-fab"
                onClick={() => setGuestChatOpen(true)}
                aria-label="צ'אט עם מאיה"
              >
                <MessageCircle size={28} strokeWidth={2} aria-hidden />
              </button>
            )}

            {guestChatOpen && (
              <div className="guest-chat-overlay" role="dialog" aria-modal="true" aria-labelledby="guest-chat-title">
                <button
                  type="button"
                  className="guest-chat-overlay-backdrop"
                  aria-label="סגור צ'אט"
                  onClick={() => setGuestChatOpen(false)}
                />
                <aside ref={guestChatPanelRef} className="guest-unified-chat guest-chat-panel">
                  <div className="guest-chat-panel-header">
                    <span id="guest-chat-title" className="guest-chat-panel-title">
                      מאיה — צ'אט
                    </span>
                    <button
                      type="button"
                      className="guest-chat-panel-close"
                      onClick={() => setGuestChatOpen(false)}
                      aria-label="סגור"
                    >
                      <X size={22} />
                    </button>
                  </div>
                  <p className="guest-unified-chat-hint">
                    {guestViewMode === 'workspace'
                      ? 'מאיה כאן — בחרו שירות לחדר הישיבות או כתבו הודעה.'
                      : 'מאיה כאן — כתבו הודעה או בחרו שירות מהרשת. אין צורך לציין מספר חדר.'}
                  </p>
                  <div className="guest-maya-scroll">
                    {mayaMessages.length === 0 && (
                      <div className="guest-maya-empty">הודעה ראשונה? כתבו למטה.</div>
                    )}
                    {mayaMessages.map((m, i) => (
                      <div
                        key={`m-${i}-${m.role}-${m.pendingTileId || ''}`}
                        className={`guest-maya-row ${m.role === 'guest' ? 'guest-maya-row--guest' : 'guest-maya-row--maya'}`}
                      >
                        <span className="guest-maya-bubble">{m.text}</span>
                        {m.role === 'maya' && m.staffCompleteBtn && m.pendingTileId && (
                          <button
                            type="button"
                            className="guest-staff-done-btn"
                            onClick={() => completeStaffTile(m.pendingTileId)}
                          >
                            סימנתי כבוצע (צוות)
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="guest-maya-input-row">
                    <input
                      type="text"
                      className="guest-maintenance-input guest-maya-input"
                      placeholder="כתוב הודעה…"
                      value={mayaInput}
                      onChange={(e) => setMayaInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMayaChat()}
                      disabled={mayaSending || Boolean(guestTileBusy) || guestContextLoading || !effectivePropertyId}
                    />
                    <button
                      type="button"
                      className="guest-maya-send"
                      onClick={sendMayaChat}
                      disabled={
                        mayaSending
                        || !mayaInput.trim()
                        || Boolean(guestTileBusy)
                        || guestContextLoading
                        || !effectivePropertyId
                      }
                    >
                      {mayaSending ? 'טוען…' : 'שלח'}
                    </button>
                  </div>
                </aside>
              </div>
            )}
          </>
        )}

        <nav className="guest-tabbar">
          {TAB_ITEMS.map((tab) => {
            const TabIcon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                className={`guest-tab ${activeTab === tab.id ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
                aria-label={tab.label}
              >
                <TabIcon size={24} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {modal === 'checkout' && (
        <div className="guest-modal-backdrop" onClick={() => setModal(null)}>
          <div className="guest-modal" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="guest-modal-close" onClick={() => setModal(null)} aria-label="סגור">
              <X size={24} />
            </button>
            <h2 className="guest-modal-title">
              {propertyTemplate === 'hotel' ? "צ'ק-אאוט" : 'סיום מפגש'}
            </h2>
            <p className="guest-modal-text">
              {propertyTemplate === 'hotel' ? "שעת צ'ק-אאוט: 11:00" : 'סיום שימוש בחלל / בחדר הישיבות.'}
            </p>
            <button type="button" className="guest-modal-btn" onClick={handleCheckoutRequest}>
              {propertyTemplate === 'hotel' ? "בקש צ'ק-אאוט" : 'סיים מפגש'}
            </button>
          </div>
        </div>
      )}

      {modal === 'maintenance' && (
        <div className="guest-modal-backdrop" onClick={() => setModal(null)}>
          <div className="guest-modal guest-modal--tall" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="guest-modal-close" onClick={() => setModal(null)} aria-label="סגור">
              <X size={24} />
            </button>
            <h2 className="guest-modal-title">תחזוקה</h2>
            <p className="guest-modal-text">תארו בקצרה מה צרי�� לטפל בו — נשלח לצוות כבקשה ממתינה.</p>
            <textarea
              className="guest-modal-textarea"
              dir="rtl"
              rows={4}
              value={maintenanceNotes}
              onChange={(e) => setMaintenanceNotes(e.target.value)}
              placeholder="לדוגמה: נורה לא נדלקת במסדרון…"
            />
            <button
              type="button"
              className="guest-modal-btn"
              disabled={!maintenanceNotes.trim() || Boolean(guestTileBusy)}
              onClick={() => void submitMaintenanceIntake()}
            >
              שלח לתחזוקה
            </button>
          </div>
        </div>
      )}

      {modal === 'room_service' && (
        <div className="guest-modal-backdrop" onClick={() => setModal(null)}>
          <div className="guest-modal guest-modal--scroll" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="guest-modal-close" onClick={() => setModal(null)} aria-label="סגור">
              <X size={24} />
            </button>
            <h2 className="guest-modal-title">שירות חדר</h2>
            <p className="guest-modal-text">
              {'\u05D1\u05D7\u05E8\u05D5 \u05E4\u05E8\u05D9\u05D8 \u2014 \u05E0\u05E9\u05DC\u05D7 \u05DB\u05DE\u05E9\u05D9\u05DE\u05D4 \u05D1\u05E2\u05D3\u05D9\u05E4\u05D5\u05EA \u05D2\u05D1\u05D5\u05D4\u05D4.'}
            </p>
            <ul className="guest-modal-menu">
              {GUEST_ROOM_SERVICE_MENU.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className="guest-modal-menu-btn"
                    disabled={Boolean(guestTileBusy)}
                    onClick={() => void orderRoomServiceItem(item)}
                  >
                    {item.labelHe}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {modal === 'spa' && (
        <div className="guest-modal-backdrop" onClick={() => setModal(null)}>
          <div className="guest-modal guest-modal--scroll" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="guest-modal-close" onClick={() => setModal(null)} aria-label="סגור">
              <X size={24} />
            </button>
            <h2 className="guest-modal-title">ספא</h2>
            <p className="guest-modal-text">הזמנה נשלחת למנהל בוואטסאפ.</p>
            <ul className="guest-modal-menu">
              {GUEST_SPA_SERVICES.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className="guest-modal-menu-btn"
                    onClick={() => orderSpaWhatsApp(item)}
                  >
                    <span className="guest-modal-menu-label">{item.labelHe}</span>
                    <span className="guest-modal-menu-cta">הזמן עכשיו</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {toast && <GuestToast message={toast} onClose={() => setToast(null)} />}
    </div>
  );
}

function GuestDashboardWithBoundary({ roomId }) {
  return (
    <GuestErrorBoundary>
      <GuestDashboard roomId={roomId} />
    </GuestErrorBoundary>
  );
}

export default GuestDashboardWithBoundary;
