import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle, Clock, DollarSign, Activity, Home, Users, Phone, MessageCircle, Percent } from 'lucide-react';
import useStore from '../../store/useStore';
import useCurrency from '../../hooks/useCurrency';
import { toWhatsAppPhone } from '../../utils/phone';
import { API_URL } from '../../config.js';
import { getDashboardSummary, getStatsSummary, updatePropertyTaskStatus } from '../../services/api';
import { useProperties } from '../../context/PropertiesContext';
import { useMission } from '../../context/MissionContext';
import StaffGrid from './StaffGrid';
import AirbnbImporter from './AirbnbImporter';
import RevenueCharts from './RevenueCharts';
import GuestChatFeed from '../guest/GuestChatFeed';
import PropertyCreatorModal from './PropertyCreatorModal';
import TaskListErrorBoundary from '../common/TaskListErrorBoundary';
import ManagerPipeline from './ManagerPipeline';

const TASK_CHART_COLORS = ['#3b82f6', '#10b981'];
const PIE_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'];

/**
 * Pilot / simulation refresh — Hotel Bazaar Jaffa (61-room engine) + portfolio occupancy.
 */
const refreshHotelOpsSimulation = async () => {
  const headers = { 'Content-Type': 'application/json' };
  try {
    const raw = localStorage.getItem('hotel-enterprise-storage');
    const parsed = raw ? JSON.parse(raw) : null;
    const token = parsed?.state?.authToken;
    const tenantId = parsed?.state?.activeTenantId;
    if (token) headers.Authorization = `Bearer ${token}`;
    if (tenantId) headers['X-Tenant-Id'] = tenantId;
  } catch (_) {
    /* ignore */
  }
  const res = await fetch(`${API_URL}/simulation/refresh?t=${Date.now()}`, {
    method: 'POST',
    headers,
    credentials: 'include',
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || data.message || `Simulation refresh failed (${res.status})`);
  }
  return data;
};

/** Dedupe by task id so list length does not jump when API returns overlaps. */
function dedupeTasksById(arr) {
  const seen = new Set();
  const out = [];
  for (const t of arr || []) {
    const id = t?.id != null ? String(t.id) : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(t);
  }
  return out;
}

/** Always return a string for rendering - prevents [object Object] crash */
const safeStr = (val, fallback = '') => {
  if (val == null) return fallback;
  if (typeof val === 'string') return val;
  if (typeof val === 'object') return safeStr(val.content ?? val.title ?? val.text, fallback);
  return String(val);
};

