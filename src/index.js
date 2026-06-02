import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import './styles/tailwind.css';
import './i18n';
import App from './App';
import AppErrorBoundary from './components/common/AppErrorBoundary.jsx';
import { register as registerSW } from './serviceWorkerRegistration';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <BrowserRouter>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </BrowserRouter>
);

// Register the service worker for PWA offline support + caching.
// Only active in production (Create React App sets NODE_ENV automatically).
if (process.env.NODE_ENV === 'production') {
  registerSW();
}