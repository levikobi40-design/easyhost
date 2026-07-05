import React, { useEffect, useState } from 'react';
import { getMessages } from '../../services/api';
import { whatsappService } from '../../services/whatsapp';
import './GuestChatFeed.css';

const ChatMessage = ({ msg }) => (
  <div
    className={`guest-chat-msg ${msg.isAI ? 'guest-chat-msg--ai' : 'guest-chat-msg--guest'}`}
  >
    <div className={`guest-chat-bubble ${msg.isAI ? 'guest-chat-bubble--ai' : 'guest-chat-bubble--guest'}`}>
      <p className="guest-chat-sender">{msg.isAI ? 'Maya AI' : 'אורח'}</p>
      <p className="guest-chat-text">{msg.text}</p>
      <span className="guest-chat-time">{msg.time}</span>
    </div>
  </div>
);

const FALLBACK_MESSAGES = [
  { text: "היי, מתי הצ'ק-אין?", isAI: false, time: '10:00' },
  {
    text: "היי! הצ'ק-אין מתחיל ב-15:00. מחכה לראות אותך!",
    isAI: true,
    time: '10:01',
  },
];

function mapApiMessageToChat(msg) {
  const isAI = msg.direction === 'outbound';
  const created = msg.created_at ? new Date(msg.created_at) : new Date();
  const time = created.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
  return {
    id: msg.id || `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    text: msg.content || msg.message || '',
    isAI,
    time,
  };
}

export default function GuestChatFeed({ guestPhone, guestName }) {
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const data = await getMessages(30);
        if (mounted && Array.isArray(data) && data.length > 0) {
          setMessages(data.map(mapApiMessageToChat));
        } else if (mounted) {
          setMessages(FALLBACK_MESSAGES.map((m, i) => ({ ...m, id: `fallback-${i}` })));
        }
      } catch (e) {
        if (mounted) setMessages(FALLBACK_MESSAGES.map((m, i) => ({ ...m, id: `fallback-${i}` })));
      } finally {
        if (mounted) setLoading(false);
      }
    };
    load();
    const interval = setInterval(load, 15000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  const handleSend = async () => {
    const text = inputText.trim();
    if (!text) return;
    const phone = guestPhone || undefined;
    if (!phone) {
      // Demo mode: add to UI only
      const now = new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
      setMessages((prev) => [
        ...prev,
        {
          id: `local-${Date.now()}`,
          text,
          isAI: true,
          time: now,
        },
      ]);
      setInputText('');
      return;
    }
    setIsSending(true);
    try {
      await whatsappService.sendViaTwilio(phone, text);
      const now = new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
      setMessages((prev) => [
        ...prev,
        {
          id: `sent-${Date.now()}`,
          text,
          isAI: true,
          time: now,
        },
      ]);
      setInputText('');
    } catch (e) {
      console.error('Failed to send message', e);
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="guest-chat-feed bg-white rounded-[40px] shadow-sm border border-gray-100 flex flex-col h-[500px]" dir="rtl">
      <div className="guest-chat-header p-6 border-b border-gray-50 flex justify-between items-center">
        <h3 className="font-black text-gray-900">שיחות פעילות (WhatsApp)</h3>
        <div className="flex gap-2 items-center">
          <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" aria-hidden />
          <span className="text-[10px] font-bold text-gray-400">MAYA ACTIVE</span>
        </div>
      </div>
      <div className="guest-chat-body flex-1 overflow-y-auto p-6 bg-[#FAFAFA]">
        {loading ? (
          <div className="guest-chat-loading text-center text-gray-400 py-8">טוען שיחות...</div>
        ) : (
          messages.map((m) => <ChatMessage key={m.id} msg={m} />)
        )}
      </div>
      <div className="guest-chat-input-wrap p-4 bg-white border-t border-gray-100">
        <div className="flex gap-2">
          <input
            type="text"
            className="guest-chat-input flex-1 bg-gray-50 rounded-xl p-3 text-sm"
            placeholder="שלח הודעה ידנית לאורח..."
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isSending}
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={!inputText.trim() || isSending}
            className="px-4 py-2 bg-black text-white rounded-xl font-bold text-sm hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {isSending ? '...' : 'שלח'}
          </button>
        </div>
      </div>
    </div>
  );
}
