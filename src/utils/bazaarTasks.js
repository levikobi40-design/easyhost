/** Legacy demo tasks (room numbers) to hide for Hotel Bazaar Jaffa pilot. */
export function isLegacyMockHotelTask(task) {
  if (!task) return false;
  const blob = `${task.property_name || ''} ${task.description || ''} ${task.property_id || ''}`.toLowerCase();
  const hasOldRoom = /\b(333|119|408)\b/.test(blob) || /חדר\s*(333|119|408)\b/i.test(blob);
  const bazaar = /בזאר|bazaar|jaffa|יפו|hotel bazaar/.test(blob);
  return hasOldRoom && !bazaar;
}
