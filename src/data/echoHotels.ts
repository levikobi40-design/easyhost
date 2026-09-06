/**
 * Echo Hotels (Tel Aviv) — authoritative multi-property demo data.
 * Room counts and types are locked; the grid must never invent types
 * outside each property's `roomTypes` list.
 */

export type EchoPropertyId =
  | 'echo-dizengoff-avenue'
  | 'echo-dizengoff-garden'
  | 'echo-sea-land-suites'
  | 'echo-iconic-hotel';

export type EchoOpsStatus =
  | 'Dirty / In Progress'
  | 'Ready / Inspected'
  | 'Occupied / Do Not Disturb';

export type EchoRoomTypeAllocation = {
  /** Exact room-type label shown on cards */
  type: string;
  /** How many units of this type (must sum to property.totalUnits) */
  count: number;
  /** Starting floor / hundred block for room numbers (e.g. 1 → 101+) */
  floor: number;
};

export type EchoPropertyDef = {
  id: EchoPropertyId;
  name: string;
  shortName: string;
  address: string;
  totalUnits: number;
  roomTypes: readonly EchoRoomTypeAllocation[];
};

export type EchoRoom = {
  id: string;
  propertyId: EchoPropertyId;
  roomNumber: number;
  roomType: string;
  status: EchoOpsStatus;
  housekeeper: string;
  lastCleanedAt: string; // ISO
  enquiryOpen: boolean;
};

export const ECHO_CHAIN_NAME = 'Echo Hotels' as const;
export const ECHO_TAGLINE = 'Multi-Property Operational AI' as const;

export const ECHO_HOUSEKEEPERS = [
  'נועה לוי',
  'דניאל כהן',
  'מאיה אברהם',
  'יוסי מזרחי',
  'שירה בן-דוד',
] as const;

/** Canonical property definitions — source of truth for types & counts. */
export const ECHO_PROPERTIES: readonly EchoPropertyDef[] = [
  {
    id: 'echo-dizengoff-avenue',
    name: 'Dizengoff Avenue',
    shortName: 'Avenue',
    address: '133 Dizengoff St, Tel Aviv',
    totalUnits: 29,
    roomTypes: [
      { type: 'Economy Room', count: 8, floor: 1 },
      { type: 'Classic Room', count: 8, floor: 2 },
      { type: 'Superior Room with Balcony', count: 7, floor: 3 },
      { type: 'Premium Room with Balcony', count: 6, floor: 4 },
    ],
  },
  {
    id: 'echo-dizengoff-garden',
    name: 'Dizengoff Garden',
    shortName: 'Garden',
    address: '138 Dizengoff St, Tel Aviv',
    totalUnits: 23,
    roomTypes: [
      { type: 'Classic Room', count: 9, floor: 1 },
      { type: 'Double Room', count: 8, floor: 2 },
      { type: 'Superior Room', count: 6, floor: 3 },
    ],
  },
  {
    id: 'echo-sea-land-suites',
    name: 'Sea-Land Suites',
    shortName: 'Sea-Land',
    address: '84 Ben Yehuda St, Tel Aviv',
    totalUnits: 20,
    roomTypes: [
      { type: 'Garden Suite', count: 6, floor: 1 },
      { type: 'Junior Suite with Balcony', count: 6, floor: 2 },
      { type: 'Junior Penthouse Suite', count: 4, floor: 3 },
      { type: 'Deluxe Suite with Balcony', count: 4, floor: 4 },
    ],
  },
  {
    id: 'echo-iconic-hotel',
    name: 'Iconic Hotel',
    shortName: 'Iconic',
    address: '147 Yehuda HaLevi St, Tel Aviv',
    totalUnits: 16,
    roomTypes: [
      { type: 'Economy Room', count: 6, floor: 1 },
      { type: 'Classic Room', count: 6, floor: 2 },
      { type: 'Deluxe Room', count: 4, floor: 3 },
    ],
  },
] as const;

/** Fail fast if allocations drift from totalUnits. */
function assertPropertyIntegrity(p: EchoPropertyDef): void {
  const sum = p.roomTypes.reduce((n, r) => n + r.count, 0);
  if (sum !== p.totalUnits) {
    throw new Error(
      `[EchoHotels] ${p.name}: roomTypes sum ${sum} ≠ totalUnits ${p.totalUnits}`,
    );
  }
}

