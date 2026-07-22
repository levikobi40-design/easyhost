import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Menu, UserCircle, Layers, Building2, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import useStore from '../../store/useStore';
import NotificationCenter from '../notifications/NotificationCenter';
import { API_URL } from '../../utils/apiClient';
import { notifyTasksChanged } from '../../utils/taskSyncBridge';
import './TopBar.css';
import { useMission } from '../../context/MissionContext';
import { PILOT_LANGUAGE_OPTIONS } from '../../utils/pilotLanguages';
import { hasDeveloperOrSettingsHub, isDashboardAdmin, isOperationRole } from '../../utils/dashboardRoles';

/* ── Mode definitions ─────────────────────────────────────── */
const SYSTEM_MODES = [
  { value: 'host',  icon: '🏰', label: 'Owner Dashboard', sub: 'Overview'  },
  { value: 'admin', icon: '👔', label: 'HQ Director',    sub: 'Manager View'     },
  { value: 'field', icon: '⚡', label: 'Field Agent',    sub: 'Mission Map'      },
  { value: 'sim',   icon: '🎮', label: 'Live Simulator', sub: 'Generate 7-Day Data', sim: true },
];

const TopBar = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const {
    lang, setLang, role, setRole, toggleSidebar,
    tenants, activeTenantId, setActiveTenantId,
  } = useStore();
  const { hardRefreshTasks } = useMission();
  const [missionSyncing, setMissionSyncing] = useState(false);

  const [menuOpen,   setMenuOpen]   = useState(false);
  const [langOpen,   setLangOpen]   = useState(false);
  const [simLoading, setSimLoading] = useState(false);
  const [simDone,    setSimDone]    = useState(false);
  const orbRef = useRef(null);
  const langMenuRef = useRef(null);

  const languages = PILOT_LANGUAGE_OPTIONS.map((o) => ({
    code: o.code,
    label: o.label,
    name: o.name,
    flag: o.code === 'he' ? '🇮🇱' : o.code === 'el' ? '🇬🇷' : o.code === 'ar' ? '🇸🇦' : '🇺🇸',
  }));
  const currentLang = languages.find((l) => l.code === lang) || languages[0];
  const currentLangCode = String(currentLang?.code || lang || 'he').toUpperCase();

  const applyLang = useCallback((code) => {
    // setLang already calls i18n.changeLanguage + persists; keep both in sync.
    setLang(code);
    setLangOpen(false);
  }, [setLang]);

  useEffect(() => {
    if (!langOpen) return undefined;
    const onDoc = (e) => {
      if (langMenuRef.current && !langMenuRef.current.contains(e.target)) {
        setLangOpen(false);
      }
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setLangOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [langOpen]);

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
              aria-label={t('nav.properties')}
              title={t('nav.properties')}
            >
              <Building2 size={20} aria-hidden />
              <span className="top-bar-hotels-label">{t('nav.properties')}</span>
            </button>
          )}
          <button
            type="button"
            className="top-bar-mission-refresh-btn"
            onClick={handleMissionHardRefresh}
            disabled={missionSyncing}
            aria-label={t('worker.card.refresh')}
            title={t('worker.card.refresh')}
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

          {/* Desktop: inline language pills */}
          <div className="lang-selector lang-pill lang-selector--desktop" role="group" aria-label="Language selector">
            {languages.map((l) => (
              <button
                key={l.code}
                type="button"
                onClick={() => applyLang(l.code)}
                className={`lang-btn${lang === l.code ? ' active' : ''}`}
                title={l.label}
                aria-pressed={lang === l.code}
              >
                <span className="lang-flag">{l.flag}</span>
                <span className="lang-label">{l.label}</span>
              </button>
            ))}
          </div>

          {/* Mobile: compact globe + current code dropdown */}
          <div className="lang-selector lang-dropdown lang-selector--mobile" ref={langMenuRef}>
            <button
              type="button"
              className="lang-dropdown-trigger"
              onClick={() => setLangOpen((o) => !o)}
              aria-label={`Language: ${currentLangCode}`}
              aria-expanded={langOpen}
              aria-haspopup="listbox"
              title={currentLang?.name || currentLang?.label || currentLangCode}
            >
              <span className="lang-dropdown-globe" aria-hidden="true">🌐</span>
              <span className="lang-dropdown-code">{currentLangCode}</span>
            </button>
            {langOpen && (
              <ul className="lang-dropdown-menu" role="listbox" aria-label="Choose language">
                {languages.map((l) => (
                  <li key={l.code} role="option" aria-selected={lang === l.code}>
                    <button
                      type="button"
                      className={`lang-dropdown-item${lang === l.code ? ' active' : ''}`}
                      onClick={() => applyLang(l.code)}
                    >
                      <span className="lang-flag">{l.flag}</span>
                      <span className="lang-dropdown-item-code">{String(l.code).toUpperCase()}</span>
                      <span className="lang-dropdown-item-name">{l.name || l.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
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
