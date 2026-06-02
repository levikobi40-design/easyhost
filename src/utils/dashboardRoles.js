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
  /** `host` = default owner dashboard role from API/store — full management UI. STAFF uses `staff` / `manager`. */
  return r === 'admin' || r === 'owner' || r === 'host' || r === 'superadmin' || r === 'god';
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
