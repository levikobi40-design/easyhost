import { API_URL } from './constants';

const PLACEHOLDER =
  'https://images.unsplash.com/photo-1613977257363-707ba9348227?w=800&auto=format&fit=crop';

/** Normalize image URL for comparison and rendering. */
export function normalizePropertyImageUrl(url, apiBase = API_URL) {
  if (!url || typeof url !== 'string') return '';
  const u = url.trim();
  if (!u) return '';
  if (u.startsWith('data:')) return u;
  if (u.startsWith('http://') || u.startsWith('https://')) return u;
  if (u.startsWith('/assets/')) return u;
  const base = String(apiBase || '').replace(/\/$/, '');
  const path = u.startsWith('/') ? u.replace(/^\/+/, '') : u;
  if (path.startsWith('uploads/')) return `${base}/${path}`;
  return `${base}/uploads/${path}`;
}

/** Dedupe gallery URLs after normalization (by normalized href). */
export function dedupePropertyGalleryUrls(urls, apiBase = API_URL) {
  const out = [];
  const seen = new Set();
  for (const raw of urls || []) {
    const norm = normalizePropertyImageUrl(String(raw || ''), apiBase);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    out.push(norm);
  }
  return out;
}

/** True when URL is non-empty and safe to render in gallery UI. */
export function isRenderableGalleryUrl(url, apiBase = API_URL) {
  const norm = normalizePropertyImageUrl(String(url || '').trim(), apiBase);
  if (!norm || norm.length < 8) return false;
  if (norm === PLACEHOLDER) return false;
  return true;
}

/** Dedupe + drop empty/broken placeholder URLs from gallery lists. */
export function sanitizePropertyGalleryList(urls, apiBase = API_URL) {
  return dedupePropertyGalleryUrls(urls, apiBase).filter((u) => isRenderableGalleryUrl(u, apiBase));
}

export function propertyHasPersistedGallery(property) {
  if (!property || typeof property !== 'object') return false;
  return buildPropertyGalleryImages(property).length > 0;
}

/** Canonical gallery order: index 0 = cover. Source of truth: `pictures` from backend. */
export function collectPropertyGalleryUrls(property, apiBase = API_URL) {
  if (Array.isArray(property?.pictures)) {
    return dedupePropertyGalleryUrls(property.pictures.filter(Boolean), apiBase);
  }
  if (Array.isArray(property?.images)) {
    return dedupePropertyGalleryUrls(property.images.filter(Boolean), apiBase);
  }
  if (Array.isArray(property?.gallery)) {
    return dedupePropertyGalleryUrls(property.gallery.filter(Boolean), apiBase);
  }
  const raw = [];
  const push = (v) => {
    const s = String(v || '').trim();
    if (s) raw.push(s);
  };
  push(property?.cover_image);
  push(property?.mainImage);
  push(property?.photo_url);
  push(property?.image_url);
  return dedupePropertyGalleryUrls(raw, apiBase);
}

/** Build render list from backend fields only — no demo placeholders merged in. */
export function buildPropertyGalleryImages(property, apiBase = API_URL) {
  return collectPropertyGalleryUrls(property, apiBase);
}

export function parsePropertyPrice(property) {
  if (!property || typeof property !== 'object') return null;
  for (const key of ['price_per_night', 'nightly_price', 'price']) {
    const v = property[key];
    if (v === null || v === undefined || v === '') continue;
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  const desc = String(property.description || '');
  if (!desc) return null;
  const m =
    desc.match(/Price per night:\s*\$?(\d+(?:\.\d+)?)/i)
    || desc.match(/מחיר\s*ללילה[:\s]*₪?(\d+(?:\.\d+)?)/i)
    || desc.match(/₪(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function formatPropertyPriceLabel(property) {
  const amount = parsePropertyPrice(property);
  if (amount === null) return null;
  const currency = String(property?.currency || '').trim().toUpperCase() || 'USD';
  if (amount === 0) return currency === 'ILS' || currency === '₪' ? '₪0' : '$0';
  if (currency === 'ILS' || currency === 'NIS' || currency === '₪') return `₪${amount}`;
  if (currency === 'EUR' || currency === '€') return `€${amount}`;
  return `$${amount}`;
}

export { PLACEHOLDER as PROPERTY_IMAGE_PLACEHOLDER };

/** Build PUT payload with all image/cover fields aligned to the same gallery list. */
export function buildPropertyImageUpdatePayload(_property, images, apiBase = API_URL) {
  const list = dedupePropertyGalleryUrls(Array.isArray(images) ? images.filter(Boolean) : [], apiBase);
  const cover = list[0] || '';
  return {
    pictures: list,
    images: list,
    gallery: list,
    photo_url: cover,
    cover_image: cover,
    image_url: cover,
    mainImage: cover,
  };
}

/** Move an existing gallery URL to cover (index 0). Cover must already be in the list. */
export function setPropertyGalleryCover(property, coverUrl, apiBase = API_URL) {
  const before = collectPropertyGalleryUrls(property, apiBase);
  const targetNorm = normalizePropertyImageUrl(String(coverUrl || '').trim(), apiBase);
  const match = before.find((u) => normalizePropertyImageUrl(u, apiBase) === targetNorm);
  if (!match) return { before, after: before };
  const rest = before.filter((u) => normalizePropertyImageUrl(u, apiBase) !== targetNorm);
  return { before, after: [match, ...rest] };
}

/** Append new URLs to the saved gallery without changing cover order. */
export function appendPropertyGalleryUrls(property, newUrls, apiBase = API_URL) {
  const existing = collectPropertyGalleryUrls(property, apiBase);
  const incoming = Array.isArray(newUrls) ? newUrls.filter(Boolean) : [];
  return dedupePropertyGalleryUrls([...existing, ...incoming], apiBase);
}

/** Remove one gallery URL (defaults to current cover) and return before/after lists. */
export function removePropertyGalleryUrl(property, urlToRemove, apiBase = API_URL) {
  const before = collectPropertyGalleryUrls(property, apiBase);
  const targetNorm = normalizePropertyImageUrl(
    String(urlToRemove || before[0] || '').trim(),
    apiBase,
  );
  const after = before.filter((u) => normalizePropertyImageUrl(u, apiBase) !== targetNorm);
  return { before, after, deleting: targetNorm || String(urlToRemove || before[0] || '') };
}
