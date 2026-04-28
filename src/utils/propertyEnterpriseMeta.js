/**
 * Enterprise metadata for large property lists — inferred from names/descriptions/branches.
 */
import { ROOMS_BRANCH_PINS, ROOMS_PIN_ID_SET } from '../config/roomsBranches';
import { getWeWorkBranchById, WEWORK_PIN_ID_SET } from '../config/weworkBranches';

const UNSPLASH = /unsplash|picsum|placeholder|via\.placeholder/i;

export function inferPropertyEnterpriseMeta(p) {
  const name = `${p?.name || ''}`;
  const desc = `${p?.description || ''}`;
  const low = name.toLowerCase();
  const dlow = desc.toLowerCase();

  const wwPin = WEWORK_PIN_ID_SET.has(String(p?.id)) ? getWeWorkBranchById(String(p.id)) : null;
  if (wwPin) {
    return {
      city: wwPin.cityHe,
      brand: 'WeWork',
      propertyType: 'Workspace',
      occupancy:
        `${p?.status || ''}` === 'InProgress' || /occupied|תפוס|ניקיון/.test(`${p?.status || ''}`)
          ? 'Occupied'
          : 'Vacant',
      hasRealImage:
        p?.mainImage &&
        !UNSPLASH.test(p.mainImage) &&
        !String(p.mainImage).includes('placehold.co') &&
        !String(p.mainImage).includes('Pending'),
    };
  }

  let city = 'תל אביב';
  if (/רמת גן|ramat gan|בורסה|diamond/.test(low) || /רמת גן|ramat gan/.test(dlow)) city = 'רמת גן';
  if (/jaffa|יפו|bazaar|בזאר/.test(low)) city = 'יפו';
  if (/פתח תקווה|petah|bsr/.test(low)) city = 'פתח תקווה';
  if (/מודיעין|modiin/.test(low)) city = 'מודיעין';
  if (/רעננה|raanana|ra'anana/.test(low)) city = 'רעננה';
  if (/בני ברק|bnei brak/.test(low)) city = 'בני ברק';
  if (/נווה צדק|neve tzedek/.test(low)) city = 'תל אביב';
  if (p?.branchSlug) {
    const b = ROOMS_BRANCH_PINS.find((x) => x.slug === p.branchSlug);
    if (b?.city) city = b.city;
  }

  let brand = 'EasyHost';
  if (/bazaar|בזאר|hotel bazaar/.test(low)) brand = 'Hotel Bazaar';
  if (/leonardo|city tower|סיטי טאוור|ליאונרדו/.test(low)) brand = 'Leonardo Plaza';
  if (/wework|ווי וורק/.test(low) || /wework/i.test(dlow)) brand = 'WeWork';
  if (ROOMS_PIN_ID_SET.has(String(p?.id)) || /rooms|רומס|fattal|coworking|משרד|workspace/.test(low)) {
    if (brand === 'EasyHost' || brand === 'WeWork') {
      /* keep WeWork if already set from name */
    }
    if (brand !== 'WeWork') brand = 'ROOMS';
  }

  let propertyType = 'Hotel Room';
  if (brand === 'WeWork' || ROOMS_PIN_ID_SET.has(String(p?.id)) || /coworking|משרד|hot desk|workspace|rooms|wework/.test(low)) {
    propertyType = 'Workspace';
  }
  if (/suite|סוויט|jacuzzi|ג׳קוזי/.test(low)) propertyType = 'Suite';

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
