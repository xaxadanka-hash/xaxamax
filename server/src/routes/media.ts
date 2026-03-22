import { Router, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuid } from 'uuid';
import { prisma } from '../index';
import { AuthRequest } from '../middleware/auth';

const uploadDir = process.env.UPLOAD_DIR || './uploads';

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
});

const router = Router();

// Upload file
router.post('/upload', upload.single('file'), async (req: AuthRequest, res: Response) => {
  try {
    const file = (req as any).file;
    if (!file) return res.status(400).json({ error: 'Файл не загружен' });

    const relativePath = file.path.replace(uploadDir, '').replace(/\\/g, '/');
    const url = `/uploads${relativePath}`;

    const media = await prisma.media.create({
      data: {
        url,
        filename: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        uploaderId: req.userId!,
      },
    });

    res.json(media);
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Ошибка загрузки' });
  }
});

// Upload multiple files
router.post('/upload-multiple', upload.array('files', 10), async (req: AuthRequest, res: Response) => {
  try {
    const files = (req as any).files as Express.Multer.File[];
    if (!files?.length) return res.status(400).json({ error: 'Файлы не загружены' });

    const mediaItems = await Promise.all(
      files.map(async (file) => {
        const relativePath = file.path.replace(uploadDir, '').replace(/\\/g, '/');
        const url = `/uploads${relativePath}`;
        return prisma.media.create({
          data: {
            url,
            filename: file.originalname,
            mimeType: file.mimetype,
            size: file.size,
            uploaderId: req.userId!,
          },
        });
      }),
    );

    res.json(mediaItems);
  } catch (err) {
    console.error('Upload multiple error:', err);
    res.status(500).json({ error: 'Ошибка загрузки' });
  }
});

export default router;
