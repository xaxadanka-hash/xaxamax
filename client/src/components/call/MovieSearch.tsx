import { useState, useEffect, useRef } from 'react';
import { Search, X, Star, Film } from 'lucide-react';

const TMDB_API_KEY = import.meta.env.VITE_TMDB_API_KEY || '695e5a3fa31e22b3da8264e1efdb7aa2';
const TMDB_BASE = 'https://api.themoviedb.org/3';
const IMG_BASE = 'https://image.tmdb.org/t/p/w342';

export interface TmdbMovie {
  id: number;
  title: string;
  original_title: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  release_date: string;
  vote_average: number;
  genre_ids: number[];
}

interface MovieSearchProps {
  onSelect: (movie: TmdbMovie) => void;
  onClose: () => void;
}

export default function MovieSearch({ onSelect, onClose }: MovieSearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TmdbMovie[]>([]);
  const [popular, setPopular] = useState<TmdbMovie[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load popular movies on mount
  useEffect(() => {
    fetch(`${TMDB_BASE}/movie/popular?api_key=${TMDB_API_KEY}&language=ru-RU&page=1`)
      .then((r) => r.json())
      .then((d) => setPopular(d.results || []))
      .catch(() => {});
    inputRef.current?.focus();
  }, []);

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setResults([]);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(() => {
      fetch(`${TMDB_BASE}/search/movie?api_key=${TMDB_API_KEY}&language=ru-RU&query=${encodeURIComponent(query)}&page=1`)
        .then((r) => r.json())
        .then((d) => {
          setResults(d.results || []);
          setLoading(false);
        })
        .catch(() => setLoading(false));
    }, 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  const movies = query.trim() ? results : popular;
  const title = query.trim() ? `Результаты: ${results.length}` : 'Популярные фильмы';

  return (
    <div className="fixed inset-0 z-[60] bg-dark-950/95 backdrop-blur-md flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b border-dark-800">
        <Film className="w-6 h-6 text-primary-400" />
        <h2 className="text-lg font-semibold text-white flex-1">Смотреть вместе</h2>
        <button onClick={onClose} className="p-2 rounded-full hover:bg-dark-800 text-dark-400 hover:text-white transition-colors">
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Search bar */}
      <div className="p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-dark-500" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Найти фильм..."
            className="w-full pl-10 pr-4 py-3 bg-dark-800 border border-dark-700 rounded-xl text-white placeholder-dark-500 focus:outline-none focus:border-primary-500 transition-colors"
          />
          {query && (
            <button onClick={() => setQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-dark-500 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        <p className="text-sm text-dark-400 mb-3">{title}</p>
        {loading && <p className="text-center text-dark-500 py-8">Поиск...</p>}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {movies.map((movie) => (
            <button
              key={movie.id}
              onClick={() => onSelect(movie)}
              className="group text-left bg-dark-800/50 rounded-xl overflow-hidden border border-dark-700/50 hover:border-primary-500/50 transition-all hover:scale-[1.02]"
            >
              {movie.poster_path ? (
                <img
                  src={`${IMG_BASE}${movie.poster_path}`}
                  alt={movie.title}
                  className="w-full aspect-[2/3] object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="w-full aspect-[2/3] bg-dark-700 flex items-center justify-center">
                  <Film className="w-10 h-10 text-dark-600" />
                </div>
              )}
              <div className="p-2">
                <p className="text-sm font-medium text-white truncate group-hover:text-primary-300 transition-colors">
                  {movie.title}
                </p>
                <div className="flex items-center gap-1 mt-1">
                  <Star className="w-3 h-3 text-yellow-500 fill-yellow-500" />
                  <span className="text-xs text-dark-400">{movie.vote_average.toFixed(1)}</span>
                  {movie.release_date && (
                    <span className="text-xs text-dark-500 ml-1">{movie.release_date.slice(0, 4)}</span>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
        {!loading && movies.length === 0 && query.trim() && (
          <p className="text-center text-dark-500 py-8">Ничего не найдено</p>
        )}
      </div>
    </div>
  );
}
