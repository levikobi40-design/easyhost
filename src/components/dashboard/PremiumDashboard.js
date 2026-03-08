import React, { useState, useEffect, useCallback, useRef } from 'react';
import { CheckCircle, Clock, DollarSign, Activity, Home, Users, Phone, MessageCircle } from 'lucide-react';
import useStore from '../../store/useStore';
import { toWhatsAppPhone } from '../../utils/phone';
import { getDashboardSummary, getStatsSummary, getPropertyTasks, updatePropertyTaskStatus } from '../../services/api';
import StaffGrid from './StaffGrid';
import AirbnbImporter from './AirbnbImporter';
import GuestChatFeed from '../guest/GuestChatFeed';
import PropertyCreatorModal from './PropertyCreatorModal';
import TaskListErrorBoundary from '../common/TaskListErrorBoundary';
import ManagerPipeline from './ManagerPipeline';

const TASK_CHART_COLORS = ['#3b82f6', '#10b981'];
const PIE_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'];

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
        <span className="px-3 py-1 bg-emerald-500/20 text-emerald-400 text-xs font-semibold rounded-full border border-emerald-500/30">LIVE</span>
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
            return (
              <div
                key={task?.id != null && typeof task.id !== 'object' ? String(task.id) : `task-${index}`}
                className="relative flex gap-4 p-4 rounded-2xl bg-gray-800/60 dark:bg-gray-700/40 border border-gray-700/50 dark:border-gray-600/40 hover:border-gray-600/60 transition-colors"
              >
                <div
                  className={`z-10 w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                    isDone ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : isSeen ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
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
                        {!isSeen && (
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

const KPICard = ({ title, value, icon: Icon, color }) => (
  <div className="bg-white dark:bg-gray-800 p-6 rounded-3xl border border-gray-100 dark:border-gray-700 shadow-sm flex items-center gap-4">
    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${color}`}>
      <Icon size={24} />
    </div>
    <div>
      <p className="text-xs text-gray-400 dark:text-gray-400 font-medium">{title}</p>
      <h4 className="text-2xl font-black text-gray-100 dark:text-white">{value}</h4>
    </div>
  </div>
);

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
  const [summary, setSummary] = useState(null);
  const [stats, setStats] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [importSuccess, setImportSuccess] = useState(0);
  const [showPropertyModal, setShowPropertyModal] = useState(false);
  const loadRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const loadId = ++loadRef.current;
    setLoading(true);
    Promise.all([getDashboardSummary(), getStatsSummary(), getPropertyTasks()])
      .then(([s, st, t]) => {
        if (!cancelled && loadId === loadRef.current) {
          setSummary(s ?? null);
          setStats(st ?? null);
          setTasks(Array.isArray(t) ? t : []);
        }
      })
      .catch((e) => {
        if (!cancelled && loadId === loadRef.current) {
          setSummary({ revenue: '0₪', active_tasks_count: 0, status: 'Unavailable' });
          setStats({ total_properties: 0, tasks_by_status: { Pending: 0, Done: 0 }, staff_workload: {}, total_capacity: 0, top_staff: [] });
          setTasks([]);
        }
      })
      .finally(() => {
        if (!cancelled && loadId === loadRef.current) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [importSuccess]);

  useEffect(() => {
    const onTaskCreated = (e) => {
      const newTask = e?.detail?.task;
      if (newTask?.id) {
        setTasks((prev) => {
          if ((prev ?? []).some((t) => t.id === newTask.id)) return prev ?? [];
          return [{ ...newTask, status: newTask.status || 'Pending' }, ...(prev ?? [])];
        });
      }
      Promise.all([getStatsSummary(), getPropertyTasks()]).then(([st, t]) => {
        if (st) setStats(st);
        setTasks(Array.isArray(t) ? t : []);
      });
    };
    window.addEventListener('maya-task-created', onTaskCreated);
    return () => window.removeEventListener('maya-task-created', onTaskCreated);
  }, []);

  const addMayaMessage = useStore((s) => s.addMayaMessage);
  const addNotification = useStore((s) => s.addNotification);
  const toggleMayaChat = useStore((s) => s.toggleMayaChat);

  const handleToggleStatus = useCallback(async (taskId, newStatus, task) => {
    try {
      await updatePropertyTaskStatus(taskId, newStatus);
      setTasks((prev) => (prev ?? []).map((t) => (t.id === taskId ? { ...t, status: newStatus } : t)));
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
  }, [addMayaMessage, addNotification, toggleMayaChat]);

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

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-8" dir="rtl">
      <div className="flex justify-between items-end mb-10">
        <div>
          <h1 className="text-3xl font-black text-gray-900 dark:text-white">בוקר טוב, מנהל</h1>
          <p className="text-gray-500 dark:text-gray-400">כל הנכסים שלך תחת שליטה. הנה מה שקורה היום.</p>
        </div>
        <button
          type="button"
          onClick={() => setShowPropertyModal(true)}
          className="bg-black dark:bg-white text-white dark:text-gray-900 px-6 py-3 rounded-2xl font-bold hover:opacity-90 transition-all"
        >
          + הוסף נכס חדש
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-10">
        <KPICard
          title="הכנסות החודש"
          value={summary?.revenue ?? '₪0'}
          icon={DollarSign}
          color="bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400"
        />
        <KPICard
          title="נכסים"
          value={String(stats?.total_properties ?? 0)}
          icon={Home}
          color="bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
        />
        <KPICard
          title="קיבולת כוללת"
          value={String(stats?.total_capacity ?? 0)}
          icon={Users}
          color="bg-violet-50 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400"
        />
        <KPICard
          title="משימות פעילות"
          value={String(stats?.tasks_by_status?.Pending ?? 0)}
          icon={Activity}
          color="bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <AirbnbImporter onSuccess={() => setImportSuccess((n) => n + 1)} />
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
            <TaskTimeline tasks={tasks ?? []} loading={loading} onToggleStatus={handleToggleStatus} />
          </TaskListErrorBoundary>
          <ManagerPipeline />
          <QuickActionStaff topStaff={stats?.top_staff} />
          <GuestChatFeed />
        </div>
      </div>

      <PropertyCreatorModal
        isOpen={showPropertyModal}
        onClose={() => setShowPropertyModal(false)}
        onSuccess={() => setImportSuccess((n) => n + 1)}
      />
    </div>
  );
}
