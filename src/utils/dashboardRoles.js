/**
 * Dashboard RBAC: full admin (owner/host/…), Operation (ops lead — no Settings/Developer),
 * STAFF (task board only), operator, field.
 */

export function isOperationRole(role) {
  const r = String(role || '').toLowerCase().trim();
  return r === 'operation' || r === 'operations';
}

/**
 * Decode the `role` claim from a JWT (UI-only, no signature verification).
 * The token is the source of truth for a user's role — the persisted Zustand
 * `role` can drift from it (most visibly on mobile, where a still-valid token
 * lets the Welcome screen skip a fresh login and leaves a stale worker role).
 */
export function roleFromJwt(token) {
  try {
    if (!token || typeof token !== 'string' || token.split('.').length !== 3) return '';
    const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(b64));
    return String(payload.role || payload.app_role || '').toLowerCase().trim();
  } catch {
    return '';
  }
}

const _TIER_RANK = { staff: 0, field: 0, operator: 1, operation: 2, admin: 3 };

/**
 * Resolve the nav tier from BOTH the persisted store role and the JWT role claim.
 * Used so a correct token always unlocks the right menu even when the persisted
 * `role` is stale/missing. The JWT only UPGRADES a `staff`-tier store role (the
 * stale-mobile case); it never overrides an explicit `field`/`operator`/admin
 * store role, so the admin TopBar "mode preview" switch keeps working.
 */
export function resolveNavTier(storeRole, token) {
  const storeTier = dashboardNavTier(storeRole);
  if (storeTier !== 'staff') return storeTier;
  const jwtTier = dashboardNavTier(roleFromJwt(token));
  return (_TIER_RANK[jwtTier] ?? 0) > (_TIER_RANK[storeTier] ?? 0) ? jwtTier : storeTier;
}

/** Full management + simulator / god-mode (excludes Operation). */
export function hasDeveloperOrSettingsHub(role) {
  return isDashboardAdmin(role) && !isOperationRole(role);
}

export function isDashboardAdmin(role) {
  const r = String(role || '').toLowerCase().trim();
  /**
   * Full management UI roles:
   * - `host`   = default owner dashboard role from API/store.
   * - `client` / `property_owner` = self-registered owners (backend /api/auth/register
   *   canonical role) — they own their tenant and get the full manager layout;
   *   the backend already scopes every query to their tenant_id.
   * - `manager` = management staff — full dashboard like owners.
   */
  return (
    r === 'admin' ||
    r === 'owner' ||
    r === 'host' ||
    r === 'client' ||
    r === 'property_owner' ||
    r === 'manager' ||
    r === 'superadmin' ||
    r === 'god'
  );
}

/**
 * Sidebar / route groups: 'admin' | 'operation' | 'staff' | 'operator' | 'field'
 * STAFF (and managers who are not admin): task board only.
 * OPERATION: same as admin except Settings (`manualops`) and Developer (`godmode`) are hidden.
 */
export function dashboardNavTier(role) {
  const r = String(role || '').toLowerCase().trim();
  if (r === 'operator') return 'operator';
  if (r === 'field' || r === 'worker') return 'field';
  if (isOperationRole(role)) return 'operation';
  if (isDashboardAdmin(role)) return 'admin';
  return 'staff';
}
