import React from 'react';
import {
  LayoutDashboard, Users, MessageCircle, Settings,
  Building2, Shield, Zap, ChevronLeft,
  ChevronRight, Sparkles, ExternalLink, Home, CalendarCheck
} from 'lucide-react';
import useTranslations from '../../hooks/useTranslations';
import useStore from '../../store/useStore';
import { AI_ASSISTANT_URL } from '../../utils/constants';
import StaffDirectory from './StaffDirectory';
import StaffDirectoryErrorBoundary from './StaffDirectoryErrorBoundary';
import './Sidebar.css';

const menuItems = [
  { id: 'dashboard', icon: LayoutDashboard, labelKey: 'nav.dashboard' },
  { id: 'premium', icon: Building2, labelKey: 'nav.premium' },
  { id: 'properties', icon: Home, labelKey: 'nav.properties' },
  { id: 'tasks', icon: CalendarCheck, labelKey: 'nav.tasks' },
  { id: 'crm', icon: Users, labelKey: 'nav.crm' },
  { id: 'operator', icon: MessageCircle, labelKey: 'nav.operator' },
  { id: 'field', icon: MessageCircle, labelKey: 'nav.field' },
];

const Sidebar = ({ activeView, setActiveView }) => {
  const { sidebarOpen, toggleSidebar, lang, role } = useStore();
  const isRTL = lang === 'he';
  const { t } = useTranslations();
  const safeT = typeof t === 'function' ? t : (k) => k;

  const roleNav = {
    host: ['dashboard', 'premium', 'properties', 'tasks', 'crm'],
    admin: ['dashboard', 'premium', 'properties', 'tasks', 'crm'],
    operator: ['operator'],
    field: ['field'],
  };

  const visibleItems = menuItems.filter((item) =>
    (roleNav[role] || []).includes(item.id)
  );

  const handleAIAssistantClick = () => {
    window.open(AI_ASSISTANT_URL, '_blank', 'noopener,noreferrer');
  };

  const sidebarStyle = {
    position: 'fixed',
    ...(isRTL ? { right: 0, left: 'auto' } : { left: 0, right: 'auto' }),
    width: sidebarOpen ? 260 : 80,
  };

  return (
    <aside
      style={sidebarStyle}
      className={`sidebar glass-dark ${sidebarOpen ? 'open' : 'collapsed'} ${isRTL ? 'sidebar-rtl' : ''}`}
    >
      {/* Logo */}
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
      </div>

      {/* Navigation */}
      <nav className="sidebar-nav">
        {visibleItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setActiveView(item.id)}
            className={`nav-item ${activeView === item.id ? 'active' : ''}`}
          >
            <item.icon size={22} />
            <span
              className="nav-label"
              style={{ opacity: sidebarOpen ? 1 : 0, width: sidebarOpen ? 'auto' : 0 }}
            >
              {safeT(item.labelKey)}
            </span>
            {activeView === item.id && (
              <div className="active-indicator" />
            )}
          </button>
        ))}
      </nav>

      {/* Staff Directory - wrapped to prevent translation/dashboard crashes */}
      <StaffDirectoryErrorBoundary>
        <StaffDirectory />
      </StaffDirectoryErrorBoundary>

      {/* AI Assistant Button */}
      <div className="sidebar-action">
        <button
          onClick={handleAIAssistantClick}
          className="ai-assistant-sidebar-btn"
        >
          <Sparkles size={20} />
          <span style={{ opacity: sidebarOpen ? 1 : 0, width: sidebarOpen ? 'auto' : 0 }}>
            {safeT('sidebar.aiAssistant')}
          </span>
          {sidebarOpen && <ExternalLink size={14} />}
        </button>
      </div>

      {/* Toggle Button */}
      <button
        onClick={toggleSidebar}
        className="sidebar-toggle"
      >
        {sidebarOpen ? (
          isRTL ? <ChevronRight size={18} /> : <ChevronLeft size={18} />
        ) : (
          isRTL ? <ChevronLeft size={18} /> : <ChevronRight size={18} />
        )}
      </button>

      {/* Footer: Security Badge + QR Code at bottom */}
      <div className="sidebar-footer">
        <div className="security-badge">
          <Shield size={16} />
          <span style={{ opacity: sidebarOpen ? 1 : 0, width: sidebarOpen ? 'auto' : 0 }}>
            {safeT('sidebar.zeroTrust')}
          </span>
        </div>
        {/* QR placeholder - no library to avoid crashes */}
        <div className="sidebar-qr-placeholder">
          <span>סרוק לניהול</span>
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
