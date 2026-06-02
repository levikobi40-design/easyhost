/** Mission board tasks — alias of useMission for clarity. */
import { useMission } from '../context/MissionContext';

export function useTasks() {
  return useMission();
}
