/**
 * Format phone number for WhatsApp wa.me links (international format).
 * Israeli numbers: 052-123-4567 -> 972521234567
 * @param {string} phone - Raw phone (e.g. "052-1234567", "+972 52 123 4567")
 * @returns {string} Digits only, with 972 prefix for Israeli local numbers
 */
export function toWhatsAppPhone(phone) {
  if (!phone) return '';
  const digits = String(phone).replace(/\D/g, '');
  if (digits.startsWith('0') && digits.length >= 9) return '972' + digits.slice(1);
  if (!digits.startsWith('972') && digits.length >= 9) return '972' + digits;
  return digits;
}

/** Hardcoded WhatsApp: Alma=0501234567, Kobi=0529876543 */
export const STAFF_PHONE_FALLBACK = { alma: '0501234567', עלמה: '0501234567', kobi: '0529876543', קובי: '0529876543' };

/**
 * Get WhatsApp phone for a task. Alma/Kobi use hardcoded numbers.
 */
export function getTaskWhatsAppPhone(task) {
  const staff = ((task?.staff_name ?? task?.staffName) || '').toString().toLowerCase();
  if (staff.includes('alma') || staff.includes('עלמה')) return toWhatsAppPhone('0501234567');
  if (staff.includes('kobi') || staff.includes('קובי')) return toWhatsAppPhone('0529876543');
  if (staff.includes('avi') || staff.includes('אבי')) return toWhatsAppPhone(task?.staff_phone ?? task?.staffPhone ?? '0502223334');
  const phone = task?.staff_phone ?? task?.staffPhone ?? '';
  return phone ? toWhatsAppPhone(phone) : '';
}
