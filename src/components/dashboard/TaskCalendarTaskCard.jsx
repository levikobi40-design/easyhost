import React, { memo } from 'react';
import { Phone, MessageCircle, Building2 } from 'lucide-react';
import { toWhatsAppPhone, getTaskWhatsAppPhone } from '../../utils/phone';
import { formatHebrewDate, taskTypeLabelHe } from '../../utils/hebrewFormat';
import {
  missionTaskIsDone as isDone,
  missionTaskIsInProgress as isInProgress,
  missionTaskIsSeen as isSeen,
  missionTaskIsDelayed as isDelayed,
  missionTaskIsUnacked as isUnacked,
  missionTaskIsEscalated as isEscalated,
  missionTaskIsSearchingStaff as isSearchingStaff,
  missionTaskIsCheckinSoonPinned as isCheckinSoonPinned,
  missionTaskIsTowelCleaning as isTowelCleaningTask,
} from '../../utils/taskCalendarStatus';
import { taskCalendarSafeStr as safeStr, getTaskCalendarWhatsAppMessage as getWhatsAppMessage } from '../../utils/taskCalendarWhatsApp';

function TaskCalendarTaskCardInner({
  task,
  properties,
  highlightedTaskId,
  setLastSelectedTask,
  setLightboxUrl,
  cleanerLoading,
  openPropertyCleanerWhatsApp,
  handleUndoMarkDone,
  handleToggleStatus,
  togglingId,
  undoOffer,
}) {
  const t = task;
  const formatDate = (str) => formatHebrewDate(str, { includeTime: true });

  return (
    <div className="task-calendar-grid-cell">
      <div
        className={[
          'task-card',
          isDone(t) ? 'task-done'
            : isDelayed(t) ? 'task-delayed'
            : isInProgress(t) ? 'task-in-progress'
            : isSeen(t) ? 'task-seen'
            : isUnacked(t) ? 'task-unack'
            : isEscalated(t) ? 'task-escalated'
            : 'task-pending',
          highlightedTaskId === t.id ? 'task-card-pop' : '',
          isCheckinSoonPinned(t) ? 'task-pinned-checkin' : '',
        ].filter(Boolean).join(' ')}
        onClick={() => setLastSelectedTask(t)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && setLastSelectedTask(t)}
      >
        <div className="task-card-thumb">
          <div className="task-card-thumb-fallback" aria-hidden>
            <Building2 size={32} />
          </div>
          {(() => {
            const prop = t.property_id ? properties.find((p) => p.id === t.property_id) : null;
            const thumbUrl = (t.property_pictures && t.property_pictures[0])
              || (prop?.pictures && prop.pictures[0])
              || prop?.photo_url
              || t.photo_url;
            return thumbUrl ? (
              <img
                src={thumbUrl}
                alt={safeStr(t.property_name ?? t.propertyName) || 'נכס'}
                className="task-card-thumb-img"
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
              />
            ) : null;
          })()}
        </div>
        <div className="task-card-header">
          <span className={`task-status-badge ${
            isDone(t) ? 'done'
              : isDelayed(t) ? 'delayed'
              : isInProgress(t) ? 'in_progress'
              : isSeen(t) ? 'seen'
              : isSearchingStaff(t) ? 'searching'
              : isEscalated(t) ? 'escalated'
              : isUnacked(t) ? 'unack'
              : 'pending'
          }`}>
            {isDone(t) ? 'הושלם ✅'
              : isDelayed(t) ? 'באיחור ⏱️'
              : isInProgress(t) ? 'בטיפול ⚙️'
              : isSeen(t) ? 'אושר 👀'
              : isSearchingStaff(t) ? 'מחפשת צוות'
              : isEscalated(t) ? '🚨 הוסלם'
              : isUnacked(t) ? '⏰ ממתין לאישור'
              : 'ממתין'}
          </span>
          <span className="task-date">{formatDate(t.created_at)}</span>
        </div>
        {isCheckinSoonPinned(t) && (
          <div className="task-pin-banner" role="status">
            צ&apos;ק-אין בפחות מ-4 שעות — עדיפות עליונה
          </div>
        )}
        {isUnacked(t) && (
          <div className="task-unack-warning">
            ⚠️ לא אושר — מאיה תשלח תזכורת בקרוב
          </div>
        )}
        {isEscalated(t) && (
          <div className="task-escalated-notice">
            🔁 הועבר ל: {t.escalated_to || 'עובד אחר'}
          </div>
        )}
        <p className="task-description">{safeStr(t.description) || safeStr(t.title) || safeStr(t.content) || ''}</p>
        {t.task_type && (
          <p className="text-xs text-slate-500 font-semibold mt-1">{taskTypeLabelHe(t.task_type)}</p>
        )}
        {safeStr(t.property_context) && (
          <p className="text-xs text-gray-500 mt-0.5">{safeStr(t.property_context)}</p>
        )}
        {t.photo_url && (
          <button
            type="button"
            className="task-photo-link"
            onClick={(e) => { e.stopPropagation(); setLightboxUrl(t.photo_url); }}
            aria-label="צפה בתמונת המשימה"
            title="לחץ להגדלה"
          >
            <img
              src={t.photo_url}
              alt="תמונת משימה"
              className="task-photo-thumb"
              onError={(e) => { e.currentTarget.closest('.task-photo-link').style.display = 'none'; }}
            />
            <span className="task-photo-expand">🔍</span>
          </button>
        )}
        <div className="task-meta">
          {(t.property_name ?? t.propertyName) && (
            <div className="task-meta-row">
              <span className="task-meta-icon" aria-hidden>🏠</span>
              <span>{safeStr(t.property_name ?? t.propertyName)}</span>
            </div>
          )}
          {(t.staff_name ?? t.staffName) && (
            <div className="task-meta-row flex items-center gap-2">
              <span className="task-meta-icon" aria-hidden>👤</span>
              <span>{safeStr(t.staff_name ?? t.staffName)}</span>
              {((t.staff_phone ?? t.staffPhone) || getTaskWhatsAppPhone(t)) && (
                <>
                  <a href={`tel:+${getTaskWhatsAppPhone(t) || toWhatsAppPhone(t.staff_phone ?? t.staffPhone)}`} className="task-phone-link" title="התקשר" onClick={(e) => e.stopPropagation()}>
                    <Phone size={14} />
                  </a>
                  <a
                    href={`https://wa.me/${getTaskWhatsAppPhone(t) || toWhatsAppPhone(t.staff_phone ?? t.staffPhone)}?text=${encodeURIComponent(getWhatsAppMessage(t))}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="task-whatsapp-btn"
                    title="שליחת וואטסאפ"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <MessageCircle size={22} />
                  </a>
                </>
              )}
            </div>
          )}
          {((t.staff_phone ?? t.staffPhone) || getTaskWhatsAppPhone(t)) && !(t.staff_name ?? t.staffName) && (
            <div className="task-meta-row task-phone">
              <Phone size={16} />
              <a href={`tel:${safeStr(t.staff_phone ?? t.staffPhone).replace(/\D/g, '')}`} className="task-phone-link" onClick={(e) => e.stopPropagation()}>{safeStr(t.staff_phone ?? t.staffPhone)}</a>
              <a href={`https://wa.me/${getTaskWhatsAppPhone(t) || toWhatsAppPhone(t.staff_phone ?? t.staffPhone)}?text=${encodeURIComponent(getWhatsAppMessage(t))}`} target="_blank" rel="noopener noreferrer" className="task-whatsapp-btn" title="שליחת וואטסאפ" onClick={(e) => e.stopPropagation()}>
                <MessageCircle size={22} />
              </a>
            </div>
          )}
        </div>
        {isTowelCleaningTask(t) && t.property_id && (
          <div className="task-cleaner-wa" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="task-cleaner-wa-btn"
              disabled={cleanerLoading[t.id]}
              onClick={(e) => openPropertyCleanerWhatsApp(t, e)}
            >
              <MessageCircle size={18} />
              {cleanerLoading[t.id] ? 'טוען…' : 'וואטסאפ לניקיון (לפי נכס)'}
            </button>
          </div>
        )}
        <div className="task-card-actions" onClick={(e) => e.stopPropagation()}>
          {isDone(t) && undoOffer?.taskId === t.id && (
            <button
              type="button"
              className="task-undo-btn"
              disabled={togglingId === t.id}
              onClick={(e) => {
                e.stopPropagation();
                handleUndoMarkDone();
              }}
            >
              בטל השלמה (5 שנ׳)
            </button>
          )}
          {!isDone(t) && (
            <>
              {(t.actions || [{ label: 'ראיתי ✅', value: 'confirmed' }, { label: 'בוצע 🏁', value: 'done' }])
                .filter(
                  (a) =>
                    (a.value === 'confirmed' && !isSeen(t) && !isInProgress(t)) || a.value === 'done',
                )
                .map((a) => {
                  const status = a.value === 'confirmed' ? 'In_Progress' : 'Done';
                  const isConfirm = a.value === 'confirmed';
                  return (
                    <button
                      key={a.value}
                      type="button"
                      disabled={togglingId === t.id}
                      onClick={() => handleToggleStatus(t.id, status, t)}
                      className={`task-action-btn ${isConfirm ? 'task-action-seen' : 'task-action-done'} ${togglingId === t.id ? 'loading' : ''}`}
                      title={isConfirm ? 'אישור קבלה' : 'סמן כהושלם'}
                    >
                      {togglingId === t.id ? <span className="task-toggle-spinner" /> : a.label}
                    </button>
                  );
                })}
            </>
          )}
          {isDone(t) && (
            <button
              type="button"
              disabled={togglingId === t.id}
              onClick={() => handleToggleStatus(t.id, 'Pending', t)}
              className={`task-action-btn task-action-revert ${togglingId === t.id ? 'loading' : ''}`}
              title="חזרה לממתין"
            >
              {togglingId === t.id ? <span className="task-toggle-spinner" /> : 'חזרה לממתין'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function areTaskCardPropsEqual(prev, next) {
  if (prev.task !== next.task) {
    if (prev.task?.id !== next.task?.id) return false;
    if (prev.task?.status !== next.task?.status) return false;
    if (prev.task?.delayed !== next.task?.delayed) return false;
    if (prev.task?.escalation_status !== next.task?.escalation_status) return false;
    if (prev.task?.due_at !== next.task?.due_at) return false;
    if (prev.task?.ack_deadline !== next.task?.ack_deadline) return false;
  }
  if (prev.highlightedTaskId !== next.highlightedTaskId) return false;
  if (prev.togglingId !== next.togglingId) return false;
  if (prev.undoOffer?.taskId !== next.undoOffer?.taskId) return false;
  if (!!prev.cleanerLoading?.[prev.task?.id] !== !!next.cleanerLoading?.[next.task?.id]) return false;
  if (prev.properties !== next.properties) return false;
  return (
    prev.setLastSelectedTask === next.setLastSelectedTask
    && prev.setLightboxUrl === next.setLightboxUrl
    && prev.openPropertyCleanerWhatsApp === next.openPropertyCleanerWhatsApp
    && prev.handleUndoMarkDone === next.handleUndoMarkDone
    && prev.handleToggleStatus === next.handleToggleStatus
  );
}

const TaskCalendarTaskCard = memo(TaskCalendarTaskCardInner, areTaskCardPropsEqual);

export default TaskCalendarTaskCard;
