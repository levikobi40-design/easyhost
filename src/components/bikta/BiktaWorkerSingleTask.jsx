import React from 'react';
import { Mic, Loader2 } from 'lucide-react';
import './BiktaWorkerSingleTask.css';

/**
 * Single large card: hotel image, huge room number, one task line.
 * Bottom bar: mic (Maya) + primary advance (same as matrix tap).
 */
export default function BiktaWorkerSingleTask({
  room,
  photoUrl,
  phase,
  isRed,
  isOrange,
  taskLine,
  completeLabel,
  onComplete,
  completeDisabled,
  onMic,
  micAriaLabel,
  emptyTitle,
  emptySubtitle,
}) {
  const isEmpty = !room;
  const idx = room?.room_index ?? '—';
  const name = room?.name || '';

  return (
    <div className="bikta-wst">
      <div className={`bikta-wst-card${isEmpty ? ' bikta-wst-card--empty' : ''}`}>
        {!isEmpty ? (
          <div
            className="bikta-wst-hero"
            style={{ backgroundImage: `url(${photoUrl})` }}
            aria-hidden
          />
        ) : (
          <div className="bikta-wst-hero bikta-wst-hero--empty" aria-hidden />
        )}
        <div className="bikta-wst-body">
          {isEmpty ? (
            <>
              <p className="bikta-wst-task bikta-wst-task--empty">{emptyTitle}</p>
              {emptySubtitle ? <p className="bikta-wst-room-name bikta-wst-empty-sub">{emptySubtitle}</p> : null}
            </>
          ) : (
            <>
              <div className={`bikta-wst-state ${isRed ? 'is-red' : ''} ${isOrange ? 'is-orange' : ''}`}>
                {isRed ? '●' : isOrange ? '●' : '●'}
              </div>
              <div className="bikta-wst-room-num" aria-live="polite">
                {idx}
              </div>
              {name ? <div className="bikta-wst-room-name">{name}</div> : null}
              <p className="bikta-wst-task">{taskLine}</p>
            </>
          )}
        </div>
      </div>

      <div className="bikta-wst-bar" role="toolbar">
        <button
          type="button"
          className="bikta-wst-mic"
          onClick={onMic}
          aria-label={micAriaLabel}
        >
          <Mic size={22} strokeWidth={2} aria-hidden />
        </button>
        <button
          type="button"
          className="bikta-wst-complete"
          onClick={onComplete}
          disabled={completeDisabled}
        >
          {completeDisabled ? (
            <Loader2 size={22} className="bikta-wst-spin" aria-hidden />
          ) : (
            completeLabel
          )}
        </button>
      </div>
    </div>
  );
}
