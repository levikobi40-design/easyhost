/** No client-side task seed — tasks come from GET /property-tasks only. */
export const initialTasks = [];

export function getInitialTasksForWorker(_workerName) {
  return [];
}