ECHO_PROPERTIES.forEach(assertPropertyIntegrity);

const STATUS_CYCLE: EchoOpsStatus[] = [
  'Ready / Inspected',
  'Occupied / Do Not Disturb',
  'Dirty / In Progress',
  'Ready / Inspected',
  'Occupied / Do Not Disturb',
  'Dirty / In Progress',
  'Ready / Inspected',
];

function hoursAgoIso(hours: number): string {
  return new Date(Date.now() - hours * 3600_000).toISOString();
}

/**
 * Build the exact room grid for one property.
 * Room numbers = floor*100 + 1..count (e.g. floor 1 → 101–108).
 * Every roomType is taken only from that property's allocation.
 */
export function buildRoomsForProperty(propertyId: EchoPropertyId): EchoRoom[] {
  const prop = ECHO_PROPERTIES.find((p) => p.id === propertyId);
  if (!prop) throw new Error(`[EchoHotels] Unknown property: ${propertyId}`);

  const rooms: EchoRoom[] = [];
  let seq = 0;
  for (const alloc of prop.roomTypes) {
    for (let i = 0; i < alloc.count; i += 1) {
      const roomNumber = alloc.floor * 100 + (i + 1);
      let status = STATUS_CYCLE[seq % STATUS_CYCLE.length];
      // Demo narrative: Avenue 102 is mid-clean (Maya avatar sample prompt).
      if (propertyId === 'echo-dizengoff-avenue' && roomNumber === 102) {
        status = 'Dirty / In Progress';
      }
      rooms.push({
        id: `${propertyId}-r${roomNumber}`,
        propertyId,
        roomNumber,
        roomType: alloc.type,
        status,
        housekeeper: ECHO_HOUSEKEEPERS[seq % ECHO_HOUSEKEEPERS.length],
        lastCleanedAt: hoursAgoIso(2 + (seq % 18)),
        enquiryOpen: seq % 7 === 0 && status !== 'Ready / Inspected',
      });
      seq += 1;
    }
  }

  if (rooms.length !== prop.totalUnits) {
    throw new Error(
      `[EchoHotels] Generated ${rooms.length} rooms for ${prop.name}, expected ${prop.totalUnits}`,
    );
  }
  return rooms;
}

export function getEchoProperty(id: EchoPropertyId): EchoPropertyDef {
  const p = ECHO_PROPERTIES.find((x) => x.id === id);
  if (!p) throw new Error(`[EchoHotels] Unknown property: ${id}`);
  return p;
}

export type EchoPropertyStats = {
  totalRooms: number;
  occupancyPct: number;
  activeHousekeeping: number;
  pendingEnquiries: number;
};

export function computeEchoStats(rooms: EchoRoom[]): EchoPropertyStats {
  const totalRooms = rooms.length;
  const occupied = rooms.filter((r) => r.status === 'Occupied / Do Not Disturb').length;
  const activeHousekeeping = rooms.filter((r) => r.status === 'Dirty / In Progress').length;
  const pendingEnquiries = rooms.filter((r) => r.enquiryOpen).length;
  const occupancyPct =
    totalRooms === 0 ? 0 : Math.round((occupied / totalRooms) * 1000) / 10;
  return { totalRooms, occupancyPct, activeHousekeeping, pendingEnquiries };
}

export const ECHO_MAYA_PROMPTS: readonly {
  id: string;
  label: string;
  answer: string;
}[] = [
  {
    id: 'happy-hour-garden',
    label: 'מתי הראפי האוור בדיזינגוף גארדן?',
    answer:
      'ה-Happy Hour בדיזינגוף גארדן מתקיים בכל יום בלובי בין השעות 18:00 ל-19:30, וכולל יין ונשנושים חופשי. תרצה שאשלח תזכורת לאורחים?',
  },
  {
    id: 'room-102',
    label: 'מה המצב בחדר 102?',
    answer: '', // resolved live from room grid in echoMayaAvatarReply
  },
  {
    id: 'wifi',
    label: 'מה קוד ה-Wi-Fi בחדר?',
    answer: 'רשת Echo Guest, סיסמה Echo 2026. אפשר להתחבר מיד בחדר.',
  },
  {
    id: 'breakfast',
    label: 'איפה אפשר לאכול ארוחת בוקר קרוב?',
    answer:
      'ארוחת הבוקר מוגשת בבתי הקפה השותפים ליד המלון ברחוב דיזנגוף או בן יהודה.',
  },
] as const;

