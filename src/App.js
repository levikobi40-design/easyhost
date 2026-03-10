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
import GodModeDashboard from './components/dashboard/GodModeDashboard';
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
  const { lang, authToken, setAuthToken, setActiveTenantId, role, hasHydrated, setLang, market } = useStore();
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

  // ── IP-based language detection — runs once per browser session ──────────
  // Uses ipapi.co (free, no key required). Silently ignored on failure.
  // Skip if the user already manually set a non-default language this session.
  useEffect(() => {
    if (sessionStorage.getItem('ip_geo_done')) return;
    sessionStorage.setItem('ip_geo_done', '1');
    fetch('https://ipapi.co/json/', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        if (data?.country_code === 'IL') {
          setLang('he');
        }
        // Any other country → keep the default 'en'
      })
      .catch(() => {}); // silent — never crash on geo failure
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Market / lang guard ────────────────────────────────────────────────
  useEffect(() => {
    // Both US and IL markets now allow 'en' and 'he'; keep this guard permissive.
    const allowed = ['en', 'he', 'es', 'th', 'hi'];
    if (!allowed.includes(lang)) {
      setLang('en');
    }
  }, [market, lang, setLang]);

  useEffect(() => {
    const normaliseRole = (r) => {
      if (!r) return 'host';
      const map = { owner: 'host', manager: 'admin', staff: 'field', worker: 'field' };
      return map[r] || r;
    };
    const roleViews = {
      host:     ['dashboard', 'premium', 'properties', 'tasks', 'crm'],
      admin:    ['dashboard', 'premium', 'properties', 'tasks', 'crm', 'godmode'],
      operator: ['operator'],
      field:    ['field'],
    };
    const navRole = normaliseRole(role);
    const allowed = roleViews[navRole] || roleViews['host'];
    if (!allowed.includes(activeView)) {
      setActiveView(allowed[0]);
    }
  }, [role, activeView]);

  useEffect(() => {
    const onTaskCreated = () => {
      const normR = { owner: 'host', manager: 'admin', staff: 'field', worker: 'field' }[role] || role;
    if (normR === 'host' || normR === 'admin') setActiveView('tasks');
    };
    window.addEventListener('maya-task-created', onTaskCreated);
    return () => window.removeEventListener('maya-task-created', onTaskCreated);
  }, [role]);

  const renderRoleView = () => {
    // Normalise backend roles (owner, manager, staff, worker) to frontend nav groups
    const normRole = (() => {
      const map = { owner: 'host', manager: 'admin', staff: 'field', worker: 'field' };
      return map[role] || role;
    })();

    switch (normRole) {
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
      case 'admin':
      default:
        if (activeView === 'crm')        return <LeadsCRM key="host-crm" />;
        if (activeView === 'premium')    return <PremiumDashboard key="host-premium" />;
        if (activeView === 'properties') return <PropertiesDashboard key="host-properties" />;
        if (activeView === 'tasks')      return <TaskCalendar key="host-tasks" />;
        if (activeView === 'godmode')    return <GodModeDashboard key="godmode" />;
        return <EnterpriseDashboard key="host-dashboard" />;
    }
  };

  const showLogin = hasHydrated && !authToken && !isClockInRoute && !isWorkerRoute;

  return (
    <div dir={isRTL ? 'rtl' : 'ltr'}>
      <a href="#main-content" className="skip-link">{isRTL ? 'דלג לתוכן הראשי' : 'Skip to main content'}</a>
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
