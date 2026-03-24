const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');

const URL_KEYS = new Set(['avatar', 'url', 'mediaUrl', 'thumbnailUrl']);

const isAbsoluteUrl = (value: string) => /^(?:[a-z]+:)?\/\//i.test(value);

export function resolveMediaUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  if (isAbsoluteUrl(value)) return value;
  if (!API_URL) return value;
  if (value.startsWith('/')) return `${API_URL}${value}`;
  return `${API_URL}/${value}`;
}

export function normalizeMediaUrls<T>(input: T): T {
  if (Array.isArray(input)) {
    return input.map((item) => normalizeMediaUrls(item)) as T;
  }

  if (!input || typeof input !== 'object') {
    return input;
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof value === 'string' && URL_KEYS.has(key)) {
      result[key] = resolveMediaUrl(value);
      continue;
    }

    if (Array.isArray(value) || (value && typeof value === 'object')) {
      result[key] = normalizeMediaUrls(value);
      continue;
    }

    result[key] = value;
  }

  return result as T;
}
