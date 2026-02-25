import React, { useState } from 'react';
import { loginAuth, registerAuth, getDemoAuthToken } from '../../services/api';
import useStore from '../../store/useStore';
import './Login.css';

function Login() {
  const { setAuthToken, setActiveTenantId, setRole } = useStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isRegister, setIsRegister] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const fn = isRegister ? registerAuth : loginAuth;
      const data = await fn(email.trim().toLowerCase(), password);
      if (data.token) {
        setAuthToken(data.token);
        if (data.tenant_id) setActiveTenantId(data.tenant_id);
        if (data.role) setRole(data.role);
      }
    } catch (err) {
      setError(err.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const handleDemo = async () => {
    setError('');
    setLoading(true);
    try {
      const data = await getDemoAuthToken('demo');
      if (data.token) {
        setAuthToken(data.token);
        if (data.tenant_id) setActiveTenantId(data.tenant_id);
        setRole('host');
      }
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
      </div>
    </div>
  );
}

export default Login;
