import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Activity, Play, Square, RotateCcw,
  Building2, CheckCircle2, Users,
  AlertCircle, Zap, RefreshCw, Terminal,
} from 'lucide-react';
import './GodModeDashboard.css';

const API = () => {
  try {
    const raw = localStorage.getItem('hotel-enterprise-storage');
    const base = raw ? (JSON.parse(raw)?.state?.authToken ? '' : '') : '';
    const env = process.env.REACT_APP_API_URL;
    if (typeof window !== 'undefined' && window.location.hostname.includes('onrender.com'))
      return 'https://easyhost-backend.onrender.com';
    return env || 'http://127.0.0.1:1000';
  } catch {
    return 'http://127.0.0.1:1000';
  }
};

const fmt = (iso) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
};

const statusColor = { busy: '#ef4444', active: '#f59e0b', clear: '#22c55e' };
const statusLabel = { busy: 'BUSY', active: 'ACTIVE', clear: 'CLEAR' };

const ownerColor = { John: '#38bdf8', Sarah: '#f472b6' };

function StatCard({ icon: Icon, label, value, color }) {
  return (
    <div className="gm-stat-card" style={{ '--accent': color }}>
      <div className="gm-stat-icon"><Icon size={20} /></div>
      <div className="gm-stat-body">
        <span className="gm-stat-val">{value ?? '—'}</span>
        <span className="gm-stat-lbl">{label}</span>
      </div>
    </div>
  );
}

function PropertyCard({ prop }) {
  const col = ownerColor[prop.owner] || '#94a3b8';
  const sc  = statusColor[prop.status] || '#94a3b8';
  return (
    <div className="gm-prop-card">
      <div className="gm-prop-bar" style={{ background: col }} />
      <div className="gm-prop-body">
        <div className="gm-prop-name" title={prop.name}>{prop.name}</div>
        <div className="gm-prop-owner" style={{ color: col }}>👤 {prop.owner}</div>
        <div className="gm-prop-badges">
          <span className="gm-badge gm-badge-pending">{prop.pending} pending</span>
          <span className="gm-badge gm-badge-done">{prop.done} done</span>
          <span className="gm-badge" style={{ background: sc + '22', color: sc, border: `1px solid ${sc}44` }}>
            {statusLabel[prop.status] || prop.status}
          </span>
        </div>
      </div>
    </div>
  );
}

function TaskRow({ task }) {
  const elapsed = task.created_at
    ? Math.floor((Date.now() - new Date(task.created_at).getTime()) / 60000)
    : null;
  return (
    <div className="gm-task-row">
      <AlertCircle size={13} className="gm-task-icon" />
      <div className="gm-task-info">
        <span className="gm-task-prop">{task.property_name}</span>
        <span className="gm-task-desc">{task.description}</span>
      </div>
      <div className="gm-task-meta">
        <span className="gm-task-staff">{task.staff_name}</span>
        {elapsed !== null && <span className="gm-task-age">{elapsed}m ago</span>}
      </div>
    </div>
  );
}

function CompletionRow({ c }) {
  const ms = [
    { name: 'Mock Alma', emoji: '🧹' },
    { name: 'Mock Kobi', emoji: '🔧' },
    { name: 'Mock Avi',  emoji: '⚡' },
  ];
  const staff = ms.find(m => m.name === c.staff_name) || { emoji: '✅' };
  return (
    <div className="gm-comp-row">
      <span className="gm-comp-emoji">{staff.emoji}</span>
      <div className="gm-comp-info">
        <span className="gm-comp-prop">{c.property_name}</span>
        <span className="gm-comp-note">{c.worker_notes}</span>
      </div>
      <div className="gm-comp-meta">
        <span className="gm-comp-staff">{c.staff_name}</span>
        <span className="gm-comp-time">{fmt(c.completed_at)}</span>
      </div>
    </div>
  );
}

const LOG_LEVEL_COLOR = {
  info:    '#94a3b8',
  warn:    '#fbbf24',
  success: '#4ade80',
  error:   '#f87171',
};

