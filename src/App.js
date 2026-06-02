import React, { useCallback, useEffect, useState, useRef } from 'react';
import { Routes, Route, useParams, useLocation, useNavigate } from 'react-router-dom';
import useTranslations from './hooks/useTranslations';
import useStore from './store/useStore';
import './styles/tailwind.css';
import './App.css';
import Layout from './components/layout/Layout';
import LoginPage from './components/auth/LoginPage';
import Welcome from './components/auth/Welcome';
import EnterpriseDashboard from './components/dashboard/EnterpriseDashboard';
import TaskCalendar from './components/dashboard/TasksDashboard';
import PremiumDashboard from './components/dashboard/PremiumDashboard';
import PropertiesDashboard from './components/dashboard/PropertiesDashboard';
import GodModeDashboard from './components/dashboard/GodModeDashboard';
import RoomInventoryDashboard from './components/dashboard/RoomInventoryDashboard';
import OwnerDashboard from './components/dashboard/OwnerDashboard';
import LeadsCRM from './components/crm/LeadsCRM';
import FieldView from './components/features/FieldView';
import StaffDashboard from './components/dashboard/StaffDashboard';
import WorkerEntry from './components/worker/WorkerEntry';
import WhatsAppMonitor from './components/operator/WhatsAppMonitor';
import GuestDashboard from './components/guest/GuestDashboard';
import ShiftScheduler from './components/admin/ShiftScheduler';
import ManualOperationsHub from './components/admin/ManualOperationsHub';
import BazaarWeek1ManagerView from './components/dashboard/BazaarWeek1ManagerView';
import { MissionProvider } from './context/MissionContext';
import { PropertiesProvider } from './context/PropertiesContext';
import hotelRealtime from './services/hotelRealtime';
import BiktaDashboard from './components/bikta/BiktaDashboard';
import MayaChat from './components/maya/MayaChat';
import WorkerLogin from './components/auth/WorkerLogin';
import { isBiktaNessZionaUser } from './utils/biktaUser';
import { dashboardNavTier, isDashboardAdmin, isOperationRole } from './utils/dashboardRoles';
import { startBackendHeartbeat } from './services/backendHeartbeat';
import { checkPythonApiHealth, flushTaskUpdateQueue } from './services/api';
import { API_URL } from './config';

/**
 * Deep links (open in separate tabs while logged into the main app):
 *   Worker portal — http://localhost:3000/worker/<staff_id>   e.g. /worker/levikobi
 *   Guest room  — http://localhost:3000/guest/<booking_or_room> e.g. /guest/60
 *   Staff       — http://localhost:3000/staff
 *   Clock-in    — http://localhost:3000/clock-in
 *   Bikta matrix — http://localhost:3000/bikta-matrix
 *   Worker clock-in → Bikta — http://localhost:3000/worker-login
 *   Scheduler   — http://localhost:3000 (nav: Shift Scheduler after login)
 */
function GuestRoutePage() {
  const { roomId } = useParams();
  return (
    <div dir="rtl">
      <GuestDashboard roomId={roomId} />
    </div>
  );
}

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

