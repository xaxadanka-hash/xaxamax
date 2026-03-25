const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');
const MEDIA_BASE_URL = API_URL.replace(/\/api$/, '');

const URL_KEYS = new Set(['avatar', 'url', 'mediaUrl', 'thumbnailUrl']);

const isAbsoluteUrl = (value: string) => /^(?:[a-z]+:)?\/\//i.test(value);

const normalizeLegacyUploadPath = (value: string): string => {
  let normalized = value.replace(/\\/g, '/');

  if (normalized.includes('/uploadsuploads/')) {
    normalized = normalized.replace('/uploadsuploads/', '/uploads/');
  } else if (normalized.startsWith('/uploadsuploads/')) {
    normalized = normalized.replace('/uploadsuploads/', '/uploads/');
  } else if (normalized.startsWith('uploadsuploads/')) {
    normalized = normalized.replace('uploadsuploads/', '/uploads/');
  }

  if (normalized.startsWith('uploads/')) {
    normalized = `/${normalized}`;
  }

  return normalized;
};

export function resolveMediaUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalizedValue = normalizeLegacyUploadPath(value);
  if (isAbsoluteUrl(normalizedValue)) return normalizedValue;
  if (!MEDIA_BASE_URL) return normalizedValue;
  if (normalizedValue.startsWith('/')) return `${MEDIA_BASE_URL}${normalizedValue}`;
  return `${MEDIA_BASE_URL}/${normalizedValue}`;
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
