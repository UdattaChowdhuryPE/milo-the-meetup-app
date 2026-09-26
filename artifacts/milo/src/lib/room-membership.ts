export type StoredRoomMembership = {
  participantId?: string;
  browserIdentity?: string;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseMembership(raw: string | null): StoredRoomMembership | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return null;
    const record = value as Record<string, unknown>;
    const participantId = typeof record.participantId === 'string' && UUID_PATTERN.test(record.participantId)
      ? record.participantId : undefined;
    const browserIdentity = typeof record.browserIdentity === 'string' && UUID_PATTERN.test(record.browserIdentity)
      ? record.browserIdentity : undefined;
    return participantId || browserIdentity ? { participantId, browserIdentity } : null;
  } catch {
    return null;
  }
}

function storageKey(roomId: string) {
  return `milo:room-membership:${roomId}`;
}

export function readRoomMembership(roomId: string): StoredRoomMembership | null {
  if (typeof window === 'undefined') return null;
  for (const kind of ['localStorage', 'sessionStorage'] as const) {
    try {
      const membership = parseMembership(window[kind].getItem(storageKey(roomId)));
      if (membership) return membership;
    } catch {
      // Browser storage can be disabled; try the other storage area.
    }
  }
  return null;
}

export function saveRoomMembership(roomId: string, membership: StoredRoomMembership): boolean {
  if (typeof window === 'undefined' || (!membership.participantId && !membership.browserIdentity)) return false;
  for (const kind of ['localStorage', 'sessionStorage'] as const) {
    try {
      window[kind].setItem(storageKey(roomId), JSON.stringify(membership));
      return true;
    } catch {
      // Session storage still survives refresh when local storage is unavailable.
    }
  }
  return false;
}