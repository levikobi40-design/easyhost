import { ROOMS_BRANCH_PINS, ROOMS_PIN_ID_SET } from '../config/roomsBranches';
import { WEWORK_PIN_ID_SET } from '../config/weworkBranches';
import { BAZAAR_JAFFA_PROPERTY_ID } from '../data/propertyData';

/** Hotel Bazaar Jaffa + 14× ROOMS — same order as backend `_default_portfolio_seed_rooms` (15 unique card images). */
export const DEMO_FIFTEEN_PROPERTY_ORDER = [
  BAZAAR_JAFFA_PROPERTY_ID,
  ...ROOMS_BRANCH_PINS.map((b) => b.id),
];

/**
 * Exactly 15 distinct Unsplash heroes — modern office, boutique hotel, coworking (PropertiesView / grid).
 */
export const PROPERTIES_VIEW_15_UNIQUE_IMAGES = [
  'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1524758631624-e2822e304c36?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1522071820081-009f0129c71c?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1497366811353-6870744d04b2?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1604328698692-f76ea9498e76?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1517245385007-cbe13ea217f0?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1556761175-b413da4baf72?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1504384308090-c894fdcc538d?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1560185007-cde436f6a4d0?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1502005229762-cf1b2da7c5d6?auto=format&fit=crop&w=1200&q=80',
];

/** Historic / boutique hotel — Hotel Bazaar Jaffa */
export const BAZAAR_BOUTIQUE_HOTEL_IMG =
  'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1200&q=80';

/** ROOMS Neve Tzedek — classy Tel Aviv–style workspace */
export const ROOMS_NEVE_TZEDEK_IMG =
  'https://images.unsplash.com/photo-1497215848784-45b487b46c0b?auto=format&fit=crop&w=1200&q=80';

/** WeWork Sarona — vibrant modern industrial office */
export const WEWORK_SARONA_INDUSTRIAL_IMG =
  'https://images.unsplash.com/photo-1604328698692-f76ea9498e76?auto=format&fit=crop&w=1200&q=80';

/** Legacy exports — map to new heroes */
export const PROPERTY_CARD_IMG_BAZAAR = BAZAAR_BOUTIQUE_HOTEL_IMG;
export const PROPERTY_CARD_IMG_WORKSPACE =
  'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=1200&q=80';

/**
 * Curated Unsplash set — 32 distinct URLs (modern office, boutique lobby, scandinavian workspace, hotel).
 * Full portfolio grid (26+ cards) indexes without repeating when using idx < length.
 */
export const UNIQUE_PROPERTY_IMAGE_POOL = [
  'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1497215848784-45b487b46c0b?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1524758631624-e2822e304c36?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1604328698692-f76ea9498e76?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1522071820081-009f0129c71c?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1497366811353-6870744d04b2?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1517245385007-cbe13ea217f0?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1556761175-b413da4baf72?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1504384308090-c894fdcc538d?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1560185007-cde436f6a4d0?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1502005229762-cf1b2da7c5d6?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1600047509807-ba8f99d2cdde?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1600121848594-d8644e57abab?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1631049035182-249067d7618e?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1615874959474-d60996a1fe29?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1618220175828-2297ee0c8eb0?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1615876234886-fd9a39fda97f?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1600880292203-757bb62b4baf?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1497215728101-856f4ea42174?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1604079628040-94301067100a?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1519710164239-da123dc03ef4?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1524756476664-24e9e637436e?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1600585154526-990dced4db0d?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1600573472592-401b3a5e5a71?auto=format&fit=crop&w=1200&q=80',
];

