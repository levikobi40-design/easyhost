/**
 * Emergency task seed when GET /property-tasks or /tasks is empty or 404.
 * 20 rows — aligns with backend `_default_property_tasks_seed` (Bazaar + ROOMS only).
 */
const now = () => new Date().toISOString();

const ACTIONS = [
  { label: 'ראיתי ✅', value: 'seen' },
  { label: 'בוצע 🏁', value: 'done' },
];

function row(id, propertyId, propertyName, title, status, staff) {
  return {
    id,
    property_id: propertyId,
    property_name: propertyName,
    title,
    room_id: propertyId,
    room: propertyName,
    room_number: propertyName,
    task_type: title,
    description: title,
    status,
    created_at: now(),
    staff_name: staff,
    worker_name: staff,
    staff_phone: '',
    assigned_to: '',
    property_context: propertyName.includes('Bazaar') ? '2 Guests, 1 Bedroom, 1 Bed' : '1 Guests, 0 Bedroom, 0 Bed',
    photo_url: '',
    actions: ACTIONS.map((a) => ({ ...a })),
  };
}

export const initialTasks = [
  row('seed-pt-bazaar-1', 'bazaar-jaffa-hotel', 'Hotel Bazaar Jaffa', "ניקיון חדר אחרי צ'ק-אאוט — 201", 'Pending', 'עלמה'),
  row('seed-pt-rooms-1', 'rooms-branch-sky-tower', 'ROOMS Sky Tower', 'ניקיון אזור Hot Desks אחרי אירוע', 'Pending', 'מנהל קהילה'),
  row('seed-pt-rooms-2', 'rooms-branch-acro-tlv', 'ROOMS Acro', "ניקיון חדר ישיבות לפני צ'ק-אאוט אורח", 'Pending', 'מנהל קהילה'),
  row('seed-pt-rooms-3', 'rooms-branch-beit-rubinstein', 'ROOMS Beit Rubinstein', "צ'ק-אאוט סוויטה — בדיקת מלאי", 'Pending', 'מנהל קהילה'),
  row('seed-pt-rooms-4', 'rooms-branch-neve-tzedek', 'ROOMS Neve Tzedek', 'ניקיון מטבחון ומקרר משותף', 'Pending', 'מנהל קהילה'),
  row('seed-pt-rooms-5', 'rooms-branch-bbc', 'ROOMS BBC', "ניקיון מסדרון אחרי צ'ק-אאוט חברה", 'In_Progress', 'עלמה'),
  row('seed-pt-bazaar-2', 'bazaar-jaffa-hotel', 'Hotel Bazaar Jaffa', 'מגבות ומצעים — ריענון לפני כניסה', 'Pending', 'עלמה'),
  row('seed-pt-rooms-6', 'rooms-branch-acro-raanana', 'ROOMS Acro Ra\'anana', "ניקיון אחרי אירוע קהילה + צ'ק-אאוט", 'Pending', 'מנהל קהילה'),
  row('seed-pt-rooms-7', 'rooms-branch-millennium-raanana', 'ROOMS Millennium', 'ניקיון שולחנות בקומת קוורקינג', 'Pending', 'מנהל קהילה'),
  row('seed-pt-rooms-8', 'rooms-branch-modiin', 'ROOMS Modi\'in', "הכנת חדר ישיבות לצ'ק-אאוט — 14:00", 'In_Progress', 'עלמה'),
  row('seed-pt-rooms-9', 'rooms-branch-bsr-city', 'ROOMS BSR City', 'ניקיון שירותים ציבוריים — קומה 3', 'Pending', 'עלמה'),
  row('seed-pt-rooms-10', 'rooms-branch-herzliya', 'ROOMS Herzliya', 'ניקיון חלונות ויתדות אחרי גשם', 'Pending', 'מנהל קהילה'),
  row('seed-pt-rooms-11', 'rooms-branch-haifa', 'ROOMS Haifa', "צ'ק-אאוט משרד — ניקיון וסימון מלאי", 'Pending', 'קובי'),
  row('seed-pt-rooms-12', 'rooms-branch-jerusalem', 'ROOMS Jerusalem', 'ניקיון שטיחים וספות במרחב משותף', 'Pending', 'עלמה'),
  row('seed-pt-rooms-13', 'rooms-branch-beer-sheva', 'ROOMS Beersheva', "תחזוקת מעלית — לפני סיבוב צ'ק-אאוטים", 'In_Progress', 'קובי'),
  row('seed-pt-bazaar-3', 'bazaar-jaffa-hotel', 'Hotel Bazaar Jaffa', "ניקיון לובי — הכנה לקבוצת צ'ק-אאוט", 'Pending', 'עלמה'),
  row('seed-pt-rooms-14', 'rooms-branch-eilat', 'ROOMS Eilat', "ניקיון חדר ישיבות — אחרי צ'ק-אאוט שעתי", 'Pending', 'מנהל קהילה'),
  row('seed-pt-bazaar-4', 'bazaar-jaffa-hotel', 'Hotel Bazaar Jaffa', "ניקיון חדר — חולצ' צ'ק-אאוט 11:00", 'In_Progress', 'עלמה'),
  row('seed-pt-rooms-15', 'rooms-branch-sky-tower', 'ROOMS Sky Tower', 'בדיקת מזגנים לפני אירוע VIP', 'Pending', 'קובי'),
  row('seed-pt-rooms-16', 'rooms-branch-acro-tlv', 'ROOMS Acro', 'סבב ניקיון ערב — הכנת חלל לאירוח', 'Pending', 'מנהל קהילה'),
];

/**
 * Worker portal: tasks assigned to this worker (case-insensitive), or full demo set if none match.
 * @param {string} workerName
 */
export function getInitialTasksForWorker(workerName) {
  const w = String(workerName || '').trim().toLowerCase();
  if (!w) return initialTasks.map((t) => ({ ...t }));
  const matched = initialTasks.filter(
    (t) => String(t.staff_name || '').toLowerCase() === w
      || String(t.worker_name || '').toLowerCase() === w
      || String(t.assigned_to || '').toLowerCase() === w,
  );
  return (matched.length ? matched : initialTasks).map((t) => ({ ...t }));
}