export const ECHO_CTA_HE =
  'נבנה במיוחד עבור הנהלת Echo Hotels | פיילוט תפעולי של 14 ימים ללא עלות וללא צורך בחיבור מורכב ב-PMS.';

/** Spoken-avatar system persona (WhatsApp / Operations preview). */
export const MAYA_ECHO_AVATAR_PERSONA = `
You are Maya (מאיה), EasyHost AI operational assistant and guest concierge for Echo Hotels Tel Aviv.
Properties: Dizengoff Avenue, Dizengoff Garden, Sea-Land Suites, Iconic Hotel.
Tone: professional, warm, helpful, concise. Hebrew by default; English only if the user writes English.
Brevity: 1–3 short sentences max — output is spoken by an interactive video avatar.
Formatting: plain text only. No bullets, tables, markdown, or code.
Capabilities: room cleaning status, check-in/out help, maintenance alerts, concierge (Wi-Fi, Happy Hour, amenities).
`.trim();

const PROPERTY_ALIASES: { id: EchoPropertyId; he: string; en: RegExp }[] = [
  {
    id: 'echo-dizengoff-garden',
    he: 'דיזינגוף גארדן',
    en: /dizengoff\s*garden|garden/i,
  },
  {
    id: 'echo-dizengoff-avenue',
    he: 'דיזינגוף אבניו',
    en: /dizengoff\s*avenue|avenue|אבניו/i,
  },
  {
    id: 'echo-sea-land-suites',
    he: 'סי־לנד סוויטס',
    en: /sea[- ]?land|בן\s*יהודה/i,
  },
  {
    id: 'echo-iconic-hotel',
    he: 'אייקוניק',
    en: /iconic|יהודה\s*הלוי/i,
  },
];

function hebrewPropertyName(id: EchoPropertyId): string {
  return PROPERTY_ALIASES.find((p) => p.id === id)?.he || getEchoProperty(id).name;
}