/** Extra distinct heroes (resort, workspace, urban) so long lists never repeat within one grid. */
export const PROPERTY_IMAGE_OVERFLOW = [
  'https://images.unsplash.com/photo-1578683010236-d716f9a3f461?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1590490360182-c33d57733427?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1618773928121-c32242e63f39?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1566664042-f4c6fe9a6b9e?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1523217582562-09d0c993a40d?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1600607687644-c7171b42498f?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1600566752355-35792bedcfea?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1600585154526-990dced4db0d?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1600047509358-9dc75507daeb?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1602343168117-bb8ffe3e2e9f?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1605276374104-dee2a0ed3cd6?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1605142859862-eaa6e3e29aa7?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1600585154084-4e5fe7c39198?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1600566753089-00f18fb6b3ea?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1600585154363-67eb9e2e2099?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1600047509782-487d2788f7a4?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1600607688969-a5bfcd646154?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1600585154526-990dced4db0d?auto=format&fit=crop&w=1200&q=81',
  'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1560185893-a0cbc6ea8879?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1560448075-bb485b067938?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1554995207-c18c203602cb?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1556912172-45b7abe8b7e1?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1556020685-41bfe6d62cd0?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1556911220-e15b29be8c8f?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1556911220-bff31c812dba?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1493809842364-78817add7ffb?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1484154218962-a197022b5858?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1507089947368-19c1da9775ae?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1513694203232-719a280e022f?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1522771739844-6a9f6d5f14af?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1598928506311-c55ded91a20c?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1571003123894-1f0594d2b48d?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1200&q=81',
  'https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1445019980597-93fa8acb246c?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1431576901776-e539bd916ba2?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1497366811353-6870744d04b2?auto=format&fit=crop&w=1200&q=81',
  'https://images.unsplash.com/photo-1497215848784-45b487b46c0b?auto=format&fit=crop&w=1200&q=81',
  'https://images.unsplash.com/photo-1604328698692-f76ea9498e76?auto=format&fit=crop&w=1200&q=81',
  'https://images.unsplash.com/photo-1564501049412-61c2a3083791?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1551882547-ff40c742a0ff?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?auto=format&fit=crop&w=1200&q=81',
  'https://images.unsplash.com/photo-1560185007-cde436f6a4d0?auto=format&fit=crop&w=1200&q=81',
  'https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?auto=format&fit=crop&w=1200&q=81',
  'https://images.unsplash.com/photo-1502005229762-cf1b2da7c5d6?auto=format&fit=crop&w=1200&q=81',
  'https://images.unsplash.com/photo-1611892440504-42a792e54d34?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1596436889106-be35e843f974?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1584132967334-10e028bd69f7?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1200&q=82',
];

const CARD_PLACEHOLDER_UNIVERSE = Array.from(
  new Set([...UNIQUE_PROPERTY_IMAGE_POOL, ...PROPERTY_IMAGE_OVERFLOW]),
);

const GENERIC =
  'https://images.unsplash.com/photo-1613977257363-707ba9348227?w=1200&auto=format&fit=crop';

/**
 * High-res Unsplash heroes: business interiors — open plan, meeting rooms, coworking, reception, lounges.
 * Used for WeWork, ROOMS, and name/slug matches (office / work / station / meeting room, etc.).
 * Keep diverse angles and styles; deduped below.
 */
