import React, { useEffect } from 'react';

/**
 * Full-screen light overlay for task / level-up moments.
 * `kind`: 'task' | 'level'
 */
export default function CelebrationOverlay({ kind, onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stable close from parent
  }, [kind]);

  if (!kind) return null;

  const title = kind === 'level' ? 'Level Up!' : 'Task Completed';
  const sub = kind === 'level' ? 'עברת שלב — כל הכבוד!' : 'נקודות נוספו';

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 400,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.45)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        animation: 'wvFadeIn 0.35s ease',
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          textAlign: 'center',
          padding: '28px 36px',
          borderRadius: 24,
          background: 'linear-gradient(145deg, rgba(37,211,102,0.35), rgba(7,94,84,0.55))',
          border: '1px solid rgba(255,255,255,0.25)',
          boxShadow: '0 20px 60px rgba(37,211,102,0.35)',
        }}
      >
        <div style={{ fontSize: 52, lineHeight: 1, marginBottom: 8 }}>
          {kind === 'level' ? '⭐' : '✅'}
        </div>
        <div style={{ color: '#fff', fontWeight: 900, fontSize: 22, letterSpacing: '0.02em' }}>
          {title}
        </div>
        <div style={{ color: 'rgba(255,255,255,0.85)', fontSize: 14, marginTop: 6, fontWeight: 600 }}>
          {sub}
        </div>
      </div>
    </div>
  );
}
