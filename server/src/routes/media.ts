import { Router, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuid } from 'uuid';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';

const uploadDir = env.UPLOAD_DIR;
const allowedMimeTypes = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/zip',
  'application/x-zip-compressed',
  'text/plain',
]);

const isAllowedFileType = (mimeType: string) =>
  mimeType.startsWith('image/')
  || mimeType.startsWith('video/')
  || mimeType.startsWith('audio/')
  || allowedMimeTypes.has(mimeType);

// Ensure upload directory exists
['images', 'videos', 'audio', 'files'].forEach((dir) => {
  const fullPath = path.join(uploadDir, dir);
  if (!fs.existsSync(fullPath)) fs.mkdirSync(fullPath, { recursive: true });
});

const storage = multer.diskStorage({
  destination: (_req, file, cb) => {
    let subdir = 'files';
    if (file.mimetype.startsWith('image/')) subdir = 'images';
    else if (file.mimetype.startsWith('video/')) subdir = 'videos';
    else if (file.mimetype.startsWith('audio/')) subdir = 'audio';
    cb(null, path.join(uploadDir, subdir));
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuid()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
  fileFilter: (_req, file, cb) => {
    if (!isAllowedFileType(file.mimetype)) {
      cb(new Error('Недопустимый тип файла'));
      return;
    }

    cb(null, true);
  },
});

const handleUploadError = (err: unknown, res: Response) => {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    res.status(400).json({ error: 'Файл слишком большой. Максимум 50MB' });
    return true;
  }

  if (err instanceof Error) {
    res.status(400).json({ error: err.message });
    return true;
  }

  return false;
};

const runUpload = (
  middleware: (req: any, res: any, callback: (err?: unknown) => void) => void,
  req: AuthRequest,
  res: Response,
) => new Promise<void>((resolve, reject) => {
  middleware(req, res, (err?: unknown) => {
    if (err) {
      reject(err);
      return;
    }

    resolve();
  });
});

const buildMediaUrl = (filePath: string): string => {
  const uploadRoot = path.resolve(uploadDir);
  const absoluteFilePath = path.resolve(filePath);
  const relativePath = path.relative(uploadRoot, absoluteFilePath).replace(/\\/g, '/');
  if (!relativePath.startsWith('..') && !path.isAbsolute(relativePath)) {
    return `/uploads/${relativePath.replace(/^\/+/, '')}`;
  }

  const normalizedFilePath = absoluteFilePath.replace(/\\/g, '/');
  const uploadMarker = `/${path.basename(uploadRoot)}/`;
  const markerIndex = normalizedFilePath.lastIndexOf(uploadMarker);
  if (markerIndex !== -1) {
    const tail = normalizedFilePath.slice(markerIndex + uploadMarker.length);
    return `/uploads/${tail.replace(/^\/+/, '')}`;
  }

  return `/uploads/${path.basename(absoluteFilePath)}`;
};

const router = Router();

// Upload file
router.post('/upload', async (req: AuthRequest, res: Response) => {
  try {
    await runUpload(upload.single('file'), req, res);
    const file = (req as any).file;
    if (!file) return res.status(400).json({ error: 'Файл не загружен' });
    const duration = typeof req.body.duration === 'string'
      ? Number.parseFloat(req.body.duration)
      : undefined;

    const url = buildMediaUrl(file.path);

    const media = await prisma.media.create({
      data: {
        url,
        filename: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        duration: Number.isFinite(duration) ? duration : undefined,
        uploaderId: req.userId!,
      },
    });

    res.json(media);
  } catch (err) {
    if (handleUploadError(err, res)) return;
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Ошибка загрузки' });
  }
});

// Upload multiple files
router.post('/upload-multiple', async (req: AuthRequest, res: Response) => {
  try {
    await runUpload(upload.array('files', 10), req, res);
    const files = (req as any).files as Express.Multer.File[];
    if (!files?.length) return res.status(400).json({ error: 'Файлы не загружены' });
    const durations = Array.isArray(req.body.duration)
      ? req.body.duration
      : typeof req.body.duration === 'string'
        ? [req.body.duration]
        : [];

    const mediaItems = await Promise.all(
      files.map(async (file, index) => {
        const url = buildMediaUrl(file.path);
        const parsedDuration = Number.parseFloat(durations[index] || '');
        return prisma.media.create({
          data: {
            url,
            filename: file.originalname,
            mimeType: file.mimetype,
            size: file.size,
            duration: Number.isFinite(parsedDuration) ? parsedDuration : undefined,
            uploaderId: req.userId!,
          },
        });
      }),
    );

    res.json(mediaItems);
  } catch (err) {
    if (handleUploadError(err, res)) return;
    console.error('Upload multiple error:', err);
    res.status(500).json({ error: 'Ошибка загрузки' });
  }
});

export default router;
