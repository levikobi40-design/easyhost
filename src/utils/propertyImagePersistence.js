/**
 * Persists property hero images in localStorage so background GET /properties syncs
 * do not wipe user uploads or client-assigned URLs (session cache alone can reset).
 */
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

/** Save or merge one property's images (by string id). */
export function persistPropertyImageOverrideFromItem(item) {
  if (!item || typeof item !== 'object' || item.id == null) return;
  const id = String(item.id).trim();
  if (!id) return;
  const main = String(item.mainImage || item.photo_url || item.image_url || '').trim();
  const pics = Array.isArray(item.pictures) ? item.pictures.filter(Boolean).map(String) : [];
  const hero = main || (pics[0] || '').trim();
  if (!hero) return;
  if (typeof localStorage === 'undefined') return;
  try {
    const all = safeParse(localStorage.getItem(STORAGE_KEY) || '{}');
    all[id] = {
      mainImage: hero,
      photo_url: String(item.photo_url || hero).trim(),
      image_url: String(item.image_url || hero).trim(),
      ...(pics.length ? { pictures: pics } : {}),
      savedAt: Date.now(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    /* quota / private mode */
  }
}

/** After each server merge, re-apply stored heroes so they win over stale API rows. */
export function mergePropertyImageOverrides(items) {
  if (!Array.isArray(items) || !items.length) return items || [];
  const all = loadPropertyImageOverrides();
  const keys = Object.keys(all);
  if (!keys.length) return items;
  return items.map((p) => {
    const o = all[String(p.id)];
    if (!o || typeof o !== 'object') return p;
    const om = String(o.mainImage || o.photo_url || o.image_url || '').trim();
    if (!om) return p;
    const mergedPics = Array.isArray(o.pictures) && o.pictures.length ? o.pictures : p.pictures;
    return {
      ...p,
      mainImage: om,
      photo_url: (o.photo_url && String(o.photo_url).trim()) || om,
      image_url: (o.image_url && String(o.image_url).trim()) || om,
      ...(mergedPics ? { pictures: mergedPics } : {}),
    };
  });
}
