import React, { memo } from 'react';
import { Phone, MessageCircle, Building2 } from 'lucide-react';
import { toWhatsAppPhone, getTaskWhatsAppPhone } from '../../utils/phone';
import {
  translateTaskDescription,
  translatePropertyName,
  translateTaskType,
  formatTaskDate,
} from '../../utils/taskDisplayI18n';
import useTranslations from '../../hooks/useTranslations';
import useStore from '../../store/useStore';
import { isRtlLang } from '../../utils/languages';
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

function statusLabel(t, task) {
  if (isDone(task)) return t('taskCalendar.status.done');
  if (isDelayed(task)) return t('taskCalendar.status.delayed');
  if (isInProgress(task)) return t('taskCalendar.status.inProgress');
  if (isSeen(task)) return t('taskCalendar.status.seen');
  if (isSearchingStaff(task)) return t('taskCalendar.status.searching');
  if (isEscalated(task)) return t('taskCalendar.status.escalated');
  if (isUnacked(task)) return t('taskCalendar.status.unack');
  return t('taskCalendar.status.pending');
}

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
  const { t } = useTranslations();
  const lang = useStore((s) => s.lang) || 'en';
  const dir = isRtlLang(lang) ? 'rtl' : 'ltr';
  const row = task;
  const formatDate = (str) => formatTaskDate(str, lang, { includeTime: true });
  const desc = translateTaskDescription(row);
  if (typeof console !== 'undefined' && console.debug) {
    console.debug('[TaskCard] rendered title/description', {
      id: row.id,
      title: row.title,
      description: desc,
    });
  }
  const propLabel = translatePropertyName(row.property_id, row.property_name || row.propertyName);
  const roomRaw = safeStr(row.room_number || row.room);
  const staffFallback = t('taskCalendar.otherStaff');

  return (
    <div className="task-calendar-grid-cell">
      <div
        className={[
          'task-card',
          isDone(row) ? 'task-done'
            : isDelayed(row) ? 'task-delayed'
            : isInProgress(row) ? 'task-in-progress'
            : isSeen(row) ? 'task-seen'
            : isUnacked(row) ? 'task-unack'
            : isEscalated(row) ? 'task-escalated'
            : 'task-pending',
          highlightedTaskId === row.id ? 'task-card-pop' : '',
          isCheckinSoonPinned(row) ? 'task-pinned-checkin' : '',
        ].filter(Boolean).join(' ')}
        onClick={() => setLastSelectedTask(row)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && setLastSelectedTask(row)}
        dir={dir}
      >
        <div className="task-card-thumb">
          <div className="task-card-thumb-fallback" aria-hidden>
            <Building2 size={32} />
          </div>
          {(() => {
            const prop = row.property_id ? properties.find((p) => p.id === row.property_id) : null;
            const thumbUrl = (row.property_pictures && row.property_pictures[0])
              || (prop?.pictures && prop.pictures[0])
              || prop?.photo_url
              || row.photo_url;
            return thumbUrl ? (
              <img
                src={thumbUrl}
                alt={propLabel || t('taskCalendar.propertyAlt')}
                className="task-card-thumb-img"
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
              />
            ) : null;
          })()}
        </div>
        <div className="task-card-header">
          <span className={`task-status-badge ${
            isDone(row) ? 'done'
              : isDelayed(row) ? 'delayed'
              : isInProgress(row) ? 'in_progress'
              : isSeen(row) ? 'seen'
              : isSearchingStaff(row) ? 'searching'
              : isEscalated(row) ? 'escalated'
              : isUnacked(row) ? 'unack'
              : 'pending'
          }`}>
            {statusLabel(t, row)}
          </span>
          <span className="task-date">{formatDate(row.created_at)}</span>
        </div>
        {isCheckinSoonPinned(row) && (
          <div className="task-pin-banner" role="status">
            {t('taskCalendar.pinCheckin')}
          </div>
        )}
        {isUnacked(row) && (
          <div className="task-unack-warning">
            {t('taskCalendar.unackWarning')}
          </div>
        )}
        {isEscalated(row) && (
          <div className="task-escalated-notice">
            {t('taskCalendar.escalatedTo', { name: row.escalated_to || staffFallback })}
          </div>
        )}
        <p className="task-description">{desc}</p>
        {row.task_type && (
          <p className="text-xs text-slate-500 font-semibold mt-1">{translateTaskType(row.task_type)}</p>
        )}
        {safeStr(row.property_context) && (
          <p className="text-xs text-gray-500 mt-0.5">{safeStr(row.property_context)}</p>
        )}
        {row.photo_url && (
          <button
            type="button"
            className="task-photo-link"
            onClick={(e) => { e.stopPropagation(); setLightboxUrl(row.photo_url); }}
            aria-label={t('taskCalendar.viewPhoto')}
            title={t('taskCalendar.viewPhoto')}
          >
            <img
              src={row.photo_url}
              alt={t('taskCalendar.taskPhoto')}
              className="task-photo-thumb"
              onError={(e) => { e.currentTarget.closest('.task-photo-link').style.display = 'none'; }}
            />
            <span className="task-photo-expand">🔍</span>
          </button>
        )}
        <div className="task-meta">
          {propLabel && (
            <div className="task-meta-row">
              <span className="task-meta-icon" aria-hidden>🏠</span>
              <span>{propLabel}</span>
            </div>
          )}
          {roomRaw && (
            <div className="task-meta-row">
              <span className="task-meta-icon" aria-hidden>🚪</span>
              <span>{t('taskCalendar.roomLabel', { room: roomRaw })}</span>
            </div>
          )}
          {(row.staff_name || row.staffName) && (
            <div className="task-meta-row flex items-center gap-2">
              <span className="task-meta-icon" aria-hidden>👤</span>
              <span>{safeStr(row.staff_name || row.staffName)}</span>
              {((row.staff_phone || row.staffPhone) || getTaskWhatsAppPhone(row)) && (
                <>
                  <a href={`tel:+${getTaskWhatsAppPhone(row) || toWhatsAppPhone(row.staff_phone || row.staffPhone)}`} className="task-phone-link" title={t('taskCalendar.callStaff')} onClick={(e) => e.stopPropagation()}>
                    <Phone size={14} />
                  </a>
                  <a
                    href={`https://wa.me/${getTaskWhatsAppPhone(row) || toWhatsAppPhone(row.staff_phone || row.staffPhone)}?text=${encodeURIComponent(getWhatsAppMessage(row))}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="task-whatsapp-btn"
                    title={t('taskCalendar.whatsappStaff')}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <MessageCircle size={22} />
                  </a>
                </>
              )}
            </div>
          )}
          {((row.staff_phone || row.staffPhone) || getTaskWhatsAppPhone(row)) && !(row.staff_name || row.staffName) && (
            <div className="task-meta-row task-phone">
              <Phone size={16} />
              <a href={`tel:${safeStr(row.staff_phone || row.staffPhone).replace(/\D/g, '')}`} className="task-phone-link" onClick={(e) => e.stopPropagation()}>{safeStr(row.staff_phone || row.staffPhone)}</a>
              <a href={`https://wa.me/${getTaskWhatsAppPhone(row) || toWhatsAppPhone(row.staff_phone || row.staffPhone)}?text=${encodeURIComponent(getWhatsAppMessage(row))}`} target="_blank" rel="noopener noreferrer" className="task-whatsapp-btn" title={t('taskCalendar.whatsappStaff')} onClick={(e) => e.stopPropagation()}>
                <MessageCircle size={22} />
              </a>
            </div>
          )}
        </div>
        {isTowelCleaningTask(row) && row.property_id && (
          <div className="task-cleaner-wa" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="task-cleaner-wa-btn"
              disabled={cleanerLoading[row.id]}
              onClick={(e) => openPropertyCleanerWhatsApp(row, e)}
            >
              <MessageCircle size={18} />
              {cleanerLoading[row.id] ? t('taskCalendar.cleanerLoading') : t('taskCalendar.cleanerWa')}
            </button>
          </div>
        )}
        <div className="task-card-actions" onClick={(e) => e.stopPropagation()}>
          {isDone(row) && undoOffer?.taskId === row.id && (
            <button
              type="button"
              className="task-undo-btn"
              disabled={togglingId === row.id}
              onClick={(e) => {
                e.stopPropagation();
                handleUndoMarkDone();
              }}
            >
              {t('taskCalendar.undoDone')}
            </button>
          )}
          {!isDone(row) && (
            <>
              {(row.actions || [{ label: t('taskCalendar.confirmSeen'), value: 'confirmed' }, { label: t('taskCalendar.markDone'), value: 'done' }])
                .filter(
                  (a) =>
                    (a.value === 'confirmed' && !isSeen(row) && !isInProgress(row)) || a.value === 'done',
                )
                .map((a) => {
                  const status = a.value === 'confirmed' ? 'In_Progress' : 'Done';
                  const isConfirm = a.value === 'confirmed';
                  const label = isConfirm ? t('taskCalendar.confirmSeen') : t('taskCalendar.markDone');
                  return (
                    <button
                      key={a.value}
                      type="button"
                      disabled={togglingId === row.id}
                      onClick={() => handleToggleStatus(row.id, status, row)}
                      className={`task-action-btn ${isConfirm ? 'task-action-seen' : 'task-action-done'} ${togglingId === row.id ? 'loading' : ''}`}
                      title={isConfirm ? t('taskCalendar.confirmTitle') : t('taskCalendar.markDoneFull')}
                    >
                      {togglingId === row.id ? <span className="task-toggle-spinner" /> : label}
                    </button>
                  );
                })}
            </>
          )}
          {isDone(row) && (
            <button
              type="button"
              disabled={togglingId === row.id}
              onClick={() => handleToggleStatus(row.id, 'Pending', row)}
              className={`task-action-btn task-action-revert ${togglingId === row.id ? 'loading' : ''}`}
              title={t('taskCalendar.revertTitle')}
            >
              {togglingId === row.id ? <span className="task-toggle-spinner" /> : t('taskCalendar.revertPending')}
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
    if (prev.task?.description !== next.task?.description) return false;
    if (prev.task?.title !== next.task?.title) return false;
    if ((prev.task?.room_number || prev.task?.room) !== (next.task?.room_number || next.task?.room)) return false;
    if (prev.task?.property_name !== next.task?.property_name) return false;
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
