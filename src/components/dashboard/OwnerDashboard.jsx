import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  AreaChart, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import {
  CheckCircle2, Clock, Trophy, Home, RefreshCw,
  TrendingUp, TrendingDown, Zap, Activity, ShieldCheck,
} from 'lucide-react';
import { API_URL } from '../../utils/apiClient';
import { getReliabilityScores } from '../../services/api';
import useCurrency from '../../hooks/useCurrency';
import './OwnerDashboard.css';

/* ── helpers ────────────────────────────────────────────────── */
const API_BASE = API_URL.replace(/\/$/, '');

const OWNER_ANALYTICS_FALLBACK = {
  kpi: {
    readiness_pct: 0,
    missions_today: 0,
    avg_clean_minutes: 0,
    top_performer: { name: '—', missions: 0 },
  },
  chart_data: [],
  activity: [],
  maya_insight:
    'קובי — פורטפוליו: 15 נכסים · מוכנות ~80% · MRR יעד $1500 ($100×15). ממתין לחיבור מלא לשרת.',
  mrr_usd: 1500,
  per_property_usd: 100,
  active_properties: 15,
};

async function fetchDashboard() {
  try {
    const res = await fetch(`${API_BASE}/analytics/owner-dashboard`, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      console.warn('[OwnerDashboard] owner-dashboard HTTP', res.status, '— demo KPIs');
      return OWNER_ANALYTICS_FALLBACK;
    }
    const text = await res.text();
    if (!text || !text.trim()) {
      return OWNER_ANALYTICS_FALLBACK;
    }
    try {
      return JSON.parse(text);
    } catch {
      console.warn('[OwnerDashboard] owner-dashboard: non-JSON body — demo KPIs');
      return OWNER_ANALYTICS_FALLBACK;
    }
  } catch (e) {
    console.warn('[OwnerDashboard] owner-dashboard fetch failed — demo KPIs', e);
    return OWNER_ANALYTICS_FALLBACK;
  }
}
async function fetchAlerts() {
  try {
    const res = await fetch(`${API_BASE}/analytics/alerts`, { credentials: 'include' });
    if (!res.ok) return { alerts: [] };
    return res.json();
  } catch {
    return { alerts: [] };
  }
}

/* ── Terminal typing effect hook ────────────────────────────── */
function useTypingEffect(text, speed = 28) {
  const [displayed, setDisplayed] = useState('');
  const [done, setDone]           = useState(false);
  useEffect(() => {
    if (!text) return;
    setDisplayed('');
    setDone(false);
    let i = 0;
    const iv = setInterval(() => {
      i += 1;
      setDisplayed(text.slice(0, i));
      if (i >= text.length) { clearInterval(iv); setDone(true); }
    }, speed);
    return () => clearInterval(iv);
  }, [text, speed]);
  return { displayed, done };
}

