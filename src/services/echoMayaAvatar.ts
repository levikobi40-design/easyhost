import { getAPIUrl, getAuthHeaders } from '../utils/apiClient';
import type { EchoRoom } from '../data/echoHotels';

/** Slightly above the server's Gemini budget so the server answers (or declines) first. */
const ECHO_AVATAR_TIMEOUT_MS = 13_000;

type EchoAvatarResponse = { ok?: boolean; reply?: string; source?: string };

/**
 * Ask Gemini (via POST /api/maya/echo-avatar) for a short spoken reply.
 * Resolves to null on any failure so the caller can use the local rules instead.
 */
export async function askEchoMayaAvatar(
  message: string,
  propertyName: string,
  rooms: EchoRoom[],
): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), ECHO_AVATAR_TIMEOUT_MS);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  for (const [key, value] of Object.entries(getAuthHeaders() as Record<string, unknown>)) {
    if (typeof value === 'string' && value) headers[key] = value;
  }
  try {
    const res = await fetch(`${getAPIUrl()}/maya/echo-avatar`, {
      method: 'POST',
      headers,
      credentials: 'include',
      signal: ctrl.signal,
      body: JSON.stringify({
        message,
        property_name: propertyName,
        rooms: rooms.map((r) => ({
          room_number: r.roomNumber,
          room_type: r.roomType,
          status: r.status,
        })),
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => ({}))) as EchoAvatarResponse;
    const reply = typeof data.reply === 'string' ? data.reply.trim() : '';
    return data.ok && reply ? reply : null;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}
