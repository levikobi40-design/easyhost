import { CHRISTOS_PROPERTY_IDS, MILOS_DEAD_SEA_PROPERTY_ID } from '../data/initialProperties';

const CHRISTOS_ID_SET = new Set(CHRISTOS_PROPERTY_IDS);
const PROTECTED_LIVE_IDS = new Set([...CHRISTOS_PROPERTY_IDS, MILOS_DEAD_SEA_PROPERTY_ID]);

/** Match TaskCalendar MANAGER_PORTFOLIO_CORFU scope. */
export function isChristosCorfuTask(t) {
  const pid = String(t?.property_id || '').trim();
  if (CHRISTOS_ID_SET.has(pid)) return true;
  const blob = [
    pid,
    t?.property_name,
    t?.propertyName,
    t?.hotel_name,
    t?.title,
    t?.description,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return /christos|corfu|barbati|thaleri|manto|i18n[.:]worker\.properties|@i18n:worker\.properties|worker\.properties/.test(blob);
}

export function filterCorfuPilotTasks(tasks) {
  if (!Array.isArray(tasks)) return [];
  return tasks.filter((row) => {
    if (!row || typeof row !== 'object') return false;
    if ((row.status || '').toLowerCase() === 'archived') return false;
    // Keep Christos pilot tasks and any other live property / room-unit task.
    // Only drop known demo portfolio rows (Bazaar / Leonardo / WeWork seeds).
    if (isChristosCorfuTask(row)) return true;
    const pid = String(row?.property_id || '').trim();
    if (!pid) return false;
    if (isDemoPropertyRow({ id: pid, name: row?.property_name || row?.propertyName })) {
      return false;
    }
    return true;
  });
}

const DEMO_NAME_RE = /bazaar|sky\s*tower|leonardo\s*plaza|city\s*tower|wework|rooms\s*branch|hotel\s*bazaar|room\s*by\s*fattal/i;

export function isDemoPropertyRow(p) {
  const id = String(p?.id || '').trim();
  if (PROTECTED_LIVE_IDS.has(id)) return false;
  if (id.startsWith('rooms-branch-') || id.startsWith('wework-')) return true;
  if (id === 'bazaar-jaffa-hotel' || id === 'leonardo-city-tower-ramat-gan') return true;
  const name = String(p?.name || p?.property_name || '').trim();
  if (/milos|dead\s*sea|herbert\s*samuel|מילוס|ים\s*המלח/i.test(`${id} ${name}`)) return false;
  return DEMO_NAME_RE.test(name);
}

/** API-only property list — Christos + Milos + user-created rows; never demo portfolio pins. */
export function filterLivePilotProperties(list) {
  if (!Array.isArray(list)) return [];
  const protectedRows = list.filter((p) => PROTECTED_LIVE_IDS.has(String(p?.id || '').trim()));
  const extras = list.filter(
    (p) => p && !PROTECTED_LIVE_IDS.has(String(p?.id || '').trim()) && !isDemoPropertyRow(p),
  );
  if (protectedRows.length) return [...protectedRows, ...extras];
  return list.filter((p) => p && !isDemoPropertyRow(p));
}
