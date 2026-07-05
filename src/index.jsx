import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import './i18n';
import App from './App';
import AppErrorBoundary from './components/common/AppErrorBoundary.jsx';
import { register as registerSW } from './serviceWorkerRegistration';
import { clearStaleMayaClientCaches, invalidateMayaCache } from './services/api';

const _viteDev = typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV;
if (_viteDev && typeof window !== 'undefined' && window.location.port === '1000') {
  const { protocol, hostname, pathname, search, hash } = window.location;
  window.location.replace(`${protocol}//${hostname}:5173${pathname}${search}${hash}`);
}

const root = ReactDOM.createRoot(document.getElementById('root'));
clearStaleMayaClientCaches();
invalidateMayaCache();
root.render(
  <BrowserRouter>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </BrowserRouter>
);

// Register the service worker for PWA offline support + caching.
const _viteProd = typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.PROD;
if (_viteProd || process.env.NODE_ENV === 'production') {
  registerSW();
}
