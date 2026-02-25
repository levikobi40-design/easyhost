import React from 'react';
import Sidebar from '../components/layout/Sidebar';
import TopBar from '../components/layout/TopBar';
import LeadsCRM from '../components/crm/LeadsCRM';
import WhatsAppMonitor from '../components/operator/WhatsAppMonitor';
import StaffManager from '../components/operator/StaffManager';
import Leaderboard from '../components/operator/Leaderboard';
import DispatchControls from '../components/operator/DispatchControls';
import MayaChat from '../components/maya/MayaChat';
import useStore from '../store/useStore';

const OperatorShell = () => {
  const { sidebarOpen } = useStore();

  return (
    <div className={`app-enterprise ${sidebarOpen ? 'sidebar-open' : 'sidebar-collapsed'}`} key="operator-shell">
      <Sidebar activeView="operator" setActiveView={() => {}} />
      <main className="main-content">
        <TopBar />
        <div className="view-container" key="operator-view">
          <LeadsCRM />
          <WhatsAppMonitor />
          <DispatchControls />
          <StaffManager />
          <Leaderboard />
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

export default OperatorShell;
