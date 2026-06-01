/**
 * Pilot tenant: Hotel Bazaar Jaffa (EasyHost AI)
 * Match server: BAZAAR_JAFFA_TENANT_ID / BAZAAR_JAFFA
 */
export const BAZAAR_JAFFA_TENANT_ID =
  process.env.REACT_APP_BAZAAR_JAFFA_TENANT_ID || 'BAZAAR_JAFFA';

export function isBazaarJaffaTenant(tenantId) {
  return String(tenantId || '').trim() === BAZAAR_JAFFA_TENANT_ID;
}
