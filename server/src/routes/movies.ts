import { Router, Response } from 'express';
import { env } from '../config/env';
import { AuthRequest } from '../middleware/auth';

const router = Router();
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

interface TmdbResponse {
  results?: unknown[];
}

const ensureTmdbConfigured = (res: Response) => {
  if (env.TMDB_API_KEY) {
    return true;
  }

  res.status(503).json({ error: 'TMDB не настроен на сервере' });
  return false;
};

const fetchTmdb = async (pathname: string, params: Record<string, string>): Promise<TmdbResponse> => {
  const searchParams = new URLSearchParams({
    api_key: env.TMDB_API_KEY,
    language: env.TMDB_LANGUAGE,
    ...params,
  });

  const response = await fetch(`${TMDB_BASE_URL}${pathname}?${searchParams.toString()}`, {
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`TMDB request failed: ${response.status}`);
  }

  return response.json() as Promise<TmdbResponse>;
};

router.get('/popular', async (_req: AuthRequest, res: Response) => {
  try {
    if (!ensureTmdbConfigured(res)) return;

    const data = await fetchTmdb('/movie/popular', { page: '1' });
    res.json({ results: data.results || [] });
  } catch (err) {
    console.error('TMDB popular error:', err);
    res.status(502).json({ error: 'Не удалось загрузить популярные фильмы' });
  }
});

router.get('/search', async (req: AuthRequest, res: Response) => {
  try {
    if (!ensureTmdbConfigured(res)) return;

    const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!query) {
      res.status(400).json({ error: 'Пустой поисковый запрос' });
      return;
    }

    const data = await fetchTmdb('/search/movie', {
      query,
      page: '1',
    });

    res.json({ results: data.results || [] });
  } catch (err) {
    console.error('TMDB search error:', err);
    res.status(502).json({ error: 'Не удалось выполнить поиск фильмов' });
  }
});

export default router;
