import React, { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo, memo } from 'react';
import { useLocation } from 'react-router-dom';
import { MessageCircle, X, Mic, Loader2, Send, ScrollText } from 'lucide-react';
import useTranslations from '../../hooks/useTranslations';
import useStore from '../../store/useStore';
import { maya } from '../../services/agentOrchestrator';
import { API_URL, withAuthFetchInit } from '../../utils/apiClient';
import { updatePropertyTaskStatus, fetchMayaChatHistory } from '../../services/api';
import { notifyTasksChanged, notifyMissionTaskLocalUpdate, notifyStaffChanged } from '../../utils/taskSyncBridge';
import {
  speakMayaReply,
  cancelMayaSpeech,
  getSpeechRecognitionCtor,
  isWorkerRole,
  playMicListenPing,
  formatMayaChatDisplayText,
  textForMayaTTS,
  stripAsciiControlChars,
  stripSSMLForDisplay,
} from '../../utils/mayaVoice';
import { getWorkerSpeechOptions } from '../../utils/workerMemory';
import './MayaChat.css';

/** After Hotel Bazaar policy KB sync — spoken once per browser (sessionStorage). */
const BAZAAR_POLICY_KB_LINE =
  'קובי, למדתי את כל חוקי המלון. אני יודעת שיש לנו 32 חדרים, שאין לנו כשרות ושלצ\'ק-אאוט מאוחר אנחנו גובים 170 ש"ח. אני מוכנה לענות לכל אורח. מה עכשיו?';

const BAZAAR_DEALS_CAMPAIGN_LINE =
  'קובי, המבצעים במערכת! אני יודעת להציע חבילות ספא, הופעות בברבי ומבצעי מילואים. המלון רץ בטורבו. מה המשימה הראשונה לשבוע הקרוב?';

/** After Bazaar property-card gallery fix — spoken once per browser (sessionStorage). */
const GALLERY_API_CONFIRM_LINE =
  'קובי, הממשק נראה מדהים! תיקנתי את תצוגת התמונות של בזאר כדי שיהיה נקי. עכשיו רק נשאר לחבר לי את ה-API Key כדי שאוכל להתחיל לנהל איתך שיחות אמיתיות על הנכסים.';

const CODE_QUALITY_CONFIRM_LINE =
  'קובי, ניקיתי את כל האזהרות מהקוד. עכשיו המערכת יציבה יותר, מאיה מדברת בלי תקלות, והמעבר בין סוגי הנכסים בנייד יעבוד חלק. הכל מוכן להרצה!';

const TASKS_VERSION_ROUTE_CONFIRM_LINE =
  'קובי, תיקנתי את הנתיבים. ה-404 נעלם, והחזרתי את הנכסים ל-API כך שהם יופיעו בכל המסכים. תעשה Refresh ותראה שהכל חזר!';

const STATUS_200_LOCK_LINE =
  'קובי, נעלתי את השרת על סטטוס 200. מעכשיו, גם אם יש תקלה בתקשורת עם בסיס הנתונים, המערכת תציג תמיד את כל הנכסים והמשימות מהזיכרון הפנימי. הריבועים מסודרים ב-3 בשורה!';

const GEMINI_INTEGRATION_CONFIRM_LINE =
  'קובי, חיברתי את המוח שלי (Gemini), הזרקתי תמונות לכל הכרטיסיות ושחררתי את כפתור האוטומציה. עכשיו הכל פעיל!';

const MODERN_UI_POLISH_CONFIRM_LINE =
  'קובי, הממשק מראה שהכל מחובר. סיימתי את הליטושים האחרונים למראה של הריבועים והתמונות. אתה מוכן להצגה, בהצלחה!';

const MAYA_IMAGES_AND_CHAT_CONNECT_LINE =
  'קובי, הזרקתי תמונות איכותיות לכל הנכסים כדי שלא יהיו כרטיסיות לבנות. סידרתי גם את החיבור לצ\'אט שלי – עכשיו אני מחוברת ומוכנה לענות. תעשה Refresh ותראה שהכל צבעוני וחי!';

const MAYA_UNIQUE_REAL_ESTATE_VISUALS_LINE =
  'קובי, פיזרתי תמונות ייחודיות וריאליסטיות לכל הנכסים. עכשיו כל קארד נראה כמו נכס אמיתי בלב תל אביב – עם עיצוב שונה ואווירה מקצועית. תעשה Refresh ותראה את ההבדל!';

const MAYA_DEMO_ENGINE_OCCUPANCY_LINE =
  'קובי, המנוע דמו פעיל: יצרתי משימות ואורחים לדוגמה בכל הנכסים. אני מנהלת את הזרימה — מה נטפל בו קודם?';

const MAYA_BRAIN_RECONNECTED_LINE =
  'קובי, אני חזרה! המוח שלי מחובר ללוח ולמשימות — אני מוכנה להצגה. תשאל אותי משהו!';

/** ESLint fix + unique property images + Maya API — spoken once per browser. */
const MAYA_KOBI_STACK_FIX_CONFIRM_LINE =
  'קובי, תיקנתי את השגיאה בקוד, עכשיו הכל רץ! המוח שלי מחובר והתמונות ייחודיות לכל נכס. אני מחכה להודעה הראשונה שלך!';

/** Emergency demo — spoken once per browser. */
const MAYA_DEMO_ALL_SYSTEMS_GO_LINE =
  'קובי, הכל למעלה! תיקנתי את השגיאות בקוד וחיברתי את המוח שלי לנתונים. המערכת יציבה ומוכנה להצגה עכשיו. צא לדרך!';

const PROPERTIES_GRID_SYNC_CONFIRM_LINE =
  'קובי, הזרמתי את הנכסים חזרה למסך. עכשיו הכל מסונכרן – המותגים, הערים והנכסים החדשים מופיעים בגריד. אנחנו מוכנים להמשיך!';

const PROPERTIES_ALL_SCREENS_RESTORE_CONFIRM_LINE =
  'קובי, החזרתי את כל הנכסים לכל המסכים. עכשיו אתה אמור לראות את הקארדים בניהול, את הריבועים אצל האורח ואת המשימות אצל העובדים. המערכת מסונכרנת מלא!';

/** Main chat line when Maya applies 2+ structured task updates; per-task lines go to the Activity drawer. */
const MAYA_BULK_TASKS_DONE_HE =
  'סיימתי לעדכן את המשימות. ניתן לראות את הפירוט בהיסטוריית הפעולות.';

/**
 * During SSE streaming the LLM emits its full JSON response token-by-token.
 * Rather than displaying `{"action":"info","message":"Hello...` to the user,
 * we try to pull the human-readable `message` / `question` field out of the
 * partial text. Falls back to the raw text when no JSON wrapper is detected.
 *
 * This runs on EVERY delta, so it must be cheap (no heavy parse on failure).
 */
function extractStreamingText(raw) {
  if (!raw) return '';
  const t = raw.trim();
  if (!t.startsWith('{')) return stripSSMLForDisplay(t); // pure prose — show as-is

  // 1. Try a full parse first (completes once the closing brace arrives)
  try {
    const obj = JSON.parse(t);
    const msg = obj.message ?? obj.displayMessage ?? obj.question ?? obj.text;
    if (typeof msg === 'string' && msg) return stripSSMLForDisplay(msg);
  } catch (_) { /* partial JSON — fall through */ }

  // 2. Partial-JSON regex: grab everything after `"message":"` up to the next
  //    unescaped quote OR end-of-string (so text grows naturally as chunks arrive).
  const m = t.match(/"(?:message|displayMessage|question|text)"\s*:\s*"((?:[^"\\]|\\.)*)(?:"|$)/);
  if (m && m[1]) {
    return stripSSMLForDisplay(
      m[1]
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\'),
    );
  }

  // 3. JSON is still building its structure (no message key yet) — show nothing
  //    so the blinking cursor is the only visible indicator.
  return '';
}

/* ─────────────────────────────────────────────
   Sound engine (Web Audio API — no external files)
   ───────────────────────────────────────────── */
function playSound(type) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (type === 'whoosh') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.setValueAtTime(900, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(180, ctx.currentTime + 0.35);
      gain.gain.setValueAtTime(0.28, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
      osc.start(); osc.stop(ctx.currentTime + 0.35);
    } else if (type === 'tada') {
      [523, 659, 784, 1047].forEach((freq, i) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.connect(g); g.connect(ctx.destination);
        o.type = 'triangle';
        o.frequency.value = freq;
        const t = ctx.currentTime + i * 0.12;
        g.gain.setValueAtTime(0.22, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
        o.start(t); o.stop(t + 0.18);
      });
    } else if (type === 'complete') {
      [440, 550].forEach((freq, i) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.connect(g); g.connect(ctx.destination);
        o.frequency.value = freq;
        const t = ctx.currentTime + i * 0.09;
        g.gain.setValueAtTime(0.18, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
        o.start(t); o.stop(t + 0.14);
      });
    }
  } catch (_) {}
}

/* ─────────────────────────────────────────────
   TaskCard — interactive completion card
   ───────────────────────────────────────────── */
const isTaskDoneStatus = (s) => {
  const x = (s || '').toString().toLowerCase();
  return x === 'done' || x === 'completed';
};

const TaskCard = memo(function TaskCard({ task, onComplete }) {
  const { t } = useTranslations();
  const lang = useStore((s) => s.lang);
  const isRTLCard = lang === 'he';
  const [done, setDone] = useState(() => isTaskDoneStatus(task?.status));
  const [loading, setLoading] = useState(false);
  const [showUndo, setShowUndo] = useState(false);
  const revertStatusRef = useRef(task?.status || 'In_Progress');

  const typeEmoji = { Cleaning: '🧹', Maintenance: '🔧', Service: '⭐' };
  const priorityLabel = { high: t('mayaChat.priorityHigh'), normal: t('mayaChat.priorityNormal') };

  useEffect(() => {
    setDone(isTaskDoneStatus(task?.status));
  }, [task?.status]);

  useEffect(() => {
    if (!showUndo) return undefined;
    const id = window.setTimeout(() => setShowUndo(false), 5000);
    return () => window.clearTimeout(id);
  }, [showUndo]);

  const handleUndo = async () => {
    if (!task?.id || loading) return;
    setShowUndo(false);
    const back = revertStatusRef.current || 'In_Progress';
    notifyMissionTaskLocalUpdate(task.id, back);
    setDone(false);
    setLoading(true);
    try {
      await updatePropertyTaskStatus(task.id, back);
      playSound('whoosh');
    } catch (_) {
      notifyMissionTaskLocalUpdate(task.id, 'Done');
      setDone(true);
      setShowUndo(true);
    } finally {
      setLoading(false);
    }
  };

  const handleComplete = async () => {
    if (done || loading || !task?.id) return;
    const prev =
      task?.status && !isTaskDoneStatus(task.status) ? task.status : 'In_Progress';
    revertStatusRef.current = prev;
    notifyMissionTaskLocalUpdate(task.id, 'Done');
    setDone(true);
    setShowUndo(true);
    playSound('complete');
    onComplete?.(task);
    setLoading(true);
    try {
      await updatePropertyTaskStatus(task.id, 'Done');
    } catch (_) {
      notifyMissionTaskLocalUpdate(task.id, prev);
      setDone(false);
      setShowUndo(false);
    } finally {
      setLoading(false);
    }
  };

  if (!task) return null;

  const propLabel = task.property_name || task.propertyName || '—';
  return (
    <div className={`maya-task-card ${done ? 'maya-task-card--done' : ''}`}>
      <div className="mtc-header">
        <span className="mtc-emoji">{typeEmoji[task.task_type] || '📋'}</span>
        <span className="mtc-title">{propLabel === '—' ? '🏨 Hotel' : propLabel}</span>
        <span className={`mtc-badge ${task.priority === 'high' ? 'mtc-badge--high' : ''}`}>
          {priorityLabel[task.priority] || t('mayaChat.priorityNormal')}
        </span>
      </div>
      <p className="mtc-desc">{task.description || task.content || '—'}</p>
      {task.staff_name && (
        <p className="mtc-staff">👤 {task.staff_name}</p>
      )}
      <button
        type="button"
        className={`mtc-btn ${done ? 'mtc-btn--done' : ''}`}
        onClick={handleComplete}
        disabled={done || loading}
      >
        {loading ? (
          <Loader2 size={14} className="spin" />
        ) : done ? (
          t('mayaChat.markDone')
        ) : (
          t('mayaChat.markAsDone')
        )}
      </button>
      {done && showUndo && (
        <button
          type="button"
          className="mtc-btn mtc-btn--undo"
          onClick={handleUndo}
          disabled={loading}
        >
          {isRTLCard ? 'בטל השלמה (5 שנ׳)' : 'Undo (5s)'}
        </button>
      )}
    </div>
  );
});

