/**
 * Task + status display — single language per active locale (no mixed strings).
 */
import i18n from '../i18n';
import { normalizeLang, isRtlLang } from './languages';

const I18N_PREFIX = '@i18n:';
const CAPACITY_RE = /^(\d+)\s+Guests?,?\s+(\d+)\s+Bedrooms?,?\s+(\d+)\s+Beds?$/i;

const TASK_TYPE_ALIASES = {
  'ניקיון חדר': 'worker.taskTypes.cleaning',
  cleaning: 'worker.taskTypes.cleaning',
  'תחזוקה': 'worker.taskTypes.maintenance',
  maintenance: 'worker.taskTypes.maintenance',
  'שירות': 'worker.taskTypes.service',
  service: 'worker.taskTypes.service',
  "צ'ק-אין": 'worker.taskTypes.checkin',
  'check-in': 'worker.taskTypes.checkin',
  checkin: 'worker.taskTypes.checkin',
  'worker.taskTypes.cleaning': 'worker.taskTypes.cleaning',
  'worker.taskTypes.maintenance': 'worker.taskTypes.maintenance',
  'worker.taskTypes.service': 'worker.taskTypes.service',
  'worker.taskTypes.checkin': 'worker.taskTypes.checkin',
  'worker.tasks.deepClean': 'worker.tasks.deepClean',
  'worker.tasks.linenChange': 'worker.tasks.linenChange',
  'worker.tasks.maintenanceCheck': 'worker.tasks.maintenanceCheck',
  'worker.tasks.checkinPrep': 'worker.tasks.checkinPrep',
};

const DESC_ALIASES = {
  'ניקוי יסודי': 'worker.tasks.deepClean',
  'החלפת מצעים': 'worker.tasks.linenChange',
  'בדיקת תחזוקה': 'worker.tasks.maintenanceCheck',
  "הכנה לצ'ק-אין": 'worker.tasks.checkinPrep',
};

const CHRISTOS_PROPERTY_KEYS = {
  'christos-thaleri-villa-corfu': 'worker.properties.thaleriVilla',
  'christos-manto-beach-apartment-barbati': 'worker.properties.mantoApt',
  'christos-manto-luxury-beach-2p-barbati': 'worker.properties.manto2p',
};

/** Hebrew display names when i18n bundle is not ready yet */
const CHRISTOS_DISPLAY_HE = {
  'christos-thaleri-villa-corfu': 'וילת יוקרה · קורפו',
  'christos-manto-beach-apartment-barbati': 'דירות מנטו',
  'christos-manto-luxury-beach-2p-barbati': 'סוויטת חוף מנטו',
};

/** Hard Hebrew fallbacks when i18n bundle is not ready */
const STATIC_LABELS_HE = {
  'worker.properties.thaleriVilla': CHRISTOS_DISPLAY_HE['christos-thaleri-villa-corfu'],
  'worker.properties.mantoApt': CHRISTOS_DISPLAY_HE['christos-manto-beach-apartment-barbati'],
  'worker.properties.manto2p': CHRISTOS_DISPLAY_HE['christos-manto-luxury-beach-2p-barbati'],
  'worker.tasks.deepClean': 'ניקוי יסודי',
  'worker.tasks.linenChange': 'החלפת מצעים',
  'worker.tasks.maintenanceCheck': 'בדיקת תחזוקה',
  'worker.tasks.checkinPrep': "הכנה לצ'ק-אין",
  'worker.taskTypes.cleaning': 'ניקיון חדר',
  'worker.taskTypes.maintenance': 'תחזוקה',
  'worker.taskTypes.service': 'שירות',
  'worker.taskTypes.checkin': "צ'ק-אין",
  'worker.labels.worker': 'עובד',
  'worker.labels.guest': 'אורח',
  'worker.labels.guests': 'אורחים',
  'worker.labels.bedroom': 'חדר שינה',
  'worker.labels.bedrooms': 'חדרי שינה',
  'worker.labels.bed': 'מיטה',
  'worker.labels.beds': 'מיטות',
  'worker.labels.unassigned': 'לא משויך',
  'worker.labels.property': 'נכס',
  'worker.labels.room': 'חדר',
  'worker.defaultDescription': 'ביצוע משימה',
  'worker.defaultTaskType': 'שירות',
};

const CAPACITY_DOT_RE = /^(\d+)\s+Guests?,?\s*·?\s*(\d+)\s+Bedrooms?,?\s*·?\s*(\d+)\s+Beds?$/i;

