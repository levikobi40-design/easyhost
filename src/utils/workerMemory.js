/**
 * Worker hyper-personalization: static JSON profiles + small local runtime notes.
 * Used by Maya /chat payload and client-side TTS options.
 */

import workerProfiles from '../data/workerProfiles.json';

const RUNTIME_KEY = 'maya_worker_runtime_v1';

function readRuntime() {
  try {
    const raw = localStorage.getItem(RUNTIME_KEY);
    if (!raw) return { praises: [], flags: [] };
    const o = JSON.parse(raw);
    return {
      praises: Array.isArray(o.praises) ? o.praises : [],
      flags: Array.isArray(o.flags) ? o.flags : [],
    };
  } catch {
    return { praises: [], flags: [] };
  }
}

function writeRuntime(next) {
  try {
    localStorage.setItem(RUNTIME_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

/** First token of a display name for greetings. */
export function firstName(name) {
  if (!name || typeof name !== 'string') return '';
  const t = name.trim().split(/\s+/)[0] || '';
  return t.replace(/[,،]/g, '');
}

function matchProfile(displayName) {
  const n = (displayName || '').trim().toLowerCase();
  if (!n) return null;
  for (const w of workerProfiles.workers || []) {
    for (const alias of w.names || []) {
      if (alias && n.includes(String(alias).trim().toLowerCase())) return { ...w };
      if (n === String(alias).trim().toLowerCase()) return { ...w };
    }
  }
  return null;
}

function staffNameFromStore() {
  try {
    const raw = localStorage.getItem('hotel-enterprise-storage');
    const name = raw ? JSON.parse(raw)?.state?.staffProfile?.name : '';
    return (name || '').trim();
  } catch {
    return '';
  }
}

/**
 * Resolved display name: Bikta shift → staff profile → ''.
 */
export function getActiveWorkerDisplayName() {
  try {
    const bikta = sessionStorage.getItem('bikta_shift_worker_name');
    if (bikta && bikta.trim()) return bikta.trim();
  } catch {
    /* ignore */
  }
  return staffNameFromStore();
}

/**
 * Merge static profile + runtime memory lines for /chat.
 */
export function getWorkerPayloadForMaya() {
  const workerDisplayName = getActiveWorkerDisplayName();
  if (!workerDisplayName) {
    return { workerDisplayName: '', workerProfile: null, workerMemoryLines: [] };
  }

  const matched = matchProfile(workerDisplayName);
  const rt = readRuntime();
  const lines = [];

  if (matched) {
    lines.push(
      `Profile: strength=${matched.strength}; tone=${matched.tone}; experience=${matched.experience}; language=${matched.language}.`,
    );
    if (matched.notes) lines.push(String(matched.notes).slice(0, 220));
  } else {
    lines.push('No static profile match — infer tone from how they write; stay warm and human.');
  }

  for (const p of rt.praises.slice(-4)) {
    lines.push(`Memory: ${p}`);
  }

  const workerProfile = matched
    ? {
        id: matched.id,
        strength: matched.strength,
        language: matched.language,
        tone: matched.tone,
        experience: matched.experience,
        notes: matched.notes || '',
      }
    : {
        id: 'unknown',
        strength: '',
        language: 'th',
        tone: 'warm_encouraging',
        experience: 'unknown',
        notes: '',
      };

  return {
    workerDisplayName,
    workerProfile,
    workerMemoryLines: lines,
  };
}

/** Call when a worker completes a room especially well (optional hook). */
export function rememberWorkerPraise(line) {
  if (!line || typeof line !== 'string') return;
  const rt = readRuntime();
  rt.praises = [...(rt.praises || []), line.trim().slice(0, 200)].slice(-12);
  writeRuntime(rt);
}

export function getDefaultManagerFirstName() {
  return workerProfiles.defaultManagerFirstName || 'דורור';
}

export function getWorkerSpeechOptions() {
  const { workerProfile, workerDisplayName } = getWorkerPayloadForMaya();
  if (!workerDisplayName || !workerProfile) return {};
  const lang = (workerProfile.language || 'th').toLowerCase();
  const exp = (workerProfile.experience || '').toLowerCase();
  const tone = (workerProfile.tone || '').toLowerCase();
  let rateBoost = 0;
  let pitchBoost = 0;
  if (exp === 'new' || exp === 'rookie') {
    pitchBoost += 0.02;
    rateBoost -= 0.03;
  }
  if (tone.includes('direct') || exp === 'veteran') {
    rateBoost += 0.02;
  }
  return {
    workerProfile,
    forceLang: lang.startsWith('he') ? 'he-IL' : lang.startsWith('en') ? 'en-US' : 'th-TH',
    rateBoost,
    pitchBoost,
  };
}
