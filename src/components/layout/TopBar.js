import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Menu, UserCircle, Layers, Building2, RefreshCw } from 'lucide-react';
import useStore from '../../store/useStore';
import i18n from '../../i18n';
import NotificationCenter from '../notifications/NotificationCenter';
import { API_URL } from '../../utils/apiClient';
import { notifyTasksChanged } from '../../utils/taskSyncBridge';
import './TopBar.css';
import { useMission } from '../../context/MissionContext';
import { isDashboardAdmin, hasDeveloperOrSettingsHub, isOperationRole } from '../../utils/dashboardRoles';

/* ── Mode definitions ─────────────────────────────────────── */
const SYSTEM_MODES = [
  { value: 'host',  icon: '🏰', label: 'Owner Dashboard', sub: 'Overview'  },
  { value: 'admin', icon: '👔', label: 'HQ Director',    sub: 'Manager View'     },
  { value: 'field', icon: '⚡', label: 'Field Agent',    sub: 'Mission Map'      },
  { value: 'sim',   icon: '🎮', label: 'Live Simulator', sub: 'Generate 7-Day Data', sim: true },
];

const TopBar = () => {
  const navigate = useNavigate();
  const {
    lang, setLang, role, setRole, toggleSidebar,
    tenants, activeTenantId, setActiveTenantId,
  } = useStore();
  const { hardRefreshTasks } = useMission();
  const [missionSyncing, setMissionSyncing] = useState(false);

  const [menuOpen,   setMenuOpen]   = useState(false);
  const [simLoading, setSimLoading] = useState(false);
  const [simDone,    setSimDone]    = useState(false);
  const orbRef = useRef(null);

  const languages = [
    { code: 'en', label: 'EN', flag: '🇺🇸' },
    { code: 'he', label: 'HE', flag: '🇮🇱' },
  ];

  const normalise = (r) => {
    const map = { owner: 'host', manager: 'admin', host: 'host', staff: 'field', worker: 'field', operator: 'operator' };
    return map[r] || r || 'host';
  };
  const activeRole = normalise(role);
  const isAdminUI = hasDeveloperOrSettingsHub(role);
  const showHotelsNav = isDashboardAdmin(role) || isOperationRole(role);

  /* Close orb menu on outside click */
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e) => {
      if (orbRef.current && !orbRef.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  /* Live Simulator */
  const handleSimulate = useCallback(async () => {
    if (simLoading) return;
    setSimLoading(true);
    setSimDone(false);
    setMenuOpen(false);
    try {
      const res = await fetch(`${API_URL}/simulate-week`, { method: 'POST' });
      if (res.ok) {
        setSimDone(true);
        setTimeout(() => setSimDone(false), 4000);
        window.dispatchEvent(new CustomEvent('simulate-complete'));
        notifyTasksChanged();
      }
    } catch (err) {
      console.error('[Simulator] fetch failed:', err);
    } finally {
      setSimLoading(false);
    }
  }, [simLoading]);

  const handleModeClick = useCallback((mode) => {
    if (mode.sim) {
      handleSimulate();
    } else {
      setRole(mode.value);
      setMenuOpen(false);
    }
  }, [handleSimulate, setRole]);

  const handleMissionHardRefresh = useCallback(async () => {
    if (missionSyncing) return;
    setMissionSyncing(true);
    try {
      await hardRefreshTasks();
    } catch (e) {
      console.error('[TopBar] mission hard refresh:', e);
    } finally {
      setMissionSyncing(false);
    }
  }, [hardRefreshTasks, missionSyncing]);

  return (
    <>
      {/* ── Main top bar ──────────────────────────────────── */}
      <header className="top-bar glass">
        {/* Left: hamburger only — logo & branding in sidebar */}
        <div className="top-bar-start">
          <button onClick={toggleSidebar} className="menu-btn" aria-label="Toggle menu">
            <Menu size={22} />
          </button>
          {showHotelsNav && (
            <button
              type="button"
              className="top-bar-hotels-btn"
              onClick={() => navigate('/properties')}
              aria-label={lang === 'he' ? 'מלונות — רשימת נכסים' : 'Hotels — properties list'}
              title={lang === 'he' ? 'מלונות / נכסים' : 'Hotels / Properties'}
            >
              <Building2 size={20} aria-hidden />
              <span className="top-bar-hotels-label">{lang === 'he' ? 'מלונות' : 'Hotels'}</span>
            </button>
          )}
          <button
            type="button"
            className="top-bar-mission-refresh-btn"
            onClick={handleMissionHardRefresh}
            disabled={missionSyncing}
            aria-label={lang === 'he' ? 'רענון לוח משימות וספירות' : 'Refresh tasks and status counts'}
            title={lang === 'he' ? 'רענון לוח משימות (מסנכרן מסד נתונים)' : 'Refresh mission board & DB task counts'}
          >
            <RefreshCw size={18} className={missionSyncing ? 'top-bar-refresh-spin' : ''} aria-hidden />
          </button>
        </div>

        {/* Right: lang + tenant + notifs + avatar */}
        <div className="top-bar-end">
          {showHotelsNav && tenants.length > 1 && (
            <div className="tenant-selector">
              <select
                value={activeTenantId}
                onChange={(e) => setActiveTenantId(e.target.value)}
                className="tenant-select"
                aria-label="Property Selector"
              >
                {tenants.map((tenant) => (
                  <option key={tenant.id} value={tenant.id}>{tenant.name}</option>
                ))}
              </select>
            </div>
          )}

          <div className="lang-selector lang-pill" role="group" aria-label="Language selector">
            {languages.map((l) => (
              <button
                key={l.code}
                onClick={() => {
                  setLang(l.code);            // update Zustand store
                  i18n.changeLanguage(l.code); // fire immediately — no async delay
                }}
                className={`lang-btn${lang === l.code ? ' active' : ''}`}
                title={l.label}
                aria-pressed={lang === l.code}
              >
                <span className="lang-flag">{l.flag}</span>
                <span className="lang-label">{l.label}</span>
              </button>
            ))}
          </div>

          <NotificationCenter />

          <div className="user-menu">
            <div className="user-avatar">
              <UserCircle size={24} />
            </div>
          </div>
        </div>
      </header>

      {/* ── Floating Control Orb — dashboard admins only (simulator / mode switch) ───────── */}
      {isAdminUI && (
        <div className="ctrl-orb-wrap" ref={orbRef}>

        {/* Backdrop blur when menu open */}
        {menuOpen && (
          <div className="ctrl-backdrop" onClick={() => setMenuOpen(false)} aria-hidden="true" />
        )}

        {/* The orb button */}
        <button
          className={`ctrl-orb${menuOpen ? ' open' : ''}${simDone ? ' sim-success' : ''}`}
          onClick={() => setMenuOpen(v => !v)}
          aria-label="System Mode"
          title="System Mode"
        >
          {simLoading
            ? <span className="ctrl-spin">⏳</span>
            : simDone
              ? <span style={{ fontSize: 20 }}>✅</span>
              : <Layers size={20} strokeWidth={2.5} />}
        </button>

        {/* Floating glass menu */}
        {menuOpen && (
          <div className="ctrl-menu" role="menu">
            <div className="ctrl-menu-header">⚙️ System Mode</div>
            {SYSTEM_MODES.map((mode) => {
              const isActive = !mode.sim && mode.value === activeRole;
              const isSim    = Boolean(mode.sim);
              return (
                <button
                  key={mode.value}
                  className={`ctrl-menu-item${isActive ? ' active' : ''}${isSim ? ' sim-item' : ''}`}
                  onClick={() => handleModeClick(mode)}
                  disabled={isSim && simLoading}
                  role="menuitem"
                >
                  <span className="ctrl-item-icon">
                    {isSim && simLoading ? '⏳' : mode.icon}
                  </span>
                  <div className="ctrl-item-text">
                    <span className="ctrl-item-label">{mode.label}</span>
                    <span className="ctrl-item-sub">
                      {isSim && simLoading ? 'Generating…' : mode.sub}
                    </span>
                  </div>
                  {isActive && <span className="ctrl-item-check">✓</span>}
                </button>
              );
            })}
          </div>
        )}
        </div>
      )}
    </>
  );
};

export default TopBar;
