import { Router, Response, NextFunction } from 'express';
import { prisma } from '../index';
import { AuthRequest } from '../middleware/auth';

const router = Router();

// Guard: only admins
async function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { isAdmin: true } });
  if (!user?.isAdmin) return res.status(403).json({ error: 'Требуются права администратора' });
  next();
}

router.use(requireAdmin);

// GET /api/admin/stats
router.get('/stats', async (_req, res: Response) => {
  try {
    const [users, messages, posts, channels, stories, activeToday] = await Promise.all([
      prisma.user.count(),
      prisma.message.count(),
      prisma.post.count(),
      prisma.channel.count(),
      prisma.story.count(),
      prisma.user.count({ where: { lastSeen: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } }),
    ]);
    res.json({ users, messages, posts, channels, stories, activeToday });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// GET /api/admin/users?q=&page=1&limit=20
router.get('/users', async (req, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const q = (req.query.q as string) || '';

    const where = q
      ? { OR: [{ displayName: { contains: q, mode: 'insensitive' as const } }, { phone: { contains: q } }] }
      : {};

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true, displayName: true, phone: true, avatar: true,
          isAdmin: true, isBanned: true, isOnline: true, createdAt: true, lastSeen: true,
          _count: { select: { messages: true, posts: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.user.count({ where }),
    ]);

    res.json({ users, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// PATCH /api/admin/users/:id — toggle ban/admin
router.patch('/users/:id', async (req, res: Response) => {
  try {
    const { isBanned, isAdmin } = req.body;
    const data: any = {};
    if (typeof isBanned === 'boolean') data.isBanned = isBanned;
    if (typeof isAdmin === 'boolean') data.isAdmin = isAdmin;

    const user = await prisma.user.update({
      where: { id: req.params.id as string },
      data,
      select: { id: true, displayName: true, isAdmin: true, isBanned: true },
    });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// DELETE /api/admin/users/:id
router.delete('/users/:id', async (req, res: Response) => {
  try {
    await prisma.user.delete({ where: { id: req.params.id as string } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// GET /api/admin/channels
router.get('/channels', async (_req, res: Response) => {
  try {
    const channels = await prisma.channel.findMany({
      include: {
        owner: { select: { id: true, displayName: true } },
        _count: { select: { subscribers: true, posts: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json(channels);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// DELETE /api/admin/channels/:id
router.delete('/channels/:id', async (req, res: Response) => {
  try {
    await prisma.channel.delete({ where: { id: req.params.id as string } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

export default router;
