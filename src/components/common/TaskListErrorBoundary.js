import React from 'react';

class TaskListErrorBoundary extends React.Component {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error('[TaskList] Error boundary caught:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-6 bg-gray-900/50 dark:bg-gray-800/80 rounded-3xl border border-gray-700/50 text-center">
          <p className="text-gray-400 dark:text-gray-500 py-6">אין משימות כרגע</p>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false })}
            className="text-sm text-blue-400 hover:underline"
          >
            נסה שוב
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default TaskListErrorBoundary;