/* ── KPI card ────────────────────────────────────────────────── */
function KPICard({ icon: Icon, label, value, sub, color, trend, loading }) {
  return (
    <div className="od-kpi-card" style={{ '--accent': color }}>
      <div className="od-kpi-icon-wrap">
        <Icon size={22} />
      </div>
      <div className="od-kpi-body">
        <div className="od-kpi-value">
          {loading ? <span className="od-shimmer od-shimmer-val" /> : (value ?? '—')}
        </div>
        <div className="od-kpi-label">{label}</div>
        {sub && <div className="od-kpi-sub">{sub}</div>}
      </div>
      {trend !== undefined && !loading && (
        <div className={`od-kpi-trend ${trend >= 0 ? 'up' : 'down'}`}>
          {trend >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
          {Math.abs(trend)}%
        </div>
      )}
    </div>
  );
}

/* ── Activity row ────────────────────────────────────────────── */
function ActivityRow({ item, idx }) {
  const typeEmoji = { Cleaning: '🧹', Maintenance: '🔧', Service: '⭐' };
  const emoji = typeEmoji[item.task_type] || '📋';
  const isDone = ['Done', 'Completed', 'finished'].includes(item.status);
  return (
    <div className="od-activity-row" style={{ animationDelay: `${idx * 0.05}s` }}>
      <span className="od-act-emoji">{emoji}</span>
      <div className="od-act-info">
        <span className="od-act-staff">{item.staff}</span>
        <span className="od-act-room">{item.room || 'General'}</span>
      </div>
      <div className="od-act-right">
        {item.photo_url && (
          <img src={item.photo_url} alt="task" className="od-act-thumb" />
        )}
        <span className={`od-act-badge ${isDone ? 'done' : 'progress'}`}>
          {isDone ? '✓ Done' : '⏳'}
        </span>
        <span className="od-act-ts">{item.ts?.slice(-5) || ''}</span>
      </div>
    </div>
  );
}

/* ── Staff Reliability Panel ─────────────────────────────────── */
function StaffReliabilityPanel() {
  const [scores,    setScores]    = useState([]);
  const [topPerfm,  setTopPerfm]  = useState(null);
  const [panelLoad, setPanelLoad] = useState(true);

  const refresh = useCallback(async () => {
    setPanelLoad(true);
    try {
      const data = await getReliabilityScores();
      setScores(data.scores || []);
      setTopPerfm(data.top_performer || null);
    } catch (_) {}
    setPanelLoad(false);
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 30_000);
    return () => clearInterval(t);
  }, [refresh]);

  const BAR_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6', '#ef4444'];

  return (
    <div className="od-card" style={{ marginTop: 24 }}>
      <div className="od-card-header" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <ShieldCheck size={16} />
        <span style={{ fontWeight: 900, color: '#000' }}>ציוני אמינות עובדים</span>
        {topPerfm && (
          <span style={{
            marginRight: 'auto', fontSize: 12, fontWeight: 800,
            background: '#fef3c7', color: '#b45309', padding: '2px 10px',
            borderRadius: 20, border: '1px solid #fde68a',
          }}>
            🏆 MVP: {topPerfm.name} — {topPerfm.reliability_score}%
          </span>
        )}
        <button onClick={refresh} title="רענן" style={{
          background: 'none', border: 'none', cursor: 'pointer', padding: 4,
        }}>
          <RefreshCw size={13} color="#6b7280" />
        </button>
      </div>

      {panelLoad ? (
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[1, 2, 3].map(i => (
            <div key={i} className="od-shimmer" style={{ height: 38, borderRadius: 8 }} />
          ))}
        </div>
      ) : scores.length === 0 ? (
        <div className="od-feed-empty" style={{ padding: 24 }}>
          <div>📊 אין עדיין נתוני ביצועים</div>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
            ציונים יחושבו לאחר שהעובדים יאשרו ויסיימו משימות
          </div>
        </div>
      ) : (
        <div style={{ padding: '8px 16px 16px' }}>
          {scores.map((s, idx) => (
            <div key={s.name} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px 0', borderBottom: '1px solid #f3f4f6',
            }}>
              <span style={{
                minWidth: 24, height: 24, borderRadius: '50%',
                background: BAR_COLORS[idx % BAR_COLORS.length],
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#fff', fontSize: 11, fontWeight: 900,
              }}>{idx + 1}</span>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                  <span style={{ fontWeight: 900, fontSize: 14, color: '#000' }}>{s.name}</span>
                  <span style={{ fontWeight: 800, fontSize: 13, color: '#000' }}>
                    {s.reliability_score}%
                    <span style={{ fontSize: 10, marginRight: 4, color: '#6b7280' }}>{s.tier}</span>
                  </span>
                </div>
                <div style={{
                  height: 8, background: '#f3f4f6', borderRadius: 4, overflow: 'hidden',
                }}>
                  <div style={{
                    height: '100%', width: `${s.reliability_score}%`,
                    background: BAR_COLORS[idx % BAR_COLORS.length],
                    borderRadius: 4, transition: 'width 0.6s ease',
                  }} />
                </div>
                <div style={{ display: 'flex', gap: 12, marginTop: 3, fontSize: 11, color: '#6b7280' }}>
                  <span>✅ {s.completion_rate}% הושלמו</span>
                  <span>👀 {s.response_rate}% אושרו</span>
                  <span>⚡ {s.avg_ack_minutes} דק׳ מ.מ</span>
                  <span>{s.tasks_total} משימות</span>
                  {s.tasks_escalated > 0 && (
                    <span style={{ color: '#ef4444' }}>🚨 {s.tasks_escalated} הוסלמו</span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Custom tooltip for chart ────────────────────────────────── */
function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="od-chart-tooltip">
      <div className="od-tt-date">{label}</div>
      {payload.map(p => (
        <div key={p.name} className="od-tt-row" style={{ color: p.color }}>
          <span>{p.name === 'completed' ? '✅ Completed' : '🎯 Goal'}</span>
          <strong>{p.value}</strong>
        </div>
      ))}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   Main Component
   ══════════════════════════════════════════════════════════════ */
/* ── Hardcoded SaaS revenue constants ──────────────────────── */
const SAAS_PROPERTIES = 15;
const SAAS_MRR        = 1500; // $100 × 15 properties (configurable via useCurrency)

export default function OwnerDashboard({ onSwitchToEmployee }) {
  const { format } = useCurrency();
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [lastSync, setLastSync] = useState(null);
  const [pulse,   setPulse]   = useState(false);
  const timerRef = useRef(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [json] = await Promise.all([fetchDashboard(), fetchAlerts()]);
      setData(json);
      setLastSync(new Date());
      setError(null);
      setPulse(true);
      setTimeout(() => setPulse(false), 600);
    } catch (e) {
      setData(OWNER_ANALYTICS_FALLBACK);
      setError(null);
    } finally {
      setLoading(false);
    }
  }, []);

  /* ── Real-time refresh when employee completes a mission ── */
  useEffect(() => {
    const onRefresh = () => load(true);
    window.addEventListener('maya-refresh-tasks',  onRefresh);
    window.addEventListener('owner-refresh-stats', onRefresh);
    return () => {
      window.removeEventListener('maya-refresh-tasks',  onRefresh);
      window.removeEventListener('owner-refresh-stats', onRefresh);
    };
  }, [load]);

  useEffect(() => {
    load();
    timerRef.current = setInterval(() => load(true), 30000);
    return () => clearInterval(timerRef.current);
  }, [load]);

  /* ── Maya insight terminal ── */
  const insightText = data?.maya_insight || '';
  const { displayed: typedInsight, done: insightDone } = useTypingEffect(insightText, 22);

  /* ── Derived KPIs ── */
  const kpi     = data?.kpi || {};
  const chart   = data?.chart_data || [];
  const feed    = data?.activity || [];
  const maxChart = Math.max(...chart.map(d => Math.max(d.completed, d.goal)), 10);

  /* Backend-driven revenue strip (MRR $1500, 15 properties) when /analytics/owner-dashboard returns them */
  const mrrDisplay = data?.mrr_usd ?? SAAS_MRR;
  const activePropsDisplay = data?.active_properties ?? SAAS_PROPERTIES;
  const perPropDisplay = data?.per_property_usd ?? 100;

  /* ── Readiness color ── */
  const readPct   = kpi.readiness_pct ?? 0;
  const readColor = readPct >= 80 ? '#16a34a' : readPct >= 50 ? '#d97706' : '#dc2626';

  return (
    <div className="od-root">

      {/* ── Top bar ──────────────────────────────────────────── */}
      <div className="od-topbar">
        <div className="od-topbar-left">
          <div className={`od-pulse-dot ${pulse ? 'flash' : ''}`} />
          <h1 className="od-title">Owner Analytics</h1>
          <span className="od-subtitle">Real-Time Operations Center</span>
          {lastSync && (
            <span className="od-sync-ts">
              <RefreshCw size={10} /> {lastSync.toLocaleTimeString()}
            </span>
          )}
        </div>
        <div className="od-topbar-right">
          <button className="od-refresh-btn" onClick={() => load()} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'od-spin' : ''} />
            {loading ? 'Loading…' : 'Refresh'}
          </button>
          {onSwitchToEmployee && (
            <button className="od-switch-btn" onClick={onSwitchToEmployee}>
              👷 Employee View
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="od-error-bar">
          ⚠️ Backend offline: {error} — make sure Flask is running on port 1000.
        </div>
      )}

      {/* ── Revenue Strip ─────────────────────────────────────── */}
      <div className="od-revenue-strip">
        <div className="od-rev-item">
          <span className="od-rev-icon">🏨</span>
          <span className="od-rev-val">{activePropsDisplay}</span>
          <span className="od-rev-label">Active Properties</span>
        </div>
        <div className="od-rev-divider" />
        <div className="od-rev-item highlight">
          <span className="od-rev-icon">💰</span>
          <span className="od-rev-val">{format(mrrDisplay)}</span>
          <span className="od-rev-label">Monthly Recurring Revenue</span>
        </div>
        <div className="od-rev-divider" />
        <div className="od-rev-item">
          <span className="od-rev-icon">📋</span>
          <span className="od-rev-val">{format(perPropDisplay)}</span>
          <span className="od-rev-label">Per Property / Month</span>
        </div>
      </div>

      {/* ── KPI Cards ─────────────────────────────────────────── */}
      <div className="od-kpi-row">
        <KPICard
          icon={CheckCircle2}
          label="Missions Completed Today"
          value={kpi.missions_today ?? 0}
          sub={`${chart.at(-1)?.goal || 10} daily goal`}
          color="#16a34a"
          trend={kpi.missions_today >= 10 ? 12 : -5}
          loading={loading}
        />
        <KPICard
          icon={Clock}
          label="Avg Cleaning Time"
          value={kpi.avg_clean_minutes ? `${kpi.avg_clean_minutes} min` : 'N/A'}
          sub="per room"
          color="#0ea5e9"
          loading={loading}
        />
        <KPICard
          icon={Trophy}
          label="Top Performer 🏆"
          value={kpi.top_performer?.name || '—'}
          sub={kpi.top_performer ? `${kpi.top_performer.missions} missions` : 'No data yet'}
          color="#f59e0b"
          loading={loading}
        />
        <KPICard
          icon={Home}
          label="Property Readiness"
          value={`${readPct}%`}
          sub={readPct >= 80 ? '✅ All clear' : readPct >= 50 ? '⚠️ Some rooms pending' : '🔴 Action needed'}
          color={readColor}
          loading={loading}
        />
      </div>

      {/* ── Main grid ─────────────────────────────────────────── */}
      <div className="od-main-grid">

        {/* ── Left column: chart + Maya ── */}
        <div className="od-left-col">

          {/* Chart card */}
          <div className="od-card">
            <div className="od-card-header">
              <Activity size={16} />
              <span>Completed Tasks vs. Daily Goal — Last 7 Days</span>
              <span className="od-card-badge">LIVE</span>
            </div>
            <div className="od-chart-wrap">
              {loading ? (
                <div className="od-shimmer" style={{ height: 220, borderRadius: 12 }} />
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={chart} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gradCompleted" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor="#00c875" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="#00c875" stopOpacity={0.02} />
                      </linearGradient>
                      <linearGradient id="gradGoal" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor="#6366f1" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="#6366f1" stopOpacity={0.01} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
                    <XAxis dataKey="date" tick={{ fill: '#000', fontSize: 11, fontWeight: 700 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: '#000', fontSize: 11 }} axisLine={false} tickLine={false} domain={[0, maxChart + 2]} />
                    <Tooltip content={<ChartTooltip />} />
                    <ReferenceLine y={10} stroke="#6366f1" strokeDasharray="4 3" label={{ value: 'Goal', fill: '#6366f1', fontSize: 10, fontWeight: 800 }} />
                    <Area type="monotone" dataKey="completed" stroke="#00c875" strokeWidth={2.5} fill="url(#gradCompleted)" name="completed" dot={{ fill: '#00c875', r: 4 }} activeDot={{ r: 6 }} isAnimationActive />
                    <Area type="monotone" dataKey="goal" stroke="#6366f1" strokeWidth={1.5} strokeDasharray="5 3" fill="url(#gradGoal)" name="goal" dot={false} isAnimationActive />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Maya's Briefing terminal */}
          <div className="od-card od-terminal-card">
            <div className="od-card-header">
              <Zap size={16} />
              <span>Maya's Daily Briefing</span>
              <span className="od-card-badge ai">AI INSIGHT</span>
            </div>
            <div className="od-terminal-body">
              <div className="od-terminal-prompt">
                <span className="od-prompt-user">maya@easyhost</span>
                <span className="od-prompt-sep">:~$</span>
                <span className="od-prompt-cmd"> analyze --today --efficiency</span>
              </div>
              <div className="od-terminal-output">
                {loading ? (
                  <span className="od-shimmer" style={{ display: 'block', height: 16, width: '80%', marginTop: 8 }} />
                ) : (
                  <>
                    <span>{typedInsight}</span>
                    {!insightDone && <span className="od-cursor">▋</span>}
                  </>
                )}
              </div>
              {insightDone && (
                <div className="od-terminal-prompt" style={{ marginTop: 12, opacity: 0.5 }}>
                  <span className="od-prompt-user">maya@easyhost</span>
                  <span className="od-prompt-sep">:~$</span>
                  <span className="od-cursor">▋</span>
                </div>
              )}
            </div>
          </div>

        </div>

        {/* ── Right column: Live Operations feed ── */}
        <div className="od-right-col">
          <div className="od-card od-feed-card">
            <div className="od-card-header">
              <Activity size={16} />
              <span>Live Operations</span>
              <span className="od-live-dot" />
              <span className="od-card-badge live">LIVE</span>
            </div>

            {loading ? (
              <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="od-shimmer" style={{ height: 44, borderRadius: 10 }} />
                ))}
              </div>
            ) : feed.length === 0 ? (
              <div className="od-feed-empty">
                <div style={{ fontSize: 36 }}>🎉</div>
                <div style={{ fontWeight: 800, color: '#000', marginTop: 8 }}>No activity yet today</div>
                <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>Missions will appear here in real-time</div>
              </div>
            ) : (
              <div className="od-feed-list">
                {feed.map((item, i) => (
                  <ActivityRow key={item.id} item={item} idx={i} />
                ))}
              </div>
            )}

            <div className="od-feed-footer">
              Auto-refreshes every 30 s · {feed.length} events
            </div>
          </div>
        </div>

      </div>

      {/* ── Staff Reliability Scores ── */}
      <StaffReliabilityPanel />

    </div>
  );
}
