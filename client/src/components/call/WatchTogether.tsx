import { useState, useCallback, useRef, useEffect } from 'react';
import { X, SkipForward, AlertTriangle } from 'lucide-react';
import type { TmdbMovie } from './MovieSearch';

// ─── EMBED PROVIDERS (auto-fallback chain) ───────────────────
const EMBED_PROVIDERS = [
  {
    name: 'Embed-API',
    movie: (id: number) => `https://player.embed-api.stream/?id=${id}`,
    tv: (id: number, s: number, e: number) => `https://player.embed-api.stream/?id=${id}&s=${s}&e=${e}`,
  },
  {
    name: 'MultiEmbed',
    movie: (id: number) => `https://multiembed.mov/?video_id=${id}&tmdb=1`,
    tv: (id: number, s: number, e: number) => `https://multiembed.mov/?video_id=${id}&tmdb=1&s=${s}&e=${e}`,
  },
  {
    name: 'VikingEmbed',
    movie: (id: number) => `https://vembed.click/play/${id}`,
    tv: (id: number, s: number, e: number) => `https://vembed.click/play/${id}_s${s}_e${e}`,
  },
  {
    name: 'VidSrc',
    movie: (id: number) => `https://vidsrc.icu/embed/movie/${id}`,
    tv: (id: number, s: number, e: number) => `https://vidsrc.icu/embed/tv/${id}/${s}/${e}`,
  },
];

const PROVIDER_TIMEOUT_MS = 15_000;

interface WatchTogetherProps {
  movie: TmdbMovie;
  onStop: () => void;
  localVideoRef: React.RefObject<HTMLVideoElement | null>;
  remoteVideoRef: React.RefObject<HTMLVideoElement | null>;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  isGroup?: boolean;
}

export default function WatchTogether({
  movie,
  onStop,
  localVideoRef,
  remoteVideoRef,
  localStream,
  remoteStream,
  isGroup,
}: WatchTogetherProps) {
  const [providerIndex, setProviderIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const currentProvider = EMBED_PROVIDERS[providerIndex];
  const embedUrl = currentProvider?.movie(movie.id) || '';

  // ─── PROVIDER FALLBACK ──────────────────────────────────────
  const tryNextProvider = useCallback(() => {
    if (providerIndex < EMBED_PROVIDERS.length - 1) {
      setProviderIndex(prev => prev + 1);
      setIsLoading(true);
      setError(null);
    } else {
      setError('Все провайдеры недоступны. Попробуйте другой фильм.');
      setIsLoading(false);
    }
  }, [providerIndex]);

  // Timeout: if iframe doesn't load in time, try next
  useEffect(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      if (isLoading) {
        console.log(`[WatchTogether] ${currentProvider?.name} timeout, trying next`);
        tryNextProvider();
      }
    }, PROVIDER_TIMEOUT_MS);
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [providerIndex, isLoading, tryNextProvider, currentProvider?.name]);

  const handleIframeLoad = () => {
    setIsLoading(false);
    setError(null);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  };

  const handleIframeError = () => {
    console.log(`[WatchTogether] ${currentProvider?.name} error, trying next`);
    tryNextProvider();
  };

  // Sync video refs
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream, localVideoRef]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream, remoteVideoRef]);

  return (
    <div className="relative w-full h-full flex flex-col bg-black">
      {/* Movie player */}
      <div className="flex-1 relative">
        {/* Provider indicator */}
        <div className="absolute top-2 left-2 z-10 flex items-center gap-2">
          <span className="text-[10px] text-dark-400 bg-black/60 px-2 py-0.5 rounded">
            {currentProvider?.name || '—'}
          </span>
          {isLoading && (
            <div className="w-3 h-3 border border-primary-400 border-t-transparent rounded-full animate-spin" />
          )}
        </div>

        {/* Close / Skip buttons */}
        <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
          <button
            onClick={tryNextProvider}
            className="p-1.5 rounded-full bg-black/60 text-dark-300 hover:text-white transition-colors"
            title="Попробовать другой источник"
          >
            <SkipForward className="w-4 h-4" />
          </button>
          <button
            onClick={onStop}
            className="p-1.5 rounded-full bg-black/60 text-dark-300 hover:text-white transition-colors"
            title="Закрыть"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Error state */}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-dark-900">
            <div className="flex flex-col items-center gap-3 text-center px-6">
              <AlertTriangle className="w-10 h-10 text-yellow-500" />
              <p className="text-sm text-dark-300">{error}</p>
              <button
                onClick={() => { setProviderIndex(0); setError(null); setIsLoading(true); }}
                className="text-xs text-primary-400 hover:text-primary-300"
              >
                Попробовать сначала
              </button>
            </div>
          </div>
        )}

        {/* Iframe */}
        {!error && (
          <iframe
            ref={iframeRef}
            src={embedUrl}
            className="w-full h-full border-0"
            allowFullScreen
            allow="autoplay; encrypted-media; picture-in-picture"
            onLoad={handleIframeLoad}
            onError={handleIframeError}
          />
        )}

        {/* Movie title bar */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-3 py-2">
          <p className="text-xs text-white/80 truncate">
            {movie.title} {movie.release_date ? `(${movie.release_date.slice(0, 4)})` : ''}
          </p>
        </div>
      </div>

      {/* Camera PiPs */}
      {!isGroup && (
        <div className="absolute bottom-12 right-3 flex flex-col gap-2 z-20">
          {/* Remote camera */}
          <div className="w-28 h-20 rounded-lg overflow-hidden bg-dark-800 shadow-lg border border-dark-700/50">
            <video
              ref={remoteVideoRef as any}
              autoPlay
              playsInline
              className="w-full h-full object-cover"
            />
          </div>
          {/* Local camera */}
          <div className="w-20 h-14 rounded-lg overflow-hidden bg-dark-800 shadow-lg border border-dark-700/50">
            <video
              ref={localVideoRef as any}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover mirror"
            />
          </div>
        </div>
      )}
    </div>
  );
}
