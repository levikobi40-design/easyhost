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
  const filtered = items.filter((p) => {
    const id = String(p?.id || '');
    return id.startsWith('christos-') || !/bazaar|sky\s*tower|leonardo|wework|rooms-branch/i.test(String(p?.name || ''));
  });
  if (!filtered.length && !force) return;
  try {
    const prevSess = loadMappedPropertyList();
    const prevLen = prevSess?.items?.length || 0;
    if (!force && filtered.length === 0 && prevLen > 0) return;
  } catch (_) {
    /* ignore */
  }
  const payload = JSON.stringify({ savedAt: Date.now(), items: filtered });
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
        if (parsed && Array.isArray(parsed.items) && parsed.items.length) {
          return parsed;
        }
      }
    }
  } catch {
    /* fall through */
  }
  const local = readLocalMapped();
  if (local?.items?.length) return local;
  return null;
}
