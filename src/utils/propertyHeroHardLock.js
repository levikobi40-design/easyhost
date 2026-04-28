/**
 * Hard-locked hero for ROOMS / Sky Tower properties — survives refreshes via propertyImagePersistence.
 */
import { persistPropertyImageOverrideFromItem } from './propertyImagePersistence';

export const HERO_OFFICE_INTERIOR_ASSET = '/assets/images/office_interior.jpg';

export function propertyNameRequiresOfficeInteriorHero(name) {
  const s = `${name || ''}`;
  if (!s.trim()) return false;
  if (/sky\s*tower/i.test(s) || s.includes('Sky Tower')) return true;
  if (/סקיי\s*טאוור/.test(s)) return true;
  return /\bROOMS\b/i.test(s) || s.toUpperCase().includes('ROOMS');
}

/** Apply locked hero + persist id → URL in localStorage */
export function applyHardLockHeroes(items) {
  if (!Array.isArray(items) || !items.length) return items || [];
  return items.map((p) => {
    if (!p || typeof p !== 'object') return p;
    if (!propertyNameRequiresOfficeInteriorHero(p.name)) return p;
    const hero = HERO_OFFICE_INTERIOR_ASSET;
    const next = {
      ...p,
      mainImage: hero,
      photo_url: hero,
      image_url: hero,
      pictures: [hero],
    };
    try {
      persistPropertyImageOverrideFromItem(next);
    } catch (_) {
      /* ignore */
    }
    return next;
  });
}
