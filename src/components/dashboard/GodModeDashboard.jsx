import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Activity, Play, Square, RotateCcw,
  Building2, CheckCircle2, Users,
  AlertCircle, Zap, RefreshCw, Terminal, BedDouble,
  MessageSquare, Paperclip, Send, Trash2, Eye,
} from 'lucide-react';
import useTranslations from '../../hooks/useTranslations';
import { fetchWithRetry, API_URL } from '../../utils/apiClient';
import api from '../../services/api';
import hotelRealtime from '../../services/hotelRealtime';
import { notifyTasksChanged, subscribeCrossTabTaskSync } from '../../utils/taskSyncBridge';
import './GodModeDashboard.css';

const fmt = (iso) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
};

const statusColor = { busy: '#ef4444', active: '#f59e0b', clear: '#22c55e' };
const statusLabel = { busy: 'BUSY', active: 'ACTIVE', clear: 'CLEAR' };

const ownerColor = { Kobi: '#38bdf8', Alma: '#f472b6' };

function StatCard({ icon: Icon, label, value, color, loading }) {
  if (!Icon || typeof Icon !== 'function') {
    console.warn('[GodModeDashboard] StatCard: invalid icon component', Icon);
    return null;
  }
  const display = loading
    ? '…'
    : value == null
    ? 'מחכה…'
    : value;
  return (
    <div className="gm-stat-card" style={{ '--accent': color }}>
      <div className="gm-stat-icon"><Icon size={20} /></div>
      <div className="gm-stat-body">
        <span className="gm-stat-val">{display}</span>
        <span className="gm-stat-lbl">{label}</span>
      </div>
    </div>
  );
}

const OWNER_LABEL_HE = { Kobi: 'קובי', Alma: 'עלמה', Levikobi: 'קובי' };

