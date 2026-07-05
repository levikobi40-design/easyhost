import React from 'react';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import Chat from '../chat/Chat';
import AccessibilityWidget from '../accessibility/AccessibilityWidget';
import useStore from '../../store/useStore';

const Layout = ({ activeView, setActiveView, children }) => {
  const { sidebarOpen, lang } = useStore();
  const isRTL = lang === 'he';

  return (
    <div
      dir={isRTL ? 'rtl' : 'ltr'}
      className={`app-enterprise ${sidebarOpen ? 'sidebar-open' : 'sidebar-collapsed'} ${isRTL ? 'layout-rtl' : ''}`}
    >
      <Sidebar activeView={activeView} setActiveView={setActiveView} />
      <main id="main-content" className="main-content">
        <TopBar />
        <div className="view-container">
          {children}
        </div>
      </main>
      {/* Maya WhatsApp UI - always mounted when Layout is shown */}
      <Chat />
      {/* Accessibility Widget — Israeli law (WCAG 2.1 AA) */}
      <AccessibilityWidget />
      <div className="bg-effects">
        <div className="bg-gradient-1" />
        <div className="bg-gradient-2" />
        <div className="bg-grid" />
      </div>
    </div>
  );
};

export default Layout;
