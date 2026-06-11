import React, { useEffect, useRef, useState, useCallback } from 'react';
import './Welcome.css';
import useStore from '../../store/useStore';
import { loginAuth, registerAuth, getDemoAuthToken } from '../../services/api';
import { hasValidAuthToken } from '../../utils/apiClient';
import { applyAuth } from './LoginPage';

/* ── Ambient particle canvas ──────────────────────────────── */
function ParticleCanvas() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const resize = () => {
      canvas.width  = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    const DOTS = Array.from({ length: 55 }, () => ({
      x: Math.random() * window.innerWidth,
      y: Math.random() * window.innerHeight,
      r: Math.random() * 1.5 + 0.4,
      vx: (Math.random() - 0.5) * 0.3,
      vy: (Math.random() - 0.5) * 0.3,
      alpha: Math.random() * 0.5 + 0.15,
    }));

    let raf;
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      DOTS.forEach(d => {
        d.x += d.vx; d.y += d.vy;
        if (d.x < 0) d.x = canvas.width;
        if (d.x > canvas.width) d.x = 0;
        if (d.y < 0) d.y = canvas.height;
        if (d.y > canvas.height) d.y = 0;
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(0,200,117,${d.alpha})`;
        ctx.fill();
      });
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
  }, []);

  return <canvas ref={canvasRef} className="wc-canvas" />;
}

/* ── Single portal card ───────────────────────────────────── */
function PortalCard({ accent, icon, eyebrow, title, subtitle, features, cta, onClick, delay }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      className={`wc-card ${hovered ? 'wc-card--hovered' : ''}`}
      style={{ '--accent': accent, animationDelay: delay }}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* glow blob behind card */}
      <span className="wc-card-glow" />

      <div className="wc-card-inner">
        <div className="wc-card-icon">{icon}</div>

        <div className="wc-card-eyebrow">{eyebrow}</div>
        <h2 className="wc-card-title">{title}</h2>
        <p className="wc-card-sub">{subtitle}</p>

        <ul className="wc-card-features">
          {features.map(f => (
            <li key={f}>
              <span className="wc-feat-dot" />
              {f}
            </li>
          ))}
        </ul>

        <div className="wc-card-cta">
          <span>{cta}</span>
          <span className="wc-cta-arrow">→</span>
        </div>
      </div>
    </button>
  );
}

/* ── Auth modal: real login / registration before entering a portal ── */
function AuthModal({ portal, onClose, onAuthed }) {
  const { loginSuccess } = useStore();
  const isOwner = portal === 'owner';
  const accent = isOwner ? '#6366f1' : '#00c875';

  const [mode, setMode]             = useState('login'); // 'login' | 'register'
  const [email, setEmail]           = useState('');
  const [password, setPassword]     = useState('');
  const [company, setCompany]       = useState('');
  const [companyCode, setCompanyCode] = useState('');
  const [busy, setBusy]             = useState(false);
  const [error, setError]           = useState('');

  const finish = useCallback((data) => {
    // Persist the JWT to all storage keys + Zustand so getAuthHeaders()
    // attaches it to every subsequent API call (tenant/role-scoped queries).
    applyAuth(data.token, data.tenant_id, data.role, loginSuccess);
    onAuthed();
  }, [loginSuccess, onAuthed]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const em = email.trim().toLowerCase();
    if (!em) { setError('Please enter your email.'); return; }
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return; }
    setBusy(true);
    try {
      if (mode === 'login') {
        const data = await loginAuth(em, password);
        finish(data);
      } else {
        const extra = isOwner
          ? { company: company.trim(), role: 'client' }
          : { role: 'worker', company_code: companyCode.trim() || undefined };
        try {
          const data = await registerAuth(em, password, extra);
          finish(data);
        } catch (err) {
          // Already registered → silently fall back to login with same credentials.
          if ((err?.message || '').toLowerCase().includes('already')) {
            const data = await loginAuth(em, password);
            finish(data);
          } else {
            throw err;
          }
        }
      }
    } catch (err) {
      const msg = err?.message || '';
      if (msg.includes('Invalid') || msg.includes('401')) {
        setError('Incorrect email or password.');
      } else if (msg.includes('Company code not found')) {
        setError('Company code not found — ask your manager for the correct code.');
      } else {
        setError(msg || 'Something went wrong. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleDemo = async () => {
    setBusy(true);
    setError('');
    try {
      const data = await getDemoAuthToken('default');
      applyAuth(data.token, data.tenant_id || 'default', data.role || 'admin', loginSuccess);
      onAuthed();
    } catch {
      setError('Demo unavailable — the server may be starting up. Try again shortly.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="wc-auth-overlay" onClick={onClose}>
      <div
        className="wc-auth-panel"
        style={{ '--accent': accent }}
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="wc-auth-close" onClick={onClose} aria-label="Close">×</button>

        <div className="wc-auth-icon">{isOwner ? '👑' : '⚡'}</div>
        <h3 className="wc-auth-title">
          {isOwner ? 'Owner Portal' : 'Field Team'}
        </h3>
        <p className="wc-auth-sub">
          {mode === 'login' ? 'Sign in to continue' : (
            isOwner
              ? 'Create your company workspace'
              : 'Join your team with the company code'
          )}
        </p>

        <div className="wc-auth-tabs">
          <button
            type="button"
            className={`wc-auth-tab ${mode === 'login' ? 'wc-auth-tab--active' : ''}`}
            onClick={() => { setMode('login'); setError(''); }}
          >
            Sign In
          </button>
          <button
            type="button"
            className={`wc-auth-tab ${mode === 'register' ? 'wc-auth-tab--active' : ''}`}
            onClick={() => { setMode('register'); setError(''); }}
          >
            Create Account
          </button>
        </div>

        <form onSubmit={handleSubmit} className="wc-auth-form">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            className="wc-auth-input"
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            className="wc-auth-input"
          />
          {mode === 'register' && isOwner && (
            <input
              type="text"
              placeholder="Company / hotel name"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              className="wc-auth-input"
            />
          )}
          {mode === 'register' && !isOwner && (
            <input
              type="text"
              placeholder="Company code (from your manager — optional)"
              value={companyCode}
              onChange={(e) => setCompanyCode(e.target.value)}
              className="wc-auth-input"
            />
          )}

          {error && <p className="wc-auth-error">{error}</p>}

          <button type="submit" className="wc-auth-submit" disabled={busy}>
            {busy ? '...' : (mode === 'login' ? 'Sign In →' : 'Create & Enter →')}
          </button>
        </form>

        <button type="button" className="wc-auth-demo" onClick={handleDemo} disabled={busy}>
          Try the live demo instead
        </button>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   Welcome — main export
   ══════════════════════════════════════════════════════════════ */
export default function Welcome({ onSelectOwner, onSelectField }) {
  const [ready, setReady] = useState(false);
  const [authPortal, setAuthPortal] = useState(null); // null | 'owner' | 'field'
  useEffect(() => { const t = setTimeout(() => setReady(true), 80); return () => clearTimeout(t); }, []);

  const proceed = useCallback((portal) => {
    if (portal === 'field') onSelectField();
    else onSelectOwner();
  }, [onSelectOwner, onSelectField]);

  /** Card click: pass through with a valid JWT, otherwise open the real auth flow.
      Works the same locally and on Railway — the only difference is that with
      AUTH_DISABLED=true the backend also accepts unauthenticated calls. */
  const handlePortalClick = useCallback((portal) => {
    if (hasValidAuthToken()) {
      proceed(portal);
      return;
    }
    setAuthPortal(portal);
  }, [proceed]);

  return (
    <div className={`wc-root ${ready ? 'wc-root--ready' : ''}`}>
      <ParticleCanvas />

      {/* ── Brand header ─────────────────────────────────────── */}
      <header className="wc-header">
        <div className="wc-logo">
          <span className="wc-logo-icon">🏨</span>
          <span className="wc-logo-name">EasyHost</span>
          <span className="wc-logo-tag">OS</span>
        </div>
        <div className="wc-live-badge">
          <span className="wc-live-dot" />
          LIVE
        </div>
      </header>

      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="wc-hero">
        <div className="wc-hero-eyebrow">Powered by Maya AI</div>
        <h1 className="wc-hero-title">
          Welcome to your<br />
          <span className="wc-hero-accent">Mission Control</span>
        </h1>
        <p className="wc-hero-sub">
          Choose your access portal to begin
        </p>
      </section>

      {/* ── Cards ────────────────────────────────────────────── */}
      <main className="wc-cards" id="main-content">
        <PortalCard
          accent="#6366f1"
          icon="👑"
          eyebrow="OWNER ACCESS"
          title="Manager Dashboard"
          subtitle="Full analytics, team performance, and real-time operations overview"
          features={[
            'KPI Cards — Revenue, Readiness, MVP',
            'Live Operations Feed',
            "Maya's Daily AI Briefing",
            'Task & Property Management',
          ]}
          cta="Enter Owner Portal"
          onClick={() => handlePortalClick('owner')}
          delay="0.1s"
        />

        <div className="wc-or-divider" aria-hidden="true">OR</div>

        <PortalCard
          accent="#00c875"
          icon="⚡"
          eyebrow="FIELD TEAM"
          title="Quest Map"
          subtitle="Your gamified mission hub — level up, earn XP, dominate the property"
          features={[
            'Mission Feed — TikTok-style cards',
            'XP & Level Progression System',
            'Energy Bar & Mystery Rewards',
            "Maya's Smart Briefing on return",
          ]}
          cta="Start My Mission"
          onClick={() => handlePortalClick('field')}
          delay="0.22s"
        />
      </main>

      {/* ── Auth modal (login / register before entering a portal) ── */}
      {authPortal && (
        <AuthModal
          portal={authPortal}
          onClose={() => setAuthPortal(null)}
          onAuthed={() => {
            const portal = authPortal;
            setAuthPortal(null);
            proceed(portal);
          }}
        />
      )}

      {/* ── Footer ───────────────────────────────────────────── */}
      <footer className="wc-footer">
        <div className="wc-footer-inner">
          <span className="wc-footer-logo">✦ Powered by</span>
          <span className="wc-footer-brand">Maya AI</span>
          <span className="wc-footer-sep">·</span>
          <span className="wc-footer-tagline">Hospitality on Autopilot</span>
        </div>
        <div className="wc-footer-bar" />
      </footer>
    </div>
  );
}
