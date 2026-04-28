import { inferPropertyEnterpriseMeta } from './propertyEnterpriseMeta';
import { WEWORK_PIN_ID_SET } from '../config/weworkBranches';

/**
 * Guest app persona: hotel (Bazaar / City Tower style) vs workspace (ROOMS meeting spaces).
 * @param {{ bookingCtx?: object, room?: object, slugFromUrl?: string }} opts
 */
export function inferGuestViewMode({ bookingCtx, room, slugFromUrl = '' }) {
  const slug = String(slugFromUrl || '')
    .trim()
    .toLowerCase();
  if (slug) {
    if (
      /wework|we-work|rooms|roomssky|sky-tower|workspace|cowork|משרד|רומס|סקיי|ישיבות|wework-/i.test(
        slug,
      )
    ) {
      return 'workspace';
    }
  }

  const pt = String(bookingCtx?.property_type || room?.property_type || '').trim();
  if (/workspace|coworking|office|משרד|meeting|ישיבות/i.test(pt)) return 'workspace';

  if (WEWORK_PIN_ID_SET.has(String(room?.id))) return 'workspace';

  const blob = `${bookingCtx?.hotel_name || ''} ${room?.name || ''} ${room?.description || ''}`.toLowerCase();
  if (/wework|ווי וורק|rooms|רומס|sky tower|coworking|workspace|משרד|fattal|חדר ישיבות|meeting room/i.test(blob)) {
    return 'workspace';
  }

  const meta = inferPropertyEnterpriseMeta({
    id: room?.id,
    name: `${room?.name || ''} ${bookingCtx?.hotel_name || ''}`,
    description: room?.description || '',
    branchSlug: room?.branchSlug,
  });
  if (meta.propertyType === 'Workspace' || meta.brand === 'ROOMS' || meta.brand === 'WeWork') return 'workspace';

  return 'hotel';
}

/**
 * Industry template for guest UI copy and tiles (Hotel vs Office / Meeting room).
 * @returns {'hotel'|'office'|'meeting_room'}
 */
export function inferGuestPropertyTemplate({ bookingCtx, room, slugFromUrl }) {
  const pt = String(bookingCtx?.property_type || room?.property_type || '').trim().toLowerCase();
  const blob = `${room?.name || ''} ${room?.description || ''} ${bookingCtx?.hotel_name || ''}`.toLowerCase();
  if (
    /meeting|ישיבות|conference|חדר ישיבות|boardroom|חדר דיונים/.test(pt)
    || /meeting|ישיבות|conference|boardroom|חדר ישיבות/.test(blob)
  ) {
    return 'meeting_room';
  }
  const mode = inferGuestViewMode({ bookingCtx, room, slugFromUrl });
  if (mode === 'workspace' || /office|משרד|cowork|open space|hot desk/.test(pt)) {
    return 'office';
  }
  return 'hotel';
}

export function buildMayaPersonaWelcomeHe(guestName, mode, hotelName) {
  const g = (guestName || '').trim() || 'אורח';
  if (mode === 'workspace') {
    const w = /wework|ווי וורק/i.test(`${hotelName || ''}`);
    if (w) {
      return `היי ${g}, ברוך הבא ל-WeWork. צריכים משהו לחלל או לחדר ישיבות?`;
    }
    return `היי ${g}, ברוך הבא ל-ROOMS. צריכים משהו לחדר הישיבות?`;
  }
  const h = (hotelName || '').trim() || 'המלון';
  if (/בזאר|bazaar/i.test(h)) {
    return `ברוך הבא ${g}, איך אני יכולה לעזור לך במלון בזאר?`;
  }
  return `ברוך הבא ${g}, איך אני יכולה לעזור לך ב${h}?`;
}
