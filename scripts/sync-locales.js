const fs = require('fs');

const en = JSON.parse(fs.readFileSync('src/locales/en.json', 'utf8'));
const he = JSON.parse(fs.readFileSync('src/locales/he.json', 'utf8'));
const el = JSON.parse(fs.readFileSync('src/locales/el.json', 'utf8'));

function deepMergeMissing(target, source) {
  if (source === null || typeof source !== 'object' || Array.isArray(source)) return target;
  const out = target && typeof target === 'object' && !Array.isArray(target) ? { ...target } : {};
  for (const [k, v] of Object.entries(source)) {
    if (!(k in out) || out[k] === undefined || out[k] === null) {
      out[k] = v;
    } else if (typeof v === 'object' && !Array.isArray(v) && typeof out[k] === 'object' && !Array.isArray(out[k])) {
      out[k] = deepMergeMissing(out[k], v);
    }
  }
  return out;
}

function flatten(o, p = '') {
  const k = {};
  for (const [key, v] of Object.entries(o || {})) {
    const nk = p ? `${p}.${key}` : key;
    if (v && typeof v === 'object' && !Array.isArray(v)) Object.assign(k, flatten(v, nk));
    else k[nk] = v;
  }
  return k;
}

function deepSet(obj, patch) {
  const out = { ...(obj || {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = deepSet(out[k] && typeof out[k] === 'object' ? out[k] : {}, v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

const elOverrides = {
  sidebarNav: {
    dashboard: '🏠 Επισκόπηση',
    analytics: '📊 Αναλυτικά',
    premium: '🏨 Κέντρο ακινήτων',
    properties: 'Διαχείριση ακινήτων',
    inventory: '🛏 Απόθεμα δωματίων',
    tasks: 'Πίνακας αποστολών',
    crm: '👥 CRM leads',
    operator: '📡 Χειριστής',
    field: '⚡ Πράκτορας πεδίου',
    scheduler: 'Πρόγραμμα βαρδιών',
    manualops: 'Χειροκίνητες λειτουργίες',
    godmode: '🔮 Λειτουργική αριστεία',
    'bazaar-week': '📅 Εβδομάδα προσφορών',
  },
  nav: {
    mainNavigation: 'Κύρια πλοήγηση',
    tasks: 'Αποστολές',
    godMode: 'Λειτουργική αριστεία',
  },
  sidebar: {
    scanToManage: 'Σάρωση για διαχείριση',
    aiAssistant: 'AI Assistant',
    zeroTrust: 'Zero-Trust Secured',
  },
  godMode: {
    demoStaff: 'Προσωπικό επίδειξης',
  },
  languages: {
    hi: 'हिन्दी',
    th: 'ไทย',
    sq: 'Shqip',
  },
  roles: {
    guest: 'Επισκέπτης',
  },
  common: {
    pending: 'Εκκρεμεί',
    done: 'Ολοκληρώθηκε',
    all: 'Όλα',
  },
};

const enSidebarExtra = { 'bazaar-week': '📅 Week 1 deals' };
const heSidebarExtra = { 'bazaar-week': '📅 שבוע פעילות / מבצעים' };

let enOut = { ...en, sidebarNav: { ...en.sidebarNav, ...enSidebarExtra } };
let heOut = deepMergeMissing(he, enOut);
heOut = { ...heOut, sidebarNav: { ...heOut.sidebarNav, ...heSidebarExtra } };
heOut.languages = { ...enOut.languages, ...heOut.languages };

let elOut = deepMergeMissing(el, enOut);
elOut = deepSet(elOut, elOverrides);

fs.writeFileSync('src/locales/en.json', JSON.stringify(enOut, null, 2) + '\n');
fs.writeFileSync('src/locales/he.json', JSON.stringify(heOut, null, 2) + '\n');
fs.writeFileSync('src/locales/el.json', JSON.stringify(elOut, null, 2) + '\n');

const fEn = flatten(enOut);
const fHe = flatten(heOut);
const fEl = flatten(elOut);
const all = new Set([...Object.keys(fEn), ...Object.keys(fHe), ...Object.keys(fEl)]);
const miss = { en: [], he: [], el: [] };
for (const k of all) {
  if (!(k in fEn)) miss.en.push(k);
  if (!(k in fHe)) miss.he.push(k);
  if (!(k in fEl)) miss.el.push(k);
}
console.log('counts', { en: Object.keys(fEn).length, he: Object.keys(fHe).length, el: Object.keys(fEl).length });
console.log('still missing', { en: miss.en.length, he: miss.he.length, el: miss.el.length, missHe: miss.he, missEn: miss.en });
console.log('el sidebarNav.dashboard', fEl['sidebarNav.dashboard']);
console.log('el propertiesPage.title', fEl['propertiesPage.title']);
console.log('en propertiesPage.addGuest', fEn['propertiesPage.addGuest']);
console.log('he sidebarNav.dashboard', fHe['sidebarNav.dashboard']);
