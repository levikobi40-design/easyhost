import React, { useEffect, useState } from 'react';
import useTranslations from './hooks/useTranslations';
import useStore from './store/useStore';
import { wsService } from './services/websocket';
import './styles/tailwind.css';
import './App.css';
import Layout from './components/layout/Layout';
import LoginPage from './components/auth/LoginPage';
import EnterpriseDashboard from './components/dashboard/EnterpriseDashboard';
import TaskCalendar from './components/dashboard/TaskCalendar';
import PremiumDashboard from './components/dashboard/PremiumDashboard';
import PropertiesDashboard from './components/dashboard/PropertiesDashboard';
import LeadsCRM from './components/crm/LeadsCRM';
import FieldView from './components/features/FieldView';
import WorkerView from './components/WorkerView';
import WhatsAppMonitor from './components/operator/WhatsAppMonitor';

const parseJwtPayload = (token) => {
  try {
    const payload = token.split('.')[1];
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = JSON.parse(atob(normalized));
    return decoded || {};
  } catch (error) {
    return {};
  }
};

function App() {
  const { lang, activeTenantId, authToken, setAuthToken, setActiveTenantId, role, hasHydrated, setLang, market } = useStore();
  const { i18n } = useTranslations();
  const isRTL = lang === 'he';
  const [activeView, setActiveView] = useState('dashboard');
  const isClockInRoute = typeof window !== 'undefined' && window.location.pathname === '/clock-in';
  const isWorkerRoute = typeof window !== 'undefined' && window.location.pathname.startsWith('/worker');

  useEffect(() => {
    // Connect to WebSocket on mount
    wsService.connect();
    
    return () => {
      wsService.disconnect();
    };
  }, []);

  useEffect(() => {
    if (authToken) return;
    const params = new URLSearchParams(window.location.search);
    const tokenParam = params.get('token');
    if (tokenParam) {
      const payload = parseJwtPayload(tokenParam);
      if (payload?.tenant_id) {
        setActiveTenantId(payload.tenant_id);
      }
      setAuthToken(tokenParam);
      params.delete('token');
      const next = `${window.location.pathname}${params.toString() ? `?${params}` : ''}`;
      window.history.replaceState({}, '', next);
    }
  }, [authToken, setAuthToken, setActiveTenantId]);

  useEffect(() => {
    i18n.changeLanguage(lang);
    if (typeof document !== 'undefined') {
      const dir = isRTL ? 'rtl' : 'ltr';
      document.documentElement.dir = dir;
      document.body.dir = dir;
      document.documentElement.lang = lang;
    }
  }, [i18n, isRTL, lang]);

  useEffect(() => {
    const marketKey = market === 'IL' ? 'IL' : 'US';
    const allowed = marketKey === 'IL' ? ['he', 'th', 'hi'] : ['en', 'he', 'es'];
    if (!allowed.includes(lang)) {
      setLang(allowed[0]);
    }
  }, [market, lang, setLang]);

  useEffect(() => {
    const roleViews = {
      host: ['dashboard', 'premium', 'properties', 'tasks', 'crm'],
      admin: ['dashboard', 'premium', 'properties', 'tasks', 'crm'],
      operator: ['operator'],
      field: ['field'],
    };
    const allowed = roleViews[role] || ['dashboard'];
    if (!allowed.includes(activeView)) {
      setActiveView(allowed[0]);
    }
  }, [role, activeView]);

  useEffect(() => {
    const onTaskCreated = () => {
      if (role === 'host' || role === 'admin') setActiveView('tasks');
    };
    window.addEventListener('maya-task-created', onTaskCreated);
    return () => window.removeEventListener('maya-task-created', onTaskCreated);
  }, [role]);

  const renderRoleView = () => {
    switch (role) {
      case 'operator':
        return (
          <div key="operator-view">
            <LeadsCRM />
            <WhatsAppMonitor />
          </div>
        );
      case 'field':
        return <FieldView key="field-view" />;
      case 'host':
      default:
        if (activeView === 'crm') return <LeadsCRM key="host-crm" />;
        if (activeView === 'premium') return <PremiumDashboard key="host-premium" />;
        if (activeView === 'properties') return <PropertiesDashboard key="host-properties" />;
        if (activeView === 'tasks') return <TaskCalendar key="host-tasks" />;
        return <EnterpriseDashboard key="host-dashboard" />;
    }
  };

  const showLogin = hasHydrated && !authToken && !isClockInRoute && !isWorkerRoute;

  return (
    <div dir={isRTL ? 'rtl' : 'ltr'}>
      {isWorkerRoute ? (
        <WorkerView />
      ) : hasHydrated ? (
        showLogin ? (
          <LoginPage />
        ) : isClockInRoute ? (
          <div className="clockin-shell">
            <FieldView clockInOnly autoClockInOnScan />
          </div>
        ) : (
          <Layout key="main-layout" activeView={activeView} setActiveView={setActiveView}>
            {renderRoleView()}
          </Layout>
        )
      ) : null}
    </div>
  );
}

export default App;
