import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import authRoutes from './routes/auth';
import userRoutes from './routes/users';
import chatRoutes from './routes/chats';
import messageRoutes from './routes/messages';
import postRoutes from './routes/posts';
import mediaRoutes from './routes/media';
import channelRoutes from './routes/channels';
import pushRoutes from './routes/push';
import storyRoutes from './routes/stories';
import adminRoutes from './routes/admin';
import notificationRoutes from './routes/notifications';
import movieRoutes from './routes/movies';
import { setupSocketHandlers } from './socket';
import { authMiddleware } from './middleware/auth';
import { allowedOrigins, env, isProduction } from './config/env';
import { prisma } from './lib/prisma';

const app = express();
const httpServer = createServer(app);

app.set('trust proxy', 1);

const corsOptions = {
  origin: (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
    if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin) || origin.startsWith('file://')) {
      cb(null, true);
    } else if (!isProduction) {
      cb(null, true);
    } else {
      cb(new Error('Origin is not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
};

const apiLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_API_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много запросов, попробуйте позже' },
});

const authLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_AUTH_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много попыток входа, попробуйте позже' },
});

const io = new Server(httpServer, {
  cors: corsOptions,
  maxHttpBufferSize: 10 * 1024 * 1024, // 10MB for file uploads
});

// Middleware
app.use(cors(corsOptions));
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: false,
}));
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());
const uploadDir = path.isAbsolute(env.UPLOAD_DIR)
  ? env.UPLOAD_DIR
  : path.join(__dirname, '..', env.UPLOAD_DIR.replace(/^\.\//, ''));
app.use('/uploads', express.static(uploadDir));

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api', apiLimiter);

// Routes
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/users', authMiddleware, userRoutes);
app.use('/api/chats', authMiddleware, chatRoutes);
app.use('/api/messages', authMiddleware, messageRoutes);
app.use('/api/posts', authMiddleware, postRoutes);
app.use('/api/media', authMiddleware, mediaRoutes);
app.use('/api/channels', authMiddleware, channelRoutes);
app.use('/api/push', authMiddleware, pushRoutes);
app.use('/api/stories', authMiddleware, storyRoutes);
app.use('/api/admin', authMiddleware, adminRoutes);
app.use('/api/notifications', authMiddleware, notificationRoutes);
app.use('/api/movies', authMiddleware, movieRoutes);

// Serve client static files in production
const clientDistPath = path.join(__dirname, '..', '..', 'client', 'dist');
app.use(express.static(clientDistPath));
app.get('*', (_req, res) => {
  res.sendFile(path.join(clientDistPath, 'index.html'));
});

// Socket.IO
setupSocketHandlers(io);

const PORT = env.PORT;

httpServer.listen(PORT, () => {
  console.log(`🚀 xaxamax server running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  await prisma.$disconnect();
  process.exit(0);
});