const STAFF_ALIASES = {
  worker: 'worker.labels.worker',
  staff: 'worker.labels.worker',
  field: 'worker.labels.worker',
};

function replaceEnglishCapacityLabels(s) {
  let out = String(s || '');
  if (!out) return out;
  const guestW = t('worker.labels.guests') || 'אורחים';
  const guest1 = t('worker.labels.guest') || 'אורח';
  const brW = t('worker.labels.bedrooms') || 'חדרי שינה';
  const br1 = t('worker.labels.bedroom') || 'חדר שינה';
  const bedW = t('worker.labels.beds') || 'מיטות';
  const bed1 = t('worker.labels.bed') || 'מיטה';
  const workerLbl = t('worker.labels.worker') || 'עובד';
  const unassignedLbl = t('worker.labels.unassigned') || 'לא משויך';
  out = out.replace(/\b(\d+)\s+Guests?\b/gi, (_, n) => {
    const num = parseInt(n, 10);
    return `${num} ${num === 1 ? guest1 : guestW}`;
  });
  out = out.replace(/\b(\d+)\s+Bedrooms?\b/gi, (_, n) => {
    const num = parseInt(n, 10);
    return `${num} ${num === 1 ? br1 : brW}`;
  });
  out = out.replace(/\b(\d+)\s+Beds?\b/gi, (_, n) => {
    const num = parseInt(n, 10);
    return `${num} ${num === 1 ? bed1 : bedW}`;
  });
  out = out.replace(/\bGuests?\b/gi, (m) => (/s$/i.test(m) ? guestW : guest1));
  out = out.replace(/\bBedrooms?\b/gi, (m) => (/s$/i.test(m) ? brW : br1));
  out = out.replace(/\bBeds?\b/gi, (m) => (/s$/i.test(m) ? bedW : bed1));
  out = out.replace(/\bUnknown\b/gi, unassignedLbl);
  out = out.replace(/\bworker\b/gi, workerLbl);
  return out;
}

function staticLabelForKey(key) {
  const k = String(key || '').trim();
  if (!k) return '';
  return STATIC_LABELS_HE[k] || '';
}

function t(key, opts) {
  if (!key) return '';
  try {
    const out = i18n.t(key, { defaultValue: '', ...opts });
    if (out && out !== key && !looksLikeI18nRef(out)) return out;
  } catch (_) { /* noop */ }
  return staticLabelForKey(key) || '';
}

export function looksLikeI18nRef(raw) {
  const s = String(raw || '').trim();
  if (!s) return false;
  if (/^(i18n[.:]|@i18n:|worker\.)/i.test(s)) return true;
  if (/i18n[.:]\s*worker\./i.test(s)) return true;
  if (/^@+worker\./i.test(s)) return true;
  return false;
}

export function extractI18nKey(raw) {
  let x = String(raw || '').trim();
  if (!x) return '';
  if (x.startsWith(I18N_PREFIX)) x = x.slice(I18N_PREFIX.length);
  else if (/^i18n:/i.test(x)) x = x.replace(/^i18n:/i, '');
  else if (x.toLowerCase().startsWith('i18n.')) x = x.slice(5);
  x = x.split('|')[0].trim();
  if (x.startsWith('worker.')) return x;
  return '';
}

export function translateI18nRef(raw, fallback = '') {
  const key = extractI18nKey(raw);
  if (key) {
    const label = t(key) || staticLabelForKey(key);
    if (label) return label;
  }
  const s = String(raw || '').trim();
  if (!s || looksLikeI18nRef(s)) return fallback;
  return s;
}

