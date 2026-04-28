import { API_URL } from '../utils/apiClient';

/**
 * GET /guest/booking/:bookingId — deep link: guest name, property_id, room_number, check-in, hotel_name.
 */
export const getGuestBookingContext = async (bookingId) => {
  const id = bookingId != null ? String(bookingId).trim() : '';
  if (!id) return { ok: false, error: 'empty' };
  try {
    const res = await fetch(`${API_URL}/guest/booking/${encodeURIComponent(id)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      return { ok: false, error: data.error || res.status, ...data };
    }
    return { ok: true, ...data };
  } catch {
    return { ok: false, error: 'network' };
  }
};

/** GET /guest/room/:roomId - public, no auth. Returns room + optional property_type/description. */
export const getGuestRoomInfo = async (roomId) => {
  const rid = roomId != null ? String(roomId).trim() : '';
  if (!rid) return { id: '', name: '' };
  try {
    const res = await fetch(`${API_URL}/guest/room/${encodeURIComponent(rid)}`);
    const data = await res.json().catch(() => ({}));
    return {
      id: data.id || rid,
      name: data.name || rid,
      description: data.description || '',
      property_type: data.property_type || data.propertyType || '',
      branchSlug: data.branch_slug || data.branchSlug || '',
    };
  } catch {
    return { id: rid, name: rid, description: '', property_type: '', branchSlug: '' };
  }
};

/**
 * GET /property-tasks?property_id=&status=pending — guest's open requests for one room only.
 */
export const getGuestPropertyTasks = async (propertyId, { status = 'pending' } = {}) => {
  const pid = propertyId != null ? String(propertyId).trim() : '';
  if (!pid) return [];
  try {
    const qs = new URLSearchParams({ property_id: pid, status: status || 'pending' });
    const res = await fetch(`${API_URL}/property-tasks?${qs}`);
    const data = await res.json().catch(() => []);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
};

/** POST /property-tasks - create task. No auth required (guest app). */
export const createGuestTask = async (payload) => {
  const res = await fetch(`${API_URL}/property-tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: 'guest', ...payload }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'Failed to create task');
  }
  return data;
};

/**
 * POST /guest/maya-chat — Maya classifies text; may create property_task + notify staff.
 */
export const sendGuestMayaMessage = async ({
  message,
  property_id,
  room_number,
  language,
  guest_name,
  booking_id,
  hotel_name,
  quick_action,
  system_message,
  suppress_task,
  guest_action_label_he,
}) => {
  const res = await fetch(`${API_URL}/guest/maya-chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: message || '',
      property_id,
      room_number: room_number || undefined,
      language: language || 'he',
      guest_name: guest_name || undefined,
      booking_id: booking_id || undefined,
      hotel_name: hotel_name || undefined,
      quick_action: quick_action || undefined,
      system_message: system_message || undefined,
      suppress_task: suppress_task ? true : undefined,
      guest_action_label_he: guest_action_label_he || undefined,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'Chat failed');
  }
  return data;
};
