import React, { useEffect, useCallback } from 'react';
import {
  LayoutDashboard, Users, Radio,
  Building2, Shield, ChevronLeft,
  ChevronRight, Sparkles, ExternalLink, Home, CalendarCheck, X, BedDouble, BarChart3,
  Cpu, Map, CalendarRange, UserCog,
} from 'lucide-react';
import useTranslations from '../../hooks/useTranslations';
import easyhostLogoDark from '../../assets/easyhost-logo-dark.svg';
import useStore from '../../store/useStore';
import { AI_ASSISTANT_URL } from '../../utils/constants';
import { dashboardNavTier } from '../../utils/dashboardRoles';
import StaffDirectory from './StaffDirectory';
import StaffDirectoryErrorBoundary from './StaffDirectoryErrorBoundary';
import './Sidebar.css';

/* ── Nav items — labels resolved via i18n in the component ─── */
const menuItems = [
  { id: 'dashboard',  icon: LayoutDashboard, fallback: '🏠 Overview'          },
  { id: 'analytics',  icon: BarChart3,       fallback: '📊 Analytics'         },
  { id: 'premium',    icon: Building2,       fallback: '🏨 Properties Hub'    },
  { id: 'properties', icon: Home,            fallback: '🏡 Manage Properties' },
  { id: 'bazaar-week', icon: CalendarRange,  fallback: '📅 Week 1 deals'      },
  { id: 'inventory',  icon: BedDouble,       fallback: '🛏 Room Inventory'    },
  { id: 'tasks',      icon: CalendarCheck,   fallback: '📋 Mission Board'     },
  { id: 'crm',        icon: Users,           fallback: '👥 Leads CRM'         },
  { id: 'operator',   icon: Radio,           fallback: '📡 Operator'          },
  { id: 'field',      icon: Map,             fallback: '⚡ Field Agent'        },
  { id: 'scheduler',  icon: CalendarRange,   fallback: '📅 Shift Scheduler',   adminOnly: true },
  { id: 'godmode',    icon: Cpu,             fallback: '🔮 Operational Excellence', adminOnly: true },
  { id: 'manualops',  icon: UserCog,         fallback: '👥 Staff & Planner' },
];

const Sidebar = ({ activeView, setActiveView }) => {
  const { sidebarOpen, toggleSidebar, lang, role, activeTenantId } = useStore();
  const isRTL = lang === 'he';
  const { t } = useTranslations();
  const safeT = typeof t === 'function' ? t : (k) => k;

  const isMobile = () => typeof window !== 'undefined' && window.innerWidth < 768;

  // Normalise backend role values → frontend nav groups
  const navTier = dashboardNavTier(role);

  const isBazaarJaffaTenant = activeTenantId === 'BAZAAR_JAFFA';
  /** ADMIN: full nav. OPERATION: no Settings (`manualops`) or Developer (`godmode`). STAFF: tasks only. */
  const roleNav = isBazaarJaffaTenant
    ? {
        admin: ['tasks', 'properties', 'bazaar-week', 'manualops', 'scheduler', 'godmode'],
        operation: ['tasks', 'properties', 'bazaar-week', 'scheduler'],
        staff: ['tasks'],
        operator: ['operator'],
        field: ['field'],
      }
    : {
        admin: ['dashboard', 'analytics', 'premium', 'properties', 'inventory', 'tasks', 'crm', 'manualops', 'scheduler', 'godmode'],
        operation: ['dashboard', 'analytics', 'premium', 'properties', 'inventory', 'tasks', 'crm', 'scheduler'],
        staff: ['tasks'],
        operator: ['operator'],
        field: ['field'],
      };

  const visibleItems = menuItems.filter((item) => {
    const allowed = roleNav[navTier] || roleNav.staff;
    if (!allowed.includes(item.id)) return false;
    if (item.adminOnly && navTier !== 'admin' && navTier !== 'operation') return false;
    return true;
  });

  const handleAIAssistantClick = () => {
    window.open(AI_ASSISTANT_URL, '_blank', 'noopener,noreferrer');
  };

  const navLabel = (item) => {
    if (isBazaarJaffaTenant && isRTL) {
      if (item.id === 'tasks') return 'לוח משימות';
      if (item.id === 'properties') return 'ניהול נכסים';
      if (item.id === 'bazaar-week') return 'שבוע פעילות / מבצעים';
      if (item.id === 'manualops') return 'הפעלה ידנית';
    }
    const key = `sidebarNav.${item.id}`;
    const translated = safeT(key);
    if (!translated || translated === key) return item.fallback;
    return translated;
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
        className={`sidebar ${sidebarOpen ? 'open' : 'collapsed'} ${isRTL ? 'sidebar-rtl' : ''}`}
        aria-label={safeT('nav.mainNavigation') || 'Main navigation'}
      >
        {/* Logo + mobile close button row — Dark Blue logo in collapsed, Building2 when open */}
        <div className="sidebar-logo">
          <div className="logo-icon logo-icon-neon logo-icon-dark">
            {sidebarOpen ? (
              <Building2 size={26} />
            ) : (
              <img src={easyhostLogoDark} alt="EasyHost AI" className="sidebar-logo-dark-img" />
            )}
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
              aria-label={safeT(`sidebarNav.${item.id}`) || item.fallback || item.id}
              aria-current={activeView === item.id ? 'page' : undefined}
            >
              <item.icon size={22} aria-hidden="true" />
              <span
                className="nav-label"
                style={{
                  opacity:    sidebarOpen ? 1 : 0,
                  maxWidth:   sidebarOpen ? 160 : 0,
                  transition: 'opacity 0.25s, max-width 0.25s',
                }}
              >
                {navLabel(item)}
              </span>
              {activeView === item.id && (
                <div className="active-indicator" aria-hidden="true" />
              )}
            </button>
          ))}
        </nav>

        {(navTier === 'admin' || navTier === 'operation') && (
          <>
            <StaffDirectoryErrorBoundary>
              <StaffDirectory />
            </StaffDirectoryErrorBoundary>
            <div className="sidebar-action">
              <button
                type="button"
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
          </>
        )}

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

        {(navTier === 'admin' || navTier === 'operation') && (
          <div className="sidebar-footer">
            <div className="security-badge">
              <Shield size={16} />
              <span style={{ opacity: sidebarOpen ? 1 : 0, width: sidebarOpen ? 'auto' : 0 }}>
                {safeT('sidebar.zeroTrust')}
              </span>
            </div>
            <div className="sidebar-qr-placeholder">
              <span>{safeT('sidebar.scanToManage')}</span>
            </div>
          </div>
        )}
      </aside>
    </>
  );
};

export default Sidebar;
