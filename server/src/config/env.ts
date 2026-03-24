import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_SECRET: z.string().min(1, 'JWT_SECRET is required'),
  JWT_REFRESH_SECRET: z.string().min(1, 'JWT_REFRESH_SECRET is required'),
  PORT: z.coerce.number().int().positive().default(3001),
  CLIENT_URL: z.string().default('http://localhost:5173'),
  UPLOAD_DIR: z.string().default('./uploads'),
  VAPID_PUBLIC_KEY: z.string().optional().default(''),
  VAPID_PRIVATE_KEY: z.string().optional().default(''),
  VAPID_CONTACT: z.string().default('admin@xaxamax.app'),
  TMDB_API_KEY: z.string().optional().default(''),
  TMDB_LANGUAGE: z.string().default('ru-RU'),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  RATE_LIMIT_API_MAX: z.coerce.number().int().positive().default(300),
  RATE_LIMIT_AUTH_MAX: z.coerce.number().int().positive().default(20),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  throw new Error('Server environment validation failed');
}

export const env = parsed.data;

export const allowedOrigins = env.CLIENT_URL.split(',')
  .map((value) => value.trim())
  .filter(Boolean);

export const isProduction = env.NODE_ENV === 'production';
export const hasWebPush = Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
