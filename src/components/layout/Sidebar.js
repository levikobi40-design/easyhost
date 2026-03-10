import React, { useEffect, useCallback } from 'react';
import {
  LayoutDashboard, Users, MessageCircle,
  Building2, Shield, ChevronLeft,
  ChevronRight, Sparkles, ExternalLink, Home, CalendarCheck, Zap, X
} from 'lucide-react';
import useTranslations from '../../hooks/useTranslations';
import useStore from '../../store/useStore';
import { AI_ASSISTANT_URL } from '../../utils/constants';
import StaffDirectory from './StaffDirectory';
import StaffDirectoryErrorBoundary from './StaffDirectoryErrorBoundary';
import './Sidebar.css';

const menuItems = [
  { id: 'dashboard', icon: LayoutDashboard, labelKey: 'nav.dashboard' },
  { id: 'premium',   icon: Building2,       labelKey: 'nav.premium' },
  { id: 'properties',icon: Home,            labelKey: 'nav.properties' },
  { id: 'tasks',     icon: CalendarCheck,   labelKey: 'nav.tasks' },
  { id: 'crm',       icon: Users,           labelKey: 'nav.crm' },
  { id: 'operator',  icon: MessageCircle,   labelKey: 'nav.operator' },
  { id: 'field',     icon: MessageCircle,   labelKey: 'nav.field' },
  { id: 'godmode',   icon: Zap,             labelKey: 'nav.godMode', adminOnly: true },
];

const Sidebar = ({ activeView, setActiveView }) => {
  const { sidebarOpen, toggleSidebar, lang, role } = useStore();
  const isRTL = lang === 'he';
  const { t } = useTranslations();
  const safeT = typeof t === 'function' ? t : (k) => k;

  const isMobile = () => typeof window !== 'undefined' && window.innerWidth < 768;

  // Normalise backend role values → frontend nav groups
  const normaliseRole = (r) => {
    if (!r) return 'host';
    const map = { owner: 'host', manager: 'admin', staff: 'field', worker: 'field' };
    return map[r] || r;
  };
  const navRole = normaliseRole(role);

  const roleNav = {
    host:     ['dashboard', 'premium', 'properties', 'tasks', 'crm'],
    admin:    ['dashboard', 'premium', 'properties', 'tasks', 'crm', 'godmode'],
    operator: ['operator'],
    field:    ['field'],
  };

  // Default to 'host' view so Properties & Leads are always visible after login
  const visibleItems = menuItems.filter((item) =>
    (roleNav[navRole] || roleNav['host']).includes(item.id)
  );

  const handleAIAssistantClick = () => {
    window.open(AI_ASSISTANT_URL, '_blank', 'noopener,noreferrer');
  };

  // Close sidebar when nav item tapped on mobile
  const handleNavClick = useCallback((id) => {
    setActiveView(id);
    if (isMobile() && sidebarOpen) {
      toggleSidebar();
    }
  }, [setActiveView, sidebarOpen, toggleSidebar]); // eslint-disable-line react-hooks/exhaustive-deps

  // Lock body scroll when sidebar is open on mobile
  useEffect(() => {
    if (isMobile()) {
      document.body.style.overflow = sidebarOpen ? 'hidden' : '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [sidebarOpen]);

  // Close on Escape key
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && sidebarOpen && isMobile()) toggleSidebar();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [sidebarOpen, toggleSidebar]);

  const sidebarStyle = {
    position: 'fixed',
    ...(isRTL ? { right: 0, left: 'auto' } : { left: 0, right: 'auto' }),
    width: sidebarOpen ? 260 : 80,
  };

  return (
    <>
      {/* Dark overlay — only visible on mobile when sidebar is open */}
      {sidebarOpen && (
        <div
          className="sidebar-overlay"
          onClick={toggleSidebar}
          aria-hidden="true"
        />
      )}

      <aside
        style={sidebarStyle}
        className={`sidebar glass-dark ${sidebarOpen ? 'open' : 'collapsed'} ${isRTL ? 'sidebar-rtl' : ''}`}
        aria-label={safeT('nav.mainNavigation') || 'Main navigation'}
      >
        {/* Logo + mobile close button row */}
        <div className="sidebar-logo">
          <div className="logo-icon">
            <div className="logo-icon-stack">
              <Home size={26} />
              <Sparkles size={14} className="logo-sparkle" />
            </div>
          </div>
          <span
            className="logo-text"
            style={{ opacity: sidebarOpen ? 1 : 0, width: sidebarOpen ? 'auto' : 0 }}
          >
            {safeT('branding.name')}
          </span>
          {/* Close button — mobile only */}
          <button
            className="sidebar-close-btn"
            onClick={toggleSidebar}
            aria-label="Close navigation menu"
          >
            <X size={20} />
          </button>
        </div>

        {/* Navigation */}
        <nav className="sidebar-nav" aria-label={safeT('nav.mainNavigation') || 'Main navigation'}>
          {visibleItems.map((item) => (
            <button
              key={item.id}
              onClick={() => handleNavClick(item.id)}
              className={`nav-item ${activeView === item.id ? 'active' : ''}${item.id === 'godmode' ? ' nav-item-godmode' : ''}`}
              aria-label={safeT(item.labelKey) || item.id}
              aria-current={activeView === item.id ? 'page' : undefined}
            >
              <item.icon size={22} aria-hidden="true" />
              <span
                className="nav-label"
                style={{ opacity: sidebarOpen ? 1 : 0, width: sidebarOpen ? 'auto' : 0 }}
              >
                {safeT(item.labelKey)}
              </span>
              {activeView === item.id && (
                <div className="active-indicator" aria-hidden="true" />
              )}
            </button>
          ))}
        </nav>

        {/* Staff Directory - wrapped to prevent crashes */}
        <StaffDirectoryErrorBoundary>
          <StaffDirectory />
        </StaffDirectoryErrorBoundary>

        {/* AI Assistant Button */}
        <div className="sidebar-action">
          <button
            onClick={handleAIAssistantClick}
            className="ai-assistant-sidebar-btn"
            aria-label={safeT('sidebar.aiAssistant') || 'AI Assistant — open in new window'}
          >
            <Sparkles size={20} />
            <span style={{ opacity: sidebarOpen ? 1 : 0, width: sidebarOpen ? 'auto' : 0 }}>
              {safeT('sidebar.aiAssistant')}
            </span>
            {sidebarOpen && <ExternalLink size={14} />}
          </button>
        </div>

        {/* Desktop collapse toggle — hidden on mobile */}
        <button
          onClick={toggleSidebar}
          className="sidebar-toggle"
          aria-label={sidebarOpen ? 'Collapse menu' : 'Expand menu'}
          aria-expanded={sidebarOpen}
        >
          {sidebarOpen ? (
            isRTL ? <ChevronRight size={18} /> : <ChevronLeft size={18} />
          ) : (
            isRTL ? <ChevronLeft size={18} /> : <ChevronRight size={18} />
          )}
        </button>

        {/* Footer */}
        <div className="sidebar-footer">
          <div className="security-badge">
            <Shield size={16} />
            <span style={{ opacity: sidebarOpen ? 1 : 0, width: sidebarOpen ? 'auto' : 0 }}>
              {safeT('sidebar.zeroTrust')}
            </span>
          </div>
          <div className="sidebar-qr-placeholder">
            <span>סרוק לניהול</span>
          </div>
        </div>
      </aside>
    </>
  );
};

export default Sidebar;
