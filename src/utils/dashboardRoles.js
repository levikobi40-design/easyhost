/**
 * Dashboard RBAC: full admin (owner/host/…), Operation (ops lead — no Settings/Developer),
 * STAFF (task board only), operator, field.
 */

export function isOperationRole(role) {
  const r = String(role || '').toLowerCase().trim();
  return r === 'operation' || r === 'operations';
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