function clampSpoken(text: string, maxSentences = 3): string {
  const plain = String(text || '')
    .replace(/[*_`#>-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!plain) return '';
  const parts = plain.split(/(?<=[.!?…])\s+/).filter(Boolean);
  return parts.slice(0, maxSentences).join(' ');
}

export type EchoMayaReplyContext = {
  propertyId: EchoPropertyId;
  propertyName: string;
  rooms: EchoRoom[];
};

function resolveRoomStatusLine(
  roomNumber: number,
  ctx: EchoMayaReplyContext,
): string {
  const room =
    ctx.rooms.find((r) => r.roomNumber === roomNumber) ||
    // Cross-property fallback for demo questions like "חדר 102"
    ECHO_PROPERTIES.flatMap((p) =>
      p.id === ctx.propertyId ? [] : buildRoomsForProperty(p.id),
    ).find((r) => r.roomNumber === roomNumber);

  const propId = room?.propertyId || ctx.propertyId;
  const propHe = hebrewPropertyName(propId);
  if (!room) {
    return `לא מצאתי את חדר ${roomNumber} ב־Echo Hotels כרגע. אפשר לבדוק מספר אחר?`;
  }
  if (room.status === 'Dirty / In Progress') {
    return `חדר ${roomNumber} ב${propHe} נמצא כרגע בסטטוס ניקיון. צוות המשק מעריך שהוא יהיה מוכן בתוך 20 דקות.`;
  }
  if (room.status === 'Ready / Inspected') {
    return `חדר ${roomNumber} ב${propHe} מוכן ובדוק. אפשר לשבץ אורח מיד.`;
  }
  return `חדר ${roomNumber} ב${propHe} תפוס כרגע, עם בקשת לא להפריע.`;
}

/**
 * Avatar-safe Maya reply for Echo Hotels WhatsApp / Operations preview.
 * Always plain Hebrew/English prose, 1–3 sentences, no markdown.
 */
export function echoMayaAvatarReply(
  input: string,
  ctx: EchoMayaReplyContext,
): string {
  const raw = (input || '').trim();
  const t = raw.toLowerCase();
  const isEn = /^[\x00-\x7F\s\d.,!?'"\-]+$/.test(raw) && /[a-z]/i.test(raw);

  if (!raw) {
    return isEn
      ? 'Hi, I am Maya from Echo Hotels. How can I help?'
      : 'שלום, אני מאיה מ־Echo Hotels. במה אוכל לעזור?';
  }

  const roomMatch =
    raw.match(/(?:חדר|room)\s*#?\s*(\d{2,4})/i) ||
    (/מצב|status|ניק|clean|ready|מוכן/i.test(raw) ? raw.match(/\b(\d{3})\b/) : null);
  if (roomMatch) {
    return clampSpoken(resolveRoomStatusLine(Number(roomMatch[1]), ctx));
  }

  const mentionedGarden =
    /גארדן|garden|דיזינגוף\s*גארדן/i.test(raw) || /ראפי|הפי|happy/i.test(t);
  if (/happy.?hour|הפי.?אוור|ראפי.?אוור|יין|לובי/i.test(t) || /ראפי/.test(raw)) {
    const place = mentionedGarden && /גארדן|garden/i.test(raw)
      ? 'בדיזינגוף גארדן'
      : `ב${hebrewPropertyName(ctx.propertyId)}`;
    return clampSpoken(
      `ה-Happy Hour ${place} מתקיים בכל יום בלובי בין השעות 18:00 ל-19:30, וכולל יין ונשנושים חופשי. תרצה שאשלח תזכורת לאורחים?`,
    );
  }

  if (/wifi|ויי.?פי|סיסמ|קוד.?ה.?wi|wi-fi/i.test(t) || raw.includes('וייפי')) {
    return clampSpoken('רשת Echo Guest, סיסמה Echo 2026. אפשר להתחבר מיד בחדר.');
  }

  if (/בוקר|breakfast|לאכול|קפה/i.test(t)) {
    return clampSpoken(
      'ארוחת הבוקר מוגשת בבתי הקפה השותפים ליד המלון ברחוב דיזנגוף או בן יהודה.',
    );
  }

  if (/צ.?ק.?אאוט|checkout|check.?out|יציאה/i.test(t)) {
    return clampSpoken('צ׳ק-אאוט עד שעה אחת עשרה. אפשר לבקש יציאה מאוחרת בקבלה לפי זמינות.');
  }

  if (/צ.?ק.?אין|check.?in|הגעה/i.test(t)) {
    return clampSpoken('צ׳ק-אין החל משלוש אחר הצהריים. מוקדמים? הקבלה תשמור מזוודות בשמחה.');
  }

  if (/תחזוק|maintenance|תקלה|שבור|broken|leak|דליפ/i.test(t)) {
    return clampSpoken(
      `קיבלתי. אפתח התראת תחזוקה עבור ${ctx.propertyName} ואעדכן את הצוות מיד.`,
    );
  }

  if (/ניק|clean|housekeep|משק/i.test(t)) {
    const dirty = ctx.rooms.filter((r) => r.status === 'Dirty / In Progress').length;
    return clampSpoken(
      dirty > 0
        ? `ב${hebrewPropertyName(ctx.propertyId)} יש כרגע ${dirty} חדרים בניקיון פעיל. רוצה עדכון על חדר מסוים?`
        : `ב${hebrewPropertyName(ctx.propertyId)} אין כרגע חדרים בניקיון פעיל. הכול נראה מוכן.`,
    );
  }

  if (isEn) {
    return clampSpoken(
      `Thanks — I am Maya at Echo Hotels ${ctx.propertyName}. Ask me about rooms, Wi-Fi, Happy Hour, or check-in.`,
    );
  }

  return clampSpoken(
    `תודה, אני מאיה מ־Echo Hotels ב${hebrewPropertyName(ctx.propertyId)}. אפשר לשאול על חדר, Wi-Fi, Happy Hour או צ׳ק-אין.`,
  );
}

/** @deprecated use echoMayaAvatarReply — kept for older call sites */
export function echoMayaFreeTextReply(input: string, propertyName: string): string {
  const prop = ECHO_PROPERTIES.find((p) => p.name === propertyName) || ECHO_PROPERTIES[0];
  return echoMayaAvatarReply(input, {
    propertyId: prop.id,
    propertyName: prop.name,
    rooms: buildRoomsForProperty(prop.id),
  });
}