const _WORKSPACE_BUSINESS_INTERIOR_RAW = [
  'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=1600&q=85',
  'https://images.unsplash.com/photo-1497215848784-45b487b46c0b?auto=format&fit=crop&w=1600&q=85',
  'https://images.unsplash.com/photo-1524758631624-e2822e304c36?auto=format&fit=crop&w=1600&q=85',
  'https://images.unsplash.com/photo-1604328698692-f76ea9498e76?auto=format&fit=crop&w=1600&q=85',
  'https://images.unsplash.com/photo-1522071820081-009f0129c71c?auto=format&fit=crop&w=1600&q=85',
  'https://images.unsplash.com/photo-1497366811353-6870744d04b2?auto=format&fit=crop&w=1600&q=85',
  'https://images.unsplash.com/photo-1517245385007-cbe13ea217f0?auto=format&fit=crop&w=1600&q=85',
  'https://images.unsplash.com/photo-1556761175-b413da4baf72?auto=format&fit=crop&w=1600&q=85',
  'https://images.unsplash.com/photo-1504384308090-c894fdcc538d?auto=format&fit=crop&w=1600&q=85',
  'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1600&q=85',
  'https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?auto=format&fit=crop&w=1600&q=85',
  'https://images.unsplash.com/photo-1560185007-cde436f6a4d0?auto=format&fit=crop&w=1600&q=85',
  'https://images.unsplash.com/photo-1600880292203-757bb62b4baf?auto=format&fit=crop&w=1600&q=85',
  'https://images.unsplash.com/photo-1497215728101-856f4ea42174?auto=format&fit=crop&w=1600&q=85',
  'https://images.unsplash.com/photo-1604079628040-94301067100a?auto=format&fit=crop&w=1600&q=85',
  'https://images.unsplash.com/photo-1519710164239-da123dc03ef4?auto=format&fit=crop&w=1600&q=85',
  'https://images.unsplash.com/photo-1524756476664-24e9e637436e?auto=format&fit=crop&w=1600&q=85',
  'https://images.unsplash.com/photo-1600585154526-990dced4db0d?auto=format&fit=crop&w=1600&q=85',
  'https://images.unsplash.com/photo-1600573472592-401b3a5e5a71?auto=format&fit=crop&w=1600&q=85',
  'https://images.unsplash.com/photo-1618220175828-2297ee0c8eb0?auto=format&fit=crop&w=1600&q=85',
  'https://images.unsplash.com/photo-1615876234886-fd9a39fda97f?auto=format&fit=crop&w=1600&q=85',
  'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=1600&q=85',
  'https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?auto=format&fit=crop&w=1600&q=85',
  'https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?auto=format&fit=crop&w=1600&q=85',
  'https://images.unsplash.com/photo-1600047509807-ba8f99d2cdde?auto=format&fit=crop&w=1600&q=85',
  'https://images.unsplash.com/photo-1600121848594-d8644e57abab?auto=format&fit=crop&w=1600&q=85',
  'https://images.unsplash.com/photo-1631049035182-249067d7618e?auto=format&fit=crop&w=1600&q=85',
  'https://images.unsplash.com/photo-1615874959474-d60996a1fe29?auto=format&fit=crop&w=1600&q=85',
  'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=1600&q=85',
  'https://images.unsplash.com/photo-1560185893-a0cbc6ea8879?auto=format&fit=crop&w=1600&q=85',
  'https://images.unsplash.com/photo-1560448075-bb485b067938?auto=format&fit=crop&w=1600&q=85',
  'https://images.unsplash.com/photo-1554995207-c18c203602cb?auto=format&fit=crop&w=1600&q=85',
  'https://images.unsplash.com/photo-1556912172-45b7abe8b7e1?auto=format&fit=crop&w=1600&q=85',
  'https://images.unsplash.com/photo-1556020685-41bfe6d62cd0?auto=format&fit=crop&w=1600&q=85',
  'https://images.unsplash.com/photo-1556911220-e15b29be8c8f?auto=format&fit=crop&w=1600&q=85',
  'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=1600&q=85',
  'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?auto=format&fit=crop&w=1600&q=85',
  'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=1600&q=85',
  'https://images.unsplash.com/photo-1493809842364-78817add7ffb?auto=format&fit=crop&w=1600&q=85',
  'https://images.unsplash.com/photo-1431576901776-e539bd916ba2?auto=format&fit=crop&w=1600&q=85',
  'https://images.unsplash.com/photo-1523217582562-09d0c993a40d?auto=format&fit=crop&w=1600&q=85',
  'https://images.unsplash.com/photo-1600607687644-c7171b42498f?auto=format&fit=crop&w=1600&q=85',
  'https://images.unsplash.com/photo-1600566752355-35792bedcfea?auto=format&fit=crop&w=1600&q=85',
  'https://images.unsplash.com/photo-1605276374104-dee2a0ed3cd6?auto=format&fit=crop&w=1600&q=85',
  'https://images.unsplash.com/photo-1600566753089-00f18fb6b3ea?auto=format&fit=crop&w=1600&q=85',
  'https://images.unsplash.com/photo-1600607688969-a5bfcd646154?auto=format&fit=crop&w=1600&q=85',
  'https://images.unsplash.com/photo-1524758121497-4f02eac6a061?auto=format&fit=crop&w=1600&q=85',
  'https://images.unsplash.com/photo-1519389950473-47ba0277781c?auto=format&fit=crop&w=1600&q=85',
  'https://images.unsplash.com/photo-1531482615713-2afd69097998?auto=format&fit=crop&w=1600&q=85',
  'https://images.unsplash.com/photo-1542744173-8e7e53415bb0?auto=format&fit=crop&w=1600&q=85',
  'https://images.unsplash.com/photo-1560250097-0b93528c311a?auto=format&fit=crop&w=1600&q=85',
  'https://images.unsplash.com/photo-1606857521015-7f9fcf423740?auto=format&fit=crop&w=1600&q=85',
  'https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=1600&q=85',
];

