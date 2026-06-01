import React from 'react';
import MayaChat from '../maya/MayaChat';
import { useMission } from '../../context/MissionContext';

/**
 * Main Maya chat surface. Mission Board task list refreshes immediately after each
 * successful sendMessage round-trip (same tab), in addition to taskSyncBridge cross-tab.
 */
export default function Chat() {
  const { quietSyncTasks, prependTask } = useMission();

  return (
    <MayaChat
      onAfterSendSuccess={(result) => {
        const t = result?.task || result?.task_data;
        if (t?.id) prependTask(t);
        if (Array.isArray(result?.tasks) && result.tasks[0]?.id) {
          prependTask(result.tasks[0]);
        }
        quietSyncTasks();
      }}
    />
  );
}
