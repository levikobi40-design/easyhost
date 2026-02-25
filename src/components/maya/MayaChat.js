import React, { useState, useRef, useEffect } from 'react';
import {
  MessageCircle, X, Send, User, Mic, Check,
  Loader2, Search, FileText, Image, Zap, Droplets,
} from 'lucide-react';
import useTranslations from '../../hooks/useTranslations';
import useStore from '../../store/useStore';
import { maya } from '../../services/agentOrchestrator';
import { API_URL } from '../../utils/apiClient';
import './MayaChat.css';

const MAYA_AVATAR_URL =
  'https://api.dicebear.com/7.x/personas/svg?seed=MayaManager&backgroundColor=25D366';

const hasHebrew = (t) => /[\u0590-\u05FF]/.test(t || '');

export default function MayaChat() {
  const mayaChatOpen   = useStore((s) => s.mayaChatOpen);
  const toggleMayaChat = useStore((s) => s.toggleMayaChat);
  const {
    mayaMessages, addMayaMessage,
    mayaIsTyping, setMayaTyping,
    addNotification, stats,
  } = useStore();
  const { t, i18n } = useTranslations();
  const lang    = useStore((s) => s.lang);
  const setLang = useStore((s) => s.setLang);
  const isRTL   = lang === 'he';

  const [input, setInput]       = useState('');
  const [mayaOnline, setOnline] = useState(true);  // assume online — server is running
  const [toast, setToast]       = useState(null);
  const [last429, setLast429]   = useState(false); // true when Gemini returns quota error

  const messagesEndRef   = useRef(null);
  const inputRef         = useRef(null);
  const connectedRef     = useRef(false);
  const proactiveRef     = useRef(false);
  const feedSinceRef     = useRef(Date.now());     // poll only events newer than this
  const feedSeenRef      = useRef(new Set());      // dedup by event id

  /* ── Scroll to latest message — fires on every new message ── */
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [mayaMessages, mayaIsTyping]);

  /* ── Focus input on open ── */
  useEffect(() => {
    if (mayaChatOpen) setTimeout(() => inputRef.current?.focus(), 120);
  }, [mayaChatOpen]);

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

  /* ── Greet once on first open ── */
  useEffect(() => {
    if (!mayaChatOpen) return;
    if (!connectedRef.current) {
      connectedRef.current = true;
      addMayaMessage({
        role: 'assistant',
        content: 'קובי, אני מחוברת ומוכנה לעבודה! 🟢 איך אפשר לעזור?',
      });
    }
  }, [mayaChatOpen, addMayaMessage]);

  /* ── Activity feed poll — bridges SIMULATE terminal events to the chat ── */
  useEffect(() => {
    if (!mayaChatOpen) return;

    const poll = async () => {
      try {
        const since = feedSinceRef.current;
        const res = await fetch(`${API_URL}/api/activity-feed?since=${since}`);
        if (!res.ok) return;
        const { events, server_ts } = await res.json();
        feedSinceRef.current = server_ts || Date.now();

        events.forEach((ev) => {
          if (feedSeenRef.current.has(ev.id)) return;
          feedSeenRef.current.add(ev.id);

          if (ev.type === 'task_created') {
            // Show task confirmation + trigger table refresh
            addMayaMessage({
              role: 'assistant',
              content: ev.text || '✅ משימה חדשה נוצרה',
              data: { taskCreated: true, task: ev.task },
            });
            window.dispatchEvent(new CustomEvent('maya-task-created', {
              detail: { task: ev.task },
            }));
            // Trigger task table refresh
            window.dispatchEvent(new Event('maya-refresh-tasks'));
          } else {
            // WhatsApp/SMS/Voice simulate messages — show as info bubble
            addMayaMessage({
              role: 'assistant',
              content: ev.text || '📡 הודעה נשלחה',
              data: { simulated: true },
            });
          }
          setOnline(true);
        });
      } catch {
        // silent — don't set offline for poll failures
      }
    };

    poll(); // immediate first check
    const interval = setInterval(poll, 30000); // 30 s — reduce traffic during testing
    return () => clearInterval(interval);
  }, [mayaChatOpen, addMayaMessage]);

  /* ── Proactive occupancy alert ── */
  useEffect(() => {
    if (!mayaChatOpen || proactiveRef.current) return;
    if ((stats?.occupancy?.current ?? 0) >= 87) {
      proactiveRef.current = true;
      addMayaMessage({ role: 'assistant', content: t('mayaChat.proactiveOccupancy') });
    }
  }, [mayaChatOpen, stats, addMayaMessage, t]);

  /* ── /test-task manual trigger (Manual Trigger Mode) ── */
  const handleTestTask = async (raw) => {
    // Syntax: /test-task [room] [description...]
    // e.g.  /test-task 102 צריך מגבות דחוף
    //        /test-task 60
    const parts       = raw.replace(/^\/test-task\s*/i, '').trim().split(/\s+/);
    const room        = parts[0] || '101';
    const description = parts.slice(1).join(' ') || 'משימת בדיקה ידנית';

    addMayaMessage({ role: 'user', content: raw });
    setMayaTyping(true);

    try {
      // Uses the existing /api/property-tasks POST — already live on the server,
      // no server restart needed.
      const res = await fetch(`${API_URL}/api/property-tasks`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          property_id:   room,
          property_name: `חדר ${room}`,
          description,
          staff_name:    'levikobi',
          status:        'Pending',
        }),
      });
      const data = await res.json();

      if (res.ok && data.ok) {
        const task = data.task;
        const queueNote = data.task?.queued_message || '';
        addMayaMessage({
          role:    'assistant',
          content: queueNote
            ? `✅ משימה נוצרה ועומדת בתור!\n🏠 *חדר ${room}*\n📋 ${description}\n\n${queueNote}`
            : `✅ משימה נוצרה!\n🏠 *חדר ${room}*\n📋 ${description}\n\n🟠 שויכה ל-levikobi — פתח את /worker/levikobi`,
          data:    { taskCreated: true, task },
        });
        // Broadcast to Dashboard + WorkerView
        window.dispatchEvent(new CustomEvent('maya-task-created', { detail: { task } }));
        window.dispatchEvent(new Event('maya-refresh-tasks'));
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

  /* ── Send ── */
  const handleSend = async () => {
    const msg = input.trim();
    if (!msg || mayaIsTyping) return;
    if (hasHebrew(msg)) setLang('he'); else setLang('en');
    setInput('');

    // ── Local command router — these NEVER touch Gemini ──
    if (/^\/test-task(\s|$)/i.test(msg)) return handleTestTask(msg);
    if (/^\/clean(\s|$)/i.test(msg)) {
      const p = msg.replace(/^\/clean\s*/i, '').trim().split(/\s+/);
      return handleTestTask(`/test-task ${p[0] || '101'} ניקיון חדר`);
    }
    if (/^\/towels(\s|$)/i.test(msg)) {
      const p = msg.replace(/^\/towels\s*/i, '').trim().split(/\s+/);
      return handleTestTask(`/test-task ${p[0] || '101'} מגבות דחוף`);
    }
    if (/^\/fix(\s|$)/i.test(msg)) {
      const p = msg.replace(/^\/fix\s*/i, '').trim().split(/\s+/);
      return handleTestTask(`/test-task ${p[0] || '101'} תקלה טכנית`);
    }

    setLast429(false); // clear previous 429 banner on new AI attempt
    addMayaMessage({ role: 'user', content: msg });
    setMayaTyping(true);

    try {
      const history = mayaMessages.slice(-6).map((m) => ({ role: m.role, content: m.content }));
      const result  = await maya.processCommand(msg, { history });
      const text    = result?.message ?? result?.displayMessage ?? t('common.taskCompleted');

      addMayaMessage({
        role: 'assistant',
        content: typeof text === 'string' ? text : JSON.stringify(text),
        data: result,
      });
      setOnline(true);

      if (result.success) {
        addNotification({
          type: 'success', title: 'Maya',
          message: typeof text === 'string' ? text : '',
        });
      }
      if (result.taskCreated || result.action === 'add_task' || result.task) {
        addNotification({
          type: 'info',
          title: t('notifications.agentUpdate'),
          message: t('notifications.agentTaskCreated', {
            defaultValue: 'משימה חדשה נוצרה ושויכה לצוות.',
          }),
        });
        window.dispatchEvent(new CustomEvent('maya-task-created', {
          detail: { task: result.task || result.task_data },
        }));
      }
    } catch (err) {
      setOnline(false);
      const errStr = String(err?.message || err || '').toLowerCase();
      const is429  = errStr.includes('429') || errStr.includes('quota') ||
                     errStr.includes('exhausted') || errStr.includes('resource');
      if (is429) setLast429(true);
      addMayaMessage({
        role: 'assistant',
        content: is429
          ? 'מאיה עמוסה כרגע (Google 429 — עומס זמני) 😮‍💨\nלחץ על כפתור "משימה ידנית" כדי לעקוף את ה-AI'
          : 'קובי, יש תקלה בחיבור לשרת גוגל. תבדוק את הטרמינל 🔴',
        isError: true,
      });
    } finally {
      setMayaTyping(false);
    }
  };

  const handleQuickAction = (cmd) => {
    setInput(cmd);
    // Use setTimeout so state updates before send
    setTimeout(() => {
      const syntheticSend = async () => {
        if (!cmd.trim() || mayaIsTyping) return;
        if (hasHebrew(cmd)) setLang('he'); else setLang('en');
        addMayaMessage({ role: 'user', content: cmd });
        setMayaTyping(true);
        try {
          const result = await maya.processCommand(cmd, { history: [] });
          const text   = result?.message ?? result?.displayMessage ?? '';
          addMayaMessage({
            role: 'assistant',
            content: typeof text === 'string' ? text : JSON.stringify(text),
            data: result,
          });
          setOnline(true);
        } catch {
          addMayaMessage({
            role: 'assistant',
            content: 'קובי, יש תקלה בחיבור לשרת גוגל. תבדוק את הטרמינל 🔴',
            isError: true,
          });
        } finally {
          setMayaTyping(false);
          setInput('');
        }
      };
      syntheticSend();
    }, 60);
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const timeLocale = i18n.language === 'he' ? 'he-IL' : 'en-US';

  const quickActions = [
    { id: 'scan',   icon: Search,   label: t('mayaChat.quickActions.scan'),       command: 'scan new Airbnb leads' },
    { id: 'report', icon: FileText, label: t('mayaChat.quickActions.report'),     command: 'generate daily report' },
    { id: 'clean',  icon: Droplets, label: t('mayaChat.quickActions.cleaning'),   command: 'לשלוח מנקה' },
    { id: 'post',   icon: Image,    label: t('mayaChat.quickActions.post'),       command: 'create marketing post' },
    { id: 'auto',   icon: Zap,      label: t('mayaChat.quickActions.automation'), command: 'enable automations' },
  ];

  const guestChips = [
    { emoji: '🚿', label: 'מגבות',      cmd: 'אני צריך מגבות' },
    { emoji: '🧼', label: 'ניקיון',      cmd: 'לשלוח מנקה לחדר שלי' },
    { emoji: '🛠️', label: 'תקלה',       cmd: 'יש תקלה בחדר שלי' },
    { emoji: '🧪', label: 'בדיקה',      cmd: '/test-task 102 ניקיון חדר' },
  ];

  return (
    <div className="maya-root">

      {/* ── Toast ── */}
      {toast && (
        <div className="maya-toast">
          ✅ משימה חדשה ל-{toast.name} נשלחה! {toast.emoji}
        </div>
      )}

      {/* ══════════════════════════════════════
          iPhone Shell — only rendered when open
          border-radius:30px; overflow:hidden;
          border:8px solid #333
         ══════════════════════════════════════ */}
      {mayaChatOpen && (
        <div className="maya-phone" dir={isRTL ? 'rtl' : 'ltr'}>

          {/* ── HEADER  position:absolute top:0 height:60px z-index:1000 ── */}
          <div className="maya-header">
            {/* iPhone notch pill */}
            <div className="maya-notch" />

            <div className="maya-header-inner">
              {/* Back/close */}
              <button
                type="button"
                onClick={() => toggleMayaChat?.()}
                className="maya-hdr-x"
                aria-label="Close"
              >
                <X size={19} />
              </button>

              {/* Avatar + online dot */}
              <div className="maya-hdr-avatar-wrap">
                <img src={MAYA_AVATAR_URL} alt="Maya" className="maya-hdr-avatar" />
                {mayaOnline && <span className="maya-hdr-dot" />}
              </div>

              {/* Name + status */}
              <div className="maya-hdr-text">
                <span className="maya-hdr-name">Maya · AI Concierge</span>
                <span className="maya-hdr-status">
                  {mayaOnline ? '🟢 Online' : '⏳ מתחברת...'}
                </span>
              </div>
            </div>
          </div>

          {/* ── BODY — sits below the absolute header ── */}
          <div className="maya-body">

            {/* Staff shortcut chips */}
            <div className="maya-quick-bar">
              {quickActions.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className="maya-quick-chip"
                  onClick={() => handleQuickAction(a.command)}
                >
                  <a.icon size={12} />
                  <span>{a.label}</span>
                </button>
              ))}
            </div>

            {/* Messages */}
            <div className="maya-messages">
              {mayaMessages.map((msg) => {
                const text = typeof msg.content === 'string'
                  ? msg.content
                  : (msg.content?.content ?? String(msg.content ?? ''));
                const rtl = hasHebrew(text);
                return (
                  <div key={msg.id} className={`maya-msg ${msg.role}`}>
                    <div className="msg-avatar">
                      {msg.role === 'assistant'
                        ? <img src={MAYA_AVATAR_URL} alt="M" className="msg-avatar-img" />
                        : <User size={14} />}
                    </div>
                    <div
                      className={`msg-bubble${msg.isError ? ' error' : ''}${rtl ? ' rtl' : ''}`}
                      dir={rtl ? 'rtl' : 'ltr'}
                    >
                      <p>{text}</p>
                      <span className="msg-meta">
                        {new Date(msg.timestamp).toLocaleTimeString(timeLocale, {
                          hour: '2-digit', minute: '2-digit',
                        })}
                        {msg.data?.taskCreated && (
                          <Check size={12} className="msg-tick" />
                        )}
                      </span>
                    </div>
                  </div>
                );
              })}

              {mayaIsTyping && (
                <div className="maya-msg assistant">
                  <div className="msg-avatar">
                    <img src={MAYA_AVATAR_URL} alt="M" className="msg-avatar-img" />
                  </div>
                  <div className="msg-bubble typing">
                    <span /><span /><span />
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Guest chips */}
            <div className="maya-guest-chips">
              {guestChips.map((c) => (
                <button
                  key={c.label}
                  type="button"
                  className="maya-guest-chip"
                  onClick={() => handleQuickAction(c.cmd)}
                >
                  {c.emoji} {c.label}
                </button>
              ))}
            </div>

            {/* ── 429 bypass button — only visible when Gemini quota hit ── */}
            {last429 && (
              <div style={{ padding: '4px 12px 6px', direction: 'rtl' }}>
                <button
                  type="button"
                  onClick={() => {
                    setLast429(false);
                    // extract room from last user message, fallback 101
                    const lastUser = [...mayaMessages].reverse().find(m => m.role === 'user');
                    const rm = (lastUser?.content || '').match(/\d{2,4}/)?.[0] || '101';
                    handleTestTask(`/test-task ${rm} משימה ידנית`);
                  }}
                  style={{
                    width: '100%', padding: '11px 14px',
                    background: 'linear-gradient(135deg,#f59e0b 0%,#ef4444 100%)',
                    border: 'none', borderRadius: 14,
                    color: '#fff', fontWeight: 800, fontSize: 13,
                    cursor: 'pointer', letterSpacing: '0.03em',
                    boxShadow: '0 4px 18px rgba(239,68,68,0.45)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  }}
                >
                  ⚡ עקוף AI — צור משימה ידנית עכשיו
                </button>
                <div style={{ textAlign: 'center', fontSize: 10, color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>
                  או הקלד /test-task [חדר] · /clean [חדר] · /towels [חדר] · /fix [חדר]
                </div>
              </div>
            )}

            {/* Input bar */}
            <div className="maya-input-bar">
              <div className="maya-input-pill">
                <input
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder={t('mayaChat.askPlaceholder')}
                  className="maya-input-field"
                  disabled={mayaIsTyping}
                  dir={isRTL ? 'rtl' : 'ltr'}
                />
              </div>
              <button
                type="button"
                onClick={input.trim() ? handleSend : undefined}
                disabled={mayaIsTyping}
                className={`maya-send-btn${input.trim() ? ' active' : ''}`}
                aria-label={input.trim() ? 'Send' : 'Voice'}
              >
                {mayaIsTyping
                  ? <Loader2 size={19} className="spin" />
                  : input.trim() ? <Send size={19} /> : <Mic size={19} />}
              </button>
            </div>

          </div>{/* end .maya-body */}
        </div>
      )}

      {/* ── Floating button ── */}
      <button
        type="button"
        onClick={() => toggleMayaChat?.()}
        className="maya-fab"
        aria-label="Toggle Maya"
      >
        {mayaChatOpen ? <X size={25} /> : <MessageCircle size={25} />}
        <div className="maya-fab-ring" />
      </button>

    </div>
  );
}