/** Deduped curated pool for workspace / WeWork / office-style cards (no hotel-only heroes). */
export const WORKSPACE_BUSINESS_INTERIOR_POOL = Array.from(new Set(_WORKSPACE_BUSINESS_INTERIOR_RAW));

/** Immediate default for ROOMS / workspace (stable CDN). Add file at this path under `public/` to override. */
export const ROOMS_WORKSPACE_OFFICE_INTERIOR_CDN =
  'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=1600&q=85';
export const ROOMS_WORKSPACE_OFFICE_INTERIOR_LOCAL = '/assets/images/workspaces/office_interior.jpg';

const LARGE_LIST_FAST_THRESHOLD = 400;

function applyVarietyToPropertyListFast(list) {
  const pinUrls = new Set([BAZAAR_BOUTIQUE_HOTEL_IMG, ROOMS_NEVE_TZEDEK_IMG, WEWORK_SARONA_INDUSTRIAL_IMG]);
  const wsPool = WORKSPACE_BUSINESS_INTERIOR_POOL.filter((u) => !pinUrls.has(u));
  const genPool = CARD_PLACEHOLDER_UNIVERSE.filter((u) => !pinUrls.has(u));
  return list.map((p, listIdx) => {
    const id = String(p.id || '');
    const fromPic =
      Array.isArray(p.pictures) && p.pictures.length ? String(p.pictures[0] || '').trim() : '';
    const main = (p.mainImage || p.photo_url || p.image_url || fromPic || '').trim();

    if (shouldPreserveHeroUrl(main)) {
      const url = main;
      const pics = Array.isArray(p.pictures) ? p.pictures.filter(Boolean) : [];
      const tail = pics.length > 1 ? pics.slice(1) : [];
      return {
        ...p,
        mainImage: url,
        photo_url: (p.photo_url || '').trim() || url,
        image_url: (p.image_url || '').trim() || url,
        pictures: url ? [url, ...tail].filter(Boolean) : pics,
      };
    }

    if (id === BAZAAR_JAFFA_PROPERTY_ID) {
      const url = BAZAAR_BOUTIQUE_HOTEL_IMG;
      const pics = Array.isArray(p.pictures) ? p.pictures.filter(Boolean) : [];
      const tail = pics.length > 1 ? pics.slice(1) : [];
      return { ...p, mainImage: url, photo_url: url, image_url: url, pictures: [url, ...tail] };
    }
    if (id === 'rooms-branch-neve-tzedek') {
      const url = ROOMS_NEVE_TZEDEK_IMG;
      const pics = Array.isArray(p.pictures) ? p.pictures.filter(Boolean) : [];
      const tail = pics.length > 1 ? pics.slice(1) : [];
      return { ...p, mainImage: url, photo_url: url, image_url: url, pictures: [url, ...tail] };
    }
    if (id === 'wework-tlv-sarona') {
      const url = WEWORK_SARONA_INDUSTRIAL_IMG;
      const pics = Array.isArray(p.pictures) ? p.pictures.filter(Boolean) : [];
      const tail = pics.length > 1 ? pics.slice(1) : [];
      return { ...p, mainImage: url, photo_url: url, image_url: url, pictures: [url, ...tail] };
    }

    let h = 0;
    const seed = `${id}:${listIdx}`;
    for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) | 0;
    const preferWs = isWorkspaceOrOfficeProperty(p);
    const pool = preferWs
      ? (wsPool.length ? wsPool : [ROOMS_WORKSPACE_OFFICE_INTERIOR_CDN])
      : (genPool.length ? genPool : [GENERIC]);
    const url = pool[Math.abs(h) % pool.length] || ROOMS_WORKSPACE_OFFICE_INTERIOR_CDN;
    const pics = Array.isArray(p.pictures) ? p.pictures.filter(Boolean) : [];
    const tail = pics.length > 1 ? pics.slice(1) : [];
    return {
      ...p,
      mainImage: url,
      photo_url: url,
      image_url: url,
      pictures: [url, ...tail].filter(Boolean),
    };
  });
}

