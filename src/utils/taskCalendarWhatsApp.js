/** Always return a string for rendering — prevents [object Object] crash */
export function taskCalendarSafeStr(val, fallback = '') {
  if (val == null) return fallback;
  if (typeof val === 'string') return val;
  if (typeof val === 'object') return taskCalendarSafeStr(val.content ?? val.title ?? val.text, fallback);
  return String(val);
}

/** Build WhatsApp message by staff (TaskCalendar). */
export function getTaskCalendarWhatsAppMessage(t) {
  const content = taskCalendarSafeStr(t.description ?? t.title ?? t.content).slice(0, 120);
  const property = taskCalendarSafeStr(t.property_name ?? t.propertyName);
  const staff = ((t.staff_name ?? t.staffName) || '').toString().toLowerCase();
  if (staff.includes('alma') || staff.includes('עלמה')) {
    const roomMatch = content.match(/חדר\s*(\d+)|room\s*(\d+)|(\d+)/i) || [];
    const room = roomMatch[1] || roomMatch[2] || roomMatch[3] || '—';
    const propName = property || 'הנכס';
    return `היי עלמה, יש בקשה חדשה מחדר ${room} בנכס ${propName}. אנא טפלי בהקדם!`;
  }
  if (staff.includes('kobi') || staff.includes('קובי')) {
    return property ? `היי קובי, יש לך משימה: ${content} ב${property}` : `היי קובי, יש לך משימה: ${content}`;
  }
  if (staff.includes('avi') || staff.includes('אבי')) {
    return property ? `היי אבי, יש לך משימה: ${content} ב${property}` : `היי אבי, יש לך משימה: ${content}`;
  }
  return `היי ${taskCalendarSafeStr(t.staff_name ?? t.staffName) || 'שם'}, יש לך משימה: ${content}`;
}
