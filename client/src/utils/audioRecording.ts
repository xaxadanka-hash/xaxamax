const AUDIO_MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
] as const;

export function getSupportedAudioMimeType() {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return '';
  }

  return AUDIO_MIME_CANDIDATES.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) || '';
}

export function createAudioRecorder(stream: MediaStream) {
  const mimeType = getSupportedAudioMimeType();
  const recorder = mimeType
    ? new MediaRecorder(stream, { mimeType })
    : new MediaRecorder(stream);

  return {
    recorder,
    mimeType: recorder.mimeType || mimeType || 'audio/webm',
  };
}

export function getAudioFileExtension(mimeType: string) {
  if (mimeType.includes('mp4')) return 'm4a';
  if (mimeType.includes('ogg')) return 'ogg';
  if (mimeType.includes('webm')) return 'webm';
  return 'audio';
}