const TaskTimeline = ({ tasks, loading, onToggleStatus = () => {} }) => {
  const mapStatus = (s) => {
    if (!s) return 'pending';
    if (s === 'Done' || s === 'done' || s === 'Completed' || s === 'completed') return 'completed';
    if (s === 'Seen' || s === 'seen') return 'seen';
    if (String(s).toLowerCase().replace(/\s+/g, '_') === 'in_progress') return 'in_progress';
    return 'pending';
  };

  const formatTime = (dueAt) => {
    if (!dueAt) return '—';
    try {
      const d = new Date(dueAt);
      return d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return typeof dueAt === 'string' && dueAt.length >= 16 ? dueAt.slice(11, 16) : '—';
    }
  };

  const list = Array.isArray(tasks) ? tasks.slice(0, 12) : [];

  return (
    <div className="p-6 bg-gray-900/50 dark:bg-gray-800/80 rounded-3xl shadow-xl border border-gray-700/50 dark:border-gray-600/50 backdrop-blur-sm">
      <div className="flex justify-between items-center mb-6">
        <h3 className="text-xl font-bold text-gray-100 dark:text-white">רשימת משימות</h3>
        <span className="px-3 py-1 bg-emerald-500/20 text-emerald-400 text-xs font-semibold rounded-full border border-emerald-500/30">שידור חי</span>
      </div>
      {loading ? (
        <div className="py-8 text-center text-gray-400 dark:text-gray-500">טוען...</div>
      ) : list.length === 0 ? (
        <div className="py-8 text-center text-gray-400 dark:text-gray-500">אין משימות כרגע</div>
      ) : (
        <div className="space-y-4">
          {list.map((task, index) => {
            const status = mapStatus(task.status);
            const displayName = safeStr(task.property_name ?? task.propertyName ?? task.room) || 'נכס';
            const capacity = safeStr(task.property_context ?? task.propertyContext) || '';
            const timeStr = formatTime(task.due_at || task.created_at);
            const isDone = status === 'completed';
            const isSeen = status === 'seen';
            const isInProg = status === 'in_progress';
            return (
              <div
                key={task?.id != null && typeof task.id !== 'object' ? String(task.id) : `task-${index}`}
                className="relative flex gap-4 p-4 rounded-2xl bg-gray-800/60 dark:bg-gray-700/40 border border-gray-700/50 dark:border-gray-600/40 hover:border-gray-600/60 transition-colors"
              >
                <div
                  className={`z-10 w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                    isDone ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                      : isInProg ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30'
                      : isSeen ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                      : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                  }`}
                >
                  {isDone ? <CheckCircle size={18} /> : <Clock size={18} />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-start gap-2">
                    <div>
                      <p className="text-sm font-bold text-gray-100 dark:text-white truncate">{displayName}</p>
                      {capacity && (
                        <p className="text-xs text-gray-400 dark:text-gray-400 mt-0.5">{capacity}</p>
                      )}
                    </div>
                    <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">{timeStr}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2">
                    <span className="text-xs text-gray-400 dark:text-gray-400">{safeStr(task.staff_name ?? task.staffName) || '—'}</span>
                    {(task.staff_phone ?? task.staffPhone) ? (
                      <>
                        <a
                          href={`tel:${safeStr(task.staff_phone ?? task.staffPhone).replace(/\D/g, '')}`}
                          className="text-xs font-medium text-blue-400 hover:text-blue-300 hover:underline inline-flex items-center gap-1"
                        >
                          <Phone size={12} />
                          {safeStr(task.staff_phone ?? task.staffPhone)}
                        </a>
                        <a
                          href={`https://wa.me/${toWhatsAppPhone(task.staff_phone ?? task.staffPhone)}?text=${encodeURIComponent(`Hi ${safeStr(task.staff_name ?? task.staffName)}, you have a task: ${safeStr(task.description ?? task.title ?? task.content).slice(0, 120)}`)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[#25D366] hover:text-[#20bd5a] inline-flex"
                          title="WhatsApp"
                        >
                          <MessageCircle size={14} />
                        </a>
                      </>
                    ) : null}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {!isDone && (
                      <>
                        {!isSeen && !isInProg && (
                          <button
                            type="button"
                            onClick={() => onToggleStatus(task.id, 'Seen', task)}
                            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg text-blue-400 hover:bg-blue-500/20 border border-blue-500/30 transition-colors"
                          >
                            ראיתי ✅
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => onToggleStatus(task.id, 'Done', task)}
                          className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/30 transition-colors"
                        >
                          <CheckCircle size={14} /> בוצע 🏁
                        </button>
                      </>
                    )}
                    {isDone && (
                      <button
                        type="button"
                        onClick={() => onToggleStatus(task.id, 'Pending', task)}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg text-amber-400 hover:bg-amber-500/20 border border-amber-500/30 transition-colors"
                      >
                        חזרה לממתין
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

const KPICard = ({ title, value, icon: Icon, color, onClick, active }) => (
  <div
    onClick={onClick}
    className={`bg-white dark:bg-gray-800 p-6 rounded-3xl border shadow-sm flex items-center gap-4 transition-all select-none
      ${active
        ? 'border-[#00ff88] ring-2 ring-[#00ff88]/40 cursor-pointer shadow-lg shadow-[#00ff88]/10'
        : 'border-gray-100 dark:border-gray-700'}
      ${onClick ? 'cursor-pointer hover:shadow-md hover:border-[#00ff88]/60' : ''}`}
    style={{ boxSizing: 'border-box' }}
  >
    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${color}`}>
      <Icon size={24} />
    </div>
    <div className="min-w-0 flex-1">
      <p className="text-xs font-bold text-gray-900 dark:text-gray-200 truncate">{title}</p>
      <h4 className="text-2xl font-black text-gray-900 dark:text-white truncate">{value}</h4>
    </div>
    {onClick && (
      <span className="text-[#00ff88] text-lg" title="לחץ לפירוט">›</span>
    )}
  </div>
);

/* ── Revenue breakdown modal ─────────────────────────────────────── */
const RevenueModal = ({ summary, onClose }) => {
  const { format } = useCurrency();
  const rows = Array.isArray(summary?.revenue_breakdown)
    ? summary.revenue_breakdown
    : [];

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#fff', borderRadius: 24, padding: '32px 28px',
          minWidth: 320, maxWidth: 480, width: '90vw',
          boxShadow: '0 24px 64px rgba(0,0,0,0.4)',
          border: '2px solid #00ff88',
          color: '#000',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ fontSize: 20, fontWeight: 900, color: '#000', margin: 0 }}>
            💰 פירוט הכנסות החודש
          </h2>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#000', fontWeight: 900 }}
          >×</button>
        </div>

        {rows.length === 0 ? (
          <p style={{ color: '#000', fontWeight: 700, textAlign: 'center', padding: '24px 0' }}>
            אין נתוני הכנסות עדיין.<br />
            <span style={{ fontSize: 13, fontWeight: 600 }}>הפעל את /simulate-week ליצירת נתוני דמו.</span>
          </p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'right', color: '#000', fontWeight: 900, padding: '8px 4px', borderBottom: '2px solid #00ff88' }}>נכס</th>
                <th style={{ textAlign: 'left',  color: '#000', fontWeight: 900, padding: '8px 4px', borderBottom: '2px solid #00ff88' }}>הכנסה</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={{
                    color: '#000', fontWeight: 700, padding: '10px 4px',
                    maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {r.property_name || r.name || `נכס ${i + 1}`}
                  </td>
                  <td style={{ color: '#000', fontWeight: 900, padding: '10px 4px', textAlign: 'left' }}>
                    {format(Number(r.revenue ?? r.amount ?? 0))}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td style={{ color: '#000', fontWeight: 900, padding: '12px 4px', borderTop: '2px solid #00ff88' }}>סה"כ</td>
                <td style={{ color: '#000', fontWeight: 900, padding: '12px 4px', borderTop: '2px solid #00ff88', textAlign: 'left' }}>
                  {format(rows.reduce((acc, r) => acc + Number(r.revenue ?? r.amount ?? 0), 0))}
                </td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  );
};

const QuickActionStaff = ({ topStaff }) => {
  const callPhone = (phone) => {
    if (!phone) return;
    window.location.href = `tel:${phone.replace(/\D/g, '')}`;
  };
  if (!topStaff?.length) return null;
  return (
    <div className="p-6 bg-gray-900/50 dark:bg-gray-800/80 rounded-3xl border border-gray-700/50 dark:border-gray-600/50 shadow-xl backdrop-blur-sm">
      <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-4 flex items-center gap-2">
        <Phone size={20} className="text-blue-500" />
        קשר מהיר
      </h3>
      <div className="space-y-3">
        {topStaff.map((s, i) => (
          <div
            key={i}
            className="flex justify-between items-center p-3 rounded-xl bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <span className="font-medium text-gray-100 dark:text-white">{s.name}</span>
            <a
              href={`tel:${(s.phone || '').replace(/\D/g, '')}`}
              onClick={(e) => { e.preventDefault(); callPhone(s.phone); }}
              className="text-blue-600 dark:text-blue-400 font-medium text-sm hover:underline"
            >
              {s.phone}
            </a>
          </div>
        ))}
      </div>
    </div>
  );
};

export default function PremiumDashboard() {
  const navigate = useNavigate();
  const { format } = useCurrency();
  const { refresh: fetchProperties } = useProperties();
  const mission = useMission();
  const {
    tasks: missionTasks,
    refresh: fetchTasks,
    loading: missionLoading,
    updateTaskInList,
  } = mission;
  const patchTaskInMission =
    typeof updateTaskInList === 'function' ? updateTaskInList : () => {};
  const tasks = useMemo(() => dedupeTasksById(missionTasks), [missionTasks]);
  const [summary, setSummary] = useState(null);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showPropertyModal, setShowPropertyModal] = useState(false);
  const [showRevenueModal, setShowRevenueModal] = useState(false);
  const [simRefreshing, setSimRefreshing] = useState(false);
  const loadRef = useRef(0);
  const bootstrapOnceRef = useRef(false);

  /** Local dashboard bundle — call on mount, Run Pilot, or explicit user actions (not global timers). */
  const loadDashboardData = useCallback(async () => {
    const loadId = ++loadRef.current;
    setLoading(true);
    try {
      if (!bootstrapOnceRef.current) {
        bootstrapOnceRef.current = true;
        try {
          const { bootstrapOperationalData } = await import('../../services/api');
          await bootstrapOperationalData();
        } catch (_) {
          /* App.js may have seeded; continue */
        }
      }
      await fetchProperties(true);
      await fetchTasks({ fullList: true });
      const [s, st] = await Promise.all([getDashboardSummary(), getStatsSummary()]);
      if (loadId !== loadRef.current) return undefined;
      setSummary(s ?? null);
      setStats(st ?? null);
      return true;
    } catch {
      if (loadId !== loadRef.current) return undefined;
      setSummary({ revenue: '0', active_tasks_count: 0, status: 'Unavailable' });
      setStats({
        total_properties: 0,
        tasks_by_status: { Pending: 0, Done: 0 },
        total_tasks: 0,
        total_active_tasks: 0,
        staff_workload: {},
        total_capacity: 0,
        top_staff: [],
      });
      return false;
    } finally {
      if (loadId === loadRef.current) setLoading(false);
    }
  }, [fetchTasks, fetchProperties]);

  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);

  /** Re-sync when simulation or global refresh events fire (not only on mount). */
  useEffect(() => {
    const onGlobalRefresh = () => {
      loadDashboardData();
    };
    window.addEventListener('properties-refresh', onGlobalRefresh);
    window.addEventListener('maya-refresh-tasks', onGlobalRefresh);
    return () => {
      window.removeEventListener('properties-refresh', onGlobalRefresh);
      window.removeEventListener('maya-refresh-tasks', onGlobalRefresh);
    };
  }, [loadDashboardData]);

  useEffect(() => {
    const onTaskCreated = () => {
      fetchTasks({ fullList: true }).then(() =>
        getStatsSummary().then((st) => {
          if (st) setStats(st);
        })
      );
    };
    window.addEventListener('maya-task-created', onTaskCreated);
    return () => {
      window.removeEventListener('maya-task-created', onTaskCreated);
    };
  }, [fetchTasks]);

  const addMayaMessage = useStore((s) => s.addMayaMessage);
  const addNotification = useStore((s) => s.addNotification);
  const toggleMayaChat = useStore((s) => s.toggleMayaChat);

  const handleSimulationRefresh = useCallback(async () => {
    setSimRefreshing(true);
    try {
      const out = await refreshHotelOpsSimulation();
      const line = out?.mayaMessage || out?.displayMessage || out?.message;
      if (line) {
        addMayaMessage({ role: 'assistant', content: line });
        toggleMayaChat(true);
      }
      await fetchProperties(true);
      await fetchTasks({ fullList: true });
      await loadDashboardData();
      window.dispatchEvent(new CustomEvent('properties-refresh', { detail: { force: true } }));
    } catch (e) {
      window.alert(e?.message || 'Simulation refresh failed');
    } finally {
      setSimRefreshing(false);
    }
  }, [addMayaMessage, fetchProperties, fetchTasks, loadDashboardData, toggleMayaChat]);

  const handleToggleStatus = useCallback(async (taskId, newStatus, task) => {
    try {
      await updatePropertyTaskStatus(taskId, newStatus);
      patchTaskInMission(taskId, (t) => ({ ...t, status: newStatus }));
      const staffName = (task?.staff_name ?? task?.staffName ?? 'העובד').trim() || 'העובד';
      if (newStatus === 'Seen') {
        addMayaMessage({ role: 'assistant', content: `${staffName} אישר את המשימה` });
        toggleMayaChat(true);
      } else if (newStatus === 'Done') {
        addMayaMessage({ role: 'assistant', content: `${staffName} סיים את המשימה ✅` });
        addNotification({ type: 'success', title: 'מאיה', message: `${staffName} סיים את המשימה` });
        toggleMayaChat(true);
      }
    } catch (e) {
      window.alert(e?.message || 'Failed to update');
    }
  }, [addMayaMessage, addNotification, toggleMayaChat, patchTaskInMission]);

  const tasksByStatusData = stats?.tasks_by_status
    ? [
        { name: 'ממתינות', value: stats.tasks_by_status.Pending || 0, fill: TASK_CHART_COLORS[0] },
        { name: 'הושלמו', value: stats.tasks_by_status.Done || 0, fill: TASK_CHART_COLORS[1] },
      ]
    : [];
  const staffWorkloadData = stats?.staff_workload
    ? Object.entries(stats.staff_workload)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name, count], i) => ({
          name: name.length > 10 ? name.slice(0, 8) + '…' : name,
          fullName: name,
          tasks: count,
          fill: PIE_COLORS[i % PIE_COLORS.length],
        }))
    : [];

  const totalTasksDisplay =
    Number(stats?.total_active_tasks ?? stats?.total_tasks ?? 0) || 0;

  return (
    <div
      className="min-h-screen bg-gray-50 dark:bg-gray-900 p-8"
      dir="rtl"
      style={{ maxWidth: '100vw', boxSizing: 'border-box', overflowX: 'hidden' }}
    >
      {showRevenueModal && (
        <RevenueModal summary={summary} onClose={() => setShowRevenueModal(false)} />
      )}

      <div className="flex justify-between items-end mb-10" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <h1 className="text-3xl font-black text-gray-900 dark:text-white" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            בוקר טוב, מנהל
          </h1>
          <p className="text-gray-700 dark:text-gray-300 font-semibold">כל הנכסים שלך תחת שליטה. הנה מה שקורה היום.</p>
        </div>
        <button
          type="button"
          onClick={() => setShowPropertyModal(true)}
          className="px-6 py-3 rounded-2xl font-black transition-all"
          style={{
            background: 'rgba(15,23,41,0.85)',
            color: '#ffffff',
            border: '1.5px solid rgba(0,255,136,0.55)',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            fontWeight: 900,
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = '#00ff88'; e.currentTarget.style.background = 'rgba(0,255,136,0.08)'; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(0,255,136,0.55)'; e.currentTarget.style.background = 'rgba(15,23,41,0.85)'; }}
        >
          + הוסף נכס חדש
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-10">
        {/* Revenue KPI — clickable → breakdown modal */}
        <KPICard
          title="הכנסות החודש"
          value={format(Number(summary?.revenue) || 0)}
          icon={DollarSign}
          color="bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400"
          onClick={() => setShowRevenueModal(true)}
          active={showRevenueModal}
        />
        <KPICard
          title="נכסים"
          value={String(stats?.total_properties ?? 0)}
          icon={Home}
          color="bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
          onClick={() => navigate('/properties')}
        />
        <KPICard
          title="שיעור תפוסה (סימולציה)"
          value={
            simRefreshing
              ? '…'
              : stats?.occupancy_pct != null && stats?.occupancy_pct !== ''
                ? `${Math.round(Number(stats.occupancy_pct))}%`
                : '—'
          }
          icon={Percent}
          color="bg-rose-50 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400"
          onClick={simRefreshing ? undefined : handleSimulationRefresh}
        />
        <KPICard
          title="קיבולת כוללת"
          value={String(stats?.total_capacity ?? 0)}
          icon={Users}
          color="bg-violet-50 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400"
        />
        <KPICard
          title="בקשות פתוחות"
          value={String(totalTasksDisplay)}
          icon={Activity}
          color="bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400"
        />
      </div>

      {/* ── גרפי הכנסות ותפוסה ──────────────────────────── */}
      <RevenueCharts />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <AirbnbImporter onSuccess={() => loadDashboardData()} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-gray-800/60 dark:bg-gray-800/80 rounded-3xl border border-gray-700/50 dark:border-gray-600/50 shadow-xl backdrop-blur-sm p-6 min-h-[280px]">
              <h3 className="text-lg font-bold text-gray-100 dark:text-white mb-4">משימות לפי סטטוס</h3>
              {tasksByStatusData.some((d) => d.value > 0) ? (
                <div className="space-y-4 mt-4">
                  {tasksByStatusData.map((d) => {
                    const total = tasksByStatusData.reduce((s, x) => s + x.value, 0) || 1;
                    const pct = Math.round((d.value / total) * 100);
                    return (
                      <div key={d.name}>
                        <div className="flex justify-between text-sm text-gray-300 mb-1">
                          <span>{d.name}</span>
                          <span className="font-bold">{d.value}</span>
                        </div>
                        <div className="w-full bg-gray-700 rounded-full h-4 overflow-hidden">
                          <div
                            className="h-4 rounded-full transition-all duration-700"
                            style={{ width: `${pct}%`, backgroundColor: d.fill }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="h-[200px] flex items-center justify-center text-gray-400 dark:text-gray-500">אין משימות</div>
              )}
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-3xl border border-gray-100 dark:border-gray-700 shadow-sm p-6 min-h-[280px]">
              <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-4">עומס עובדים</h3>
              {staffWorkloadData.length > 0 ? (
                <div className="space-y-3 mt-4">
                  {staffWorkloadData.map((d) => {
                    const maxTasks = Math.max(...staffWorkloadData.map((x) => x.tasks)) || 1;
                    const pct = Math.round((d.tasks / maxTasks) * 100);
                    return (
                      <div key={d.fullName}>
                        <div className="flex justify-between text-sm text-gray-600 dark:text-gray-300 mb-1">
                          <span className="truncate max-w-[140px]">{d.fullName}</span>
                          <span className="font-bold">{d.tasks} משימות</span>
                        </div>
                        <div className="w-full bg-gray-100 dark:bg-gray-700 rounded-full h-3 overflow-hidden">
                          <div
                            className="h-3 rounded-full transition-all duration-700"
                            style={{ width: `${pct}%`, backgroundColor: d.fill }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="h-[200px] flex items-center justify-center text-gray-400 dark:text-gray-500">אין נתונים</div>
              )}
            </div>
          </div>
          <StaffGrid />
        </div>
        <div className="space-y-8">
          <TaskListErrorBoundary>
            <TaskTimeline tasks={tasks ?? []} loading={loading || missionLoading} onToggleStatus={handleToggleStatus} />
          </TaskListErrorBoundary>
          <ManagerPipeline />
          <QuickActionStaff topStaff={stats?.top_staff} />
          <GuestChatFeed />
        </div>
      </div>

      <PropertyCreatorModal
        isOpen={showPropertyModal}
        onClose={() => setShowPropertyModal(false)}
        onSuccess={() => loadDashboardData()}
      />
    </div>
  );
}
