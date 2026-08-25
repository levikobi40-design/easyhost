import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BedDouble,
  Building2,
  CheckCircle2,
  ClipboardList,
  MessageCircle,
  Send,
  Sparkles,
  UserPlus,
  MapPin,
} from 'lucide-react';
import {
  ECHO_CHAIN_NAME,
  ECHO_CTA_HE,
  ECHO_MAYA_PROMPTS,
  ECHO_PROPERTIES,
  ECHO_TAGLINE,
  buildRoomsForProperty,
  computeEchoStats,
  echoMayaFreeTextReply,
  getEchoProperty,
  type EchoOpsStatus,
  type EchoPropertyId,
  type EchoRoom,
} from '../../data/echoHotels';
import './EchoHotelsDashboard.css';

type ChatMsg = { id: string; role: 'guest' | 'maya'; text: string; at: number };

const STATUS_STYLE: Record<
  EchoOpsStatus,
  { bg: string; border: string; text: string; dot: string }
> = {
  'Dirty / In Progress': {
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    text: 'text-amber-900',
    dot: 'bg-amber-500',
  },
  'Ready / Inspected': {
    bg: 'bg-emerald-50',
    border: 'border-emerald-200',
    text: 'text-emerald-900',
    dot: 'bg-emerald-500',
  },
  'Occupied / Do Not Disturb': {
    bg: 'bg-rose-50',
    border: 'border-rose-200',
    text: 'text-rose-900',
    dot: 'bg-rose-500',
  },
};

