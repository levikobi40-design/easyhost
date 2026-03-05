import React, { useState } from 'react';
import { loginAuth, registerAuth } from '../../services/api';
import useStore from '../../store/useStore';
import './Login.css';

export const LOGIN_STORAGE_KEY = 'hotel-login-state';

export function clearLoginState() {
  try { localStorage.removeItem(LOGIN_STORAGE_KEY); } catch {}
}

function saveLoginState(token, tenantId, role) {
  try {
    localStorage.setItem(LOGIN_STORAGE_KEY, JSON.stringify({
      token, tenantId: tenantId || 'default', role: role || 'owner', loggedInAt: Date.now(),
    }));
  } catch {}
}

function applyAuth(token, tenantId, role, setAuthToken, setActiveTenantId, setRole) {
  setAuthToken(token);
  setActiveTenantId(tenantId || 'default');
  setRole(role || 'owner');
  saveLoginState(token, tenantId, role);
  try {
    const raw = localStorage.getItem('hotel-enterprise-storage');
    const parsed = raw ? JSON.parse(raw) : { state: {}, version: 0 };
    parsed.state = { ...(parsed.state || {}), authToken: token, role: role || 'owner', activeTenantId: tenantId || 'default' };
    localStorage.setItem('hotel-enterprise-storage', JSON.stringify(parsed));
  } catch {}
}

