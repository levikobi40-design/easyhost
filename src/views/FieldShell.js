import React from 'react';
import Sidebar from '../components/layout/Sidebar';
import TopBar from '../components/layout/TopBar';
import FieldView from '../components/features/FieldView';
import useStore from '../store/useStore';

const FieldShell = () => {
  const { sidebarOpen } = useStore();

  return (
    <div className={`app-enterprise ${sidebarOpen ? 'sidebar-open' : 'sidebar-collapsed'}`} key="field-shell">
      <Sidebar activeView="field" setActiveView={() => {}} />
      <main className="main-content">
        <TopBar />
        <div className="view-container" key="field-view">
          <FieldView />
        </div>
      </main>
      <div className="bg-effects">
        <div className="bg-gradient-1" />
        <div className="bg-gradient-2" />
        <div className="bg-grid" />
      </div>
    </div>
  );
};

export default FieldShell;
