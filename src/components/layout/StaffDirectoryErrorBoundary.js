import React from 'react';

/** Catches errors in StaffDirectory to prevent _s is not a function / translation crashes from breaking the sidebar */
class StaffDirectoryErrorBoundary extends React.Component {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.warn('[StaffDirectory] Error boundary caught:', error?.message, info);
  }

  render() {
    if (this.state.hasError) {
      return null;
    }
    return this.props.children;
  }
}

export default StaffDirectoryErrorBoundary;
