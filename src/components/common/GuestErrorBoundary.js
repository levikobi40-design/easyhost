import React from 'react';

class GuestErrorBoundary extends React.Component {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error('[GuestApp] Error boundary caught:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="guest-error-boundary" dir="rtl">
          <div className="guest-error-card">
            <p className="guest-error-text">משהו השתבש</p>
            <button
              type="button"
              onClick={() => this.setState({ hasError: false })}
              className="guest-error-btn"
            >
              נסה שוב
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default GuestErrorBoundary;
