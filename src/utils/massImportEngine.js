/**
 * Mass import: multi-sheet Excel, chunked execution, validation stats for Maya report.
 */

import { WEWORK_BRANCH_PINS, WEWORK_RENTAL_LABELS_HE } from '../config/weworkBranches';

const CHUNK = 80;

export function chunkArray(arr, size = CHUNK) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Parse all sheets from .xlsx / .xls; CSV returns single sheet "default". */
export async function parseEnterpriseWorkbook(file) {
  const name = (file?.name || '').toLowerCase();
  const buf = await file.arrayBuffer();
  if (name.endsWith('.csv') || name.endsWith('.txt')) {
    const XLSX = await import('xlsx');
    const text = new TextDecoder('utf-8').decode(buf);
    const wb = XLSX.read(text, { type: 'string' });
    const sheet = wb.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { defval: '' });
    return { sheets: { default: Array.isArray(rows) ? rows : [] } };
  }
  const XLSX = await import('xlsx');
  const wb = XLSX.read(buf, { type: 'array' });
  const sheets = {};
  for (const sn of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { defval: '' });
    sheets[sn] = Array.isArray(rows) ? rows : [];
  }
  return { sheets };
}

function normKey(o, ...keys) {
  for (const k of keys) {
    if (o[k] != null && String(o[k]).trim()) return String(o[k]).trim();
  }
  return '';
}

/** Match Excel row to a WeWork branch pin (slug, branch name, or brand + city). */
export function matchWeWorkBranchFromRow(row) {
  const rawSlug = normKey(row, 'branch_slug', 'Branch slug', 'slug', 'סניף_slug', 'WeWork slug', 'wework_slug');
  if (rawSlug) {
    const s = rawSlug.toLowerCase().trim().replace(/[\s_]+/g, '-');
    const exact = WEWORK_BRANCH_PINS.find((b) => b.slug === s || b.id === s);
    if (exact) return exact;
    const fuzzy = WEWORK_BRANCH_PINS.find((b) => s.includes(b.slug) || b.slug.includes(s));
    if (fuzzy) return fuzzy;
  }
  const branchLabel = normKey(row, 'branch', 'Branch', 'סניף', 'branch_name', 'שם סניף', 'סניף WeWork');
  if (branchLabel) {
    const lc = branchLabel.toLowerCase();
    const byName = WEWORK_BRANCH_PINS.find((b) => {
      const bn = b.name.toLowerCase();
      return bn.includes(lc) || lc.includes(bn.slice(0, Math.min(14, bn.length)));
    });
    if (byName) return byName;
  }
  const city = normKey(row, 'city', 'City', 'עיר');
  const brand = normKey(row, 'brand', 'Brand', 'מותג');
  const name = normKey(row, 'name', 'Name', 'שם', 'property_name');
  if (!/wework|ווי\s*וורק/i.test(`${brand} ${name} ${rawSlug}`)) return null;
  if (city) {
    const byCity = WEWORK_BRANCH_PINS.find(
      (b) => b.cityHe === city || b.cityHe.includes(city) || city.includes(b.cityHe),
    );
    if (byCity) return byCity;
  }
  return null;
}

/** Validate property/room/pricing rows (flexible column names). */
export function validatePropertyLikeRows(rows) {
  const list = Array.isArray(rows) ? rows : [];
  let missingImage = 0;
  let missingHourlyRate = 0;
  for (const r of list) {
    const img = normKey(r, 'photo_url', 'Photo', 'image', 'Image', 'תמונה');
    const name = normKey(r, 'name', 'Name', 'שם', 'property_name');
    const hourly = normKey(r, 'hourly_rate', 'Hourly', 'Hourly Rate', 'תעריף שעה', 'מחיר שעה');
    if (!img && name) missingImage += 1;
    const brand = normKey(r, 'brand', 'Brand', 'מותג');
    const slug = normKey(r, 'branch_slug', 'Branch slug', 'slug', 'סניף_slug');
    const isWw =
      /wework|ווי\s*וורק/i.test(`${name} ${brand} ${slug}`) || /^wework-/i.test(slug);
    const isWs =
      isWw ||
      /workspace|rooms|משרד|cowork|room\s*sky|רומס/i.test(`${name} ${r.type || r.Type || ''}`);
    if (isWs && !hourly && name) missingHourlyRate += 1;
  }
  return {
    total: list.length,
    missingImage,
    missingHourlyRate,
    ok: Math.max(0, list.length - missingImage - missingHourlyRate),
  };
}

/** Map loose row to createProperty payload */
export function rowToCreatePropertyPayload(row) {
  const name = normKey(row, 'name', 'Name', 'שם', 'property_name') || 'Imported Property';
  let description = normKey(row, 'description', 'Description', 'תיאור');
  const photo_url = normKey(row, 'photo_url', 'Photo', 'image', 'Image', 'תמונה');
  const hourlyRaw = normKey(row, 'hourly_rate', 'Hourly', 'Hourly Rate', 'תעריף שעה', 'מחיר שעה');
  const nightly = Number(row.price ?? row.Price ?? row['לילה'] ?? row.nightly ?? 0) || 0;
  const hourlyNum = hourlyRaw ? Number(String(hourlyRaw).replace(/[^\d.]/g, '')) || 0 : 0;
  const price = nightly || hourlyNum || 0;
  const pin = matchWeWorkBranchFromRow(row);
  const brandCol = normKey(row, 'brand', 'Brand', 'מותג');
  const slugCol = normKey(row, 'branch_slug', 'Branch slug', 'slug', 'סניף_slug');
  const isWeworkRow =
    pin ||
    /wework|ווי\s*וורק/i.test(`${brandCol} ${name}`) ||
    /^wework-/i.test(slugCol);
  let amenities = [];
  if (isWeworkRow && pin) {
    description = [`WeWork · ${pin.name} (${pin.cityHe}) — ${pin.address}.`, description].filter(Boolean).join('\n').trim();
    amenities = ['WeWork', ...WEWORK_RENTAL_LABELS_HE.slice(0, 4)];
  } else if (isWeworkRow && !pin) {
    description = [
      'WeWork Israel — ציין סניף בעמודת branch_slug (למשל wework-tlv-toha) או סניף.',
      description,
    ]
      .filter(Boolean)
      .join('\n')
      .trim();
    amenities = ['WeWork'];
  }
  return {
    name,
    description,
    photo_url,
    price,
    max_guests: Number(row.max_guests ?? row.guests ?? 2) || 2,
    bedrooms: Number(row.bedrooms ?? 1) || 1,
    beds: Number(row.beds ?? 1) || 1,
    bathrooms: Number(row.bathrooms ?? 1) || 1,
    amenities,
  };
}

/** Map row to staff bulk row */
export function rowToStaffBulkRow(row) {
  return {
    name: normKey(row, 'name', 'Name', 'שם'),
    role: normKey(row, 'role', 'Role', 'תפקיד') || 'Staff',
    department: normKey(row, 'department', 'Department', 'מחלקה') || undefined,
    branch: normKey(row, 'branch', 'Branch', 'סניף') || undefined,
    phone_number: normKey(row, 'phone', 'Phone', 'phone_number', 'טלפון') || undefined,
  };
}

export function buildMayaValidationReportHe(stats) {
  const t = stats.total ?? 0;
  const mi = stats.missingImage ?? 0;
  const mh = stats.missingHourlyRate ?? 0;
  const rest = Math.max(0, t - mi - mh);
  return `קובי, קלטתי ${t} נכסים. ב-${mi} מהם חסרה תמונה, ב-${mh} חסר תעריף שעה. הכל תקין בשאר (${rest}).`;
}
