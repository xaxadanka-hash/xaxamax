import { Router, Response } from 'express';
import { prisma } from '../index';
import { AuthRequest } from '../middleware/auth';

const router = Router();

// Search users by phone or name
router.get('/search', async (req: AuthRequest, res: Response) => {
  try {
    const { q } = req.query;
    if (!q || typeof q !== 'string') return res.json([]);

    const users = await prisma.user.findMany({
      where: {
        AND: [
          { id: { not: req.userId } },
          {
            OR: [
              { phone: { contains: q } },
              { displayName: { contains: q, mode: 'insensitive' } },
            ],
          },
        ],
      },
      select: { id: true, phone: true, displayName: true, avatar: true, isOnline: true, lastSeen: true },
      take: 20,
    });
    res.json(users);
  } catch (err) {
    console.error('Search users error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Update profile — both PUT /me and PATCH /profile (must be before /:id)
router.patch('/profile', async (req: AuthRequest, res: Response) => {
  try {
    const { displayName, bio, avatar } = req.body;
    const user = await prisma.user.update({
      where: { id: req.userId },
      data: {
        ...(displayName && { displayName }),
        ...(bio !== undefined && { bio }),
        ...(avatar !== undefined && { avatar }),
      },
      select: { id: true, phone: true, displayName: true, avatar: true, bio: true },
    });
    res.json(user);
  } catch (err) {
    console.error('Patch profile error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.put('/me', async (req: AuthRequest, res: Response) => {
  try {
    const { displayName, bio, avatar } = req.body;
    const user = await prisma.user.update({
      where: { id: req.userId },
      data: {
        ...(displayName && { displayName }),
        ...(bio !== undefined && { bio }),
        ...(avatar !== undefined && { avatar }),
      },
      select: { id: true, phone: true, displayName: true, avatar: true, bio: true },
    });
    res.json(user);
  } catch (err) {
    console.error('Update profile error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Get user profile (must be after /me routes)
router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id as string },
      select: { id: true, phone: true, displayName: true, avatar: true, bio: true, isOnline: true, lastSeen: true, createdAt: true },
    });
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
    res.json(user);
  } catch (err) {
    console.error('Get user error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Get contacts
router.get('/me/contacts', async (req: AuthRequest, res: Response) => {
  try {
    const contacts = await prisma.contact.findMany({
      where: { userId: req.userId },
      include: {
        contact: {
          select: { id: true, phone: true, displayName: true, avatar: true, isOnline: true, lastSeen: true },
        },
      },
    });
    res.json(contacts);
  } catch (err) {
    console.error('Get contacts error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Add contact
router.post('/me/contacts', async (req: AuthRequest, res: Response) => {
  try {
    const { contactId, nickname } = req.body;
    if (contactId === req.userId) return res.status(400).json({ error: 'Нельзя добавить себя' });

    const contact = await prisma.contact.create({
      data: { userId: req.userId!, contactId, nickname },
      include: {
        contact: {
          select: { id: true, phone: true, displayName: true, avatar: true, isOnline: true, lastSeen: true },
        },
      },
    });
    res.json(contact);
  } catch (err) {
    console.error('Add contact error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

export default router;