function MainApp() {
  const location = useLocation();
  const navigate = useNavigate();
  const isClockInRoute = location.pathname === '/clock-in';

  const {
    lang,
    authToken,
    setAuthToken,
    setActiveTenantId,
    setRole,
    role,
    hasHydrated,
    setLang,
    market,
    activeTenantId: activeTenantIdFromStore,
  } = useStore();
  const resetMayaChatForBazaar = useStore((s) => s.resetMayaChatForBazaar);
  const prevTenantForMayaRef = useRef(null);
  const activeTenantId =
    activeTenantIdFromStore ??
    process.env.REACT_APP_BIKTA_TENANT_ID ??
    'demo';
  const { i18n } = useTranslations();
  const isRTL = lang === 'he';
  const [activeView, setActiveView] = useState('dashboard');
  const [showWelcome, setShowWelcome] = useState(
    !authToken && !sessionStorage.getItem('wc_passed')
  );

  useEffect(() => {
    if (authToken) return;
    const params = new URLSearchParams(window.location.search);
    const tokenParam = params.get('token');
    if (tokenParam) {
      const payload = parseJwtPayload(tokenParam);
      if (payload?.tenant_id) {
        setActiveTenantId(payload.tenant_id);
      }
      const jwtRole = (payload?.role || '').trim();
      if (jwtRole) {
        setRole(jwtRole);
      }
      setAuthToken(tokenParam);
      params.delete('token');
      const next = `${window.location.pathname}${params.toString() ? `?${params}` : ''}`;
      window.history.replaceState({}, '', next);
    }
  }, [authToken, setAuthToken, setActiveTenantId, setRole]);

  useEffect(() => {
    const id = startBackendHeartbeat(30000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const onOnline = () => {
      flushTaskUpdateQueue();
    };
    window.addEventListener('online', onOnline);
    flushTaskUpdateQueue();
    return () => window.removeEventListener('online', onOnline);
  }, []);

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
    if (sessionStorage.getItem('ip_geo_done')) return;
    sessionStorage.setItem('ip_geo_done', '1');
    fetch('https://ipapi.co/json/', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        if (data?.country_code === 'IL') {
          setLang('he');
        }
      })
      .catch(() => {});
  }, [setLang]);

  useEffect(() => {
    const allowed = ['en', 'he', 'es', 'th', 'hi'];
    if (!allowed.includes(lang)) {
      setLang('en');
    }
  }, [market, lang, setLang]);

  useEffect(() => {
    const isBazaarJaffa = activeTenantIdFromStore === 'BAZAAR_JAFFA';
    const tier = dashboardNavTier(role);
    const roleViews = isBazaarJaffa
      ? {
          admin: ['tasks', 'properties', 'bazaar-week', 'manualops', 'scheduler', 'godmode'],
          operation: ['tasks', 'properties', 'bazaar-week', 'scheduler'],
          staff: ['tasks'],
          operator: ['operator'],
          field: ['field'],
        }
      : {
          admin: ['dashboard', 'premium', 'properties', 'tasks', 'crm', 'inventory', 'analytics', 'manualops', 'scheduler', 'godmode'],
          operation: ['dashboard', 'premium', 'properties', 'tasks', 'crm', 'inventory', 'analytics', 'scheduler'],
          staff: ['tasks'],
          operator: ['operator'],
          field: ['field'],
        };
    const allowed = roleViews[tier] || roleViews.staff;
    if (!allowed.includes(activeView)) {
      setActiveView(allowed[0]);
    }
  }, [role, activeView, activeTenantIdFromStore]);

  useEffect(() => {
    if (!authToken) return;
    const tid = activeTenantIdFromStore;
    if (tid === 'BAZAAR_JAFFA' && prevTenantForMayaRef.current !== 'BAZAAR_JAFFA') {
      resetMayaChatForBazaar();
    }
    prevTenantForMayaRef.current = tid;
  }, [authToken, activeTenantIdFromStore, resetMayaChatForBazaar]);

  useEffect(() => {
    try {
      if (sessionStorage.getItem('maya_code_quality_confirm_fired_v1') === '1') return;
      sessionStorage.setItem('maya_code_quality_confirm_fired_v1', '1');
      sessionStorage.setItem('maya_code_quality_confirm_pending', '1');
    } catch (_) {
      return;
    }
    window.dispatchEvent(new CustomEvent('maya-code-quality-confirm-ready', { detail: { source: 'app' } }));
  }, []);

  useEffect(() => {
    try {
      if (sessionStorage.getItem('maya_status_200_lock_fired_v1') === '1') return;
      sessionStorage.setItem('maya_status_200_lock_fired_v1', '1');
      sessionStorage.setItem('maya_status_200_lock_pending', '1');
    } catch (_) {
      return;
    }
    window.dispatchEvent(new CustomEvent('maya-status-200-lock-ready', { detail: { source: 'app' } }));
  }, []);

  useEffect(() => {
    try {
      if (sessionStorage.getItem('maya_gemini_integration_fired_v1') === '1') return;
      sessionStorage.setItem('maya_gemini_integration_fired_v1', '1');
      sessionStorage.setItem('maya_gemini_integration_pending', '1');
    } catch (_) {
      return;
    }
    window.dispatchEvent(new CustomEvent('maya-gemini-integration-ready', { detail: { source: 'app' } }));
  }, []);

  useEffect(() => {
    try {
      if (sessionStorage.getItem('maya_modern_ui_polish_fired_v1') === '1') return;
      sessionStorage.setItem('maya_modern_ui_polish_fired_v1', '1');
      sessionStorage.setItem('maya_modern_ui_polish_pending', '1');
    } catch (_) {
      return;
    }
    window.dispatchEvent(new CustomEvent('maya-modern-ui-polish-ready', { detail: { source: 'app' } }));
  }, []);

  useEffect(() => {
    try {
      if (sessionStorage.getItem('maya_images_chat_connect_fired_v1') === '1') return;
      sessionStorage.setItem('maya_images_chat_connect_fired_v1', '1');
      sessionStorage.setItem('maya_images_chat_connect_pending', '1');
    } catch (_) {
      return;
    }
    window.dispatchEvent(new CustomEvent('maya-images-chat-connect-ready', { detail: { source: 'app' } }));
  }, []);

  useEffect(() => {
    try {
      if (sessionStorage.getItem('maya_unique_realestate_visuals_fired_v1') === '1') return;
      sessionStorage.setItem('maya_unique_realestate_visuals_fired_v1', '1');
      sessionStorage.setItem('maya_unique_realestate_visuals_pending', '1');
    } catch (_) {
      return;
    }
    window.dispatchEvent(new CustomEvent('maya-unique-realestate-visuals-ready', { detail: { source: 'app' } }));
  }, []);

  useEffect(() => {
    try {
      if (sessionStorage.getItem('maya_demo_engine_fired_v1') === '1') return;
      sessionStorage.setItem('maya_demo_engine_fired_v1', '1');
      sessionStorage.setItem('maya_demo_engine_pending', '1');
    } catch (_) {
      return;
    }
    window.dispatchEvent(new CustomEvent('maya-demo-engine-ready', { detail: { source: 'app' } }));
  }, []);

  useEffect(() => {
    try {
      if (sessionStorage.getItem('maya_brain_reconnected_fired_v1') === '1') return;
      sessionStorage.setItem('maya_brain_reconnected_fired_v1', '1');
      sessionStorage.setItem('maya_brain_reconnected_pending', '1');
    } catch (_) {
      return;
    }
    window.dispatchEvent(new CustomEvent('maya-brain-reconnected-ready', { detail: { source: 'app' } }));
  }, []);

  useEffect(() => {
    try {
      if (sessionStorage.getItem('maya_kobi_stack_fix_fired_v1') === '1') return;
      sessionStorage.setItem('maya_kobi_stack_fix_fired_v1', '1');
      sessionStorage.setItem('maya_kobi_stack_fix_pending', '1');
    } catch (_) {
      return;
    }
    window.dispatchEvent(new CustomEvent('maya-kobi-stack-fix-ready', { detail: { source: 'app' } }));
  }, []);

  useEffect(() => {
    try {
      if (sessionStorage.getItem('maya_demo_all_systems_go_fired_v1') === '1') return;
      sessionStorage.setItem('maya_demo_all_systems_go_fired_v1', '1');
      sessionStorage.setItem('maya_demo_all_systems_go_pending', '1');
    } catch (_) {
      return;
    }
    window.dispatchEvent(new CustomEvent('maya-demo-all-systems-go-ready', { detail: { source: 'app' } }));
  }, []);

  useEffect(() => {
    const p = (location.pathname || '').replace(/\/$/, '') || '/';
    if (p === '/properties') setActiveView('properties');
    else if (p === '/rooms') setActiveView('inventory');
  }, [location.pathname]);

  const handleNavViewChange = useCallback((viewId) => {
    if (viewId === 'premium') {
      setActiveView('properties');
      navigate('/properties', { replace: true });
      return;
    }
    setActiveView(viewId);
    if (viewId === 'properties') navigate('/properties', { replace: true });
    else if (viewId === 'inventory') navigate('/rooms', { replace: true });
    else if (location.pathname === '/properties' || location.pathname === '/rooms') {
      navigate('/', { replace: true });
    }
  }, [navigate, location.pathname]);

  useEffect(() => {
    const onTaskCreated = () => {
      if (isDashboardAdmin(role) || isOperationRole(role)) setActiveView('tasks');
    };
    window.addEventListener('maya-task-created', onTaskCreated);
    return () => window.removeEventListener('maya-task-created', onTaskCreated);
  }, [role]);

  const renderRoleView = () => {
    const tier = dashboardNavTier(role);
    if (tier === 'staff') {
      return <TaskCalendar key="staff-tasks" />;
    }
    switch (tier) {
      case 'operator':
        return (
          <div key="operator-view">
            <LeadsCRM />
            <WhatsAppMonitor />
          </div>
        );
      case 'field':
        return <FieldView key="field-view" />;
      case 'admin':
      default:
        if (activeView === 'crm')        return <LeadsCRM key="host-crm" />;
        if (activeView === 'premium')    return <PremiumDashboard key="host-premium" />;
        if (activeView === 'properties') return <PropertiesDashboard key="host-properties" />;
        if (activeView === 'tasks')      return <TaskCalendar key="host-tasks" />;
        if (activeView === 'inventory')  return <RoomInventoryDashboard key="room-inventory" />;
        if (activeView === 'scheduler') return <ShiftScheduler key="scheduler" />;
        if (activeView === 'godmode')    return <GodModeDashboard key="godmode" />;
        if (activeView === 'manualops') return <ManualOperationsHub key="manual-ops" />;
        if (activeView === 'bazaar-week') return <BazaarWeek1ManagerView key="bazaar-week1" />;
        if (activeView === 'analytics')  return <OwnerDashboard key="owner-analytics" onSwitchToEmployee={() => setActiveView('field')} />;
        return <EnterpriseDashboard key="host-dashboard" />;
    }
  };

  const showLogin = hasHydrated && !authToken && !isClockInRoute;

  const handleWelcomeOwner = () => {
    sessionStorage.setItem('wc_passed', '1');
    setShowWelcome(false);
  };
  const handleWelcomeField = () => {
    sessionStorage.setItem('wc_passed', '1');
    setShowWelcome(false);
    navigate('/clock-in', { replace: true });
  };

  useEffect(() => {
    if (authToken) {
      sessionStorage.setItem('wc_passed', '1');
      setShowWelcome(false);
    }
  }, [authToken]);

  /** Warm Flask — only runs when the user has a valid auth token. */
  useEffect(() => {
    if (!authToken) return;
    let cancelled = false;
    const run = async () => {
      try {
        const api = await import('./services/api');
        try {
          await api.bootstrapOperationalData();
        } catch (_) {
          /* server may have seeded on startup; still fetch below */
        }
        await Promise.all([
          api.getProperties({ limit: 30, offset: 0 }),
          api.getPropertyTasks({ limit: 30, offset: 0 }),
        ]);
        if (cancelled) return;
        window.dispatchEvent(new CustomEvent('properties-refresh', { detail: { force: true } }));
        window.dispatchEvent(new Event('maya-refresh-tasks'));
      } catch (_) {
        /* MissionContext / PropertiesContext will retry */
      }
    };
    run();
    return () => { cancelled = true; };
  }, [authToken]);

  /** When any protected API call returns 401, clear the stale token → show LoginPage. */
  useEffect(() => {
    const handle = () => setAuthToken(null);
    window.addEventListener('easyhost-auth-required', handle);
    return () => window.removeEventListener('easyhost-auth-required', handle);
  }, [setAuthToken]);

  return (
    <div dir={isRTL ? 'rtl' : 'ltr'}>
      <a href="#main-content" className="skip-link">{isRTL ? 'דלג לתוכן הראשי' : 'Skip to main content'}</a>
      {!hasHydrated ? (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-600 text-sm">
          Loading…
        </div>
      ) : (
        showLogin && showWelcome ? (
          <Welcome onSelectOwner={handleWelcomeOwner} onSelectField={handleWelcomeField} />
        ) : showLogin ? (
          <LoginPage />
        ) : isClockInRoute ? (
          <div className="clockin-shell">
            <FieldView clockInOnly autoClockInOnScan />
          </div>
        ) : isBiktaNessZionaUser(authToken, activeTenantId) ? (
          <BiktaDashboard />
        ) : (
          <MissionProvider>
            <PropertiesProvider>
              <Layout key="main-layout" activeView={activeView} setActiveView={handleNavViewChange}>
                {renderRoleView()}
              </Layout>
            </PropertiesProvider>
          </MissionProvider>
        )
      )}
    </div>
  );
}