// ─────────────────────────────────────────────────────────────────────────────
export default function LoginPage() {
  const { setAuthToken, setActiveTenantId, setRole } = useStore();

  // 'login' | 'register' | 'success'
  const [view, setView]           = useState('login');
  const [email, setEmail]         = useState('');
  const [password, setPassword]   = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');

  // Saved after successful registration — shown to user
  const [savedEmail, setSavedEmail]   = useState('');
  const [savedPassword, setSavedPassword] = useState('');
  const [copied, setCopied]           = useState('');

  const copyToClipboard = (text, label) => {
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopied(label);
    setTimeout(() => setCopied(''), 2000);
  };

  // ── Login ────────────────────────────────────────────────────────────────
  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    if (!email.trim()) { setError('Please enter your email.'); return; }
    if (!password)     { setError('Please enter your password.'); return; }
    setLoading(true);
    try {
      const data = await loginAuth(email.trim().toLowerCase(), password);
      applyAuth(data.token, data.tenant_id, data.role, setAuthToken, setActiveTenantId, setRole);
    } catch (err) {
      const msg = err?.message || '';
      if (msg.includes('Invalid') || msg.includes('401')) {
        setError('Incorrect email or password. Please try again.');
      } else if (msg.includes('fetch') || msg.includes('Failed') || msg.includes('network')) {
        setError('Cannot reach the server. Make sure the backend is running.');
      } else {
        setError(msg || 'Sign-in error. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  // ── Register ─────────────────────────────────────────────────────────────
  const handleRegister = async (e) => {
    e.preventDefault();
    setError('');
    if (!email.trim())       { setError('Please enter your email.'); return; }
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return; }
    if (password !== confirmPw) { setError('Passwords do not match.'); return; }
    setLoading(true);
    try {
      const data = await registerAuth(email.trim().toLowerCase(), password);
      setSavedEmail(email.trim().toLowerCase());
      setSavedPassword(password);
      applyAuth(data.token, data.tenant_id, data.role, setAuthToken, setActiveTenantId, setRole);
      setView('success');
    } catch (err) {
      const msg = err?.message || '';
      if (msg.includes('already') || msg.includes('409')) {
        try {
          const data = await loginAuth(email.trim().toLowerCase(), password);
          applyAuth(data.token, data.tenant_id, data.role, setAuthToken, setActiveTenantId, setRole);
        } catch {
          setError('This email is already registered. Switch to Sign In and try again.');
          setView('login');
        }
      } else if (msg.includes('fetch') || msg.includes('Failed')) {
        setError('Cannot reach the server. Make sure the backend is running.');
      } else {
        setError(msg || 'Registration error. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  // ── Dev bypass ───────────────────────────────────────────────────────────
  const handleDevLogin = () => {
    const token = 'dev-bypass-' + Date.now();
    applyAuth(token, 'default', 'admin', setAuthToken, setActiveTenantId, setRole);
  };

  // ── Enter dashboard from success screen ─────────────────────────────────
  const handleEnterDashboard = () => {
    // Auth already applied — just force-navigate by refreshing auth state
    setAuthToken(prev => prev); // no-op to trigger re-render
  };

  // ═════════════════════════════════════════════════════════════════════════
  return (
    <div className="lp-wrap">
      {/* ── LEFT PANEL — Branding ────────────────────────────────────── */}
      <div className="lp-left">
        <div className="lp-brand">
          <div className="lp-brand-icon">🏨</div>
          <h1 className="lp-brand-name">EasyHost</h1>
          <p className="lp-brand-headline">The AI Force Multiplier for<br />Short-Term Rentals.</p>
          <p className="lp-brand-tagline">Stop managing tasks. Start scaling your empire with Maya, your 24/7 AI manager.</p>
        </div>

        <ul className="lp-features">
          {[
            '✅ Property &amp; task management',
            '🤖 Maya AI — your 24/7 ops manager',
            '📊 Reports &amp; analytics',
            '💬 Automated WhatsApp dispatch',
          ].map(f => (
            <li key={f} className="lp-feature-item" dangerouslySetInnerHTML={{ __html: f }} />
          ))}
        </ul>

        {/* Testimonial */}
        <blockquote className="lp-testimonial">
          <p className="lp-testimonial-quote">
            "Maya handles my entire morning briefing automatically. It's like having a full-time ops manager for the cost of a coffee."
          </p>
          <footer className="lp-testimonial-author">
            <span className="lp-testimonial-avatar">RD</span>
            <div>
              <strong>Robert D.</strong>
              <span>Luxury Portfolio Manager · Miami, FL</span>
            </div>
          </footer>
        </blockquote>

        <div className="lp-left-footer">v2.0 · EasyHost Dashboard</div>
      </div>

      {/* ── RIGHT PANEL — Form ───────────────────────────────────────── */}
      <div className="lp-right">
        <div className="lp-form-box">

          {/* ─── SUCCESS SCREEN ──────────────────────────────────────── */}
          {view === 'success' && (
            <div className="lp-success-wrap">
              <div className="lp-success-icon">🎉</div>
              <h2 className="lp-success-title">You're in!</h2>
              <p className="lp-success-sub">Save your login credentials:</p>

              <div className="lp-cred-card">
                <div className="lp-cred-row">
                  <span className="lp-cred-label">📧 Email</span>
                  <span className="lp-cred-val">{savedEmail}</span>
                  <button className="lp-copy-btn" onClick={() => copyToClipboard(savedEmail, 'email')} aria-label="Copy email">
                    {copied === 'email' ? '✅' : '📋'}
                  </button>
                </div>
                <div className="lp-cred-row">
                  <span className="lp-cred-label">🔑 Password</span>
                  <span className="lp-cred-val">{savedPassword}</span>
                  <button className="lp-copy-btn" onClick={() => copyToClipboard(savedPassword, 'pw')} aria-label="Copy password">
                    {copied === 'pw' ? '✅' : '📋'}
                  </button>
                </div>
              </div>

              <p className="lp-success-note">⚠️ Store these credentials — passwords cannot be recovered.</p>

              <button className="lp-btn lp-btn--primary lp-btn--wide" onClick={handleEnterDashboard}>
                🚀 Enter Dashboard
              </button>
            </div>
          )}

          {/* ─── LOGIN / REGISTER FORMS ───────────────────────────────── */}
          {view !== 'success' && (
            <>
              <div className="lp-form-header">
                <h2 className="lp-form-title">
                  {view === 'login' ? 'Welcome back 👋' : 'Create your account ✨'}
                </h2>
                <p className="lp-form-sub">
                  {view === 'login' ? 'Enter your details to continue' : 'Free to start — no credit card required'}
                </p>
              </div>

              {/* Tab switcher */}
              <div className="lp-tabs">
                <button className={`lp-tab ${view === 'login' ? 'active' : ''}`} onClick={() => { setView('login'); setError(''); }}>
                  Sign In
                </button>
                <button className={`lp-tab ${view === 'register' ? 'active' : ''}`} onClick={() => { setView('register'); setError(''); }}>
                  Sign Up
                </button>
              </div>

              {/* Form */}
              <form onSubmit={view === 'login' ? handleLogin : handleRegister} noValidate>
                <div className="lp-field">
                  <label className="lp-label">📧 Email</label>
                  <input
                    className="lp-input"
                    type="email"
                    placeholder="your@email.com"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    dir="ltr"
                    autoComplete="email"
                  />
                </div>

                <div className="lp-field">
                  <label className="lp-label">🔑 Password</label>
                  <input
                    className="lp-input"
                    type="password"
                    placeholder={view === 'register' ? 'At least 6 characters' : 'Your password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    dir="ltr"
                    autoComplete={view === 'register' ? 'new-password' : 'current-password'}
                  />
                </div>

                {view === 'register' && (
                  <div className="lp-field">
                    <label className="lp-label">🔑 Confirm Password</label>
                    <input
                      className="lp-input"
                      type="password"
                      placeholder="Repeat your password"
                      value={confirmPw}
                      onChange={e => setConfirmPw(e.target.value)}
                      dir="ltr"
                      autoComplete="new-password"
                    />
                  </div>
                )}

                {error && (
                  <div className="lp-error">
                    <span>⚠️</span> {error}
                  </div>
                )}

                <button type="submit" className="lp-btn lp-btn--primary lp-btn--wide" disabled={loading}>
                  {loading
                    ? <span className="lp-spinner">⏳ Processing…</span>
                    : view === 'login' ? '🔑 Sign In' : '✅ Create Account'}
                </button>
              </form>

              {/* Divider */}
              <div className="lp-divider"><span>or</span></div>

              {/* Quick access */}
              <button
                className="lp-btn lp-btn--ghost lp-btn--wide"
                onClick={handleDevLogin}
                title="Instant access without registration"
              >
                ⚡ Demo Access (no sign-up)
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
