/**
 * StaffDashboard — Guest-style worker dashboard
 * Same visual concept as GuestDashboard: cityscape bg, welcome header, task tiles grid, fixed tab bar.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import {
  Home,
  ClipboardList,
  User,
  MessageCircle,
} from 'lucide-react';
import { updatePropertyTaskStatus } from '../../services/api';
import { API_URL } from '../../utils/apiClient';
import easyhostLogoDark from '../../assets/easyhost-logo-dark.svg';
import '../guest/GuestDashboard.css';
import './StaffDashboard.css';

const BG_IMAGE = 'https://images.unsplash.com/photo-1514565131-fce0801e5785?w=1920&auto=format&fit=crop';

const TASK_IMAGES = {
  Cleaning: 'https://images.unsplash.com/photo-1582735689369-4fe89db7114c?w=400&auto=format&fit=crop',
  Maintenance: 'https://images.unsplash.com/photo-1581092160562-40aa08e78837?w=400&auto=format&fit=crop',
  Service: 'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=400&auto=format&fit=crop',
};

const TAB_ITEMS = [
  { id: 'home', icon: Home, label: 'בית' },
  { id: 'tasks', icon: ClipboardList, label: 'משימות' },
  { id: 'profile', icon: User, label: 'פרופיל' },
  { id: 'maya', icon: MessageCircle, label: 'צ\'אט מאיה' },
];

function workerNameFromPath(pathname) {
  if (!pathname || typeof pathname !== 'string') return null;
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] === 'staff') return parts[1] && !['tasks','profile','maya'].includes(parts[1]) ? decodeURIComponent(parts[1]) : null;
  if (parts[0] === 'worker' && parts[1]) return decodeURIComponent(parts[1]);
  return null;
}

function tabFromPath(pathname) {
  if (!pathname) return 'home';
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] === 'staff') {
    if (parts[1] === 'tasks') return 'tasks';
    if (parts[1] === 'profile') return 'profile';
    if (parts[1] === 'maya') return 'maya';
    return 'home';
  }
  if (parts[2] === 'tasks') return 'tasks';
  if (parts[2] === 'profile') return 'profile';
  if (parts[2] === 'maya') return 'maya';
  return 'home';
}

function parseRoomComposition(desc) {
  if (!desc || typeof desc !== 'string') return '—';
  const m = desc.match(/עבור\s+([^ב]+?)(?:בתאריך|$)/);
  return m ? m[1].trim() : '—';
}

function parseRoomFromDesc(desc, propertyName) {
  if (!desc && !propertyName) return '—';
  const roomMatch = (desc || '').match(/חדר\s*(\d+[^,\s]*|\S+)/);
  if (roomMatch) return roomMatch[1];
  const propMatch = (propertyName || desc || '').match(/(\d{3,4})/);
  return propMatch ? propMatch[1] : (propertyName || '—');
}

function getTaskTypeLabel(taskType, desc) {
  const lower = (taskType || desc || '').toLowerCase();
  if (lower.includes('ניקיון') || lower.includes('cleaning')) return 'ניקיון יסודי';
  if (lower.includes('תקל') || lower.includes('חשמל') || lower.includes('maintenance')) return 'תקלה/תחזוקה';
  if (lower.includes('שירות') || lower.includes('service')) return 'שירות';
  return desc ? desc.slice(0, 30) : (taskType || 'משימה');
}

function StaffToast({ message, onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 3500);
    return () => clearTimeout(t);
  }, [onClose]);
  return (
    <div className="guest-toast staff-success-toast" role="alert">
      {message}
    </div>
  );
}

export default function StaffDashboard() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { id: workerIdParam } = useParams();
  const workerFromPath = workerNameFromPath(pathname);
  const workerName = typeof workerFromPath === 'string' ? workerFromPath : (pathname?.startsWith?.('/staff') ? 'צוות' : 'עובד');
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const activeTab = tabFromPath(pathname);
  const [markingId, setMarkingId] = useState(null);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    try {
      const base = API_URL.replace(/\/$/, '');
      let url = `${base}/property-tasks`;
      if (pathname.startsWith('/worker') && workerIdParam) {
        url = `${base}/my-tasks?worker_id=${encodeURIComponent(workerIdParam)}`;
      } else if (workerFromPath) {
        url = `${base}/property-tasks?worker=${encodeURIComponent(workerFromPath)}`;
      }
      const res = await fetch(url);
      if (!res.ok) return;
      const raw = await res.json();
      const list = Array.isArray(raw) ? raw : [];
      const active = list.filter((t) => !['done', 'Done', 'completed', 'Completed'].includes(t.status || ''));
      setTasks(active);
    } catch (_) {
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, [workerFromPath, workerIdParam, pathname]);

  useEffect(() => {
    loadTasks();
    const onRefresh = () => loadTasks();
    window.addEventListener('maya-refresh-tasks', onRefresh);
    window.addEventListener('maya-task-created', onRefresh);
    return () => {
      window.removeEventListener('maya-refresh-tasks', onRefresh);
      window.removeEventListener('maya-task-created', onRefresh);
    };
  }, [loadTasks]);

  const handleMarkDone = useCallback(
    async (task) => {
      if (markingId) return;
      setMarkingId(task.id);
      try {
        await updatePropertyTaskStatus(task.id, 'Done');
        setToast('המשימה בוצעה בהצלחה!');
        setTasks((prev) => prev.filter((t) => t.id !== task.id));
        window.dispatchEvent(new Event('maya-refresh-tasks'));
      } catch (e) {
        setToast(e?.message || 'שגיאה — נסה שוב');
      } finally {
        setMarkingId(null);
      }
    },
    [markingId]
  );

  const handleTabClick = useCallback((id) => {
    if (id === 'maya') {
      window.dispatchEvent(new CustomEvent('maya-chat-open'));
      return;
    }
    const isStaffPath = pathname.startsWith('/staff');
    const base = isStaffPath ? '/staff' : `/worker/${encodeURIComponent(workerName)}`;
    const path = id === 'home' ? base : `${base}/${id}`;
    navigate(path);
  }, [navigate, workerName, pathname]);

  return (
    <div className="guest-dashboard staff-dashboard" dir="rtl">
      <div className="guest-bg" style={{ backgroundImage: `url(${BG_IMAGE})` }} />
      <div className="guest-overlay" />
      <div className="guest-content">
        <header className="guest-header guest-header-centered">
          <div className="guest-header-row">
            <img src={easyhostLogoDark} alt="" className="guest-logo guest-logo-dark" />
            <h1 className="guest-title">EasyHost AI</h1>
          </div>
          <div className="guest-welcome">
            <p className="guest-welcome-line1">היי {workerName}!</p>
            <p className="guest-welcome-line2">מאיה ריכזה עבורך את המשימות להיום</p>
          </div>
        </header>

        <div className="guest-grid guest-grid-3col staff-task-grid">
          {activeTab === 'profile' && (
            <div className="staff-tab-placeholder">
              <User size={48} />
              <p>פרופיל — {workerName}</p>
            </div>
          )}
          {activeTab === 'maya' && (
            <div className="staff-tab-placeholder">
              <MessageCircle size={48} />
              <p>צ'אט מאיה זמין באפליקציית הניהול</p>
            </div>
          )}
          {(activeTab === 'home' || activeTab === 'tasks') && (
            loading ? (
              <div className="staff-loading">טוען משימות...</div>
            ) : tasks.length === 0 ? (
              <div className="staff-empty">אין משימות כרגע</div>
            ) : (
              tasks.map((t) => {
              const room = parseRoomFromDesc(t.description, t.property_name);
              const taskLabel = getTaskTypeLabel(t.task_type, t.description);
              const composition = parseRoomComposition(t.description);
              const imgKey = (t.task_type || 'Service').replace(/[\s_]+/g, '');
              const imgSrc = TASK_IMAGES[imgKey] || TASK_IMAGES.Cleaning;
              const isMarking = markingId === t.id;

              return (
                <button
                  key={t.id}
                  type="button"
                  className="guest-tile staff-task-tile"
                  onClick={() => handleMarkDone(t)}
                  disabled={!!markingId}
                  aria-label={`חדר ${room} - ${taskLabel}`}
                >
                  <div className="guest-tile-img-wrap">
                    <img src={imgSrc} alt="" className="guest-tile-img" />
                  </div>
                  <div className="staff-tile-details">
                    <span className="staff-tile-room">חדר: {room}</span>
                    <span className="staff-tile-mission">משימה: {taskLabel}</span>
                    <span className="staff-tile-composition">הרכב חדר: {composition}</span>
                  </div>
                  {isMarking ? (
                    <span className="guest-tile-loading">...</span>
                  ) : (
                    <span className="staff-tile-action">לחץ לסימון בוצע</span>
                  )}
                </button>
              );
            })
            )
          )}
        </div>

        <nav className="guest-tabbar">
          {TAB_ITEMS.map((tab) => {
            const TabIcon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                className={`guest-tab ${activeTab === tab.id ? 'active' : ''}`}
                onClick={() => handleTabClick(tab.id)}
                aria-label={tab.label}
              >
                <TabIcon size={24} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {toast && <StaffToast message={toast} onClose={() => setToast(null)} />}
    </div>
  );
}
