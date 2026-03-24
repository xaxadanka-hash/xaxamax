import { Router, Response } from 'express';
import { prisma } from '../index';
import { AuthRequest } from '../middleware/auth';
import path from 'path';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';

const router = Router();

const uploadDir = process.env.UPLOAD_DIR || 'uploads';
const storiesDir = path.join(uploadDir, 'stories');
if (!fs.existsSync(storiesDir)) fs.mkdirSync(storiesDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, storiesDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

// GET /api/stories — active stories from contacts + self (last 24h)
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Get contact user IDs
    const contacts = await prisma.contact.findMany({
      where: { userId: req.userId },
      select: { contactId: true },
    });
    const visibleIds = [req.userId!, ...contacts.map((c) => c.contactId)];

    const stories = await prisma.story.findMany({
      where: {
        authorId: { in: visibleIds },
        expiresAt: { gt: new Date() },
        createdAt: { gte: since },
      },
      include: {
        author: { select: { id: true, displayName: true, avatar: true } },
        viewers: { select: { userId: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Group by author
    const byAuthor = new Map<string, any>();
    stories.forEach((s) => {
      if (!byAuthor.has(s.authorId)) {
        byAuthor.set(s.authorId, { author: s.author, stories: [] });
      }
      byAuthor.get(s.authorId).stories.push({
        ...s,
        viewed: s.viewers.some((v) => v.userId === req.userId),
      });
    });

    res.json(Array.from(byAuthor.values()));
  } catch (err) {
    console.error('Get stories error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// POST /api/stories — upload a new story
router.post('/', upload.single('media'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Файл обязателен' });

    const { text, duration } = req.body;
    const mediaUrl = `/uploads/stories/${req.file.filename}`;
    const mimeType = req.file.mimetype;
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const story = await prisma.story.create({
      data: {
        authorId: req.userId!,
        mediaUrl,
        mimeType,
        text: text || null,
        duration: duration ? parseInt(duration) : 5,
        expiresAt,
      },
      include: {
        author: { select: { id: true, displayName: true, avatar: true } },
      },
    });

    res.status(201).json({ story });
  } catch (err) {
    console.error('Create story error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// POST /api/stories/:id/view — mark a story as viewed
router.post('/:id/view', async (req: AuthRequest, res: Response) => {
  try {
    const storyId = req.params.id as string;
    await prisma.storyViewer.upsert({
      where: { storyId_userId: { storyId, userId: req.userId! } },
      update: {},
      create: { storyId, userId: req.userId! },
    });
    res.json({ success: true });
  } catch (err) {
    console.error('View story error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// DELETE /api/stories/:id — delete own story
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const storyId = req.params.id as string;
    const story = await prisma.story.findUnique({ where: { id: storyId } });
    if (!story) return res.status(404).json({ error: 'Сторис не найден' });
    if (story.authorId !== req.userId) return res.status(403).json({ error: 'Нет доступа' });

    // Remove file
    const filePath = path.join(process.cwd(), story.mediaUrl);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    await prisma.story.delete({ where: { id: storyId } });
    res.json({ success: true });
  } catch (err) {
    console.error('Delete story error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

export default router;
