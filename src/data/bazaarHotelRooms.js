/**
 * Hotel Bazaar Jaffa — room cards for Mission Board (images under public/assets/images/hotels/bazaar/).
 * Name files: 01.jpg … 41.jpg (or adjust pattern below to match Kobi’s filenames).
 */
const LABELS_HE = [
  'חדר סופיריור', 'חדר דלוקס', "סוויטת ג'וניור", 'סוויטת דלוקס', 'חדר קלאסיק',
  'סוויטה משפחתית', 'פנטהאוז', 'חדר סטנדרט', 'דלוקס נוף לים', 'סופיריור מרפסת',
  'סוויטת רויאל', 'סטודיו דלוקס', 'חדר טרסה', 'סוויטת גן', 'דופלקס',
  'חדר נגישות', 'סוויטת ספא', 'דלוקס טריפל', 'חדר קומה עליונה', 'סוויטת נשיאותית',
  'חדר עסקים', 'דלוקס פינתי', 'סופיריור פנורמי', 'סוויטה דו-קומתית', 'חדר מרפסת כפולה',
  'סופיריור מודרני', "דלוקס וינטג'", 'סוויטת ארוחת בוקר', 'חדר מרפסת', 'דלוקס פטיו',
  'סוויטת בוטיק',
  'דלוקס פרימיום',
  'דלוקס משפחה', 'סוויטת רומנטיק', 'חדר שקט', 'סופיריור מרווח', 'דלוקס מיני בר',
  'סוויטת אמבט זוגית', 'חדר נוף נמל', 'דלוקס גג', 'סוויטת אמבטיה',
];

export const BAZAAR_ROOM_IMAGE_COUNT = 41;

export function getBazaarHotelRoomCards() {
  return Array.from({ length: BAZAAR_ROOM_IMAGE_COUNT }, (_, i) => {
    const labelHe = LABELS_HE[i] || `חדר ${i + 1}`;
    const n = String(i + 1).padStart(2, '0');
    return {
      id: `bazaar-room-${i + 1}`,
      labelHe,
      imageSrc: `/assets/images/hotels/bazaar/${n}.jpg`,
    };
  });
}