/**
 * True for WeWork & ROOMS portfolio pins, workspace slugs, and names that imply office / coworking / station.
 * Does not match generic hotel "guest room" unless combined with meeting/conference/office cues.
 */
export function isWorkspaceOrOfficeProperty(property) {
  if (!property || typeof property !== 'object') return false;
  const id = String(property.id ?? '');
  const n = `${property.name ?? ''}`.toLowerCase();
  const slug = `${property.branchSlug || property.slug || property.branch_slug || ''}`.toLowerCase();
  const desc = `${property.description ?? ''}`.toLowerCase();
  const hay = `${id} ${n} ${slug} ${desc}`;

  if (id === BAZAAR_JAFFA_PROPERTY_ID) return false;

  if (WEWORK_PIN_ID_SET.has(id) || ROOMS_PIN_ID_SET.has(id)) return true;
  if (/^wework-/i.test(id) || /^rooms-/i.test(id)) return true;

  if (
    /wework|we-work|ווי\s*וורק|רומס|cowork|co-work|workspace|open plan|hot desk|dedicated desk|private office|full floor|suite|לונג|lounge|משרד משותף|חלל עבודה|עמדת עבודה|חדר ישיבות|קומת משרדים/i.test(
      hay,
    )
  ) {
    return true;
  }
  if (/\boffice\b|\boffices\b|\bworkplace\b/i.test(hay)) return true;
  if (/\bwork\b|\bworks\b/i.test(hay) && !/network|homework|firework|artwork|woodwork/i.test(hay)) return true;
  if (/\bstation\b|\bstations\b/i.test(hay)) return true;
  if (/\brooms\b/i.test(hay)) return true;
  if (/meeting room|conference room|boardroom|war room|training room/i.test(hay)) return true;

  return false;
}

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Keep real uploads and bundled app assets; Unsplash fallbacks can be replaced for variety. */
export function shouldPreserveHeroUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const u = url.trim().toLowerCase();
  if (u.startsWith('/assets/')) return true;
  return u.includes('/uploads/') || u.includes('cloudinary') || u.includes('amazonaws.com');
}

/**
 * Pick hero URL: brand-specific pins, then index-based variety pool.
 * @param {object} property — { id, name, image_url?, photo_url? }
 * @param {number} listIndex — position in the visible list (for variety)
 */
