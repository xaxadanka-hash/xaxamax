const HIDDEN_MESSAGES_STORAGE_KEY_PREFIX = 'xaxamax:hidden-messages';

function getStorageKey(userId: string) {
  return `${HIDDEN_MESSAGES_STORAGE_KEY_PREFIX}:${userId}`;
}

export function getHiddenMessageIds(userId?: string | null): Set<string> {
  if (!userId || typeof window === 'undefined') return new Set();

  try {
    const rawValue = window.localStorage.getItem(getStorageKey(userId));
    if (!rawValue) return new Set();

    const parsed = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) return new Set();

    return new Set(parsed.filter((value): value is string => typeof value === 'string'));
  } catch {
    return new Set();
  }
}

export function hideMessageForUser(messageId: string, userId?: string | null) {
  if (!userId || typeof window === 'undefined') return;

  const hiddenIds = getHiddenMessageIds(userId);
  hiddenIds.add(messageId);
  window.localStorage.setItem(getStorageKey(userId), JSON.stringify(Array.from(hiddenIds)));
}

export function isMessageHiddenForUser(messageId: string, userId?: string | null) {
  if (!messageId || !userId) return false;
  return getHiddenMessageIds(userId).has(messageId);
}

export function filterHiddenMessages<T extends { id: string }>(messages: T[], userId?: string | null) {
  const hiddenIds = getHiddenMessageIds(userId);
  if (hiddenIds.size === 0) return messages;

  return messages.filter((message) => !hiddenIds.has(message.id));
}