let _userRestoreAttempted = false;

function restoreUserFromLocalStorage() {
  if (_userRestoreAttempted) return;
  try {
    const raw = localStorage.getItem('user');
    if (!raw) return;
    const u = JSON.parse(raw);
    if (u?.token && !useStore.getState().authToken) {
      useStore.getState().loginSuccess(u.token, u.tenantId || 'demo', u.role || 'host');
    }
  } catch {
    /* ignore */
  } finally {
    _userRestoreAttempted = true;
  }
}

/** No red banner until this long after load — backend + network can be slow on first paint. */
const PYTHON_HEALTH_GRACE_MS = 50000;

export default function App() {
  const [pythonOffline, setPythonOffline] = useState(false);
  const healthGraceRef = useRef(
    typeof performance !== 'undefined' ? performance.now() : Date.now(),
  );

  useEffect(() => {
    if (typeof window !== 'undefined' && window.__EASYHOST_API_URL__ && window.__EASYHOST_API_URL__ !== API_URL) {
      console.warn('[App] API_URL mismatch — config:', API_URL, 'vs window:', window.__EASYHOST_API_URL__);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let consecutiveFail = 0;
    const tick = async () => {
      let { ok } = await checkPythonApiHealth();
      if (!ok && !cancelled) {
        await new Promise((r) => setTimeout(r, 900));
        if (!cancelled) {
          ({ ok } = await checkPythonApiHealth());
        }
      }
      if (cancelled) return;
      if (ok) {
        consecutiveFail = 0;
        setPythonOffline(false);
        return;
      }
      consecutiveFail += 1;
      const elapsed =
        (typeof performance !== 'undefined' ? performance.now() : Date.now()) -
        healthGraceRef.current;
      const pastGrace = elapsed > PYTHON_HEALTH_GRACE_MS;
      // Require 5 consecutive failures after the grace window before showing the banner.
      if (!pastGrace || consecutiveFail < 5) {
        setPythonOffline(false);
        return;
      }
      setPythonOffline(true);
    };
    tick();
    const id = setInterval(tick, 10000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  /** When the 30s heartbeat sees Flask, clear false offline and bump Mission Board (syncs DB task count). */
  useEffect(() => {
    const onHb = () => {
      setPythonOffline(false);
      window.dispatchEvent(new Event('maya-refresh-tasks'));
    };
    window.addEventListener('easyhost-heartbeat', onHb);
    return () => window.removeEventListener('easyhost-heartbeat', onHb);
  }, []);

  useEffect(() => {
    hotelRealtime.connect();
    return () => hotelRealtime.disconnect();
  }, []);

  useEffect(() => {
    restoreUserFromLocalStorage();
    const unsub = typeof useStore.persist?.onFinishHydration === 'function'
      ? useStore.persist.onFinishHydration(() => restoreUserFromLocalStorage())
      : undefined;
    return typeof unsub === 'function' ? unsub : undefined;
  }, []);

  return (
    <div className="app-root">
      {pythonOffline && (
        <div
          role="alert"
          dir="rtl"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 99999,
            padding: '10px 16px',
            background: '#b91c1c',
            color: '#fff',
            fontWeight: 700,
            fontSize: 14,
            textAlign: 'center',
            boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
          }}
        >
          Python Offline — השרת לא מגיב. הפעל את ה-backend:{' '}
          <code style={{ background: 'rgba(0,0,0,0.2)', padding: '2px 6px', borderRadius: 4 }}>python app.py</code>{' '}
          (פורט 1000, CORS מופעל).
        </div>
      )}
      <Routes>
        <Route
          path="/bikta-matrix"
          element={
            <>
              <BiktaDashboard />
              <MayaChat />
            </>
          }
        />
        <Route path="/worker-login" element={<WorkerLogin />} />
        <Route path="/worker" element={<WorkerEntry />} />
        <Route path="/worker/:id/*" element={<WorkerEntry />} />
        <Route path="/guest/:roomId" element={<GuestRoutePage />} />
        <Route path="/staff/*" element={<StaffDashboard />} />
        <Route path="*" element={<MainApp />} />
      </Routes>
    </div>
  );
}
