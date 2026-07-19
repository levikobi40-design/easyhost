import { CHRISTOS_PROPERTY_IDS } from '../data/initialProperties';

const CHRISTOS_ID_SET = new Set(CHRISTOS_PROPERTY_IDS);

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
  if (CHRISTOS_ID_SET.has(id)) return false;
  if (id.startsWith('rooms-branch-') || id.startsWith('wework-')) return true;
  if (id === 'bazaar-jaffa-hotel' || id === 'leonardo-city-tower-ramat-gan') return true;
  const name = String(p?.name || p?.property_name || '').trim();
  return DEMO_NAME_RE.test(name);
}

/** API-only property list — Christos seeds plus user-created rows; never demo portfolio pins. */
export function filterLivePilotProperties(list) {
  if (!Array.isArray(list)) return [];
  const christos = list.filter((p) => CHRISTOS_ID_SET.has(String(p?.id || '').trim()));
  const extras = list.filter(
    (p) => p && !CHRISTOS_ID_SET.has(String(p?.id || '').trim()) && !isDemoPropertyRow(p),
  );
  if (christos.length) return [...christos, ...extras];
  return list.filter((p) => p && !isDemoPropertyRow(p));
}
