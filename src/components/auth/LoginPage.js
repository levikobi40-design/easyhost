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
    if (!email.trim()) { setError('נא להזין אימייל'); return; }
    if (!password)     { setError('נא להזין סיסמה'); return; }
    setLoading(true);
    try {
      const data = await loginAuth(email.trim().toLowerCase(), password);
      applyAuth(data.token, data.tenant_id, data.role, setAuthToken, setActiveTenantId, setRole);
    } catch (err) {
      const msg = err?.message || '';
      if (msg.includes('Invalid') || msg.includes('401')) {
        setError('אימייל או סיסמה שגויים. נסה שוב.');
      } else if (msg.includes('fetch') || msg.includes('Failed') || msg.includes('network')) {
        setError('לא ניתן להתחבר לשרת. וודא ש-Python רץ.');
      } else {
        setError(msg || 'שגיאת כניסה');
      }
    } finally {
      setLoading(false);
    }
  };

  // ── Register ─────────────────────────────────────────────────────────────
  const handleRegister = async (e) => {
    e.preventDefault();
    setError('');
    if (!email.trim())       { setError('נא להזין אימייל'); return; }
    if (password.length < 6) { setError('הסיסמה חייבת לפחות 6 תווים'); return; }
    if (password !== confirmPw) { setError('הסיסמאות אינן תואמות'); return; }
    setLoading(true);
    try {
      const data = await registerAuth(email.trim().toLowerCase(), password);
      // Save credentials for display
      setSavedEmail(email.trim().toLowerCase());
      setSavedPassword(password);
      // Apply auth immediately
      applyAuth(data.token, data.tenant_id, data.role, setAuthToken, setActiveTenantId, setRole);
      setView('success');
    } catch (err) {
      const msg = err?.message || '';
      if (msg.includes('already') || msg.includes('409')) {
        // Auto-try login
        try {
          const data = await loginAuth(email.trim().toLowerCase(), password);
          applyAuth(data.token, data.tenant_id, data.role, setAuthToken, setActiveTenantId, setRole);
        } catch {
          setError('האימייל כבר רשום. עבור ל"כניסה" ונסה שוב.');
          setView('login');
        }
      } else if (msg.includes('fetch') || msg.includes('Failed')) {
        setError('לא ניתן להגיע לשרת. וודא ש-Python רץ.');
      } else {
        setError(msg || 'שגיאת הרשמה');
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
          <p className="lp-brand-tagline">מערכת ניהול נכסים חכמה</p>
        </div>
        <ul className="lp-features">
          {['✅ ניהול נכסים ומשימות', '🤖 AI מאיה — עוזרת חכמה', '📊 דוחות ואנליטיקה', '💬 WhatsApp אוטומטי'].map(f => (
            <li key={f} className="lp-feature-item">{f}</li>
          ))}
        </ul>
        <div className="lp-left-footer">v2.0 · EasyHost Dashboard</div>
      </div>

      {/* ── RIGHT PANEL — Form ───────────────────────────────────────── */}
      <div className="lp-right">
        <div className="lp-form-box">

          {/* ─── SUCCESS SCREEN ──────────────────────────────────────── */}
          {view === 'success' && (
            <div className="lp-success-wrap">
              <div className="lp-success-icon">🎉</div>
              <h2 className="lp-success-title">ההרשמה הצליחה!</h2>
              <p className="lp-success-sub">שמור את פרטי הכניסה שלך:</p>

              <div className="lp-cred-card">
                <div className="lp-cred-row">
                  <span className="lp-cred-label">📧 אימייל</span>
                  <span className="lp-cred-val">{savedEmail}</span>
                  <button className="lp-copy-btn" onClick={() => copyToClipboard(savedEmail, 'email')}>
                    {copied === 'email' ? '✅' : '📋'}
                  </button>
                </div>
                <div className="lp-cred-row">
                  <span className="lp-cred-label">🔑 סיסמה</span>
                  <span className="lp-cred-val">{savedPassword}</span>
                  <button className="lp-copy-btn" onClick={() => copyToClipboard(savedPassword, 'pw')}>
                    {copied === 'pw' ? '✅' : '📋'}
                  </button>
                </div>
              </div>

              <p className="lp-success-note">⚠️ שמור את הפרטים האלו — לא ניתן לשחזר סיסמה</p>

              <button className="lp-btn lp-btn--primary lp-btn--wide" onClick={handleEnterDashboard}>
                🚀 כנס לדאשבורד עכשיו
              </button>
            </div>
          )}

          {/* ─── LOGIN / REGISTER FORMS ───────────────────────────────── */}
          {view !== 'success' && (
            <>
              <div className="lp-form-header">
                <h2 className="lp-form-title">
                  {view === 'login' ? 'ברוך הבא 👋' : 'צור חשבון חדש ✨'}
                </h2>
                <p className="lp-form-sub">
                  {view === 'login' ? 'הכנס פרטים כדי להמשיך' : 'הרשמה מהירה וחינמית'}
                </p>
              </div>

              {/* Tab switcher */}
              <div className="lp-tabs">
                <button className={`lp-tab ${view === 'login' ? 'active' : ''}`} onClick={() => { setView('login'); setError(''); }}>
                  כניסה
                </button>
                <button className={`lp-tab ${view === 'register' ? 'active' : ''}`} onClick={() => { setView('register'); setError(''); }}>
                  הרשמה
                </button>
              </div>

              {/* Form */}
              <form onSubmit={view === 'login' ? handleLogin : handleRegister} noValidate>
                <div className="lp-field">
                  <label className="lp-label">📧 אימייל</label>
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
                  <label className="lp-label">🔑 סיסמה</label>
                  <input
                    className="lp-input"
                    type="password"
                    placeholder={view === 'register' ? 'לפחות 6 תווים' : 'הסיסמה שלך'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    dir="ltr"
                    autoComplete={view === 'register' ? 'new-password' : 'current-password'}
                  />
                </div>

                {view === 'register' && (
                  <div className="lp-field">
                    <label className="lp-label">🔑 אימות סיסמה</label>
                    <input
                      className="lp-input"
                      type="password"
                      placeholder="חזור על הסיסמה"
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
                    ? <span className="lp-spinner">⏳ מעבד...</span>
                    : view === 'login' ? '🔑 כניסה' : '✅ הרשמה וכניסה'}
                </button>
              </form>

              {/* Divider */}
              <div className="lp-divider"><span>או</span></div>

              {/* Quick access */}
              <button
                className="lp-btn lp-btn--ghost lp-btn--wide"
                onClick={handleDevLogin}
                title="כניסה מיידית ללא שרת"
              >
                ⚡ כניסה מיידית (ללא הרשמה)
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
