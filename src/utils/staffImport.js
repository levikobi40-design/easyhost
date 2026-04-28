/**
 * Parse staff rows from CSV text or Excel (SheetJS) workbook.
 * Expected columns (header row): Name, Role, Department, Phone (Hebrew / English OK).
 */

function normKey(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function mapHeaderToField(h) {
  const k = normKey(h);
  if (/^name$|^שם$|full\s*name/.test(k)) return 'name';
  if (/^role$|^תפקיד$|title|position/.test(k)) return 'role';
  if (/^department$|^מחלקה$|dept/.test(k)) return 'department';
  if (/^branch$|^סניף$|^site$|מיקום\s*סניף/.test(k)) return 'branch';
  if (/^phone$|^טלפון$|mobile|cell|נייד/.test(k)) return 'phone_number';
  return null;
}

/** @returns {Array<{ name: string, role?: string, department?: string, branch?: string, phone_number?: string }>} */
export function parseStaffCsvText(text) {
  const lines = String(text || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((l) => l.trim());
  if (lines.length < 2) return [];
  const delim = lines[0].includes('\t') && !lines[0].includes(',') ? '\t' : ',';
  const rawHeader = lines[0].split(delim).map((c) => c.trim().replace(/^"|"$/g, ''));
  const fieldIdx = {};
  rawHeader.forEach((cell, i) => {
    const f = mapHeaderToField(cell);
    if (f) fieldIdx[f] = i;
  });
  if (fieldIdx.name == null) {
    fieldIdx.name = 0;
    fieldIdx.role = 1;
    fieldIdx.department = 2;
    fieldIdx.phone_number = 3;
  }
  const out = [];
  for (let r = 1; r < lines.length; r += 1) {
    const cells = lines[r].split(delim).map((c) => c.trim().replace(/^"|"$/g, ''));
    const name = cells[fieldIdx.name] != null ? String(cells[fieldIdx.name]).trim() : '';
    if (!name) continue;
    const row = { name };
    if (fieldIdx.role != null && cells[fieldIdx.role] != null) row.role = String(cells[fieldIdx.role]).trim() || 'Staff';
    if (fieldIdx.department != null && cells[fieldIdx.department] != null) {
      const d = String(cells[fieldIdx.department]).trim();
      if (d) row.department = d;
    }
    if (fieldIdx.phone_number != null && cells[fieldIdx.phone_number] != null) {
      const p = String(cells[fieldIdx.phone_number]).trim();
      if (p) row.phone_number = p;
    }
    if (fieldIdx.branch != null && cells[fieldIdx.branch] != null) {
      const br = String(cells[fieldIdx.branch]).trim();
      if (br) row.branch = br;
    }
    out.push(row);
  }
  return out;
}

/** @param {ArrayBuffer|Uint8Array} data */
export async function parseStaffXlsxArrayBuffer(data) {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(data, { type: 'array' });
  const sheet = wb.SheetNames[0];
  if (!sheet) return [];
  const ws = wb.Sheets[sheet];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  if (!rows || rows.length < 2) return [];
  const header = (rows[0] || []).map((c) => String(c).trim());
  const fieldIdx = {};
  header.forEach((cell, i) => {
    const f = mapHeaderToField(cell);
    if (f) fieldIdx[f] = i;
  });
  if (fieldIdx.name == null) {
    fieldIdx.name = 0;
    fieldIdx.role = 1;
    fieldIdx.department = 2;
    fieldIdx.phone_number = 3;
  }
  const out = [];
  for (let r = 1; r < rows.length; r += 1) {
    const cells = rows[r] || [];
    const name = cells[fieldIdx.name] != null ? String(cells[fieldIdx.name]).trim() : '';
    if (!name) continue;
    const row = { name };
    if (fieldIdx.role != null && cells[fieldIdx.role] != null) row.role = String(cells[fieldIdx.role]).trim() || 'Staff';
    if (fieldIdx.department != null && cells[fieldIdx.department] != null) {
      const d = String(cells[fieldIdx.department]).trim();
      if (d) row.department = d;
    }
    if (fieldIdx.phone_number != null && cells[fieldIdx.phone_number] != null) {
      const p = String(cells[fieldIdx.phone_number]).trim();
      if (p) row.phone_number = p;
    }
    if (fieldIdx.branch != null && cells[fieldIdx.branch] != null) {
      const br = String(cells[fieldIdx.branch]).trim();
      if (br) row.branch = br;
    }
    out.push(row);
  }
  return out;
}

export async function parseStaffFile(file) {
  const name = (file?.name || '').toLowerCase();
  const buf = await file.arrayBuffer();
  if (name.endsWith('.csv') || name.endsWith('.txt')) {
    const text = new TextDecoder('utf-8').decode(buf);
    return parseStaffCsvText(text);
  }
  return parseStaffXlsxArrayBuffer(buf);
}
