import React, { useEffect, useRef, useState } from 'react';
import './Welcome.css';

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

/* ══════════════════════════════════════════════════════════════
   Welcome — main export
   ══════════════════════════════════════════════════════════════ */
export default function Welcome({ onSelectOwner, onSelectField }) {
  const [ready, setReady] = useState(false);
  useEffect(() => { const t = setTimeout(() => setReady(true), 80); return () => clearTimeout(t); }, []);

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
          onClick={onSelectOwner}
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
          onClick={onSelectField}
          delay="0.22s"
        />
      </main>

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
