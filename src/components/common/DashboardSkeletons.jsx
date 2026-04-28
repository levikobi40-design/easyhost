import React from 'react';
import './DashboardSkeletons.css';

/** Mission board / task grid — layout visible immediately while GET /api/tasks runs. */
export function TaskBoardSkeleton({ rows = 6 }) {
  return (
    <div className="eh-skel-task-board" aria-busy="true" aria-label="Loading tasks">
      <div className="eh-skel-toolbar">
        <span className="eh-skel-pill eh-skel-shimmer" />
        <span className="eh-skel-pill eh-skel-shimmer" />
        <span className="eh-skel-pill eh-skel-shimmer" />
      </div>
      <div className="eh-skel-grid">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="eh-skel-card eh-skel-shimmer">
            <div className="eh-skel-card-top">
              <span className="eh-skel-dot" />
              <span className="eh-skel-line eh-skel-line--title" />
            </div>
            <span className="eh-skel-line eh-skel-line--muted" />
            <span className="eh-skel-line eh-skel-line--short" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Property cards grid — matches dashboard grid density. */
export function PropertyGridSkeleton({ cards = 8 }) {
  return (
    <div className="eh-skel-props" aria-busy="true" aria-label="Loading properties">
      <div className="properties-grid">
        {Array.from({ length: cards }).map((_, i) => (
          <div key={i} className="eh-skel-prop-card eh-skel-shimmer">
            <div className="eh-skel-prop-img" />
            <div className="eh-skel-prop-body">
              <span className="eh-skel-line eh-skel-line--title" />
              <span className="eh-skel-line eh-skel-line--muted" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