function PropertyCard({ prop }) {
  const col = ownerColor[prop.owner] || '#94a3b8';
  const sc  = statusColor[prop.status] || '#94a3b8';
  const ownerLabel = OWNER_LABEL_HE[prop.owner] || prop.owner;
  return (
    <div className="gm-prop-card">
      <div className="gm-prop-bar" style={{ background: col }} />
      <div className="gm-prop-body">
        <div className="gm-prop-name" title={prop.name}>{prop.name}</div>
        <div className="gm-prop-owner" style={{ color: col }}>👤 {ownerLabel}</div>
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
    { name: 'Alma', emoji: '🧹' },
    { name: 'Kobi', emoji: '🔧' },
    { name: 'Avi', emoji: '⚡' },
  ];
  const staffNameNorm = String(c.staff_name || '').replace(/^Mock\s+/i, '').trim();
  const staff = ms.find(m => m.name === staffNameNorm || m.name === c.staff_name) || { emoji: '✅' };
  const staffDisplay =
    staffNameNorm === 'Alma' ? 'עלמה' : staffNameNorm === 'Kobi' ? 'קובי' : staffNameNorm === 'Avi' ? 'אבי' : c.staff_name;
  return (
    <div className="gm-comp-row">
      <span className="gm-comp-emoji">{staff.emoji}</span>
      <div className="gm-comp-info">
        <span className="gm-comp-prop">{c.property_name}</span>
        <span className="gm-comp-note">{c.worker_notes}</span>
      </div>
      <div className="gm-comp-meta">
        <span className="gm-comp-staff">{staffDisplay}</span>
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
  const { t } = useTranslations();
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [simBusy, setSimBusy] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [simLog, setSimLog]   = useState([]);
  // WhatsApp Injector state
  const [injectMsg,      setInjectMsg]      = useState('');
  const [injectPropId,   setInjectPropId]   = useState('');
  const [injectFile,     setInjectFile]     = useState(null);
  const [injectPreview,  setInjectPreview]  = useState(null);
  const [injectBusy,     setInjectBusy]     = useState(false);
  const [injectDone,     setInjectDone]     = useState('');
  const [previewModal,   setPreviewModal]   = useState(null);
  // Complaint system state
  const [complaintText,  setComplaintText]  = useState('');
  const [complaintPropId, setComplaintPropId] = useState('');
  const [complaintBusy,  setComplaintBusy]  = useState(false);
  const [complaintDone,  setComplaintDone]  = useState(false);
  /** Bumped when Maya chat creates tasks — refetches overview / Task Board stats without full reload */
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const injectFileRef = useRef(null);
  const logEndRef  = useRef(null);
  const logBodyRef = useRef(null);

  const fetchOverview = useCallback(async () => {
    try {
      const [ovRes, logRes] = await Promise.all([
        fetch(`${API_URL}/god-mode/overview`),
        fetch(`${API_URL}/sim-log?limit=60`),
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
    const t = setInterval(() => fetchOverview(), 15000);
    return () => clearInterval(t);
  }, [fetchOverview]);

  useEffect(() => {
    const bump = () => setRefreshTrigger((n) => n + 1);
    window.addEventListener('maya-refresh-tasks', bump);
    return () => window.removeEventListener('maya-refresh-tasks', bump);
  }, []);

  useEffect(() => {
    return subscribeCrossTabTaskSync(() => setRefreshTrigger((n) => n + 1));
  }, []);

  useEffect(() => {
    if (refreshTrigger === 0) return;
    fetchOverview();
  }, [fetchOverview, refreshTrigger]);

  // Scroll only within the log panel — never jumps the page
  useEffect(() => {
    if (logBodyRef.current) {
      logBodyRef.current.scrollTop = logBodyRef.current.scrollHeight;
    }
  }, [simLog]);

  const toggleSim = async (action) => {
    setSimBusy(true);
    try {
      await fetch(`${API_URL}/demo/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      await fetchOverview();
    } finally {
      setSimBusy(false);
    }
  };

  const seedRooms = async () => {
    setSimBusy(true);
    try {
      const res  = await fetch(`${API_URL}/seed-rooms-status`, { method: 'POST' });
      const json = await res.json();
      await fetchOverview();
      alert(json.message || '✅ Room inventory seeded');
    } catch (e) {
      alert(`❌ Seed error: ${e.message}`);
    } finally {
      setSimBusy(false);
    }
  };

  const runPilot = async () => {
    setSimBusy(true);
    try {
      const res  = await fetch(`${API_URL}/demo/run-pilot`, { method: 'POST' });
      const json = await res.json();
      await fetchOverview();
      alert(json.message || '✅ Pilot simulation running');
    } catch (e) {
      alert(`❌ Error: ${e.message}`);
    } finally {
      setSimBusy(false);
    }
  };

  // ── WhatsApp Injector ──────────────────────────────────────────────────────
  const handleInjectFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setInjectFile(f);
    if (f.type.startsWith('image/')) {
      setInjectPreview(URL.createObjectURL(f));
    } else {
      setInjectPreview(null);
    }
  };

  const handleInject = async () => {
    if (!injectMsg.trim()) return;
    setInjectBusy(true);
    setInjectDone('');
    try {
      let attachUrl = null;

      // Upload attachment first if present (with retry for intermittent network)
      if (injectFile) {
        const fd = new FormData();
        fd.append('files', injectFile);
        if (injectPropId) fd.append('property_id', injectPropId);
        const upRes = await fetchWithRetry(`${API_URL}/field/upload`, { method: 'POST', body: fd }, { maxRetries: 3 });
        if (upRes.ok) {
          const upJson = await upRes.json();
          attachUrl = (upJson.urls || [])[0] || null;
        }
      }

      // Inject the message into Maya's AI pipeline (same as Maya chat: /ai/maya-command)
      const res = await fetch(`${API_URL}/ai/maya-command`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          command: injectMsg,
          message: injectMsg,
          property_id: injectPropId || undefined,
          attachment: attachUrl || undefined,
          source: 'god-mode-inject',
        }),
      });
      const json = await res.json();
      setInjectDone(
        json.displayMessage || json.message || json.reply || json.response
          || '✅ Message sent — check Mission Board.',
      );
      setInjectMsg('');
      setInjectFile(null);
      setInjectPreview(null);
      if (injectFileRef.current) injectFileRef.current.value = '';
      await fetchOverview();
      notifyTasksChanged();
    } catch (e) {
      setInjectDone(`❌ Error: ${e.message}`);
    } finally {
      setInjectBusy(false);
    }
  };

  const handleSubmitComplaint = async (e) => {
    e?.preventDefault?.();
    if (!complaintText.trim()) return;
    try {
      setComplaintBusy(true);
      setComplaintDone(false);
      await api.createComplaint({
        property_id: complaintPropId || undefined,
        text: complaintText.trim(),
      });
      setComplaintDone(true);
      setComplaintText('');
      hotelRealtime.publishLocal('complaint_created', {});
      await fetchOverview();
      notifyTasksChanged();
    } catch (err) {
      console.error(err);
      setComplaintDone(false);
    } finally {
      setComplaintBusy(false);
    }
  };

  // ── Demo Reset ─────────────────────────────────────────────────────────────
  const resetDemo = async () => {
    if (!window.confirm('Reset the demo? This will clear all uploaded files and set all rooms to Ready.')) return;
    setSimBusy(true);
    try {
      const res  = await fetch(`${API_URL}/demo/reset`, { method: 'POST' });
      const json = await res.json();
      await fetchOverview();
      alert(json.message || '♻️ Demo reset complete.');
    } catch (e) {
      alert(`❌ Reset error: ${e.message}`);
    } finally {
      setSimBusy(false);
    }
  };

  const kobiProps = (data?.properties || []).filter(p => p.owner === 'Kobi');
  const almaProps = (data?.properties || []).filter(p => p.owner === 'Alma');
  const stats      = data?.stats || {};
  const simActive  = data?.demo_active ?? false;

  return (
    <div className="gm-root">
      {/* ── Header ── */}
      <div className="gm-header">
        <div className="gm-header-left">
          <div className="gm-pulse-dot" />
          <h1 className="gm-title">{t('nav.godMode') || 'Operational Excellence'}</h1>
          <span className="gm-subtitle">Pilot Demo — Live Operations</span>
          {lastRefresh && (
            <span className="gm-refresh-ts">
              <RefreshCw size={11} /> {lastRefresh.toLocaleTimeString()}
            </span>
          )}
        </div>
        <div className="gm-sim-controls">
          <button
            className="gm-btn gm-btn-run"
            onClick={runPilot}
            disabled={simBusy}
            title="Seed 10 properties + start bots (runPilotSimulation)"
          >
            <Zap size={14} /> Run Pilot
          </button>
          <button
            className="gm-btn"
            onClick={seedRooms}
            disabled={simBusy}
            title="Populate Room Inventory: 4 Occupied, 3 Dirty, 3 Ready + upcoming bookings"
            style={{ background: 'rgba(0,255,136,0.15)', border: '1px solid rgba(0,255,136,0.4)', color: '#00ff88' }}
          >
            <BedDouble size={14} /> Seed Rooms
          </button>
          {simActive ? (
            <button
              className="gm-btn gm-btn-stop"
              onClick={() => toggleSim('stop')}
              disabled={simBusy}
            >
              <Square size={14} /> Stop Bots
            </button>
          ) : (
            <button
              className="gm-btn gm-btn-start"
              onClick={() => toggleSim('start')}
              disabled={simBusy}
            >
              <Play size={14} /> Start Bots
            </button>
          )}
          <button
            className="gm-btn gm-btn-reset"
            onClick={() => toggleSim('reset')}
            disabled={simBusy}
            title="Clear all mock-staff tasks and stop bots"
          >
            <RotateCcw size={14} /> Reset Bots
          </button>
          <button
            className="gm-btn gm-btn-reset-demo"
            onClick={resetDemo}
            disabled={simBusy}
            title="Clear all uploaded demo files and reset rooms to Ready"
          >
            <Trash2 size={14} /> Reset Demo
          </button>
          <div className={`gm-sim-status ${simActive ? 'active' : 'idle'}`}>
            <Activity size={13} /> {simActive ? 'BOTS LIVE' : 'BOTS OFF'}
          </div>
        </div>
      </div>

      {/* ── Stats row ── */}
      <div className="gm-stats-row">
        <StatCard icon={Building2}    label={t('dashboard.properties')}      value={stats.total_properties} color="#3b82f6" loading={loading} />
        <StatCard icon={AlertCircle}  label={t('dashboard.activeTasks')}      value={stats.active_tasks}     color="#f59e0b" loading={loading} />
        <StatCard icon={CheckCircle2} label={t('dashboard.completed')}        value={stats.completed_tasks}  color="#16a34a" loading={loading} />
        <StatCard icon={Users}        label={t('godMode.demoStaff')} value={stats.mock_staff_count} color="#7c3aed" loading={loading} />
        <StatCard icon={Zap}          label={t('dashboard.simComplaints')}  value={loading ? null : (data?.pending_tasks || []).length} color="#ea580c" loading={loading} />
      </div>

      {error && (
        <div className="gm-error-bar">
          ⚠️ Backend offline ({error}).&nbsp;
          Run <code style={{ background: 'rgba(0,0,0,0.3)', padding: '1px 6px', borderRadius: 4 }}>
            python app.py
          </code> in the project root, then&nbsp;
          <button
            onClick={fetchOverview}
            style={{ background: 'none', border: '1px solid #fbbf24', borderRadius: 4,
                     color: '#fbbf24', padding: '1px 8px', cursor: 'pointer', fontWeight: 700 }}
          >retry</button>
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
            {loading && (
              <div className="gm-spinner-wrap">
                <div className="gm-spinner" />
                <span className="gm-spinner-label">טוען נכסים…</span>
              </div>
            )}
            {!loading && (data?.properties || []).length === 0 && (
              <div className="gm-empty-friendly">מחכה לנתונים ראשונים…</div>
            )}
            {!loading && (data?.properties || []).length > 0 && (
              <>
                <div className="gm-owner-section">
                  <div className="gm-owner-header" style={{ color: ownerColor.Kobi }}>
                    👤 קובי — תיק נכסים ({kobiProps.length})
                  </div>
                  {kobiProps.map(p => <PropertyCard key={p.id} prop={p} />)}
                </div>
                <div className="gm-owner-section">
                  <div className="gm-owner-header" style={{ color: ownerColor.Alma }}>
                    👤 עלמה — תיק נכסים ({almaProps.length})
                  </div>
                  {almaProps.map(p => <PropertyCard key={p.id} prop={p} />)}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Column 2 — Incoming Complaints */}
        <div className="gm-panel">
          <div className="gm-panel-header">
            <AlertCircle size={16} /> {t('dashboard.incomingComplaints')}
            <span className="gm-panel-count gm-count-red">{(data?.pending_tasks || []).length}</span>
          </div>
          <div className="gm-panel-body">
            {loading && (
              <div className="gm-spinner-wrap">
                <div className="gm-spinner" />
                <span className="gm-spinner-label">טוען תלונות…</span>
              </div>
            )}
            {!loading && (data?.pending_tasks || []).length === 0 && (
              <div className="gm-empty">אין תלונות פתוחות 🎉</div>
            )}
            {!loading && (data?.pending_tasks || []).map(t => <TaskRow key={t.id} task={t} />)}
          </div>
        </div>

        {/* Column 3 — Staff Responses */}
        <div className="gm-panel">
          <div className="gm-panel-header">
            <CheckCircle2 size={16} /> {t('dashboard.staffResponses')}
            <span className="gm-panel-count gm-count-green">{(data?.completions || []).length}</span>
          </div>
          <div className="gm-panel-body">
            {loading && (
              <div className="gm-spinner-wrap">
                <div className="gm-spinner" />
                <span className="gm-spinner-label">טוען תגובות צוות…</span>
              </div>
            )}
            {!loading && (data?.completions || []).length === 0 && (
              <div className="gm-empty-friendly">
                {simActive ? 'ממתין לתגובות…' : 'הפעל את הסימולציה כדי לראות תגובות צוות.'}
              </div>
            )}
            {!loading && (data?.completions || []).map(c => <CompletionRow key={c.id} c={c} />)}
          </div>
        </div>

      </div>

      {/* ── Submit Complaint (POST /complaints) ── */}
      <div className="gm-inject-panel" style={{ marginBottom: 12 }}>
        <div className="gm-panel-header" style={{ borderRadius: '0.75rem 0.75rem 0 0' }}>
          <AlertCircle size={15} /> Submit Complaint — Task + WhatsApp
          <span className="gm-inject-badge" style={{ background: 'rgba(234,88,12,0.3)', color: '#ea580c' }}>Flow</span>
        </div>
        <div className="gm-inject-body">
          <div className="gm-inject-row">
            <select
              className="gm-inject-select"
              value={complaintPropId}
              onChange={e => setComplaintPropId(e.target.value)}
            >
              <option value="">📍 Property (optional)</option>
              {(data?.properties || []).map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div className="gm-inject-row">
            <textarea
              className="gm-inject-textarea"
              rows={2}
              placeholder="תלונת אורח — e.g. אין מים חמים בחדר 102"
              value={complaintText}
              onChange={e => setComplaintText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSubmitComplaint(e); }}
            />
          </div>
          <div className="gm-inject-actions">
            <button
              type="button"
              className="gm-inject-send-btn"
              onClick={(e) => handleSubmitComplaint(e)}
              disabled={complaintBusy || !complaintText.trim()}
              style={{ background: '#ea580c', borderColor: '#ea580c' }}
            >
              {complaintBusy ? <><span className="gm-inject-spinner" /> Sending…</> : <><Send size={14} /> Submit Complaint</>}
            </button>
            {complaintDone && (
              <div className="gm-inject-done">✅ תלונה נשלחה</div>
            )}
          </div>
        </div>
      </div>

      {/* ── WhatsApp Message Injector ── */}
      <div className="gm-inject-panel">
        <div className="gm-panel-header" style={{ borderRadius: '0.75rem 0.75rem 0 0' }}>
          <MessageSquare size={15} /> WhatsApp Injector — Simulate Incoming Message
          <span className="gm-inject-badge">Operational Excellence</span>
        </div>
        <div className="gm-inject-body">
          <div className="gm-inject-row">
            <select
              className="gm-inject-select"
              value={injectPropId}
              onChange={e => setInjectPropId(e.target.value)}
            >
              <option value="">📍 Select Property (optional)</option>
              {(data?.properties || []).map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div className="gm-inject-row">
            <textarea
              className="gm-inject-textarea"
              rows={3}
              placeholder='Simulate a WhatsApp message, e.g. "יש נזילה בחדר 201, צריך אינסטלטור דחוף"'
              value={injectMsg}
              onChange={e => setInjectMsg(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleInject(); }}
            />
          </div>
          <div className="gm-inject-file-row">
            <label className="gm-inject-file-label">
              <Paperclip size={14} />
              {injectFile ? injectFile.name : 'Attach Image / PDF'}
              <input
                ref={injectFileRef}
                type="file"
                accept="image/*,.pdf"
                style={{ display: 'none' }}
                onChange={handleInjectFile}
              />
            </label>
            {injectPreview && (
              <button
                className="gm-inject-preview-btn"
                onClick={() => setPreviewModal(injectPreview)}
                title="Preview attachment"
              >
                <Eye size={13} /> Preview
              </button>
            )}
            {injectFile && (
              <button
                className="gm-inject-clear-file"
                onClick={() => { setInjectFile(null); setInjectPreview(null); if (injectFileRef.current) injectFileRef.current.value = ''; }}
                title="Remove attachment"
              >✕</button>
            )}
          </div>
          <div className="gm-inject-actions">
            <button
              className="gm-inject-send-btn"
              onClick={handleInject}
              disabled={injectBusy || !injectMsg.trim()}
            >
              {injectBusy
                ? <><span className="gm-inject-spinner" /> Sending…</>
                : <><Send size={14} /> Inject Message</>
              }
            </button>
            {injectDone && (
              <div className="gm-inject-done">
                {injectDone}
              </div>
            )}
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
        <div className="gm-log-body" ref={logBodyRef}>
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
        <span className="gm-legend-item">🧹 עלמה — ניקיון</span>
        <span className="gm-legend-item">🔧 קובי — תחזוקה</span>
        <span className="gm-legend-item">⚡ אבי — חשמל</span>
        <span className="gm-legend-sep" />
        <span className="gm-legend-item" style={{ color: '#64748b' }}>Auto-refresh every 5 s</span>
      </div>

      {/* ── Attachment Preview Modal ── */}
      {previewModal && (
        <div className="gm-preview-modal-backdrop" onClick={() => setPreviewModal(null)}>
          <div className="gm-preview-modal" onClick={e => e.stopPropagation()}>
            <button className="gm-preview-close" onClick={() => setPreviewModal(null)}>✕</button>
            <img src={previewModal} alt="Attachment preview" className="gm-preview-img" />
          </div>
        </div>
      )}
    </div>
  );
}
