/**
 * Cache of last successful GET /properties payload (mapped property cards).
 * Session + localStorage mirror — avoids blank grid on slow/empty API responses.
 */
const KEY = 'easyhost_properties_mapped_v2';
const LOCAL_KEY = 'easyhost_properties_mapped_local_v1';

function readLocalMapped() {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.items)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveMappedPropertyList(items, opts = {}) {
  const force = opts.force === true;
  if (!Array.isArray(items)) return;
  try {
    const prevSess = loadMappedPropertyList();
    const prevLen = prevSess?.items?.length || 0;
    if (!force && items.length === 0 && prevLen > 0) return;
    if (!force && prevLen > 0 && items.length > 0 && items.length < Math.min(prevLen, 8)) return;
  } catch (_) {
    /* ignore */
  }
  const payload = JSON.stringify({ savedAt: Date.now(), items });
  try {
    if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(KEY, payload);
  } catch {
    /* quota / private mode */
  }
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(LOCAL_KEY, payload);
  } catch {
    /* quota */
  }
}

export function loadMappedPropertyList() {
  try {
    if (typeof sessionStorage !== 'undefined') {
      const raw = sessionStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.items)) return parsed;
      }
    }
  } catch {
    /* fall through */
  }
  return readLocalMapped();
}
