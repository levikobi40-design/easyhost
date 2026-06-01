import React from 'react';

export default class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { err: null };
  }

  static getDerivedStateFromError(err) {
    return { err };
  }

  componentDidCatch(err, info) {
    console.error('[AppErrorBoundary]', err, info?.componentStack);
  }

  render() {
    if (this.state.err) {
      return (
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
            fontFamily: 'system-ui, sans-serif',
            background: '#0f172a',
            color: '#e2e8f0',
          }}
        >
          <h1 style={{ fontSize: 18, marginBottom: 8, fontWeight: 700 }}>מאיה מתחברת מחדש…</h1>
          <p style={{ fontSize: 14, color: '#94a3b8', maxWidth: 480, textAlign: 'center', lineHeight: 1.5 }}>
            משהו השתבש בתצוגה. הנתונים האחרונים מהשרת נשמרו במטמון — רענון יחזיר את המסך.
          </p>
          <p
            style={{
              fontSize: 12,
              color: '#64748b',
              maxWidth: 480,
              textAlign: 'center',
              marginTop: 8,
              wordBreak: 'break-word',
            }}
          >
            {String(this.state.err?.message || this.state.err || '')}
          </p>
          <button
            type="button"
            style={{
              marginTop: 20,
              padding: '10px 20px',
              cursor: 'pointer',
              borderRadius: 999,
              border: '1px solid rgba(148, 163, 184, 0.35)',
              background: 'rgba(16, 185, 129, 0.15)',
              color: '#6ee7b7',
              fontWeight: 600,
            }}
            onClick={() => this.setState({ err: null })}
          >
            נסה שוב
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
