/**
 * Enterprise metadata for property lists — inferred from names/descriptions.
 */
const UNSPLASH = /unsplash|picsum|placeholder|via\.placeholder/i;

export function inferPropertyEnterpriseMeta(p) {
  const name = `${p?.name || ''}`;
  const desc = `${p?.description || ''}`;
  const low = name.toLowerCase();
  const dlow = desc.toLowerCase();

  let city = 'Corfu';
  if (/corfu|kérkyra|kerkyra|barbati|thaleri|manto/.test(low) || /corfu|barbati/.test(dlow)) {
    city = 'Corfu';
  }

  let brand = 'Christos Pilot';
  let propertyType = 'Villa';
  if (/apartment|apt|דיר/.test(low)) propertyType = 'Apartment';
  if (/suite|סוויט/.test(low)) propertyType = 'Suite';
  if (/beach/.test(low)) propertyType = 'Beach Suite';

  const st = `${p?.status || ''}`;
  const occupancy =
    st === 'InProgress' || /occupied|תפוס|ניקיון/.test(st)
      ? 'Occupied'
      : 'Vacant';

  const hasRealImage =
    p?.mainImage &&
    !UNSPLASH.test(p.mainImage) &&
    !String(p.mainImage).includes('photo-1613977257363');

  return {
    city,
    brand,
    propertyType,
    occupancy,
    hasRealImage,
  };
}

export function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'he'));
}