function stripInternalTags(text) {
  return String(text || '')
    .replace(/\[(?:booking_ref|ical_uid)[^\]]*\]/gi, '')
    .replace(/\[SIM-ENGINE\]\s*/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Never render raw i18n keys / English capacity labels in worker UI. */
export function formatWorkerDisplayText(raw, fallback = '') {
  let s = stripInternalTags(String(raw ?? '').trim());
  if (!s) return fallback;
  if (looksLikeI18nRef(s)) {
    const tr = translateI18nRef(s, '');
    return tr || fallback;
  }
  if (s.includes('|')) {
    const parts = s.split('|').map((p) => formatWorkerDisplayText(p.trim(), '')).filter(Boolean);
    if (parts.length) return parts.join(' · ');
  }
  s = replaceEnglishCapacityLabels(s);
  if (looksLikeI18nRef(s)) return fallback;
  if (/^unknown$/i.test(s)) {
    return t('worker.labels.unassigned') || fallback;
  }
  return s || fallback;
}

function resolveTaskTypeKey(raw) {
  const x = String(raw || '').trim();
  if (!x) return '';
  const fromRef = extractI18nKey(x);
  if (fromRef) return fromRef;
  if (x.startsWith('worker.')) return x;
  if (TASK_TYPE_ALIASES[x]) return TASK_TYPE_ALIASES[x];
  if (TASK_TYPE_ALIASES[x.toLowerCase()]) return TASK_TYPE_ALIASES[x.toLowerCase()];
  return '';
}

function resolveDescriptionKey(raw) {
  const x = String(raw || '').trim();
  if (!x) return '';
  const fromRef = extractI18nKey(x);
  if (fromRef) return fromRef;
  if (x.startsWith('worker.')) return x;
  if (DESC_ALIASES[x]) return DESC_ALIASES[x];
  const typeKey = resolveTaskTypeKey(x);
  if (typeKey && x.length <= 24) return typeKey;
  return '';
}

export function translatePropertyName(propertyId, fallback = '') {
  const pid = String(propertyId || '').trim();
  const fbKey = extractI18nKey(fallback);
  const pidKey = CHRISTOS_PROPERTY_KEYS[pid];
  const key = pidKey || fbKey;
  if (key) {
    const label = t(key) || staticLabelForKey(key);
    if (label) return label;
  }
  if (CHRISTOS_DISPLAY_HE[pid]) return CHRISTOS_DISPLAY_HE[pid];
  const fromRef = translateI18nRef(fallback, '');
  if (fromRef) return fromRef;
  const fb = String(fallback || '').trim();
  if (!fb || looksLikeI18nRef(fb)) {
    return t('worker.labels.property') || 'נכס';
  }
  return replaceEnglishCapacityLabels(fb);
}

export function translatePropertyContext(raw) {
  const fromRef = translateI18nRef(raw, '');
  if (fromRef) return fromRef;
  const s = stripInternalTags(String(raw || '').trim());
  if (!s) return '';
  let m = s.match(CAPACITY_RE);
  if (!m) m = s.match(CAPACITY_DOT_RE);
  if (m) {
    const guests = parseInt(m[1], 10);
    const bedrooms = parseInt(m[2], 10);
    const beds = parseInt(m[3], 10);
    const gLabel = t(guests === 1 ? 'worker.labels.guest' : 'worker.labels.guests') || (guests === 1 ? 'אורח' : 'אורחים');
    const brLabel = t(bedrooms === 1 ? 'worker.labels.bedroom' : 'worker.labels.bedrooms') || (bedrooms === 1 ? 'חדר שינה' : 'חדרי שינה');
    const bLabel = t(beds === 1 ? 'worker.labels.bed' : 'worker.labels.beds') || (beds === 1 ? 'מיטה' : 'מיטות');
    return `${guests} ${gLabel} · ${bedrooms} ${brLabel} · ${beds} ${bLabel}`;
  }
  if (looksLikeI18nRef(s)) return '';
  return replaceEnglishCapacityLabels(s);
}

export function translateStaffLabel(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const fromRef = translateI18nRef(s, '');
  if (fromRef) return fromRef;
  const low = s.toLowerCase();
  if (low === 'unknown') {
    return t('worker.labels.unassigned') || 'לא משויך';
  }
  if (STAFF_ALIASES[low] || low === 'worker' || low === 'staff') {
    return t('worker.labels.worker') || 'עובד';
  }
  if (s.includes('@') && s.includes('.')) return '';
  if (looksLikeI18nRef(s)) return t('worker.labels.worker') || 'עובד';
  return replaceEnglishCapacityLabels(s);
}

export function formatWorkerRoomLine(task) {
  const roomWord = t('worker.labels.room') || 'חדר';
  const candidates = [
    task?.room_number,
    task?.room_id,
    task?.room,
    task?.property_key,
  ];
  for (const raw of candidates) {
    const clean = formatWorkerDisplayText(raw, '');
    if (!clean) continue;
    const numMatch = clean.match(/(\d{1,4})/);
    if (numMatch) return `${roomWord} ${numMatch[1]}`;
    const stripped = clean.replace(/^(חדר|room|غرفة|δωμάτιο)\s*/i, '').trim();
    if (stripped && !looksLikeI18nRef(stripped)) return `${roomWord} ${stripped}`;
  }
  return roomWord;
}

export function translateTaskType(taskType, fallback = '') {
  const key = resolveTaskTypeKey(taskType);
  if (key) {
    const label = t(key);
    if (label) return label;
  }
  const fb = String(fallback || taskType || '').trim();
  if (looksLikeI18nRef(fb)) return t('worker.defaultTaskType') || '';
  return fb || t('worker.defaultTaskType') || '';
}

export function translateTaskStatus(status) {
  const raw = String(status || 'pending').trim().toLowerCase().replace(/\s+/g, '_');
  if (['done', 'completed', 'closed'].includes(raw)) return t('worker.labels.done') || t('worker.status.completed');
  if (['in_progress', 'inprogress', 'accepted', 'assigned', 'started', 'seen', 'working', 'delayed', 'searching_for_staff'].includes(raw)) {
    return t('worker.labels.inProgress') || t('worker.status.inProgress');
  }
  if (['overdue', 'late', 'escalated'].includes(raw)) return t('worker.labels.overdue') || t('worker.status.pending');
  if (['waiting', 'queued'].includes(raw)) return t('worker.status.waiting');
  return t('worker.status.pending');
}

export function translateTaskDescription(task, fallbackKey = 'worker.defaultDescription') {
  const row = task || {};
  const rawDesc = String(row.description || row.content || row.title || '').trim();
  const primaryRaw = rawDesc.split('|')[0].split('—')[0].trim();
  if (primaryRaw && !looksLikeI18nRef(primaryRaw)) {
    const cleaned = formatWorkerDisplayText(primaryRaw, '');
    if (cleaned) return cleaned;
  }
  if (rawDesc && !looksLikeI18nRef(rawDesc)) {
    const cleaned = formatWorkerDisplayText(rawDesc.split('|')[0].split('—')[0].trim(), '');
    if (cleaned) return cleaned;
  }
  const descKey = resolveDescriptionKey(rawDesc);
  const typeKey = resolveTaskTypeKey(row.task_type);
  const pid = String(row.property_id || '').trim();
  const propLabel = translatePropertyName(pid, row.property_name || row.room || '');

  if (descKey) {
    const base = t(descKey);
    if (base && propLabel) return `${base} · ${propLabel}`;
    if (base) return base;
  }
  if (typeKey) {
    const base = t(typeKey);
    if (base && propLabel) return `${base} · ${propLabel}`;
    if (base) return base;
  }

  if (rawDesc && !looksLikeI18nRef(rawDesc)) {
    const primary = formatWorkerDisplayText(rawDesc.split('|')[0].trim(), '');
    if (primary) return primary;
  }

  const fb = t(fallbackKey) || 'משימה חדשה';
  if (propLabel) return `${fb} · ${propLabel}`;
  return fb || 'משימה חדשה';
}

export function formatTaskDate(isoStr, lang, opts = {}) {
  const { includeTime = true } = opts;
  if (!isoStr) return '—';
  const lng = normalizeLang(lang || i18n.language);
  try {
    const d = new Date(isoStr);
    if (Number.isNaN(d.getTime())) return String(isoStr);
    const locale = lng === 'he' ? 'he-IL' : lng === 'el' ? 'el-GR' : lng === 'ar' ? 'ar' : 'en-US';
    const datePart = d.toLocaleDateString(locale, { day: 'numeric', month: 'long' });
    if (!includeTime) return datePart;
    const timePart = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
    return `${datePart} · ${timePart}`;
  } catch {
    return String(isoStr);
  }
}

export function localeDirection(lang) {
  return isRtlLang(lang) ? 'rtl' : 'ltr';
}

export function localizeWorkerTask(task) {
  if (!task) return task;
  const description = translateTaskDescription(task);
  const property_name = translatePropertyName(task.property_id, task.property_name);
  const property_context = translatePropertyContext(task.property_context);
  const staff_name = translateStaffLabel(task.staff_name || task.worker_name);
  const worker_name = translateStaffLabel(task.worker_name || task.staff_name);
  const assigned_to = translateStaffLabel(task.assigned_to) || staff_name;
  return {
    ...task,
    description,
    title: description,
    content: description,
    property_name,
    hotel_name: property_name || translateI18nRef(task.hotel_name, ''),
    room: property_name || translatePropertyName(task.property_id, task.room),
    room_number: property_name || translatePropertyName(task.property_id, task.room_number),
    property_context,
    staff_name,
    worker_name,
    assigned_to,
    statusLabel: translateTaskStatus(task.status),
    task_typeLabel: translateTaskType(task.task_type),
  };
}

export function localizeWorkerTasks(tasks) {
  if (!Array.isArray(tasks)) return [];
  return tasks.map(localizeWorkerTask);
}
