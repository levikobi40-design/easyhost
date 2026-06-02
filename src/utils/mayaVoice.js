/**
 * Maya voice helpers — Web Speech API (STT) + speechSynthesis (TTS).
 * Does not import the store or dispatch task refresh events (avoids “hiccup” loops).
 */

/** Strip ASCII control chars + DEL (STT glitches). No RegExp control ranges — eslint no-control-regex safe. */
export function stripAsciiControlChars(str) {
  if (!str || typeof str !== 'string') return '';
  let out = '';
  for (let i = 0; i < str.length; i += 1) {
    const c = str.charCodeAt(i);
    out += c < 32 || c === 127 ? ' ' : str[i];
  }
  return out;
}

/** Strip markdown / noise for TTS. */
export function stripForSpeech(text) {
  if (!text || typeof text !== 'string') return '';
  return stripAsciiControlChars(text)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]+`/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_#>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1200);
}

/**
 * Remove SSML-like tags for on-screen chat (Web Speech API ignores most SSML anyway;
 * we parse breaks in speakMayaReply for rhythm).
 */
/** Avoid raw JSON / huge arrays in the Maya chat bubble — keep a short Hebrew line. */
export function formatMayaChatDisplayText(raw) {
  if (raw == null) return '';
  if (typeof raw === 'object') {
    const m = raw.message ?? raw.displayMessage ?? raw.text;
    if (typeof m === 'string' && m.trim()) return formatMayaChatDisplayText(m);
    return 'קיבלתי. איך להמשיך?';
  }
  let s = stripSSMLForDisplay(String(raw));
  const t = s.trim();
  if (t.startsWith('[') && t.length > 120 && /"property|tasks|description|staff"/i.test(t)) {
    try {
      const p = JSON.parse(t);
      if (Array.isArray(p)) {
        return 'עדכנתי את הנתונים. מה השלב הבא?';
      }
    } catch (_) {
      /* fall through */
    }
  }
  if (/\[[\s\S]*\{[\s\S]*"message"[\s\S]*\}\s*\]/.test(t) && t.length > 200) {
    return 'הנה עדכון מהמערכת. רוצה שאפרט?';
  }
  if (t.startsWith('{') && t.length > 160 && /"(success|tasks|message|displayMessage)"/i.test(t)) {
    try {
      const o = JSON.parse(t);
      if (o && typeof o.message === 'string' && o.message.length < 800) {
        return stripSSMLForDisplay(o.message);
      }
      if (o && typeof o.displayMessage === 'string') {
        return stripSSMLForDisplay(o.displayMessage);
      }
    } catch (_) {
      return 'הנה עדכון מהמערכת. רוצה שאפרט?';
    }
  }
  return s
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\s*[-*]\s+/gm, '• ')
    .trim();
}

export function stripSSMLForDisplay(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/<speak[^>]*>/gi, '')
    .replace(/<\/speak>/gi, '')
    .replace(/<break[^>]*\/?>/gi, ' ')
    .replace(/<emphasis[^>]*>/gi, '')
    .replace(/<\/emphasis>/gi, '')
    .replace(/<prosody[^>]*>/gi, '')
    .replace(/<\/prosody>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Split on <break time="Nms"/> for queued TTS with pauses (SSML-like, browser-safe). */
function parseSSMLIntoChunks(text) {
  if (!text || typeof text !== 'string') {
    return [{ text: '', pauseAfter: 0 }];
  }
  const raw = text;
  const re = /<break\s+time=["'](\d+)ms["']\s*\/?>/gi;
  const parts = [];
  let last = 0;
  let m;
  while ((m = re.exec(raw)) !== null) {
    const segment = raw.slice(last, m.index);
    if (segment.trim()) {
      parts.push({
        text: stripSSMLForDisplay(segment),
        pauseAfter: parseInt(m[1], 10) || 0,
      });
    }
    last = m.index + m[0].length;
  }
  const tail = raw.slice(last);
  if (tail.trim()) {
    parts.push({ text: stripSSMLForDisplay(tail), pauseAfter: 0 });
  }
  if (parts.length === 0) {
    parts.push({ text: stripSSMLForDisplay(raw), pauseAfter: 0 });
  }
  return parts.filter((p) => p.text && p.text.trim());
}

/** field role → Thai; admin/host → Hebrew */
export function isWorkerRole(role) {
  return role === 'field' || role === 'worker';
}

export function getMayaSpeechLang(role) {
  return isWorkerRole(role) ? 'th-TH' : 'he-IL';
}

/** Prefer natural Carmit / Google-style voices when the browser exposes them. */
export function pickVoiceForLang(lang) {
  if (typeof window === 'undefined' || !window.speechSynthesis) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices || !voices.length) return null;
  const l = (lang || '').toLowerCase();

  if (l.startsWith('he')) {
    /* Prefer natural neural / “Standard” Hebrew (e.g. IL Standard-D) when exposed by the OS. */
    const standardHe =
      voices.find(
        (v) =>
          (v.lang || '').toLowerCase().startsWith('he') &&
          /standard[- ]?[abd]|he-il.*standard|neural|natural/i.test(`${v.name} ${v.lang}`),
      ) ||
      voices.find(
        (v) =>
          (v.lang || '').toLowerCase().startsWith('he') &&
          /Hila|הילה|Asaf|אסף|Carmit|כרמית/i.test(v.name),
      );
    if (standardHe) return standardHe;
    const carmit = voices.find(
      (v) =>
        /Carmit|כרמית/i.test(v.name) ||
        (/Google/i.test(v.name) && /he|עברית|Hebrew/i.test(`${v.name} ${v.lang}`)),
    );
    if (carmit) return carmit;
    const msHe = voices.find(
      (v) =>
        /Microsoft/i.test(v.name) &&
        (/he|Hebrew|עברית|He-IL/i.test(`${v.name} ${v.lang}`) ||
          (v.lang || '').toLowerCase().startsWith('he')),
    );
    if (msHe) return msHe;
    const he = voices.find((v) => (v.lang || '').toLowerCase().startsWith('he'));
    return he || null;
  }

  if (l.startsWith('th')) {
    const th =
      voices.find(
        (v) =>
          /Google/i.test(v.name) && /th|Thai|ไทย/i.test(`${v.name} ${v.lang}`),
      ) ||
      voices.find(
        (v) =>
          /Microsoft/i.test(v.name) &&
          ((v.lang || '').toLowerCase().startsWith('th') || /Thai|ไทย/i.test(v.name)),
      ) ||
      voices.find((v) => (v.lang || '').toLowerCase().startsWith('th'));
    return th || null;
  }

  if (l.startsWith('en')) {
    const en = voices.find(
      (v) => /Google/i.test(v.name) && /en-US|US English/i.test(`${v.name} ${v.lang}`),
    ) || voices.find((v) => (v.lang || '').toLowerCase().startsWith('en'));
    return en || null;
  }

  return null;
}

/** Warm, human assistant — calm pace, natural pitch (not robotic). Hebrew: warm Israeli manager; Thai: natural polite rhythm. */
export function applyMayaFriendlyVoice(utterance, lang, opts = {}) {
  const u = utterance;
  const l = (lang || '').toLowerCase();
  const rb = opts.rateBoost || 0;
  const pb = opts.pitchBoost || 0;
  if (l.startsWith('he')) {
    /* Warm, natural Hebrew — slightly slower, softer pitch (less robotic). */
    u.rate = Math.min(1.08, Math.max(0.74, 0.86 + rb));
    u.pitch = Math.min(1.1, Math.max(0.88, 0.98 + pb));
  } else if (l.startsWith('th')) {
    u.rate = Math.min(1.1, Math.max(0.72, 0.9 + rb));
    u.pitch = Math.min(1.12, Math.max(0.85, 1.0 + pb));
  } else {
    u.rate = Math.min(1.1, Math.max(0.72, 0.92 + rb));
    u.pitch = Math.min(1.12, Math.max(0.85, 1.02 + pb));
  }
  u.volume = 1;
  const voice = pickVoiceForLang(lang);
  if (voice) u.voice = voice;
}

function ensureVoicesLoadedOnce() {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  try {
    window.speechSynthesis.getVoices();
    window.speechSynthesis.addEventListener(
      'voiceschanged',
      () => {
        window.speechSynthesis.getVoices();
      },
      { once: true },
    );
  } catch (_) {
    /* ignore */
  }
}

if (typeof window !== 'undefined') {
  ensureVoicesLoadedOnce();
}

/** Subtle ping when mic listening starts. */
export function playMicListenPing() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g);
    g.connect(ctx.destination);
    o.frequency.value = 1040;
    o.type = 'sine';
    g.gain.setValueAtTime(0.07, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
    o.start(ctx.currentTime);
    o.stop(ctx.currentTime + 0.09);
  } catch (_) {
    /* ignore */
  }
}

/**
 * Speak assistant reply — SSML-like <break time="300ms"/> becomes real pauses between utterances.
 * options: { forceLang, rateBoost, pitchBoost, workerProfile, onStart, onComplete }
 */
export function speakMayaReply(text, role, options = {}) {
  const done = () => {
    try {
      options.onComplete?.();
    } catch (_) {
      /* ignore */
    }
  };
  if (typeof window === 'undefined' || !window.speechSynthesis) {
    done();
    return;
  }
  let chunks = parseSSMLIntoChunks(text);
  if (!chunks.length) {
    const p = stripForSpeech(stripSSMLForDisplay(text));
    if (!p) {
      done();
      return;
    }
    chunks = [{ text: p, pauseAfter: 0 }];
  }
  const voiceOpts = {
    rateBoost: options.rateBoost || 0,
    pitchBoost: options.pitchBoost || 0,
  };
  try {
    window.speechSynthesis.cancel();
    try {
      options.onStart?.();
    } catch (_) {
      /* ignore */
    }
    const lang = options.forceLang || getMayaSpeechLang(role);
    const speakAt = (idx) => {
      if (idx >= chunks.length) {
        done();
        return;
      }
      const c = chunks[idx];
      const piece = stripForSpeech(c.text);
      if (!piece.trim()) {
        setTimeout(() => speakAt(idx + 1), c.pauseAfter || 0);
        return;
      }
      const u = new SpeechSynthesisUtterance(piece);
      u.lang = lang;
      applyMayaFriendlyVoice(u, lang, voiceOpts);
      u.onend = () => {
        const pause = c.pauseAfter || 0;
        if (pause > 0) setTimeout(() => speakAt(idx + 1), pause);
        else speakAt(idx + 1);
      };
      u.onerror = () => speakAt(idx + 1);
      window.speechSynthesis.speak(u);
    };
    speakAt(0);
  } catch (_) {
    done();
  }
}

/** Proactive: room stayed red too long — admin (Hebrew) or worker (Thai). */
export function speakBiktaProactiveStaleRed({ isAdmin, roomIndex, managerFirstName, workerFirstName }) {
  const ri = Number(roomIndex) || 0;
  if (!ri) return;
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  const mgr = managerFirstName || 'דורור';
  const text = isAdmin
    ? `${mgr}, שמתי לב שחדר ${ri} מחכה הרבה זמן. רוצה שאשלח הודעה לעובד?`
    : `เรียนค่ะ ห้อง ${ri} รอมานานแล้วนะคะ ${workerFirstName ? `${workerFirstName} ` : ''}ต้องการให้ช่วยประสานไหมคะ`;
  try {
    window.speechSynthesis.cancel();
    const lang = isAdmin ? 'he-IL' : 'th-TH';
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    applyMayaFriendlyVoice(u, lang);
    window.speechSynthesis.speak(u);
  } catch (_) {
    /* ignore */
  }
}

export function cancelMayaSpeech() {
  try {
    window.speechSynthesis?.cancel();
  } catch (_) {
    /* ignore */
  }
}

/** Light human fillers for Hebrew TTS (not shown in chat bubble). */
function sprinkleHebrewTtsFillers(spoken) {
  const s = String(spoken || '').trim();
  if (!s || !/[\u0590-\u05FF]/.test(s)) return s;
  if (Math.random() > 0.35) return s;
  const fillers = ['אהמ, ', 'אוקיי, ', 'רגע, ', 'כן, '];
  return `${fillers[Math.floor(Math.random() * fillers.length)]}${s}`;
}

/** Text safe for SpeechSynthesis — no JSON dumps in spoken output. */
export function textForMayaTTS(raw) {
  if (raw == null) return '';
  const displayed = formatMayaChatDisplayText(typeof raw === 'string' ? raw : String(raw));
  const stripped = stripForSpeech(displayed);
  return sprinkleHebrewTtsFillers(stripped);
}

export function getSpeechRecognitionCtor() {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

/** Returns text after wake word, or '' if missing / wake only */
export function extractAfterWakeWord(transcript) {
  const t = (transcript || '').trim();
  if (!t) return '';
  const re = /(?:מאיה|מיה|Maya)\s*[,:]?\s*(.*)$/i;
  const m = t.match(re);
  if (m && m[1] != null) {
    const rest = m[1].trim();
    if (rest) return rest;
  }
  if (/^(?:מאיה|מיה|Maya)[.!?\s]*$/i.test(t)) return '';
  return '';
}

export function transcriptHasWakeWord(transcript) {
  return /(?:^|\s)(?:מאיה|מיה|Maya)(?:\s|$|[,:])/i.test(transcript || '');
}

/** Same copy as TTS (for chat bubble when a new dirty room appears). */
export function getBiktaNewTaskSpeechText(roomIndex, isWorker) {
  const n = Number(roomIndex) || 0;
  return isWorker
    ? `เรียนค่ะ มีงานใหม่ที่ห้อง ${n} กรุณาตรวจสอบ`
    : `Attention, new task in room ${n}`;
}

/** Bikta “red X” — spoken alert (worker = Thai, admin = English). */
export function speakBiktaNewTask(roomIndex, isWorker, options = {}) {
  const finish = () => {
    try {
      options.onComplete?.();
    } catch (_) {
      /* ignore */
    }
  };
  if (typeof window === 'undefined' || !window.speechSynthesis) {
    finish();
    return;
  }
  const text = getBiktaNewTaskSpeechText(roomIndex, isWorker);
  const lang = isWorker ? 'th-TH' : 'en-US';
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    applyMayaFriendlyVoice(u, lang);
    u.onend = finish;
    u.onerror = finish;
    window.speechSynthesis.speak(u);
  } catch (_) {
    finish();
  }
}

const BIKTA_ORANGE_HE = 'נהדר, אני מעדכנת את המנהל שאתה בדרך!';
const BIKTA_GREEN_HE = 'כל הכבוד! החדר מוכן לאורחים.';

/** Worker tapped room → orange (on the way) or green (clean) — Hebrew cues for manager update flow. */
export function speakBiktaWorkerPhaseCue(phase) {
  if (phase !== 'orange' && phase !== 'green') return;
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  const text = phase === 'orange' ? BIKTA_ORANGE_HE : BIKTA_GREEN_HE;
  const lang = 'he-IL';
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    applyMayaFriendlyVoice(u, lang);
    window.speechSynthesis.speak(u);
  } catch (_) {
    /* ignore */
  }
}

/** Level-up praise after green when cleaning was >10% faster than 7‑day average. */
export function speakBiktaPerformancePraise(event, preferThai) {
  if (!event || !event.level_up) return;
  const text = preferThai ? event.praise_th : event.praise_he;
  if (!text || typeof window === 'undefined' || !window.speechSynthesis) return;
  const lang = preferThai ? 'th-TH' : 'he-IL';
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    applyMayaFriendlyVoice(u, lang);
    window.speechSynthesis.speak(u);
  } catch (_) {
    /* ignore */
  }
}

/** End-of-shift celebration (response-time improvement vs prior week). */
export function speakBiktaShiftCelebration(celebration, preferThai) {
  if (!celebration || typeof window === 'undefined' || !window.speechSynthesis) return;
  const text = preferThai ? celebration.th : celebration.he;
  if (!text) return;
  const lang = preferThai ? 'th-TH' : 'he-IL';
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    applyMayaFriendlyVoice(u, lang);
    window.speechSynthesis.speak(u);
  } catch (_) {
    /* ignore */
  }
}