export default function GodModeDashboard() {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [simBusy, setSimBusy] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [simLog, setSimLog]   = useState([]);
  const timerRef  = useRef(null);
  const logEndRef = useRef(null);

  const fetchOverview = useCallback(async () => {
    try {
      const base = API();
      const [ovRes, logRes] = await Promise.all([
        fetch(`${base}/api/god-mode/overview`),
        fetch(`${base}/api/sim-log?limit=60`),
      ]);
      if (ovRes.ok) {
        setData(await ovRes.json());
        setLastRefresh(new Date());
        setError(null);
      } else {
        throw new Error(`HTTP ${ovRes.status}`);
      }
      if (logRes.ok) {
        const logData = await logRes.json();
        setSimLog(logData.entries || []);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOverview();
    timerRef.current = setInterval(fetchOverview, 5000);
    return () => clearInterval(timerRef.current);
  }, [fetchOverview]);

  // Auto-scroll log to top (newest entries are shown first)
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [simLog]);

  const toggleSim = async (action) => {
    setSimBusy(true);
    try {
      const base = API();
      await fetch(`${base}/api/demo/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      await fetchOverview();
    } finally {
      setSimBusy(false);
    }
  };

  const johnProps  = (data?.properties || []).filter(p => p.owner === 'John');
  const sarahProps = (data?.properties || []).filter(p => p.owner === 'Sarah');
  const stats      = data?.stats || {};
  const simActive  = data?.demo_active ?? false;

  return (
    <div className="gm-root">
      {/* ── Header ── */}
      <div className="gm-header">
        <div className="gm-header-left">
          <div className="gm-pulse-dot" />
          <h1 className="gm-title">GOD MODE</h1>
          <span className="gm-subtitle">Pilot Demo — Live Operations</span>
          {lastRefresh && (
            <span className="gm-refresh-ts">
              <RefreshCw size={11} /> {lastRefresh.toLocaleTimeString()}
            </span>
          )}
        </div>
        <div className="gm-sim-controls">
          {simActive ? (
            <button
              className="gm-btn gm-btn-stop"
              onClick={() => toggleSim('stop')}
              disabled={simBusy}
            >
              <Square size={14} /> Stop Simulation
            </button>
          ) : (
            <button
              className="gm-btn gm-btn-start"
              onClick={() => toggleSim('start')}
              disabled={simBusy}
            >
              <Play size={14} /> Start Simulation
            </button>
          )}
          <button
            className="gm-btn gm-btn-reset"
            onClick={() => toggleSim('reset')}
            disabled={simBusy}
            title="Clear all mock-staff tasks"
          >
            <RotateCcw size={14} /> Reset
          </button>
          <div className={`gm-sim-status ${simActive ? 'active' : 'idle'}`}>
            <Activity size={13} /> {simActive ? 'SIM LIVE' : 'SIM OFF'}
          </div>
        </div>
      </div>

      {/* ── Stats row ── */}
      <div className="gm-stats-row">
        <StatCard icon={Building2}    label="Properties"      value={stats.total_properties} color="#38bdf8" />
        <StatCard icon={AlertCircle}  label="Active Tasks"    value={stats.active_tasks}     color="#f59e0b" />
        <StatCard icon={CheckCircle2} label="Completed"       value={stats.completed_tasks}  color="#22c55e" />
        <StatCard icon={Users}        label="Mock Staff"      value={stats.mock_staff_count} color="#a78bfa" />
        <StatCard icon={Zap}          label="Sim Complaints"  value={(data?.pending_tasks || []).length} color="#fb923c" />
      </div>

      {error && (
        <div className="gm-error-bar">
          ⚠️ Cannot reach backend: {error} — make sure Flask is running on port 1000.
        </div>
      )}

      {/* ── Main 3-column grid ── */}
      <div className="gm-grid">

        {/* Column 1 — Properties */}
        <div className="gm-panel">
          <div className="gm-panel-header">
            <Building2 size={16} /> Properties
            <span className="gm-panel-count">{(data?.properties || []).length}</span>
          </div>
          <div className="gm-panel-body">
            {loading && <div className="gm-skeleton-list">{[...Array(5)].map((_, i) => <div key={i} className="gm-skeleton" />)}</div>}
            {!loading && (
              <>
                <div className="gm-owner-section">
                  <div className="gm-owner-header" style={{ color: ownerColor.John }}>
                    👤 John ({johnProps.length})
                  </div>
                  {johnProps.map(p => <PropertyCard key={p.id} prop={p} />)}
                </div>
                <div className="gm-owner-section">
                  <div className="gm-owner-header" style={{ color: ownerColor.Sarah }}>
                    👤 Sarah ({sarahProps.length})
                  </div>
                  {sarahProps.map(p => <PropertyCard key={p.id} prop={p} />)}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Column 2 — Incoming Complaints */}
        <div className="gm-panel">
          <div className="gm-panel-header">
            <AlertCircle size={16} /> Incoming Complaints
            <span className="gm-panel-count gm-count-red">{(data?.pending_tasks || []).length}</span>
          </div>
          <div className="gm-panel-body">
            {loading && <div className="gm-skeleton-list">{[...Array(6)].map((_, i) => <div key={i} className="gm-skeleton" />)}</div>}
            {!loading && (data?.pending_tasks || []).length === 0 && (
              <div className="gm-empty">No pending complaints 🎉</div>
            )}
            {!loading && (data?.pending_tasks || []).map(t => <TaskRow key={t.id} task={t} />)}
          </div>
        </div>

        {/* Column 3 — Staff Responses */}
        <div className="gm-panel">
          <div className="gm-panel-header">
            <CheckCircle2 size={16} /> Staff Responses
            <span className="gm-panel-count gm-count-green">{(data?.completions || []).length}</span>
          </div>
          <div className="gm-panel-body">
            {loading && <div className="gm-skeleton-list">{[...Array(6)].map((_, i) => <div key={i} className="gm-skeleton" />)}</div>}
            {!loading && (data?.completions || []).length === 0 && (
              <div className="gm-empty">
                No completions yet.{' '}
                {!simActive && <span>Start the simulation to see staff responses.</span>}
              </div>
            )}
            {!loading && (data?.completions || []).map(c => <CompletionRow key={c.id} c={c} />)}
          </div>
        </div>

      </div>

      {/* ── Simulation Log Panel ── */}
      <div className="gm-log-panel">
        <div className="gm-panel-header" style={{ borderRadius: '0.75rem 0.75rem 0 0' }}>
          <Terminal size={15} />
          runPilotSimulation() — Activity Log
          <span className="gm-panel-count">{simLog.length}</span>
          <span className="gm-log-live">● LIVE</span>
        </div>
        <div className="gm-log-body">
          {simLog.length === 0 && (
            <div className="gm-log-empty">
              No log entries yet. Start the simulation to see real-time activity.
            </div>
          )}
          {simLog.map((entry) => (
            <div key={entry.id} className="gm-log-row">
              <span className="gm-log-ts">{entry.ts_str}</span>
              <span
                className="gm-log-msg"
                style={{ color: LOG_LEVEL_COLOR[entry.level] || '#e2e8f0' }}
              >
                {entry.message}
              </span>
            </div>
          ))}
          <div ref={logEndRef} />
        </div>
      </div>

      {/* ── Footer legend ── */}
      <div className="gm-footer">
        <span className="gm-legend-item"><span className="gm-dot" style={{ background: '#ef4444' }} /> BUSY &gt;2 pending</span>
        <span className="gm-legend-item"><span className="gm-dot" style={{ background: '#f59e0b' }} /> ACTIVE 1–2 pending</span>
        <span className="gm-legend-item"><span className="gm-dot" style={{ background: '#22c55e' }} /> CLEAR 0 pending</span>
        <span className="gm-legend-sep" />
        <span className="gm-legend-item">🧹 Mock Alma — Cleaning</span>
        <span className="gm-legend-item">🔧 Mock Kobi — Maintenance</span>
        <span className="gm-legend-item">⚡ Mock Avi — Electrical</span>
        <span className="gm-legend-sep" />
        <span className="gm-legend-item" style={{ color: '#64748b' }}>Auto-refresh every 5 s</span>
      </div>
    </div>
  );
}
