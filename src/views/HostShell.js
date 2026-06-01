import React, { useState } from 'react';
import Sidebar from '../components/layout/Sidebar';
import TopBar from '../components/layout/TopBar';
import EnterpriseDashboard from '../components/dashboard/EnterpriseDashboard';
import LeadsCRM from '../components/crm/LeadsCRM';
import MayaChat from '../components/maya/MayaChat';
import useTranslations from '../hooks/useTranslations';
import useStore from '../store/useStore';

const AnalyticsView = () => {
  const { t } = useTranslations();
  return (
    <div className="view-placeholder glass-card">
      <h2>{t('placeholders.analyticsTitle')}</h2>
      <p>{t('placeholders.analyticsDesc')}</p>
    </div>
  );
};

const HostShell = () => {
  const { sidebarOpen } = useStore();
  const [activeView, setActiveView] = useState('dashboard');

  const renderView = () => {
    switch (activeView) {
      case 'dashboard':
        return <EnterpriseDashboard />;
      case 'crm':
        return <LeadsCRM />;
      case 'analytics':
        return <AnalyticsView />;
      default:
        return <EnterpriseDashboard />;
    }
  };

  return (
    <div className={`app-enterprise ${sidebarOpen ? 'sidebar-open' : 'sidebar-collapsed'}`} key="host-shell">
      <Sidebar activeView={activeView} setActiveView={setActiveView} />
      <main className="main-content">
        <TopBar />
        <div className="view-container" key={`host-${activeView}`}>
          {renderView()}
        </div>
      </main>
      <MayaChat />
      <div className="bg-effects">
        <div className="bg-gradient-1" />
        <div className="bg-gradient-2" />
        <div className="bg-grid" />
      </div>
    </div>
  );
};

export default HostShell;