export function pickHeroUrlForCard(property, listIndex = 0) {
  const id = String(property?.id ?? '');
  const n = `${property?.name ?? ''}`.toLowerCase();

  if (id === BAZAAR_JAFFA_PROPERTY_ID || /bazaar|בזאר|hotel bazaar|מלון בזאר|jaffa|יפו/.test(id) || /hotel bazaar|בזאר|bazaar jaffa/.test(n)) {
    return BAZAAR_BOUTIQUE_HOTEL_IMG;
  }
  if (id === 'rooms-branch-neve-tzedek' || /neve tzedek|נווה צדק/.test(n)) {
    return ROOMS_NEVE_TZEDEK_IMG;
  }
  if (id === 'wework-tlv-sarona' || /wework sarona/.test(n)) {
    return WEWORK_SARONA_INDUSTRIAL_IMG;
  }

  if (isWorkspaceOrOfficeProperty(property)) {
    const pool = WORKSPACE_BUSINESS_INTERIOR_POOL.length
      ? WORKSPACE_BUSINESS_INTERIOR_POOL
      : CARD_PLACEHOLDER_UNIVERSE;
    const idx = Math.max(0, Number(listIndex) || 0);
    return pool[idx % pool.length] || ROOMS_WORKSPACE_OFFICE_INTERIOR_CDN;
  }

  const pool = CARD_PLACEHOLDER_UNIVERSE.length ? CARD_PLACEHOLDER_UNIVERSE : UNIQUE_PROPERTY_IMAGE_POOL;
  const idx = Math.max(0, Number(listIndex) || 0);
  return pool[idx % pool.length] || GENERIC;
}

/**
 * Resolve hero image when API omitted photo — uses index for variety across cards.
 */
export function resolvePropertyCardImage(property, listIndex = 0) {
  const fromPictures =
    Array.isArray(property?.pictures) && property.pictures[0]
      ? String(property.pictures[0]).trim()
      : '';
  const primary = (
    property?.mainImage ||
    property?.photo_url ||
    property?.image_url ||
    fromPictures ||
    ''
  ).trim();
  if (primary) return primary;

  const id = String(property?.id ?? '');
  const n = `${property?.name ?? ''}`.toLowerCase();

  if (id === BAZAAR_JAFFA_PROPERTY_ID || /bazaar|בזאר|jaffa|יפו/.test(id) || /bazaar|בזאר|hotel bazaar|jaffa/.test(n)) {
    return BAZAAR_BOUTIQUE_HOTEL_IMG;
  }
  if (id === 'rooms-branch-neve-tzedek') return ROOMS_NEVE_TZEDEK_IMG;
  if (id === 'wework-tlv-sarona') return WEWORK_SARONA_INDUSTRIAL_IMG;

  if (isWorkspaceOrOfficeProperty(property)) {
    const pool = WORKSPACE_BUSINESS_INTERIOR_POOL.length
      ? WORKSPACE_BUSINESS_INTERIOR_POOL
      : CARD_PLACEHOLDER_UNIVERSE;
    const li = Math.max(0, Number(listIndex) || 0);
    return pool[li % pool.length] || ROOMS_WORKSPACE_OFFICE_INTERIOR_CDN;
  }

  const demoIx2 = DEMO_FIFTEEN_PROPERTY_ORDER.indexOf(id);
  if (demoIx2 >= 0 && PROPERTIES_VIEW_15_UNIQUE_IMAGES[demoIx2]) {
    return PROPERTIES_VIEW_15_UNIQUE_IMAGES[demoIx2];
  }

  return pickHeroUrlForCard(property, listIndex);
}

/**
 * Apply unique / brand heroes to a finalized property list (e.g. PropertiesContext merge).
 * Preserves user uploads (uploads/, Cloudinary).
 */