function fmtCleaned(iso: string): string {
  try {
    return new Date(iso).toLocaleString('he-IL', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

function StatPill({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent: string;
}) {
  return (
    <div className={`echo-stat-pill ${accent}`}>
      <span className="echo-stat-val">{value}</span>
      <span className="echo-stat-lbl">{label}</span>
    </div>
  );
}

export default function EchoHotelsDashboard() {
  const [propertyId, setPropertyId] = useState<EchoPropertyId>('echo-dizengoff-avenue');
  const [roomsByProperty, setRoomsByProperty] = useState<Record<EchoPropertyId, EchoRoom[]>>(() => {
    const init = {} as Record<EchoPropertyId, EchoRoom[]>;
    for (const p of ECHO_PROPERTIES) {
      init[p.id] = buildRoomsForProperty(p.id);
    }
    return init;
  });
  const [assignRoomId, setAssignRoomId] = useState<string | null>(null);
  const [assignName, setAssignName] = useState('');
  const [chat, setChat] = useState<ChatMsg[]>([
    {
      id: 'welcome',
      role: 'maya',
      text: 'שלום! אני Maya מ־Echo Hotels. שאלו על Wi‑Fi, Happy Hour או ארוחת בוקר — או הקלידו חופשי.',
      at: Date.now(),
    },
  ]);
  const [draft, setDraft] = useState('');
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const property = useMemo(() => getEchoProperty(propertyId), [propertyId]);
  const rooms = roomsByProperty[propertyId] ?? [];
  const stats = useMemo(() => computeEchoStats(rooms), [rooms]);

  // Hard guard: never show mismatched room types for the selected property
  useEffect(() => {
    const allowed = new Set(property.roomTypes.map((r) => r.type));
    const bad = rooms.find((r) => !allowed.has(r.roomType) || r.propertyId !== propertyId);
    if (bad) {
      console.error('[EchoHotels] Data mismatch — regenerating grid', bad);
      setRoomsByProperty((prev) => ({
        ...prev,
        [propertyId]: buildRoomsForProperty(propertyId),
      }));
    }
    if (rooms.length !== property.totalUnits) {
      console.error('[EchoHotels] Room count mismatch — regenerating grid');
      setRoomsByProperty((prev) => ({
        ...prev,
        [propertyId]: buildRoomsForProperty(propertyId),
      }));
    }
  }, [property, propertyId, rooms]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat]);

  const updateRoom = useCallback(
    (roomId: string, patch: Partial<EchoRoom>) => {
      setRoomsByProperty((prev) => ({
        ...prev,
        [propertyId]: (prev[propertyId] || []).map((r) =>
          r.id === roomId ? { ...r, ...patch } : r,
        ),
      }));
    },
    [propertyId],
  );

  const markReady = (roomId: string) => {
    updateRoom(roomId, {
      status: 'Ready / Inspected',
      lastCleanedAt: new Date().toISOString(),
      enquiryOpen: false,
    });
  };

  const confirmAssign = () => {
    if (!assignRoomId || !assignName.trim()) return;
    updateRoom(assignRoomId, {
      housekeeper: assignName.trim(),
      status: 'Dirty / In Progress',
    });
    setAssignRoomId(null);
    setAssignName('');
  };

  const pushMaya = (guestText: string, answer: string) => {
    const now = Date.now();
    setChat((c) => [
      ...c,
      { id: `g-${now}`, role: 'guest', text: guestText, at: now },
      { id: `m-${now + 1}`, role: 'maya', text: answer, at: now + 1 },
    ]);
  };

  const onQuickPrompt = (label: string, answer: string) => {
    pushMaya(label, answer);
  };

  const onSend = (e?: React.FormEvent) => {
    e?.preventDefault?.();
    const text = draft.trim();
    if (!text) return;
    pushMaya(text, echoMayaFreeTextReply(text, property.name));
    setDraft('');
  };

  return (
    <div className="echo-root" dir="rtl">
      {/* Header */}
      <header className="echo-header">
        <div className="echo-brand">
          <Sparkles className="echo-brand-icon" size={22} aria-hidden />
          <div>
            <h1 className="echo-title">
              {ECHO_CHAIN_NAME}{' '}
              <span className="echo-title-sep">|</span>{' '}
              <span className="echo-title-sub">{ECHO_TAGLINE}</span>
            </h1>
            <p className="echo-subtitle flex items-center gap-1.5">
              <MapPin size={13} aria-hidden />
              {property.address}
            </p>
          </div>
        </div>

        <nav className="echo-tabs" aria-label="Echo properties">
          {ECHO_PROPERTIES.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`echo-tab ${p.id === propertyId ? 'echo-tab-active' : ''}`}
              onClick={() => setPropertyId(p.id)}
              aria-pressed={p.id === propertyId}
            >
              <Building2 size={14} aria-hidden />
              <span className="echo-tab-name">{p.name}</span>
              <span className="echo-tab-count">{p.totalUnits}</span>
            </button>
          ))}
        </nav>

        <div className="echo-stats-row">
          <StatPill label="Total Rooms" value={stats.totalRooms} accent="echo-accent-blue" />
          <StatPill label="Occupancy %" value={`${stats.occupancyPct}%`} accent="echo-accent-teal" />
          <StatPill
            label="Active Housekeeping"
            value={stats.activeHousekeeping}
            accent="echo-accent-amber"
          />
          <StatPill
            label="Pending Enquiries"
            value={stats.pendingEnquiries}
            accent="echo-accent-rose"
          />
        </div>
      </header>

      <div className="echo-main">
        {/* Housekeeping grid */}
        <section className="echo-board" aria-label="Housekeeping status board">
          <div className="echo-board-head">
            <BedDouble size={18} aria-hidden />
            <h2>
              Housekeeping — {property.name}
              <span className="echo-board-meta">
                {' '}
                · {rooms.length} units · types:{' '}
                {property.roomTypes.map((t) => t.type).join(' · ')}
              </span>
            </h2>
          </div>

          <div className="echo-grid">
            {rooms.map((room) => {
              const st = STATUS_STYLE[room.status];
              return (
                <article
                  key={room.id}
                  className={`echo-card border ${st.border} ${st.bg}`}
                >
                  <div className="echo-card-top">
                    <span className="echo-room-num">#{room.roomNumber}</span>
                    <span className={`echo-status ${st.text}`}>
                      <span className={`echo-dot ${st.dot}`} />
                      {room.status}
                    </span>
                  </div>
                  <div className="echo-room-type">{room.roomType}</div>
                  <div className="echo-card-meta">
                    <span>🧹 {room.housekeeper}</span>
                    <span>🕒 {fmtCleaned(room.lastCleanedAt)}</span>
                  </div>
                  <div className="echo-card-actions">
                    <button
                      type="button"
                      className="echo-btn echo-btn-ready"
                      onClick={() => markReady(room.id)}
                      disabled={room.status === 'Ready / Inspected'}
                    >
                      <CheckCircle2 size={14} aria-hidden />
                      Mark Ready
                    </button>
                    <button
                      type="button"
                      className="echo-btn echo-btn-assign"
                      onClick={() => {
                        setAssignRoomId(room.id);
                        setAssignName(room.housekeeper);
                      }}
                    >
                      <UserPlus size={14} aria-hidden />
                      Assign Task
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        {/* Maya panel */}
        <aside className="echo-maya" aria-label="Maya AI Concierge">
          <div className="echo-maya-head">
            <MessageCircle size={18} aria-hidden />
            <div>
              <h2>Maya · Echo Concierge</h2>
              <p>WhatsApp-style guest replies</p>
            </div>
          </div>

          <div className="echo-maya-prompts">
            {ECHO_MAYA_PROMPTS.map((p) => (
              <button
                key={p.id}
                type="button"
                className="echo-prompt-chip"
                onClick={() => onQuickPrompt(p.label, p.answer)}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="echo-maya-thread">
            {chat.map((m) => (
              <div
                key={m.id}
                className={`echo-bubble ${m.role === 'maya' ? 'echo-bubble-maya' : 'echo-bubble-guest'}`}
              >
                <span className="echo-bubble-who">{m.role === 'maya' ? 'Maya' : 'אורח'}</span>
                {m.text}
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>

          <form className="echo-maya-compose" onSubmit={onSend}>
            <input
              className="echo-maya-input maya-input-field"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="הקלידו שאלה לאורח Echo…"
              aria-label="Maya message"
            />
            <button type="submit" className="echo-maya-send" aria-label="Send">
              <Send size={16} />
            </button>
          </form>
        </aside>
      </div>

      {/* CTA */}
      <footer className="echo-cta">
        <ClipboardList size={16} aria-hidden />
        <p>{ECHO_CTA_HE}</p>
      </footer>

      {/* Assign modal */}
      {assignRoomId && (
        <div className="echo-modal-backdrop" role="dialog" aria-modal="true">
          <div className="echo-modal">
            <h3>Assign housekeeping task</h3>
            <p className="echo-modal-hint">Room will move to Dirty / In Progress</p>
            <input
              className="echo-modal-input"
              value={assignName}
              onChange={(e) => setAssignName(e.target.value)}
              placeholder="Housekeeper name"
              autoFocus
            />
            <div className="echo-modal-actions">
              <button type="button" className="echo-btn" onClick={() => setAssignRoomId(null)}>
                Cancel
              </button>
              <button type="button" className="echo-btn echo-btn-ready" onClick={confirmAssign}>
                Assign
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
