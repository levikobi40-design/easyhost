import React from 'react';

/** XP within current level: 0–99 progress toward next level (every 100 XP = level up). */
export default function XpProgressBar({ xp, level, variant = 'dark' }) {
  const into = xp % 100;
  const pct = Math.min(100, Math.max(0, into));
  const light = variant === 'light';

  const label = light ? '#222222' : 'rgba(255,255,255,0.9)';
  const sub = light ? '#717171' : 'rgba(255,255,255,0.45)';
  const track = light ? '#ebebeb' : 'rgba(255,255,255,0.1)';
  const trackBorder = light ? '#dddddd' : 'rgba(255,255,255,0.12)';

  return (
    <div style={{ marginTop: light ? 0 : 8 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: 6,
        }}
      >
        <span style={{ color: label, fontWeight: 800, fontSize: 12 }}>
          שלב {level}
        </span>
        <span style={{ color: sub, fontWeight: 700, fontSize: 11 }}>
          {into} / 100 נק׳
        </span>
      </div>
      <div
        style={{
          height: 10,
          borderRadius: 999,
          background: track,
          overflow: 'hidden',
          border: `1px solid ${trackBorder}`,
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            borderRadius: 999,
            background: 'linear-gradient(90deg,#FF5A5F,#00A699,#ffb400)',
            transition: 'width 0.45s cubic-bezier(0.22,1,0.36,1)',
          }}
        />
      </div>
    </div>
  );
}