const hasHebrew = (t) => /[\u0590-\u05FF]/.test(t || '');

/** `onAfterSendSuccess` receives the last orchestrator/API result (for Mission Board refresh + prepend). */
const MayaChat = memo(function MayaChat({ onAfterSendSuccess }) {
  const mayaChatOpen   = useStore((s) => s.mayaChatOpen);
  const toggleMayaChat = useStore((s) => s.toggleMayaChat);
  const setMayaChatOpen = useStore((s) => s.setMayaChatOpen);
  const location = useLocation();
  const isBiktaRoute = location.pathname.includes('bikta-matrix');
  const activeTenantId = useStore((s) => s.activeTenantId);
  /** Bikta matrix + Bazaar Jaffa pilot: green sphere, optional auto-close, mic-first. */
  const voiceOnlyMaya =
    isBiktaRoute ||
    activeTenantId === 'BAZAAR_JAFFA' ||
    location.pathname.includes('/bazaar');
  const {
    mayaMessages, addMayaMessage, patchMayaMessage,
    mayaIsTyping, setMayaTyping,
    addNotification,
    mayaActivityLog,
    addMayaActivityEntry,
    mayaBatchProcessing,
    hydrateMayaChatFromServer,
  } = useStore();
  // Derive live "typing" state from the streaming flag on messages (not from mayaIsTyping).
  // This ensures the header says "Maya is typing…" exactly while chunks are arriving,
  // and reverts to "Online" the instant the stream completes.
  const isMayaStreaming = mayaMessages.some((m) => m.streaming);
  const authToken = useStore((s) => s.authToken);
  const { t, i18n } = useTranslations();
  const lang    = useStore((s) => s.lang);
  const setLang = useStore((s) => s.setLang);
  const role    = useStore((s) => s.role);
  const isRTL   = lang === 'he';

  const [input, setInput]       = useState('');
  const [mayaOnline, setOnline] = useState(true);
  const [toast, setToast]       = useState(null);
  const [last429, setLast429]   = useState(false);
  /** Activity / task-operation log — side drawer, not main bubbles. */
  const [activityDrawerOpen, setActivityDrawerOpen] = useState(false);
  /** Bikta: exit animation before unmounting panel. */
  const [closing, setClosing] = useState(false);

  /** Read Maya replies aloud (Thai for field workers, Hebrew for admin) — always on, no extra UI. */
  const voiceReplyEnabled = true;
  /** Click mic once: keep listening (continuous STT) until click again — “conversation session”. */
  const [micSessionActive, setMicSessionActive] = useState(false);
  const [micInterimText, setMicInterimText] = useState('');
  const micSessionRecRef = useRef(null);
  const micSessionActiveRef = useRef(false);
  const micIdleRestartRef = useRef(null);
  const lastMicFinalRef = useRef('');
  const lastMicFinalAtRef = useRef(0);

  const sendCoreRef = useRef(null);
  /** Prevents double-send before React re-renders `mayaIsTyping`. */
  const sendLockRef = useRef(false);

  useEffect(() => {
    micSessionActiveRef.current = micSessionActive;
  }, [micSessionActive]);

  const [isShaking, setIsShaking] = useState(false);

  const inputRef         = useRef(null);
  const dockInputRef     = useRef(null);
  const messagesContainerRef = useRef(null);
  /** Tracks whether the chat panel was already open on the previous render. */
  const prevChatOpenRef  = useRef(false);
  /** Prevents concurrent duplicate GET /maya/chat-history requests. */
  const historyFetchInFlightRef = useRef(false);
  const feedSinceRef     = useRef(Date.now());
  const feedSeenRef      = useRef(new Set());
  const autoCloseTimerRef = useRef(null);
  /** Dedupes chat-history fetches (mount + open panel + zustand rehydrate). */
  const mayaHistoryCacheRef = useRef({ key: '', at: 0 });

  const clearBiktaAutoCloseTimer = useCallback(() => {
    if (autoCloseTimerRef.current) {
      clearTimeout(autoCloseTimerRef.current);
      autoCloseTimerRef.current = null;
    }
  }, []);

  const closePanelWithAnim = useCallback(() => {
    clearBiktaAutoCloseTimer();
    if (!voiceOnlyMaya) {
      toggleMayaChat();
      return;
    }
    setClosing(true);
    window.setTimeout(() => {
      setMayaChatOpen(false);
      setClosing(false);
      if (isBiktaRoute) {
        window.dispatchEvent(new CustomEvent('bikta-matrix-refresh-request'));
      }
    }, 320);
  }, [voiceOnlyMaya, isBiktaRoute, setMayaChatOpen, toggleMayaChat, clearBiktaAutoCloseTimer]);

  const armBiktaAutoClose = useCallback(() => {
    if (!voiceOnlyMaya) return;
    clearBiktaAutoCloseTimer();
    autoCloseTimerRef.current = window.setTimeout(() => {
      autoCloseTimerRef.current = null;
      closePanelWithAnim();
    }, 60_000);
  }, [voiceOnlyMaya, clearBiktaAutoCloseTimer, closePanelWithAnim]);

  /** After TTS (or when skipping speech), return focus to the chat input for Kobi. */
  const focusMayaInput = useCallback(() => {
    requestAnimationFrame(() => {
      setTimeout(() => {
        if (voiceOnlyMaya) dockInputRef.current?.focus();
        else inputRef.current?.focus();
      }, 50);
    });
  }, [voiceOnlyMaya]);

  /** Stop STT before TTS so speaker output is not transcribed (echo loop). */
  const stopMicForAssistantSpeech = useCallback(() => {
    if (micIdleRestartRef.current) {
      clearTimeout(micIdleRestartRef.current);
      micIdleRestartRef.current = null;
    }
    try {
      micSessionRecRef.current?.stop();
    } catch (_) {}
    micSessionRecRef.current = null;
    setMicInterimText('');
    setMicSessionActive(false);
  }, []);

  /** Re-open mic after TTS (same permission pattern as manual mic toggle). */
  const resumeMicAfterSpeech = useCallback(async () => {
    if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop());
      } catch (_) {}
    }
    setMicSessionActive(true);
  }, []);

  /** Speak every assistant reply via browser SpeechSynthesis; then focus input. */
  const speakAssistantReply = useCallback(
    (rawText, opts = {}) => {
      const o = opts && typeof opts === 'object' ? opts : {};
      const {
        resumeMicAfter = false,
        markBazaarVoiceDone = false,
        markPolicyKbDone = false,
        markDealsCampaignDone = false,
      } = o;
      stopMicForAssistantSpeech();
      if (!voiceReplyEnabled) {
        focusMayaInput();
        if (voiceOnlyMaya) armBiktaAutoClose();
        if (resumeMicAfter) resumeMicAfterSpeech();
        return;
      }
      const line = textForMayaTTS(rawText);
      if (!line.trim()) {
        focusMayaInput();
        if (voiceOnlyMaya) armBiktaAutoClose();
        if (resumeMicAfter) resumeMicAfterSpeech();
        return;
      }
      const wOpts = getWorkerSpeechOptions();
      speakMayaReply(line, role, {
        ...wOpts,
        onComplete: () => {
          focusMayaInput();
          if (voiceOnlyMaya) armBiktaAutoClose();
          let skipResume = false;
          const dealsStill = () => {
            try {
              return (
                sessionStorage.getItem('maya_bazaar_deals_campaign_pending') === '1' &&
                !sessionStorage.getItem('maya_bazaar_deals_campaign_done')
              );
            } catch (_) {
              return false;
            }
          };
          if (markBazaarVoiceDone) {
            try {
              sessionStorage.setItem('maya_bazaar_voice_done', '1');
            } catch (_) {}
            try {
              const policyStill =
                sessionStorage.getItem('maya_bazaar_policy_kb_pending') === '1' &&
                !sessionStorage.getItem('maya_bazaar_policy_kb_v1_done');
              if (policyStill) {
                sessionStorage.removeItem('maya_bazaar_policy_kb_pending');
                const chainDeals = dealsStill();
                addMayaMessage({ role: 'assistant', content: BAZAAR_POLICY_KB_LINE });
                window.setTimeout(() => {
                  speakAssistantReply(BAZAAR_POLICY_KB_LINE, {
                    resumeMicAfter: !chainDeals,
                    markPolicyKbDone: true,
                  });
                }, 450);
                skipResume = true;
              }
            } catch (_) {}
          }
          if (markPolicyKbDone) {
            try {
              sessionStorage.setItem('maya_bazaar_policy_kb_v1_done', '1');
            } catch (_) {}
            try {
              if (dealsStill()) {
                sessionStorage.removeItem('maya_bazaar_deals_campaign_pending');
                addMayaMessage({ role: 'assistant', content: BAZAAR_DEALS_CAMPAIGN_LINE });
                window.setTimeout(() => {
                  speakAssistantReply(BAZAAR_DEALS_CAMPAIGN_LINE, {
                    resumeMicAfter: true,
                    markDealsCampaignDone: true,
                  });
                }, 450);
                skipResume = true;
              }
            } catch (_) {}
          }
          if (markDealsCampaignDone) {
            try {
              sessionStorage.setItem('maya_bazaar_deals_campaign_done', '1');
            } catch (_) {}
          }
          if (resumeMicAfter && !skipResume) {
            resumeMicAfterSpeech();
          }
        },
      });
    },
    [
      stopMicForAssistantSpeech,
      voiceReplyEnabled,
      voiceOnlyMaya,
      role,
      focusMayaInput,
      armBiktaAutoClose,
      resumeMicAfterSpeech,
      addMayaMessage,
    ],
  );

  const bazaarWelcomeStartedRef = useRef(false);
  const policyKbAnnounceStartedRef = useRef(false);
  const runBazaarHotelWelcome = useCallback(() => {
    if (!voiceOnlyMaya) return;
    if (bazaarWelcomeStartedRef.current) return;
    let pending = false;
    let done = false;
    try {
      pending = sessionStorage.getItem('maya_bazaar_pending_speak') === '1';
      done = sessionStorage.getItem('maya_bazaar_voice_done') === '1';
    } catch (_) {}
    if (done || !pending) return;
    bazaarWelcomeStartedRef.current = true;
    try {
      sessionStorage.removeItem('maya_bazaar_pending_speak');
    } catch (_) {}
    const line =
      "קובי, סיטי טאוור רמת גן באוויר. עדכנתי את כל סוגי החדרים, כולל סוויטת הג'קוזי והטרקלין. גם התמונות של בזאר סודרו. איפה אתה רוצה שנתמקד עכשיו – ביפו או בבורסה?";
    let willChainPolicy = false;
    try {
      willChainPolicy =
        sessionStorage.getItem('maya_bazaar_policy_kb_pending') === '1' &&
        !sessionStorage.getItem('maya_bazaar_policy_kb_v1_done');
    } catch (_) {}
    addMayaMessage({ role: 'assistant', content: line });
    speakAssistantReply(line, {
      resumeMicAfter: !willChainPolicy,
      markBazaarVoiceDone: true,
    });
  }, [voiceOnlyMaya, addMayaMessage, speakAssistantReply]);

  /** When onboarding voice already played earlier, announce policy KB once. */
  const runPolicyKbAnnounce = useCallback(() => {
    if (!voiceOnlyMaya) return;
    if (policyKbAnnounceStartedRef.current) return;
    let wDone = false;
    let pPending = false;
    let pDone = false;
    try {
      wDone = sessionStorage.getItem('maya_bazaar_voice_done') === '1';
      pPending = sessionStorage.getItem('maya_bazaar_policy_kb_pending') === '1';
      pDone = sessionStorage.getItem('maya_bazaar_policy_kb_v1_done') === '1';
    } catch (_) {}
    if (!pPending || pDone) return;
    if (!wDone) return;
    policyKbAnnounceStartedRef.current = true;
    try {
      sessionStorage.removeItem('maya_bazaar_policy_kb_pending');
    } catch (_) {}
    let dealsChain = false;
    try {
      dealsChain =
        sessionStorage.getItem('maya_bazaar_deals_campaign_pending') === '1' &&
        !sessionStorage.getItem('maya_bazaar_deals_campaign_done');
    } catch (_) {}
    addMayaMessage({ role: 'assistant', content: BAZAAR_POLICY_KB_LINE });
    speakAssistantReply(BAZAAR_POLICY_KB_LINE, {
      resumeMicAfter: !dealsChain,
      markPolicyKbDone: true,
    });
  }, [voiceOnlyMaya, addMayaMessage, speakAssistantReply]);

  const dealsCampaignStartedRef = useRef(false);
  const runDealsCampaignAnnounce = useCallback(() => {
    if (!voiceOnlyMaya) return;
    if (dealsCampaignStartedRef.current) return;
    let wDone = false;
    let pDone = false;
    let dPending = false;
    let dDone = false;
    try {
      wDone = sessionStorage.getItem('maya_bazaar_voice_done') === '1';
      pDone = sessionStorage.getItem('maya_bazaar_policy_kb_v1_done') === '1';
      dPending = sessionStorage.getItem('maya_bazaar_deals_campaign_pending') === '1';
      dDone = sessionStorage.getItem('maya_bazaar_deals_campaign_done') === '1';
    } catch (_) {}
    if (!dPending || dDone) return;
    if (!wDone || !pDone) return;
    dealsCampaignStartedRef.current = true;
    try {
      sessionStorage.removeItem('maya_bazaar_deals_campaign_pending');
    } catch (_) {}
    addMayaMessage({ role: 'assistant', content: BAZAAR_DEALS_CAMPAIGN_LINE });
    speakAssistantReply(BAZAAR_DEALS_CAMPAIGN_LINE, { resumeMicAfter: true, markDealsCampaignDone: true });
  }, [voiceOnlyMaya, addMayaMessage, speakAssistantReply]);

  useEffect(() => {
    if (!voiceOnlyMaya) return undefined;
    const h = () => {
      runBazaarHotelWelcome();
      runPolicyKbAnnounce();
      runDealsCampaignAnnounce();
    };
    window.addEventListener('maya-bazaar-properties-ready', h);
    h();
    return () => window.removeEventListener('maya-bazaar-properties-ready', h);
  }, [voiceOnlyMaya, runBazaarHotelWelcome, runPolicyKbAnnounce, runDealsCampaignAnnounce]);

  const scaleupStartedRef = useRef(false);
  const runScaleupPortfolioWelcome = useCallback(() => {
    if (!voiceOnlyMaya) return;
    try {
      if (sessionStorage.getItem('maya_scaleup_voice_v1_done') === '1') return;
    } catch (_) {}
    if (scaleupStartedRef.current) return;
    let pending = false;
    try {
      pending = sessionStorage.getItem('maya_scaleup_voice_pending') === '1';
    } catch (_) {}
    if (!pending) return;
    scaleupStartedRef.current = true;
    try {
      sessionStorage.removeItem('maya_scaleup_voice_pending');
      sessionStorage.setItem('maya_scaleup_voice_v1_done', '1');
    } catch (_) {}
    const line =
      'קובי, המערכת עכשיו מנהלת את כל סניפי ROOMS. פתחתי אפשרות להשכרות לפי שעה, יום או חודש בכל סניף. סידרתי את התמונות של בזאר והכנתי את המערכת לקליטת אקסל עובדים מרובה סניפים. מה הסניף הראשון שנדגום?';
    addMayaMessage({ role: 'assistant', content: line });
    speakAssistantReply(line, { resumeMicAfter: true });
  }, [voiceOnlyMaya, addMayaMessage, speakAssistantReply]);

  useEffect(() => {
    if (!voiceOnlyMaya) return undefined;
    const h = () => runScaleupPortfolioWelcome();
    window.addEventListener('maya-portfolio-scaleup-ready', h);
    h();
    return () => window.removeEventListener('maya-portfolio-scaleup-ready', h);
  }, [voiceOnlyMaya, runScaleupPortfolioWelcome]);

  const enterpriseStartedRef = useRef(false);
  const runEnterpriseWelcome = useCallback(() => {
    if (!voiceOnlyMaya) return;
    try {
      if (sessionStorage.getItem('maya_enterprise_voice_v1_done') === '1') return;
    } catch (_) {}
    if (enterpriseStartedRef.current) return;
    let pending = false;
    try {
      pending = sessionStorage.getItem('maya_enterprise_voice_pending') === '1';
    } catch (_) {}
    if (!pending) return;
    enterpriseStartedRef.current = true;
    try {
      sessionStorage.removeItem('maya_enterprise_voice_pending');
      sessionStorage.setItem('maya_enterprise_voice_v1_done', '1');
      sessionStorage.setItem('maya_scaleup_voice_v1_done', '1');
      sessionStorage.removeItem('maya_scaleup_voice_pending');
    } catch (_) {}
    const line =
      'קובי, המערכת עברה למבנה Enterprise. אני מוכנה לנהל 1,000 נכסים ויודעת להבחין בין חדר 101 ביפו למשרד 502 ברומס סקיי טאוור. תעלה את האקסל הגדול, אני אנווט את הספינה.';
    addMayaMessage({ role: 'assistant', content: line });
    speakAssistantReply(line, { resumeMicAfter: true });
  }, [voiceOnlyMaya, addMayaMessage, speakAssistantReply]);

  useEffect(() => {
    if (!voiceOnlyMaya) return undefined;
    const h = () => runEnterpriseWelcome();
    window.addEventListener('maya-enterprise-ready', h);
    h();
    return () => window.removeEventListener('maya-enterprise-ready', h);
  }, [voiceOnlyMaya, runEnterpriseWelcome]);

  const weworkInjectionStartedRef = useRef(false);
  const runWeWorkInjectionWelcome = useCallback(() => {
    try {
      if (sessionStorage.getItem('maya_wework_injection_v1_done') === '1') return;
    } catch (_) {}
    if (weworkInjectionStartedRef.current) return;
    let pending = false;
    try {
      pending = sessionStorage.getItem('maya_wework_injection_pending') === '1';
    } catch (_) {}
    if (!pending) return;
    weworkInjectionStartedRef.current = true;
    try {
      sessionStorage.removeItem('maya_wework_injection_pending');
      sessionStorage.setItem('maya_wework_injection_v1_done', '1');
    } catch (_) {}
    const line =
      'קובי, הזרקתי את כל 14 סניפי WeWork למערכת. הם מופיעים עכשיו כקארדים נקיים בגריד הניהול שלך. מחכה שתעלה את התמונות והתמחור כדי להפעיל אותם ללקוחות. המערכת עכשיו מנהלת עשרות נכסי פרימיום בפריסה ארצית!';
    addMayaMessage({ role: 'assistant', content: line });
    if (voiceOnlyMaya) speakAssistantReply(line, { resumeMicAfter: true });
  }, [voiceOnlyMaya, addMayaMessage, speakAssistantReply]);

  useEffect(() => {
    const h = () => runWeWorkInjectionWelcome();
    window.addEventListener('maya-wework-portfolio-ready', h);
    h();
    return () => window.removeEventListener('maya-wework-portfolio-ready', h);
  }, [runWeWorkInjectionWelcome]);

  const uiPolishStartedRef = useRef(false);
  const runUiPolishWelcome = useCallback(() => {
    try {
      if (sessionStorage.getItem('maya_ui_polish_message_spoken_v1') === '1') return;
      if (sessionStorage.getItem('maya_ui_polish_message_pending') !== '1') return;
    } catch (_) {
      return;
    }
    if (uiPolishStartedRef.current) return;
    uiPolishStartedRef.current = true;
    try {
      sessionStorage.removeItem('maya_ui_polish_message_pending');
      sessionStorage.setItem('maya_ui_polish_message_spoken_v1', '1');
    } catch (_) {}
    const line =
      'קובי, סידרתי את הסרגלים. הוספתי כפתור חיפוש ונתתי להם מראה מקצועי יותר. כל הטקסט המיותר נעלם והמידע עבר אליי לזיכרון. איך זה נראה עכשיו?';
    addMayaMessage({ role: 'assistant', content: line });
    if (voiceOnlyMaya) speakAssistantReply(line, { resumeMicAfter: true });
  }, [voiceOnlyMaya, addMayaMessage, speakAssistantReply]);

  useEffect(() => {
    const onPolish = () => runUiPolishWelcome();
    window.addEventListener('maya-ui-polish-ready', onPolish);
    runUiPolishWelcome();
    return () => window.removeEventListener('maya-ui-polish-ready', onPolish);
  }, [runUiPolishWelcome]);

  const bazaarCleanupStartedRef = useRef(false);
  const runBazaarDashboardCleanupWelcome = useCallback(() => {
    try {
      if (sessionStorage.getItem('maya_bazaar_cleanup_message_spoken_v1') === '1') return;
      if (sessionStorage.getItem('maya_bazaar_cleanup_message_pending') !== '1') return;
    } catch (_) {
      return;
    }
    if (bazaarCleanupStartedRef.current) return;
    bazaarCleanupStartedRef.current = true;
    try {
      sessionStorage.removeItem('maya_bazaar_cleanup_message_pending');
      sessionStorage.setItem('maya_bazaar_cleanup_message_spoken_v1', '1');
    } catch (_) {}
    const line =
      'קובי, שיחררתי את המסך מהבלוק של בזאר יפו. עכשיו הדשבורד נקי ומוקדש כולו לנכסים שלך. סרגל הסינון קיבל \'צבע\' ונוכחות, והוא מוכן לעבודה. איך הממשק נראה עכשיו?';
    addMayaMessage({ role: 'assistant', content: line });
    if (voiceOnlyMaya) speakAssistantReply(line, { resumeMicAfter: true });
  }, [voiceOnlyMaya, addMayaMessage, speakAssistantReply]);

  useEffect(() => {
    const onBazaarCleanup = () => runBazaarDashboardCleanupWelcome();
    window.addEventListener('maya-bazaar-dashboard-cleanup-ready', onBazaarCleanup);
    runBazaarDashboardCleanupWelcome();
    return () => window.removeEventListener('maya-bazaar-dashboard-cleanup-ready', onBazaarCleanup);
  }, [runBazaarDashboardCleanupWelcome]);

  const galleryApiConfirmStartedRef = useRef(false);
  const runGalleryApiConfirm = useCallback(() => {
    try {
      if (sessionStorage.getItem('maya_gallery_api_confirm_spoken_v1') === '1') return;
      if (sessionStorage.getItem('maya_gallery_api_confirm_pending') !== '1') return;
    } catch (_) {
      return;
    }
    if (galleryApiConfirmStartedRef.current) return;
    galleryApiConfirmStartedRef.current = true;
    try {
      sessionStorage.removeItem('maya_gallery_api_confirm_pending');
      sessionStorage.setItem('maya_gallery_api_confirm_spoken_v1', '1');
    } catch (_) {}
    addMayaMessage({ role: 'assistant', content: GALLERY_API_CONFIRM_LINE });
    if (voiceOnlyMaya) speakAssistantReply(GALLERY_API_CONFIRM_LINE, { resumeMicAfter: true });
  }, [voiceOnlyMaya, addMayaMessage, speakAssistantReply]);

  useEffect(() => {
    const onGalleryApi = () => runGalleryApiConfirm();
    window.addEventListener('maya-bazaar-gallery-api-confirm-ready', onGalleryApi);
    runGalleryApiConfirm();
    return () => window.removeEventListener('maya-bazaar-gallery-api-confirm-ready', onGalleryApi);
  }, [runGalleryApiConfirm]);

  const codeQualityConfirmStartedRef = useRef(false);
  const runCodeQualityConfirm = useCallback(() => {
    try {
      if (sessionStorage.getItem('maya_code_quality_confirm_spoken_v1') === '1') return;
      if (sessionStorage.getItem('maya_code_quality_confirm_pending') !== '1') return;
    } catch (_) {
      return;
    }
    if (codeQualityConfirmStartedRef.current) return;
    codeQualityConfirmStartedRef.current = true;
    try {
      sessionStorage.removeItem('maya_code_quality_confirm_pending');
      sessionStorage.setItem('maya_code_quality_confirm_spoken_v1', '1');
    } catch (_) {}
    addMayaMessage({ role: 'assistant', content: CODE_QUALITY_CONFIRM_LINE });
    if (voiceOnlyMaya) speakAssistantReply(CODE_QUALITY_CONFIRM_LINE, { resumeMicAfter: true });
  }, [voiceOnlyMaya, addMayaMessage, speakAssistantReply]);

  useEffect(() => {
    const onCodeQuality = () => runCodeQualityConfirm();
    window.addEventListener('maya-code-quality-confirm-ready', onCodeQuality);
    runCodeQualityConfirm();
    return () => window.removeEventListener('maya-code-quality-confirm-ready', onCodeQuality);
  }, [runCodeQualityConfirm]);

  const tasksVersionRouteConfirmStartedRef = useRef(false);
  const runTasksVersionRouteConfirm = useCallback(() => {
    try {
      if (sessionStorage.getItem('maya_tasks_version_route_spoken_v1') === '1') return;
      if (sessionStorage.getItem('maya_tasks_version_route_pending') !== '1') return;
    } catch (_) {
      return;
    }
    if (tasksVersionRouteConfirmStartedRef.current) return;
    tasksVersionRouteConfirmStartedRef.current = true;
    try {
      sessionStorage.removeItem('maya_tasks_version_route_pending');
      sessionStorage.setItem('maya_tasks_version_route_spoken_v1', '1');
    } catch (_) {}
    addMayaMessage({ role: 'assistant', content: TASKS_VERSION_ROUTE_CONFIRM_LINE });
    if (voiceOnlyMaya) speakAssistantReply(TASKS_VERSION_ROUTE_CONFIRM_LINE, { resumeMicAfter: true });
  }, [voiceOnlyMaya, addMayaMessage, speakAssistantReply]);

  useEffect(() => {
    const onTasksVersionRoute = () => runTasksVersionRouteConfirm();
    window.addEventListener('maya-tasks-version-route-ready', onTasksVersionRoute);
    runTasksVersionRouteConfirm();
    return () => window.removeEventListener('maya-tasks-version-route-ready', onTasksVersionRoute);
  }, [runTasksVersionRouteConfirm]);

  const status200LockStartedRef = useRef(false);
  const runStatus200LockConfirm = useCallback(() => {
    try {
      if (sessionStorage.getItem('maya_status_200_lock_spoken_v1') === '1') return;
      if (sessionStorage.getItem('maya_status_200_lock_pending') !== '1') return;
    } catch (_) {
      return;
    }
    if (status200LockStartedRef.current) return;
    status200LockStartedRef.current = true;
    try {
      sessionStorage.removeItem('maya_status_200_lock_pending');
      sessionStorage.setItem('maya_status_200_lock_spoken_v1', '1');
    } catch (_) {}
    addMayaMessage({ role: 'assistant', content: STATUS_200_LOCK_LINE });
    if (voiceOnlyMaya) speakAssistantReply(STATUS_200_LOCK_LINE, { resumeMicAfter: true });
  }, [voiceOnlyMaya, addMayaMessage, speakAssistantReply]);

  useEffect(() => {
    const onStatus200Lock = () => runStatus200LockConfirm();
    window.addEventListener('maya-status-200-lock-ready', onStatus200Lock);
    runStatus200LockConfirm();
    return () => window.removeEventListener('maya-status-200-lock-ready', onStatus200Lock);
  }, [runStatus200LockConfirm]);

  const geminiIntegrationConfirmStartedRef = useRef(false);
  const runGeminiIntegrationConfirm = useCallback(() => {
    try {
      if (sessionStorage.getItem('maya_gemini_integration_spoken_v1') === '1') return;
      if (sessionStorage.getItem('maya_gemini_integration_pending') !== '1') return;
    } catch (_) {
      return;
    }
    if (geminiIntegrationConfirmStartedRef.current) return;
    geminiIntegrationConfirmStartedRef.current = true;
    try {
      sessionStorage.removeItem('maya_gemini_integration_pending');
      sessionStorage.setItem('maya_gemini_integration_spoken_v1', '1');
    } catch (_) {}
    addMayaMessage({ role: 'assistant', content: GEMINI_INTEGRATION_CONFIRM_LINE });
    if (voiceOnlyMaya) speakAssistantReply(GEMINI_INTEGRATION_CONFIRM_LINE, { resumeMicAfter: true });
  }, [voiceOnlyMaya, addMayaMessage, speakAssistantReply]);

  useEffect(() => {
    const onGeminiIntegration = () => runGeminiIntegrationConfirm();
    window.addEventListener('maya-gemini-integration-ready', onGeminiIntegration);
    runGeminiIntegrationConfirm();
    return () => window.removeEventListener('maya-gemini-integration-ready', onGeminiIntegration);
  }, [runGeminiIntegrationConfirm]);

  const modernUiPolishStartedRef = useRef(false);
  const runModernUiPolishConfirm = useCallback(() => {
    try {
      if (sessionStorage.getItem('maya_modern_ui_polish_spoken_v1') === '1') return;
      if (sessionStorage.getItem('maya_modern_ui_polish_pending') !== '1') return;
    } catch (_) {
      return;
    }
    if (modernUiPolishStartedRef.current) return;
    modernUiPolishStartedRef.current = true;
    try {
      sessionStorage.removeItem('maya_modern_ui_polish_pending');
      sessionStorage.setItem('maya_modern_ui_polish_spoken_v1', '1');
    } catch (_) {}
    addMayaMessage({ role: 'assistant', content: MODERN_UI_POLISH_CONFIRM_LINE });
    if (voiceOnlyMaya) speakAssistantReply(MODERN_UI_POLISH_CONFIRM_LINE, { resumeMicAfter: true });
  }, [voiceOnlyMaya, addMayaMessage, speakAssistantReply]);

  useEffect(() => {
    const onModernUiPolish = () => runModernUiPolishConfirm();
    window.addEventListener('maya-modern-ui-polish-ready', onModernUiPolish);
    runModernUiPolishConfirm();
    return () => window.removeEventListener('maya-modern-ui-polish-ready', onModernUiPolish);
  }, [runModernUiPolishConfirm]);

  const mayaImagesChatConnectStartedRef = useRef(false);
  const runMayaImagesChatConnectConfirm = useCallback(() => {
    try {
      if (sessionStorage.getItem('maya_images_chat_connect_spoken_v1') === '1') return;
      if (sessionStorage.getItem('maya_images_chat_connect_pending') !== '1') return;
    } catch (_) {
      return;
    }
    if (mayaImagesChatConnectStartedRef.current) return;
    mayaImagesChatConnectStartedRef.current = true;
    try {
      sessionStorage.removeItem('maya_images_chat_connect_pending');
      sessionStorage.setItem('maya_images_chat_connect_spoken_v1', '1');
    } catch (_) {}
    addMayaMessage({ role: 'assistant', content: MAYA_IMAGES_AND_CHAT_CONNECT_LINE });
    if (voiceOnlyMaya) speakAssistantReply(MAYA_IMAGES_AND_CHAT_CONNECT_LINE, { resumeMicAfter: true });
  }, [voiceOnlyMaya, addMayaMessage, speakAssistantReply]);

  useEffect(() => {
    const onImagesChat = () => runMayaImagesChatConnectConfirm();
    window.addEventListener('maya-images-chat-connect-ready', onImagesChat);
    runMayaImagesChatConnectConfirm();
    return () => window.removeEventListener('maya-images-chat-connect-ready', onImagesChat);
  }, [runMayaImagesChatConnectConfirm]);

  const mayaUniqueRealEstateVisualsStartedRef = useRef(false);
  const runMayaUniqueRealEstateVisualsConfirm = useCallback(() => {
    try {
      if (sessionStorage.getItem('maya_unique_realestate_visuals_spoken_v1') === '1') return;
      if (sessionStorage.getItem('maya_unique_realestate_visuals_pending') !== '1') return;
    } catch (_) {
      return;
    }
    if (mayaUniqueRealEstateVisualsStartedRef.current) return;
    mayaUniqueRealEstateVisualsStartedRef.current = true;
    try {
      sessionStorage.removeItem('maya_unique_realestate_visuals_pending');
      sessionStorage.setItem('maya_unique_realestate_visuals_spoken_v1', '1');
    } catch (_) {}
    addMayaMessage({ role: 'assistant', content: MAYA_UNIQUE_REAL_ESTATE_VISUALS_LINE });
    if (voiceOnlyMaya) speakAssistantReply(MAYA_UNIQUE_REAL_ESTATE_VISUALS_LINE, { resumeMicAfter: true });
  }, [voiceOnlyMaya, addMayaMessage, speakAssistantReply]);

  useEffect(() => {
    const onUniqueVisuals = () => runMayaUniqueRealEstateVisualsConfirm();
    window.addEventListener('maya-unique-realestate-visuals-ready', onUniqueVisuals);
    runMayaUniqueRealEstateVisualsConfirm();
    return () => window.removeEventListener('maya-unique-realestate-visuals-ready', onUniqueVisuals);
  }, [runMayaUniqueRealEstateVisualsConfirm]);

  const mayaDemoEngineStartedRef = useRef(false);
  const runMayaDemoEngineOccupancyConfirm = useCallback(() => {
    try {
      if (sessionStorage.getItem('maya_demo_engine_spoken_v1') === '1') return;
      if (sessionStorage.getItem('maya_demo_engine_pending') !== '1') return;
    } catch (_) {
      return;
    }
    if (mayaDemoEngineStartedRef.current) return;
    mayaDemoEngineStartedRef.current = true;
    try {
      sessionStorage.removeItem('maya_demo_engine_pending');
      sessionStorage.setItem('maya_demo_engine_spoken_v1', '1');
    } catch (_) {}
    addMayaMessage({ role: 'assistant', content: MAYA_DEMO_ENGINE_OCCUPANCY_LINE });
    if (voiceOnlyMaya) speakAssistantReply(MAYA_DEMO_ENGINE_OCCUPANCY_LINE, { resumeMicAfter: true });
  }, [voiceOnlyMaya, addMayaMessage, speakAssistantReply]);

  useEffect(() => {
    const onDemoEngine = () => runMayaDemoEngineOccupancyConfirm();
    window.addEventListener('maya-demo-engine-ready', onDemoEngine);
    runMayaDemoEngineOccupancyConfirm();
    return () => window.removeEventListener('maya-demo-engine-ready', onDemoEngine);
  }, [runMayaDemoEngineOccupancyConfirm]);

  const mayaBrainReconnectedStartedRef = useRef(false);
  const runMayaBrainReconnectedConfirm = useCallback(() => {
    try {
      if (sessionStorage.getItem('maya_brain_reconnected_spoken_v1') === '1') return;
      if (sessionStorage.getItem('maya_brain_reconnected_pending') !== '1') return;
    } catch (_) {
      return;
    }
    if (mayaBrainReconnectedStartedRef.current) return;
    mayaBrainReconnectedStartedRef.current = true;
    try {
      sessionStorage.removeItem('maya_brain_reconnected_pending');
      sessionStorage.setItem('maya_brain_reconnected_spoken_v1', '1');
    } catch (_) {}
    addMayaMessage({ role: 'assistant', content: MAYA_BRAIN_RECONNECTED_LINE });
    if (voiceOnlyMaya) speakAssistantReply(MAYA_BRAIN_RECONNECTED_LINE, { resumeMicAfter: true });
  }, [voiceOnlyMaya, addMayaMessage, speakAssistantReply]);

  useEffect(() => {
    const onBrain = () => runMayaBrainReconnectedConfirm();
    window.addEventListener('maya-brain-reconnected-ready', onBrain);
    runMayaBrainReconnectedConfirm();
    return () => window.removeEventListener('maya-brain-reconnected-ready', onBrain);
  }, [runMayaBrainReconnectedConfirm]);

  const mayaKobiStackFixStartedRef = useRef(false);
  const runMayaKobiStackFixConfirm = useCallback(() => {
    try {
      if (sessionStorage.getItem('maya_kobi_stack_fix_spoken_v1') === '1') return;
      if (sessionStorage.getItem('maya_kobi_stack_fix_pending') !== '1') return;
    } catch (_) {
      return;
    }
    if (mayaKobiStackFixStartedRef.current) return;
    mayaKobiStackFixStartedRef.current = true;
    try {
      sessionStorage.removeItem('maya_kobi_stack_fix_pending');
      sessionStorage.setItem('maya_kobi_stack_fix_spoken_v1', '1');
    } catch (_) {}
    addMayaMessage({ role: 'assistant', content: MAYA_KOBI_STACK_FIX_CONFIRM_LINE });
    if (voiceOnlyMaya) speakAssistantReply(MAYA_KOBI_STACK_FIX_CONFIRM_LINE, { resumeMicAfter: true });
  }, [voiceOnlyMaya, addMayaMessage, speakAssistantReply]);

  useEffect(() => {
    const onKobiFix = () => runMayaKobiStackFixConfirm();
    window.addEventListener('maya-kobi-stack-fix-ready', onKobiFix);
    runMayaKobiStackFixConfirm();
    return () => window.removeEventListener('maya-kobi-stack-fix-ready', onKobiFix);
  }, [runMayaKobiStackFixConfirm]);

  const mayaDemoAllSystemsGoStartedRef = useRef(false);
  const runMayaDemoAllSystemsGoConfirm = useCallback(() => {
    try {
      if (sessionStorage.getItem('maya_demo_all_systems_go_spoken_v1') === '1') return;
      if (sessionStorage.getItem('maya_demo_all_systems_go_pending') !== '1') return;
    } catch (_) {
      return;
    }
    if (mayaDemoAllSystemsGoStartedRef.current) return;
    mayaDemoAllSystemsGoStartedRef.current = true;
    try {
      sessionStorage.removeItem('maya_demo_all_systems_go_pending');
      sessionStorage.setItem('maya_demo_all_systems_go_spoken_v1', '1');
    } catch (_) {}
    addMayaMessage({ role: 'assistant', content: MAYA_DEMO_ALL_SYSTEMS_GO_LINE });
    if (voiceOnlyMaya) speakAssistantReply(MAYA_DEMO_ALL_SYSTEMS_GO_LINE, { resumeMicAfter: true });
  }, [voiceOnlyMaya, addMayaMessage, speakAssistantReply]);

  useEffect(() => {
    const onDemoGo = () => runMayaDemoAllSystemsGoConfirm();
    window.addEventListener('maya-demo-all-systems-go-ready', onDemoGo);
    runMayaDemoAllSystemsGoConfirm();
    return () => window.removeEventListener('maya-demo-all-systems-go-ready', onDemoGo);
  }, [runMayaDemoAllSystemsGoConfirm]);

  const propertiesGridSyncConfirmStartedRef = useRef(false);
  const runPropertiesGridSyncConfirm = useCallback(() => {
    try {
      if (sessionStorage.getItem('maya_properties_grid_sync_spoken_v1') === '1') return;
      if (sessionStorage.getItem('maya_properties_grid_sync_pending') !== '1') return;
    } catch (_) {
      return;
    }
    if (propertiesGridSyncConfirmStartedRef.current) return;
    propertiesGridSyncConfirmStartedRef.current = true;
    try {
      sessionStorage.removeItem('maya_properties_grid_sync_pending');
      sessionStorage.setItem('maya_properties_grid_sync_spoken_v1', '1');
    } catch (_) {}
    addMayaMessage({ role: 'assistant', content: PROPERTIES_GRID_SYNC_CONFIRM_LINE });
    if (voiceOnlyMaya) speakAssistantReply(PROPERTIES_GRID_SYNC_CONFIRM_LINE, { resumeMicAfter: true });
  }, [voiceOnlyMaya, addMayaMessage, speakAssistantReply]);

  useEffect(() => {
    const onGridSync = () => runPropertiesGridSyncConfirm();
    window.addEventListener('maya-properties-grid-sync-ready', onGridSync);
    runPropertiesGridSyncConfirm();
    return () => window.removeEventListener('maya-properties-grid-sync-ready', onGridSync);
  }, [runPropertiesGridSyncConfirm]);

  const propertiesAllScreensRestoreStartedRef = useRef(false);
  const runPropertiesAllScreensRestoreConfirm = useCallback(() => {
    try {
      if (sessionStorage.getItem('maya_properties_all_screens_restore_spoken_v1') === '1') return;
      if (sessionStorage.getItem('maya_properties_all_screens_restore_pending') !== '1') return;
    } catch (_) {
      return;
    }
    if (propertiesAllScreensRestoreStartedRef.current) return;
    propertiesAllScreensRestoreStartedRef.current = true;
    try {
      sessionStorage.removeItem('maya_properties_all_screens_restore_pending');
      sessionStorage.setItem('maya_properties_all_screens_restore_spoken_v1', '1');
    } catch (_) {}
    addMayaMessage({ role: 'assistant', content: PROPERTIES_ALL_SCREENS_RESTORE_CONFIRM_LINE });
    if (voiceOnlyMaya) speakAssistantReply(PROPERTIES_ALL_SCREENS_RESTORE_CONFIRM_LINE, { resumeMicAfter: true });
  }, [voiceOnlyMaya, addMayaMessage, speakAssistantReply]);

  useEffect(() => {
    const onAllScreens = () => runPropertiesAllScreensRestoreConfirm();
    window.addEventListener('maya-properties-all-screens-restore-ready', onAllScreens);
    runPropertiesAllScreensRestoreConfirm();
    return () => window.removeEventListener('maya-properties-all-screens-restore-ready', onAllScreens);
  }, [runPropertiesAllScreensRestoreConfirm]);

  useEffect(() => {
    const onMassReport = (e) => {
      const msg = e?.detail?.message;
      if (!msg) return;
      addMayaMessage({ role: 'assistant', content: msg });
      if (voiceOnlyMaya) speakAssistantReply(msg, { resumeMicAfter: true });
    };
    window.addEventListener('maya-mass-import-report', onMassReport);
    return () => window.removeEventListener('maya-mass-import-report', onMassReport);
  }, [voiceOnlyMaya, addMayaMessage, speakAssistantReply]);

  useEffect(() => {
    const onBatch = (e) => {
      const msg = e?.detail?.message;
      if (!msg) return;
      addMayaMessage({ role: 'assistant', content: msg });
      if (voiceOnlyMaya) speakAssistantReply(msg, { resumeMicAfter: true });
    };
    window.addEventListener('maya-enterprise-batch-report', onBatch);
    return () => window.removeEventListener('maya-enterprise-batch-report', onBatch);
  }, [voiceOnlyMaya, addMayaMessage, speakAssistantReply]);

  useEffect(() => {
    if (!voiceOnlyMaya) return undefined;
    const onBulk = (e) => {
      const n = Number(e?.detail?.count) || 0;
      const line = `קובי, קלטתי את קובץ האקסל. כל ${n} העובדים עודכנו במערכת.`;
      addMayaMessage({ role: 'assistant', content: line });
      speakAssistantReply(line, { resumeMicAfter: true });
    };
    window.addEventListener('maya-staff-bulk-import', onBulk);
    return () => window.removeEventListener('maya-staff-bulk-import', onBulk);
  }, [voiceOnlyMaya, addMayaMessage, speakAssistantReply]);

  useEffect(() => {
    const onAutomation = (e) => {
      const t = e?.detail?.text;
      if (t == null || String(t).trim() === '') return;
      const line = `קובי, קלטתי את כלל האוטומציה: ${String(t).trim().slice(0, 600)} — אוכל לייצר משימות ותזכורות לפי זה.`;
      addMayaMessage({ role: 'assistant', content: line });
      if (voiceOnlyMaya) speakAssistantReply(line, { resumeMicAfter: true });
    };
    window.addEventListener('maya-automation-rule', onAutomation);
    return () => window.removeEventListener('maya-automation-rule', onAutomation);
  }, [voiceOnlyMaya, addMayaMessage, speakAssistantReply]);

  useEffect(() => {
    if (mayaChatOpen) clearBiktaAutoCloseTimer();
  }, [mayaChatOpen, clearBiktaAutoCloseTimer]);

  useEffect(() => {
    if (!voiceOnlyMaya) return undefined;
    const h = () => armBiktaAutoClose();
    window.addEventListener('maya-bikta-arm-auto-close', h);
    return () => window.removeEventListener('maya-bikta-arm-auto-close', h);
  }, [voiceOnlyMaya, armBiktaAutoClose]);

  useEffect(() => () => clearBiktaAutoCloseTimer(), [clearBiktaAutoCloseTimer]);

  /* ── Task completed — Activity drawer only (main chat stays conversational). ── */
  const handleTaskComplete = useCallback((task) => {
    playSound('complete');
    const doneLine = `עבודה טובה! 💪 משימה "${task?.description || task?.content || ''}" סומנה כבוצעה.`;
    addMayaActivityEntry({
      kind: 'task_done_ui',
      text: doneLine,
      taskId: task?.id,
    });
    notifyTasksChanged();
  }, [addMayaActivityEntry]);

  /* ── Field staff status (אני בדרך / נכנסתי / סיימתי) — same pipeline as activity-feed, instant in UI ── */
  useEffect(() => {
    const labels = {
      on_my_way: 'אני בדרך',
      started: 'נכנסתי לחדר',
      finished: 'סיימתי - החדר מוכן',
    };
    const onFieldStatus = (e) => {
      const d = e?.detail || {};
      const label = labels[d.status] || d.status || '';
      const who = String(d.staffName || d.staffId || 'צוות').trim();
      const room = String(d.room || '—').trim();
      const line = `שטח · ${who} · חדר ${room} · ${label}`;
      addMayaActivityEntry({ kind: 'field_staff_status', text: line, taskId: d.taskId });
    };
    window.addEventListener('field-staff-status', onFieldStatus);
    return () => window.removeEventListener('field-staff-status', onFieldStatus);
  }, [addMayaActivityEntry]);

  /* ── Screen shake on new task accepted ── */
  const triggerShake = useCallback(() => {
    setIsShaking(true);
    setTimeout(() => setIsShaking(false), 500);
  }, []);

  /** Full transcript in panel; scroll area capped by CSS (see .maya-messages) */
  const visibleMessages = useMemo(() => mayaMessages.slice(-2000), [mayaMessages]);
  const activityLogForDrawer = useMemo(() => mayaActivityLog.slice(0, 400), [mayaActivityLog]);

  /*
   * Smart scroll-to-bottom:
   *   – Always scrolls when the panel is first opened.
   *   – While open, only scrolls on new messages/typing if the user is
   *     already within 80 px of the bottom, so reading history is not
   *     interrupted by incoming messages.
   */
  useLayoutEffect(() => {
    if (!mayaChatOpen) {
      prevChatOpenRef.current = false;
      return;
    }
    const el = messagesContainerRef.current;
    if (!el) return;

    const justOpened = !prevChatOpenRef.current;
    prevChatOpenRef.current = true;

    // Consider the user "at the bottom" if within 80 px of the end.
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;

    if (!justOpened && !isNearBottom) {
      // User has scrolled up to read history — don't interrupt them.
      return;
    }

    const scrollToBottom = () => { el.scrollTop = el.scrollHeight; };
    scrollToBottom();
    const raf = requestAnimationFrame(() => requestAnimationFrame(scrollToBottom));
    const t1  = window.setTimeout(scrollToBottom, 60);
    const t2  = window.setTimeout(scrollToBottom, 200);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [mayaChatOpen, mayaMessages, mayaIsTyping]);

  useEffect(() => {
    if (!activityDrawerOpen) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setActivityDrawerOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activityDrawerOpen]);

  /* ── Focus input on open (text mode only) ── */
  useEffect(() => {
    if (!mayaChatOpen) return;
    if (voiceOnlyMaya) {
      setTimeout(() => dockInputRef.current?.focus(), 120);
      return;
    }
    setTimeout(() => inputRef.current?.focus(), 120);
  }, [mayaChatOpen, voiceOnlyMaya]);

  useEffect(() => {
    if (!mayaChatOpen) {
      cancelMayaSpeech();
      setMicInterimText('');
      setMicSessionActive(false);
    }
  }, [mayaChatOpen]);

  const loadMayaChatHistory = useCallback(
    async (reason) => {
      if (!authToken) return;
      // Prevent two concurrent fetches (mount + open can race without this guard).
      if (historyFetchInFlightRef.current) return;
      const tid = activeTenantId ?? 'demo';
      const key = `${tid}:${String(authToken).slice(0, 24)}`;
      const now = Date.now();
      if (
        reason !== 'force' &&
        mayaHistoryCacheRef.current.key === key &&
        now - mayaHistoryCacheRef.current.at < 10_000
      ) {
        return;
      }
      historyFetchInFlightRef.current = true;
      try {
        const rows = await fetchMayaChatHistory();
        if (!Array.isArray(rows) || rows.length === 0) return;
        hydrateMayaChatFromServer(rows);
        mayaHistoryCacheRef.current = { key, at: Date.now() };
      } catch {
        /* keep existing bubbles */
      } finally {
        historyFetchInFlightRef.current = false;
      }
    },
    [authToken, activeTenantId, hydrateMayaChatFromServer],
  );

  /* ── Server-backed history: load in the next event-loop tick after paint so it
       never blocks the initial render, but runs immediately rather than waiting
       for browser idle time (old requestIdleCallback timeout was up to 1200 ms). ── */
  useEffect(() => {
    if (!authToken) return undefined;
    let cancelled = false;
    const tid = window.setTimeout(() => {
      if (!cancelled) loadMayaChatHistory('mount');
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(tid);
    };
  }, [authToken, activeTenantId, loadMayaChatHistory]);

  /* ── Refresh when opening panel (stale / other tab); lightly debounced, deduped inside loader. ── */
  useEffect(() => {
    if (!authToken || !mayaChatOpen) return undefined;
    let cancelled = false;
    const tid = window.setTimeout(() => {
      if (!cancelled) loadMayaChatHistory('open');
    }, 160);
    return () => {
      cancelled = true;
      window.clearTimeout(tid);
    };
  }, [mayaChatOpen, authToken, loadMayaChatHistory]);

  /* ── Backend heartbeat — clears false "offline" after transient fetch errors ── */
  useEffect(() => {
    const onBeat = () => setOnline(true);
    window.addEventListener('easyhost-heartbeat', onBeat);
    return () => window.removeEventListener('easyhost-heartbeat', onBeat);
  }, []);

  /* ── Task-created toast ── */
  useEffect(() => {
    const h = (e) => {
      const task = e?.detail?.task;
      if (!task) return;
      const name  = (task.staff_name || task.staffName || 'צוות').trim();
      const emoji = /alma|עלמה/i.test(name) ? '🧹' : /avi|אבי/i.test(name) ? '⚡' : '🛠️';
      setToast({ name, emoji });
      setTimeout(() => setToast(null), 3500);
    };
    window.addEventListener('maya-task-created', h);
    return () => window.removeEventListener('maya-task-created', h);
  }, []);

  /* ── Activity feed poll — bridges SIMULATE / demo events to the chat ── */
  useEffect(() => {
    if (!mayaChatOpen) return;

    const poll = async () => {
      try {
        const since = feedSinceRef.current;
        const res = await fetch(
          `${API_URL}/activity-feed?since=${since}&include_manager=1`,
          withAuthFetchInit({ credentials: 'include' }),
        );
        if (!res.ok) return;
        const { events, server_ts } = await res.json();
        feedSinceRef.current = server_ts || Date.now();

        events.forEach((ev) => {
          if (feedSeenRef.current.has(ev.id)) return;
          feedSeenRef.current.add(ev.id);

          if (ev.type === 'task_created') {
            const content = ev.text || t('mayaChat.newTaskCreated');
            addMayaActivityEntry({
              kind: 'task_created',
              text: content,
              taskId: ev.task?.id,
            });
            notifyTasksChanged({ task: ev.task });
          } else {
            const content = ev.text || t('mayaChat.messageSent');
            addMayaActivityEntry({
              kind: 'feed_sim',
              text: content,
            });
          }
          setOnline(true);
        });
      } catch {
        // silent — don't set offline for poll failures
      }
    };

    poll(); // immediate first check
    const interval = setInterval(poll, 15000); // activity-feed — min 15s per ops policy
    return () => clearInterval(interval);
  }, [mayaChatOpen, addMayaActivityEntry, t]);

  /* ── /test-task manual trigger (Manual Trigger Mode) ── */
  const handleTestTask = async (raw) => {
    if (voiceOnlyMaya) clearBiktaAutoCloseTimer();
    // Syntax: /test-task [room] [description...]
    // e.g.  /test-task 102 צריך מגבות דחוף
    //        /test-task 60
    const parts       = raw.replace(/^\/test-task\s*/i, '').trim().split(/\s+/);
    const room        = parts[0] || '101';
    const description = parts.slice(1).join(' ') || 'משימת בדיקה ידנית';

    addMayaMessage({ role: 'user', content: raw });
    setMayaTyping(true);

    try {
      // Uses the existing /property-tasks POST — already live on the server,
      // no server restart needed.
      const res = await fetch(`${API_URL}/property-tasks`, withAuthFetchInit({
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          property_id:   room,
          property_name: `חדר ${room}`,
          description,
          staff_name:    'levikobi',
          status:        'Pending',
        }),
        credentials: 'include',
      }));
      const data = await res.json();

      if (res.ok && data.ok) {
        const task = data.task;
        const queueNote = data.task?.queued_message || '';
        const assistantContent = queueNote
          ? `✅ משימה נוצרה ועומדת בתור!\n🏠 *חדר ${room}*\n📋 ${description}\n\n${queueNote}`
          : `✅ משימה נוצרה!\n🏠 *חדר ${room}*\n📋 ${description}\n\n🟠 שויכה ל-levikobi — פתח את /worker/levikobi`;
        addMayaMessage({
          role:    'assistant',
          content: assistantContent,
          data:    { taskCreated: true, task },
        });
        speakAssistantReply(assistantContent);
        notifyTasksChanged({ task });
        onAfterSendSuccess?.();
      } else {
        addMayaMessage({
          role:    'assistant',
          content: `❌ שגיאה ביצירת משימה: ${data.error || res.status}`,
          isError: true,
        });
      }
    } catch {
      addMayaMessage({
        role:    'assistant',
        content: '❌ לא ניתן להתחבר לשרת. תבדוק שה-Flask רץ.',
        isError: true,
      });
    } finally {
      setMayaTyping(false);
    }
  };

  /* ── Send (typed or voice) — skip setLang for STT to avoid i18n / DOM “hiccup” loops ── */
  const sendCore = async (msg, { skipLangDetect = false } = {}) => {
    if (!msg || mayaIsTyping) return;
    if (sendLockRef.current) return;
    sendLockRef.current = true;
    try {
      if (!skipLangDetect) {
        if (hasHebrew(msg)) setLang('he'); else setLang('en');
      }
      setInput('');

      // ── Local command router — these NEVER touch the AI backend ──
      if (/^\/test-task(\s|$)/i.test(msg)) {
        await handleTestTask(msg);
        return;
      }
      if (/^\/clean(\s|$)/i.test(msg)) {
        const p = msg.replace(/^\/clean\s*/i, '').trim().split(/\s+/);
        await handleTestTask(`/test-task ${p[0] || '101'} ניקיון חדר`);
        return;
      }
      if (/^\/towels(\s|$)/i.test(msg)) {
        const p = msg.replace(/^\/towels\s*/i, '').trim().split(/\s+/);
        await handleTestTask(`/test-task ${p[0] || '101'} מגבות דחוף`);
        return;
      }
      if (/^\/fix(\s|$)/i.test(msg)) {
        const p = msg.replace(/^\/fix\s*/i, '').trim().split(/\s+/);
        await handleTestTask(`/test-task ${p[0] || '101'} תקלה טכנית`);
        return;
      }

      setLast429(false); // clear previous 429 banner on new AI attempt
      if (voiceOnlyMaya) clearBiktaAutoCloseTimer();
      addMayaMessage({ role: 'user', content: msg });
      setMayaTyping(true);

      // ── Streaming placeholder — added immediately so the bubble appears before the full reply ──
      const streamMsgId = `ms-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      let streamedText = '';
      // The streaming bubble IS the visual "typing" indicator. Hide the Loader2 row now so
      // it can never appear stuck while waiting for the first token from Gemini.
      addMayaMessage({ id: streamMsgId, role: 'assistant', content: '', streaming: true });
      setMayaTyping(false);

      // onDelta: called per-token by parseMayaSseResponse as Gemini yields chunks
      const onDelta = (chunk) => {
        streamedText += chunk;
        patchMayaMessage(streamMsgId, { content: streamedText, streaming: true });
      };

      try {
        const history = useStore
          .getState()
          .mayaMessages.slice(-6)
          .map((m) => ({ role: m.role, content: m.content }));
        const lang = isWorkerRole(role) ? 'th' : hasHebrew(msg) ? 'he' : 'en';
        let result;
        try {
          result = await maya.processCommand(msg, { history, language: lang, onDelta });
        } catch (firstErr) {
          const m = String(firstErr?.message || firstErr || '').toLowerCase();
          const keyBad =
            m.includes('key') && (m.includes('invalid') || m.includes('expired') || m.includes('unauthenticated'));
          const retryable =
            !keyBad &&
            (!firstErr?.status || firstErr.status >= 500 || m.includes('failed to fetch') || m.includes('network'));
          if (retryable) {
            await new Promise((r) => setTimeout(r, 200));
            // Reset streamed text for the retry attempt; keep streaming bubble visible
            streamedText = '';
            patchMayaMessage(streamMsgId, { content: '…', streaming: true });
            result = await maya.processCommand(msg, { history, language: lang, onDelta });
          } else {
            throw firstErr;
          }
        }

        if (result && (result.success === false || result.brainFailure)) {
          const failText =
            (typeof result.displayMessage === 'string' && result.displayMessage.trim() && result.displayMessage) ||
            (typeof result.message === 'string' && result.message.trim() && result.message) ||
            (typeof result.brainErrorDetail === 'string' && result.brainErrorDetail.trim() && result.brainErrorDetail) ||
            t('mayaChat.errorServer');
          patchMayaMessage(streamMsgId, { content: failText, isError: true, streaming: false, data: result });
          setOnline(true);
          return;
        }

        const rawReply =
          result?.message ||
          result?.displayMessage ||
          result?.response ||
          result?.reply ||
          (result?.data && (result.data.message || result.data.displayMessage || result.data.response)) ||
          t('common.taskCompleted');

        const mayaBrainMod = await import('../../utils/mayaBrain');
        const bulkTaskCount = mayaBrainMod.countTaskStatusUpdatesInMayaResult(result);
        const isBulkTaskUpdate = bulkTaskCount > 1;
        const displayContent = isBulkTaskUpdate
          ? MAYA_BULK_TASKS_DONE_HE
          : (typeof rawReply === 'string' ? rawReply : JSON.stringify(rawReply));

        // Settle the streaming bubble with the processed final content + task card data
        patchMayaMessage(streamMsgId, {
          content: displayContent,
          streaming: false,
          ...(isBulkTaskUpdate ? {} : { data: result }),
        });

        try {
          await mayaBrainMod.applyClientSideTaskUpdatesFromMayaResult(result);
        } catch (_) {
          /* optional client-side batch from parsed JSON */
        }
        speakAssistantReply(displayContent);
        setOnline(true);

        if (result.success) {
          addNotification({
            type: 'success', title: 'Maya',
            message: isBulkTaskUpdate ? MAYA_BULK_TASKS_DONE_HE : (typeof rawReply === 'string' ? rawReply : ''),
          });
        }
        const textOk = typeof rawReply === 'string' ? rawReply : '';
        const looksLikeTaskCreated =
          Boolean(result.taskCreated || result.shiftCreated || result.action === 'add_task' || result.action === 'add_tasks' || result.task || result.tasks) ||
          /משימה\s*נוצרה|נוצרה\s*בהצלחה|task\s*created/i.test(textOk);
        if (looksLikeTaskCreated) {
          addNotification({
            type: 'info',
            title: t('notifications.agentUpdate'),
            message: t('notifications.agentTaskCreated', {
              defaultValue: 'משימה חדשה נוצרה ושויכה לצוות.',
            }),
          });
          triggerShake();
          notifyTasksChanged({ task: result.task || result.task_data || (Array.isArray(result.tasks) ? result.tasks[0] : null) });
        }
        if (result.staffRegistered) {
          notifyStaffChanged({ staff: result.staff });
          addNotification({
            type: 'success',
            title: 'Maya — Staff',
            message: result.displayMessage || 'עובד/ת חדש/ה נרשמ/ה בהצלחה.',
          });
        }
        onAfterSendSuccess?.(result);
      } catch (err) {
        setOnline(false);
        const errStr = String(err?.message || err || '').toLowerCase();

        const isKeyInvalid = errStr.includes('key_invalid') || errStr.includes('__key_invalid__') ||
                             errStr.includes('api key not valid') || errStr.includes('api key invalid') ||
                             errStr.includes('key has expired') || errStr.includes('api key expired') ||
                             errStr.includes('unauthenticated') || errStr.includes('permission_denied');
        const is429 = errStr.includes('429') || errStr.includes('quota') ||
                      errStr.includes('exhausted') || errStr.includes('resource');

        if (is429) setLast429(true);

        let errorContent;
        if (isKeyInvalid) {
          errorContent =
            '🔑 Maya is offline — the Gemini API key is invalid or missing. ' +
            'Set GEMINI_API_KEY in your server environment (.env or Render), restart the backend, ' +
            'and confirm the key at Google AI Studio.';
        } else if (is429) {
          errorContent = t('mayaChat.error429');
        } else {
          errorContent = t('mayaChat.errorServer');
        }

        patchMayaMessage(streamMsgId, { content: errorContent, isError: true, streaming: false });
      } finally {
        setMayaTyping(false);
      }
    } finally {
      sendLockRef.current = false;
    }
  };

  sendCoreRef.current = sendCore;

  const handleSend = () => {
    const text = input.trim();
    if (!text) return;
    if (voiceOnlyMaya && !mayaChatOpen) setMayaChatOpen(true);
    sendCore(text, { skipLangDetect: false });
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  /* ── Mic: explicit permission + SpeechRecognition while “session” is on ── */
  const toggleMicConversation = useCallback(
    async (e) => {
      e?.preventDefault?.();
      if (mayaIsTyping) return;
      const SR = getSpeechRecognitionCtor();
      if (!SR) {
        setToast({ name: 'Speech not supported', emoji: '⚠️' });
        setTimeout(() => setToast(null), 3500);
        return;
      }
      if (micSessionActive) {
        if (micIdleRestartRef.current) {
          clearTimeout(micIdleRestartRef.current);
          micIdleRestartRef.current = null;
        }
        setMicInterimText('');
        setMicSessionActive(false);
        return;
      }
      if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          stream.getTracks().forEach((t) => t.stop());
        } catch (err) {
          const denied = /denied|notallowed|NotAllowed/i.test(String(err?.name || err || ''));
          setToast({
            name: denied
              ? (isRTL ? 'יש לאשר גישה למיקרופון' : 'Allow microphone for Maya')
              : (isRTL ? 'לא ניתן לפתוח את המיקרופון' : 'Could not open microphone'),
            emoji: '⚠️',
          });
          setTimeout(() => setToast(null), 4000);
          return;
        }
      }
      playMicListenPing();
      cancelMayaSpeech();
      setMicSessionActive(true);
    },
    [mayaIsTyping, micSessionActive, isRTL],
  );

  useEffect(() => {
    if (!voiceOnlyMaya) return undefined;
    const h = () => toggleMicConversation();
    window.addEventListener('maya-external-mic-toggle', h);
    return () => window.removeEventListener('maya-external-mic-toggle', h);
  }, [voiceOnlyMaya, toggleMicConversation]);

  useEffect(() => {
    if (!micSessionActive) {
      try {
        micSessionRecRef.current?.stop();
      } catch (_) {}
      micSessionRecRef.current = null;
      return undefined;
    }
    if (!voiceOnlyMaya && !mayaChatOpen) {
      try {
        micSessionRecRef.current?.stop();
      } catch (_) {}
      micSessionRecRef.current = null;
      return undefined;
    }
    const SR = getSpeechRecognitionCtor();
    if (!SR) {
      setMicSessionActive(false);
      return undefined;
    }
    let alive = true;
    const rec = new SR();
    rec.lang = isWorkerRole(role) ? 'th-TH' : 'he-IL';
    rec.continuous = false;
    rec.interimResults = true;
    rec.onresult = (ev) => {
      let interim = '';
      let finalLine = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        const t = stripAsciiControlChars(r[0]?.transcript || '');
        if (r.isFinal) {
          finalLine = t.replace(/\s+/g, ' ').trim();
        } else {
          interim += t;
        }
      }
      const interimTrim = interim.replace(/\s+/g, ' ').trim();
      if (interimTrim) setMicInterimText(interimTrim);
      if (!finalLine) return;
      setMicInterimText('');
      const now = Date.now();
      if (finalLine === lastMicFinalRef.current && now - lastMicFinalAtRef.current < 1800) return;
      lastMicFinalRef.current = finalLine;
      lastMicFinalAtRef.current = now;
      sendCoreRef.current?.(finalLine, { skipLangDetect: true });
    };
    rec.onerror = (ev) => {
      if (ev?.error === 'no-speech' || ev?.error === 'aborted') return;
      if (ev?.error === 'not-allowed') {
        setMicInterimText('');
        setMicSessionActive(false);
        setToast({
          name: isRTL ? 'הדפדפן חוסם את המיקרופון' : 'Microphone blocked in browser',
          emoji: '⚠️',
        });
        setTimeout(() => setToast(null), 4000);
      }
    };
    rec.onend = () => {
      if (!alive) return;
      if (!micSessionActiveRef.current) return;
      micIdleRestartRef.current = window.setTimeout(() => {
        micIdleRestartRef.current = null;
        if (!alive || !micSessionActiveRef.current) return;
        try {
          rec.start();
        } catch (_) {}
      }, 80);
    };
    micSessionRecRef.current = rec;
    try {
      rec.start();
    } catch (_) {
      setMicSessionActive(false);
    }
    return () => {
      alive = false;
      if (micIdleRestartRef.current) {
        clearTimeout(micIdleRestartRef.current);
        micIdleRestartRef.current = null;
      }
      try {
        rec.stop();
      } catch (_) {}
      micSessionRecRef.current = null;
    };
  }, [micSessionActive, mayaChatOpen, voiceOnlyMaya, role, isRTL]);

  const timeLocale = i18n.language === 'he' ? 'he-IL' : 'en-US';

  return (
    <div
      id="maya-chat-root"
      className={`maya-chat-isolated maya-root${voiceOnlyMaya ? ' maya-root--voice-dock' : ''}`}
    >

      {/* ── Toast ── */}
      {toast && (
        <div className="maya-toast">
          {t('mayaChat.toast', { name: toast.name, emoji: toast.emoji })}
        </div>
      )}

      {(mayaChatOpen || closing) && (
        <div
          className={`maya-phone maya-phone--glass maya-phone--modern${voiceOnlyMaya ? ' maya-phone--bikta-dock' : ''}${isShaking ? ' maya-shake' : ''}${closing ? ' maya-phone--leave' : ''}`}
          dir={isRTL ? 'rtl' : 'ltr'}
          role="dialog"
          aria-modal="true"
          aria-label={t('mayaChat.dialogLabel')}
        >

          {/* ── HEADER  position:absolute top:0 height:60px z-index:1000 ── */}
          <div className="maya-header">
            <div className="maya-header-inner">
              <button
                type="button"
                onClick={() => (voiceOnlyMaya ? closePanelWithAnim() : toggleMayaChat?.())}
                className="maya-hdr-x"
                aria-label="Close"
              >
                <X size={19} />
              </button>

              <div className="maya-hdr-text">
                <span className="maya-hdr-name">{t('mayaChat.title')}</span>
                <span className="maya-hdr-role">{t('mayaChat.role')}</span>
                <span className="maya-hdr-status">
                  {isMayaStreaming
                    ? (isRTL ? 'מאיה כותבת…' : 'Maya is typing…')
                    : mayaOnline
                      ? t('mayaChat.status.online')
                      : t('mayaChat.status.connecting')}
                </span>
              </div>

              <div className="maya-hdr-actions">
                <button
                  type="button"
                  className={`maya-hdr-activity${activityDrawerOpen ? ' maya-hdr-activity--open' : ''}`}
                  onClick={() => setActivityDrawerOpen((o) => !o)}
                  aria-expanded={activityDrawerOpen}
                  aria-label={isRTL ? 'מגירת פעילות' : 'Activity history'}
                  title={isRTL ? 'היסטוריית פעולות' : 'Activity history'}
                >
                  <ScrollText size={20} strokeWidth={2} aria-hidden />
                </button>
                {mayaIsTyping ? (
                  <span className="maya-thinking-pulse" aria-hidden title={isRTL ? 'מאיה חושבת' : 'Thinking'} />
                ) : null}
              </div>
            </div>
          </div>

          {/* ── BODY — sits below the absolute header ── */}
          <div className="maya-body">

            {/* Messages — scrollable; input bar stays fixed below (flex layout + flex-shrink:0) */}
            <div className="maya-messages" ref={messagesContainerRef}>
              {visibleMessages.map((msg) => {
                const rawText = typeof msg.content === 'string'
                  ? msg.content
                  : (msg.content?.content ?? msg.content ?? '');
                // While streaming, extract human-readable text from the accumulating JSON response.
                // extractStreamingText pulls the "message" field as soon as it appears so the user
                // never sees raw `{"action":"info","message":"..."}` JSON in the bubble.
                const text = msg.streaming
                  ? extractStreamingText(rawText)
                  : formatMayaChatDisplayText(rawText);
                const rtl = hasHebrew(text);
                const task = msg.data?.task || msg.data?.task_data;
                const hasTaskCard = msg.role === 'assistant' && task?.id && !msg.streaming;
                const bubbleKind = msg.role === 'user' ? 'maya-message-user' : 'maya-message-assistant';
                return (
                  <div key={msg.id} className={`maya-msg ${msg.role} maya-msg-fadein`}>
                    <div className="maya-msg-col">
                      <div
                        className={`msg-bubble ${bubbleKind}${msg.isError ? ' error' : ''}${rtl ? ' rtl' : ''}`}
                        dir={rtl ? 'rtl' : 'ltr'}
                      >
                        <p className={msg.streaming ? 'maya-streaming-text' : ''}>
                          {text || (msg.streaming ? '' : '…')}
                        </p>
                        {!msg.streaming && (
                          <span className="msg-meta">
                            {new Date(msg.timestamp).toLocaleTimeString(timeLocale, {
                              hour: '2-digit', minute: '2-digit',
                            })}
                          </span>
                        )}
                      </div>
                      {hasTaskCard && (
                        <TaskCard
                          task={task}
                          onComplete={handleTaskComplete}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
              {mayaIsTyping ? (
                <div className="maya-msg assistant maya-msg-fadein" aria-live="polite">
                  <div className="maya-msg-col">
                    <div className="msg-bubble maya-message-assistant maya-msg-bubble--pending" dir="ltr">
                      <p className="maya-pending-reply">
                        <Loader2 className="spin" size={16} aria-hidden />
                        <span>{isRTL ? 'מאיה כותבת…' : 'Maya is typing…'}</span>
                      </p>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            {activityDrawerOpen ? (
              <div className="maya-activity-drawer-root" role="presentation">
                <button
                  type="button"
                  className="maya-activity-drawer-scrim"
                  aria-label={isRTL ? 'סגור' : 'Close'}
                  onClick={() => setActivityDrawerOpen(false)}
                />
                <aside
                  className={`maya-activity-drawer-panel${isRTL ? ' maya-activity-drawer-panel--rtl' : ''}`}
                  dir={isRTL ? 'rtl' : 'ltr'}
                  aria-label={isRTL ? 'מגירת פעילות' : 'Activity log'}
                >
                  <div className="maya-activity-drawer-head">
                    <h3 className="maya-activity-drawer-title">
                      {isRTL ? 'מגירת פעילות' : 'Activity'}
                    </h3>
                    <button
                      type="button"
                      className="maya-activity-drawer-close"
                      onClick={() => setActivityDrawerOpen(false)}
                      aria-label={isRTL ? 'סגור' : 'Close'}
                    >
                      <X size={18} />
                    </button>
                  </div>
                  <div className="maya-activity-drawer-list">
                    {activityLogForDrawer.length === 0 ? (
                      <p className="maya-activity-drawer-empty">
                        {isRTL ? 'אין רשומות עדיין.' : 'No activity yet.'}
                      </p>
                    ) : (
                      activityLogForDrawer.map((entry) => (
                        <div key={entry.id} className="maya-activity-drawer-item">
                          <span className="maya-activity-drawer-item-time">
                            {new Date(entry.ts).toLocaleString(timeLocale, {
                              day: '2-digit',
                              month: '2-digit',
                              hour: '2-digit',
                              minute: '2-digit',
                              second: '2-digit',
                            })}
                          </span>
                          <p className="maya-activity-drawer-item-text">{entry.text}</p>
                        </div>
                      ))
                    )}
                  </div>
                </aside>
              </div>
            ) : null}

            {/* ── 429 bypass button — only visible when AI quota hit ── */}
            {last429 && (
              <div className="maya-chat-bypass-wrap" dir="rtl">
                <button
                  type="button"
                  className="maya-chat-bypass-btn"
                  onClick={() => {
                    setLast429(false);
                    const lastUser = [...mayaMessages].reverse().find(m => m.role === 'user');
                    const rm = (lastUser?.content || '').match(/\d{2,4}/)?.[0] || '101';
                    handleTestTask(`/test-task ${rm} משימה ידנית`);
                  }}
                >
                  {t('mayaChat.bypassBtn')}
                </button>
                <div className="maya-chat-bypass-hint">
                  {t('mayaChat.bypassHint')}
                </div>
              </div>
            )}

            {/* Text + mic (standard); Bikta / Bazaar: slim dock at screen bottom — see .maya-voice-dock */}
            {!voiceOnlyMaya ? (
              <>
            {micSessionActive && (
              <div className="maya-mic-live-strip" aria-live="polite" dir={isRTL ? 'rtl' : 'ltr'}>
                <span className="maya-mic-live-dot" title={isRTL ? 'מאזינה' : 'Listening'} />
                <span className="maya-mic-live-wave" aria-hidden>
                  <i /><i /><i />
                </span>
                {micInterimText ? (
                  <span className="maya-mic-live-interim" dir="auto">{micInterimText}</span>
                ) : null}
              </div>
            )}
            {mayaBatchProcessing ? (
              <div className="maya-batch-processing-hint" aria-live="polite">
                <Loader2 className="maya-batch-processing-hint__icon" size={15} aria-hidden />
                <span>{isRTL ? 'מעבדת…' : 'Processing…'}</span>
              </div>
            ) : null}
              <div className="maya-input-bar" dir="ltr">
                <div className="maya-input-pill">
                  <input
                    ref={inputRef}
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={t('mayaChat.askPlaceholder')}
                    className="maya-input-field"
                    disabled={mayaIsTyping}
                    dir={isRTL ? 'rtl' : 'ltr'}
                    autoComplete="off"
                  />
                </div>
                <button
                  type="button"
                  className={`maya-mic-btn${micSessionActive ? ' maya-mic-btn--listening' : ''}`}
                  disabled={mayaIsTyping}
                  onClick={toggleMicConversation}
                  aria-label={
                    micSessionActive
                      ? (isRTL ? 'עצור האזנה' : 'Stop listening')
                      : (isRTL ? 'מיקרופון' : 'Microphone')
                  }
                >
                  <Mic size={17} className="maya-mic-btn-icon" strokeWidth={2} aria-hidden />
                </button>
                <button
                  type="button"
                  className="maya-bar-send-icon-btn"
                  disabled={mayaIsTyping || !input.trim()}
                  onClick={handleSend}
                  aria-label={t('mayaChat.send')}
                  title={t('mayaChat.send')}
                >
                  <Send size={20} strokeWidth={2} aria-hidden />
                </button>
              </div>
              </>
            ) : null}

          </div>{/* end .maya-body */}
        </div>
      )}

      {/* Bikta / Bazaar: WhatsApp-style bottom dock — text + שליחה; orb above = mic only (no extra FAB) */}
      {voiceOnlyMaya ? (
        <div className="maya-voice-dock" aria-label="Maya voice and input">
          <div className="maya-voice-dock-orb-row">
            <div className="maya-voice-dock-orb-row__live" aria-live="polite">
              {micSessionActive ? (
                <>
                  <span className="maya-mic-live-dot" title={isRTL ? 'מאזינה' : 'Listening'} />
                  <span className="maya-mic-live-wave" aria-hidden>
                    <i /><i /><i />
                  </span>
                  {micInterimText ? (
                    <span className="maya-mic-live-interim" dir="auto">{micInterimText}</span>
                  ) : null}
                </>
              ) : null}
            </div>
            <button
              type="button"
              className={`maya-voice-orb${micSessionActive ? ' maya-voice-orb--listening' : ''}`}
              disabled={mayaIsTyping}
              onClick={toggleMicConversation}
              aria-pressed={micSessionActive}
              aria-label={
                micSessionActive
                  ? (isRTL ? 'עצור האזנה' : 'Stop listening')
                  : (isRTL ? 'הפעל מיקרופון' : 'Start microphone')
              }
            >
              <span className="maya-fab-orb-dot" aria-hidden />
            </button>
          </div>
          {mayaBatchProcessing ? (
            <div className="maya-batch-processing-hint maya-batch-processing-hint--dock" aria-live="polite">
              <Loader2 className="maya-batch-processing-hint__icon" size={15} aria-hidden />
              <span>{isRTL ? 'מעבדת…' : 'Processing…'}</span>
            </div>
          ) : null}
          <div className="maya-voice-dock-bar" dir={isRTL ? 'rtl' : 'ltr'}>
            <div className="maya-input-pill maya-input-pill--dock">
              <input
                ref={dockInputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t('mayaChat.askPlaceholder')}
                className="maya-input-field"
                disabled={mayaIsTyping}
                dir={isRTL ? 'rtl' : 'ltr'}
                autoComplete="off"
              />
            </div>
            <button
              type="button"
              className="maya-voice-send-icon-btn"
              disabled={mayaIsTyping || !input.trim()}
              onClick={handleSend}
              aria-label={t('mayaChat.send')}
              title={t('mayaChat.send')}
            >
              <Send size={22} strokeWidth={2} className="maya-voice-send-plane" aria-hidden />
            </button>
          </div>
        </div>
      ) : null}

      {/* ── Floating button (non–voice-only routes) ── */}
      {!voiceOnlyMaya ? (
        <button
          type="button"
          onClick={() => {
            if (mayaChatOpen) {
              toggleMayaChat?.();
            } else {
              setMayaChatOpen(true);
            }
          }}
          className={`maya-fab ${mayaChatOpen ? 'maya-fab-open' : ''}`}
          aria-label={mayaChatOpen ? t('mayaChat.fabClose') : t('mayaChat.fabOpen')}
          aria-expanded={mayaChatOpen}
          aria-haspopup="dialog"
        >
          {mayaChatOpen ? (
            <X size={24} aria-hidden="true" />
          ) : (
            <MessageCircle size={24} aria-hidden="true" />
          )}
          <div className="maya-fab-ring" aria-hidden="true" />
        </button>
      ) : null}

    </div>
  );
});

export default MayaChat;
