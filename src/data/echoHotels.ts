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
      const status = STATUS_CYCLE[seq % STATUS_CYCLE.length];
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
    id: 'happy-hour',
    label: 'מה שעות ה-Happy Hour והיין בלובי?',
    answer:
      'ה-Happy Hour שלנו מתקיים בכל ערב בלובי בין 18:00 ל-19:30 כולל כוס יין במתנה!',
  },
  {
    id: 'wifi',
    label: 'מה קוד ה-Wi-Fi בחדר?',
    answer: 'רשת: Echo_Guest | סיסמה: Echo2026',
  },
  {
    id: 'breakfast',
    label: 'איפה אפשר לאכול ארוחת בוקר קרוב?',
    answer:
      'ארוחת הבוקר מוגשת בבתי הקפה השותפים שלנו ממש ליד המלון ברחוב דיזנגוף / בן יהודה.',
  },
] as const;

export const ECHO_CTA_HE =
  'נבנה במיוחד עבור הנהלת Echo Hotels | פיילוט תפעולי של 14 ימים ללא עלות וללא צורך בחיבור מורכב ב-PMS.';

/** Free-text Maya replies keyed by simple intent tokens (Hebrew + English). */
export function echoMayaFreeTextReply(input: string, propertyName: string): string {
  const t = (input || '').trim().toLowerCase();
  if (!t) {
    return `שלום מ־Echo Hotels (${propertyName})! במה אפשר לעזור?`;
  }
  if (/wifi|ויי.?פי|סיסמ|קוד.?ה.?wi/i.test(t) || t.includes('wifi') || t.includes('וייפי') || t.includes('wi-fi')) {
    return ECHO_MAYA_PROMPTS[1].answer;
  }
  if (/happy.?hour|הפי.?אוור|יין|לובי/i.test(t)) {
    return ECHO_MAYA_PROMPTS[0].answer;
  }
  if (/בוקר|breakfast|לאכול|קפה|דיזנגוף|בן.?יהודה/i.test(t)) {
    return ECHO_MAYA_PROMPTS[2].answer;
  }
  if (/ספא|spa|בריכה|pool|חוף|beach/i.test(t)) {
    return `ב־${propertyName} אפשר לתאם ספא / בריכה דרך הקבלה — אשמח להפנות אתכם.`;
  }
  if (/צ.?ק.?אאוט|checkout|check.?out|יציאה/i.test(t)) {
    return 'צ׳ק-אאוט עד 11:00. אפשר לבקש late checkout בקבלה לפי זמינות.';
  }
  if (/צ.?ק.?אין|check.?in|הגעה/i.test(t)) {
    return 'צ׳ק-אין החל מ־15:00. מוקדמים? הקבלה תשמור את המזוודות בשמחה.';
  }
  return (
    `תודה על הפנייה ל־Echo Hotels (${propertyName}). ` +
    'קיבלתי את ההודעה — הקבלה או Maya ב־WhatsApp יחזרו אליך מיד עם תשובה מדויקת.'
  );
}
