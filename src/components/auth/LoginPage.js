import React, { useState } from 'react';
import { loginAuth, registerAuth, getDemoAuthToken } from '../../services/api';
import useStore from '../../store/useStore';
import './Login.css';

const LOGIN_STORAGE_KEY = 'hotel-login-state';

/** Persist login state to localStorage for simple auth persistence. */
function saveLoginState(token, tenantId, role) {
  try {
    const state = { token, tenantId: tenantId || 'demo', role: role || 'host', loggedInAt: Date.now() };
    localStorage.setItem(LOGIN_STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('[LoginPage] Could not save to localStorage:', e);
  }
}

function clearLoginState() {
  try {
    localStorage.removeItem(LOGIN_STORAGE_KEY);
  } catch {}
}

function LoginPage() {
  const { setAuthToken, setActiveTenantId, setRole } = useStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isRegister, setIsRegister] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSuccess = (data) => {
    if (data.token) {
      setAuthToken(data.token);
      if (data.tenant_id) setActiveTenantId(data.tenant_id);
      if (data.role) setRole(data.role);
      saveLoginState(data.token, data.tenant_id, data.role);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const trimmedEmail = email.trim().toLowerCase();
      if (!trimmedEmail) {
        setError('Email is required');
        return;
      }
      if (!password) {
        setError('Password is required');
        return;
      }
      const fn = isRegister ? registerAuth : loginAuth;
      const data = await fn(trimmedEmail, password);
      if (data?.token) {
        handleSuccess(data);
      } else {
        setError(data?.error || 'Login failed');
      }
    } catch (err) {
      setError(err?.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const handleDevLogin = () => {
    setError('');
    const fakeToken = 'dev-bypass-' + Date.now();
    setAuthToken(fakeToken);
    setActiveTenantId('default');
    setRole('admin');
    try {
      const raw = localStorage.getItem('hotel-enterprise-storage');
      const parsed = raw ? JSON.parse(raw) : { state: {}, version: 0 };
      const prev = parsed?.state || {};
      parsed.state = { ...prev, authToken: fakeToken, role: 'admin', activeTenantId: 'default' };
      localStorage.setItem('hotel-enterprise-storage', JSON.stringify(parsed));
    } catch (e) {
      console.warn('[DevLogin] localStorage sync:', e);
    }
  };

  const handleDemo = async () => {
    setError('');
    setLoading(true);
    try {
      const data = await getDemoAuthToken('demo');
      handleSuccess({ ...data, role: 'host' });
    } catch (err) {
      setError(err.message || 'Demo login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-screen">
      <div className="login-card">
        <h1 className="login-title">Hotel Dashboard</h1>
        <p className="login-subtitle">{isRegister ? 'Create an account' : 'Sign in to continue'}</p>

        <form onSubmit={handleSubmit} className="login-form">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="login-input"
            autoComplete="email"
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="login-input"
            autoComplete={isRegister ? 'new-password' : 'current-password'}
            minLength={isRegister ? 6 : undefined}
            required
          />
          {error && <p className="login-error">{error}</p>}
          <button type="submit" className="login-button" disabled={loading}>
            {loading ? 'Please wait…' : isRegister ? 'Register' : 'Sign In'}
          </button>
        </form>

        <button type="button" className="login-switch" onClick={() => { setIsRegister(!isRegister); setError(''); }}>
          {isRegister ? 'Already have an account? Sign in' : "Don't have an account? Register"}
        </button>

        <div className="login-divider">
          <span>or</span>
        </div>

        <button type="button" className="login-demo" onClick={handleDemo} disabled={loading}>
          Continue as Demo
        </button>

        <button
          type="button"
          className="login-switch"
          onClick={handleDevLogin}
          style={{ marginTop: 8, opacity: 0.8, fontSize: 12 }}
        >
          [Dev Login] Bypass API
        </button>
      </div>
    </div>
  );
}

export default LoginPage;
export { saveLoginState, clearLoginState, LOGIN_STORAGE_KEY };
