import React from 'react';
import MayaChat from '../maya/MayaChat';
import { useMission } from '../../context/MissionContext';
import { ensureMayaTaskPersisted } from '../../utils/taskSyncBridge';

function extractTaskFromMayaResult(result) {
  if (!result || typeof result !== 'object') return null;
  return (
    result.task
    || result.task_data
    || (Array.isArray(result.tasks) ? result.tasks[0] : null)
    || result?.parsed?.task
    || null
  );
}

function looksLikeMayaCreatedTask(result, textOk) {
  if (!result) return false;
  return (
    Boolean(
      result.taskCreated
      || result.shiftCreated
      || result.action === 'add_task'
      || result.action === 'add_tasks'
      || result.task
      || result.tasks,
    )
    || /משימה\s*נוצרה|נוצרה\s*בהצלחה|task\s*created/i.test(textOk || '')
  );
}

/**
 * Main Maya chat surface. Mission Board task list refreshes immediately after each
 * successful sendMessage round-trip (same tab), in addition to taskSyncBridge cross-tab.
 */
export default function Chat() {
  const { quietSyncTasks } = useMission();

  return (
    <MayaChat
      onAfterSendSuccess={async (result) => {
        const textOk =
          typeof result?.message === 'string'
            ? result.message
            : typeof result?.displayMessage === 'string'
              ? result.displayMessage
              : '';
        let t = extractTaskFromMayaResult(result);
        if (t) {
          await ensureMayaTaskPersisted(t);
        } else if (looksLikeMayaCreatedTask(result, textOk) && !result?.taskCreated) {
          t = { description: textOk.slice(0, 240) || 'משימה חדשה', status: 'Pending' };
          await ensureMayaTaskPersisted(t);
        }
        quietSyncTasks();
      }}
    />
  );
}
