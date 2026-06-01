/** Bikta Ness Ziona — detect exclusive dashboard from JWT / env. */

/** Must match server `BIKTA_NESS_ZIONA_TENANT_ID` / matrix seed tenant. */
export const BIKTA_TENANT_ID =
  (typeof process !== 'undefined' && process.env.REACT_APP_BIKTA_TENANT_ID) || 'BIKTA_NESS_ZIONA';

export const BIKTA_TENANT_NAME =
  (typeof process !== 'undefined' && process.env.REACT_APP_BIKTA_TENANT_NAME) || 'הבקתה נס ציונה';

export function parseJwtPayload(token) {
  try {
    const payload = token.split('.')[1];
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(normalized)) || {};
  } catch {
    return {};
  }
}

/** Digits only — compare last 9 digits for IL numbers. */
export function normalizePhoneDigits(phone) {
  if (phone == null || phone === '') return '';
  return String(phone).replace(/\D/g, '');
}

/**
 * Phones that must use Bikta tenant (comma-separated in REACT_APP_BIKTA_FORCE_PHONES).
 * Default includes the demo line from BiktaDashboard branding.
 */
export function isBiktaForcePhone(phone) {
  const digits = normalizePhoneDigits(phone);
  if (!digits || digits.length < 9) return false;
  const tail = digits.slice(-9);
  const env = (typeof process !== 'undefined' && process.env.REACT_APP_BIKTA_FORCE_PHONES) || '';
  const list = env
    .split(/[,;\s]+/)
    .map((s) => normalizePhoneDigits(s))
    .filter(Boolean)
    .map((d) => (d.length >= 9 ? d.slice(-9) : d));
  const fallback = list.length === 0 ? ['559399999'] : []; // 055-939-9999 (BiktaDashboard demo)
  const all = [...list, ...fallback];
  return all.some((d) => tail === d);
}

/**
 * True when this login should see the Bikta matrix (not the standard hotel dashboard).
 */

export function isBiktaNessZionaUser(authToken, activeTenantId) {
  const envId = typeof process !== 'undefined' && process.env.REACT_APP_BIKTA_TENANT_ID;
  const p = parseJwtPayload(authToken || '');
  const label = (p.tenant_name || '').trim().toLowerCase();
  const target = BIKTA_TENANT_NAME.trim().toLowerCase();
  if (authToken && activeTenantId === 'BIKTA_NESS_ZIONA') return true;
  if (envId && (p.tenant_id === envId || activeTenantId === envId)) return true;
  const rawName = (p.tenant_name || '').trim();
  if (rawName && (rawName === BIKTA_TENANT_NAME.trim() || label === target || label === 'bikta ness ziona')) {
    return true;
  }
  return false;
}