export function applyVarietyToPropertyList(list) {
  if (!Array.isArray(list)) return [];
  if (list.length > LARGE_LIST_FAST_THRESHOLD) {
    return applyVarietyToPropertyListFast(list);
  }
  const pinUrls = new Set([BAZAAR_BOUTIQUE_HOTEL_IMG, ROOMS_NEVE_TZEDEK_IMG, WEWORK_SARONA_INDUSTRIAL_IMG]);
  const workspaceUniverse = WORKSPACE_BUSINESS_INTERIOR_POOL.filter((u) => !pinUrls.has(u));
  const wsDeck = shuffleArray(workspaceUniverse);
  const genDeck = shuffleArray(CARD_PLACEHOLDER_UNIVERSE.filter((u) => !pinUrls.has(u)));
  const used = new Set();
  let wsDi = 0;
  let genDi = 0;
  const takeUniquePlaceholder = (property) => {
    const preferWs = isWorkspaceOrOfficeProperty(property);

    const takeFrom = (deck, ref) => {
      while (ref.i < deck.length) {
        const u = deck[ref.i++];
        if (!used.has(u)) {
          used.add(u);
          return u;
        }
      }
      return null;
    };

    const wsRef = { i: wsDi };
    const genRef = { i: genDi };

    if (preferWs) {
      const w = takeFrom(wsDeck, wsRef);
      wsDi = wsRef.i;
      if (w) return w;
    }
    let g = takeFrom(genDeck, genRef);
    genDi = genRef.i;
    if (g) return g;

    let h = 0;
    const seed = `${property?.id ?? ''}:${property?.name ?? ''}:${used.size}`;
    for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) | 0;
    const pool = preferWs && workspaceUniverse.length
      ? workspaceUniverse
      : CARD_PLACEHOLDER_UNIVERSE.length
        ? CARD_PLACEHOLDER_UNIVERSE
        : [GENERIC];
    let tries = 0;
    while (tries < pool.length * 2) {
      const u = pool[Math.abs(h + tries) % pool.length];
      tries += 1;
      if (!used.has(u)) {
        used.add(u);
        return u;
      }
    }
    const fallback = `${GENERIC}&v=${encodeURIComponent(seed)}`;
    used.add(fallback);
    return fallback;
  };

  return list.map((p) => {
    const id = String(p.id || '');
    const fromPic =
      Array.isArray(p.pictures) && p.pictures.length ? String(p.pictures[0] || '').trim() : '';
    const main = (p.mainImage || p.photo_url || p.image_url || fromPic || '').trim();

    if (shouldPreserveHeroUrl(main)) {
      const url = main;
      const pics = Array.isArray(p.pictures) ? p.pictures.filter(Boolean) : [];
      const tail = pics.length > 1 ? pics.slice(1) : [];
      return {
        ...p,
        mainImage: url,
        photo_url: (p.photo_url || '').trim() || url,
        image_url: (p.image_url || '').trim() || url,
        pictures: url ? [url, ...tail].filter(Boolean) : pics,
      };
    }

    if (id === BAZAAR_JAFFA_PROPERTY_ID) {
      const url = BAZAAR_BOUTIQUE_HOTEL_IMG;
      used.add(url);
      const pics = Array.isArray(p.pictures) ? p.pictures.filter(Boolean) : [];
      const tail = pics.length > 1 ? pics.slice(1) : [];
      return { ...p, mainImage: url, photo_url: url, image_url: url, pictures: [url, ...tail] };
    }
    if (id === 'rooms-branch-neve-tzedek') {
      const url = ROOMS_NEVE_TZEDEK_IMG;
      used.add(url);
      const pics = Array.isArray(p.pictures) ? p.pictures.filter(Boolean) : [];
      const tail = pics.length > 1 ? pics.slice(1) : [];
      return { ...p, mainImage: url, photo_url: url, image_url: url, pictures: [url, ...tail] };
    }
    if (id === 'wework-tlv-sarona') {
      const url = WEWORK_SARONA_INDUSTRIAL_IMG;
      used.add(url);
      const pics = Array.isArray(p.pictures) ? p.pictures.filter(Boolean) : [];
      const tail = pics.length > 1 ? pics.slice(1) : [];
      return { ...p, mainImage: url, photo_url: url, image_url: url, pictures: [url, ...tail] };
    }

    const url = takeUniquePlaceholder(p);
    const pics = Array.isArray(p.pictures) ? p.pictures.filter(Boolean) : [];
    const tail = pics.length > 1 ? pics.slice(1) : [];
    return {
      ...p,
      mainImage: url,
      photo_url: url,
      image_url: url,
      pictures: [url, ...tail].filter(Boolean),
    };
  });
}
