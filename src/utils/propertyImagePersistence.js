/**
 * Persists property hero images in localStorage so background GET /properties syncs
 * do not wipe user uploads or client-assigned URLs (session cache alone can reset).
 */
import {
  dedupePropertyGalleryUrls,
  propertyHasPersistedGallery,
} from './propertyGallery';

const STORAGE_KEY = 'easyhost_property_image_overrides_v1';

function safeParse(raw) {
  try {
    const o = JSON.parse(raw);
    return o && typeof o === 'object' ? o : {};
  } catch {
    return {};
  }
}

export function loadPropertyImageOverrides() {
  if (typeof localStorage === 'undefined') return {};
  return safeParse(localStorage.getItem(STORAGE_KEY) || '{}');
}

/** Backend is source of truth — do not persist galleries to localStorage. */
export function persistPropertyImageOverrideFromItem(_item) {
  /* no-op */
}

export function clearPropertyImageOverride(propertyId) {
  const id = String(propertyId || '').trim();
  if (!id || typeof localStorage === 'undefined') return;
  try {
    const all = safeParse(localStorage.getItem(STORAGE_KEY) || '{}');
    if (!all[id]) return;
    delete all[id];
    if (Object.keys(all).length) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    /* quota / private mode */
  }
}

/** Backend is source of truth — do not merge stale localStorage galleries. */
export function mergePropertyImageOverrides(items) {
  return Array.isArray(items) ? items : [];
}
