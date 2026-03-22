import { Router, Response } from 'express';
import { prisma } from '../index';
import { AuthRequest } from '../middleware/auth';

const router = Router();

// Get all chats for current user
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const chats = await prisma.chat.findMany({
      where: { members: { some: { userId: req.userId } } },
      include: {
        members: {
          include: {
            user: { select: { id: true, displayName: true, avatar: true, isOnline: true, lastSeen: true } },
          },
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: {
            sender: { select: { id: true, displayName: true } },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    const formatted = chats.map((chat) => {
      const otherMembers = chat.members.filter((m) => m.userId !== req.userId);
      const lastMessage = chat.messages[0] || null;
      return {
        ...chat,
        name: chat.type === 'PRIVATE' ? otherMembers[0]?.user.displayName : chat.name,
        avatar: chat.type === 'PRIVATE' ? otherMembers[0]?.user.avatar : chat.avatar,
        isOnline: chat.type === 'PRIVATE' ? otherMembers[0]?.user.isOnline : undefined,
        lastMessage,
      };
    });

    res.json(formatted);
  } catch (err) {
    console.error('Get chats error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Create private chat or get existing
router.post('/private', async (req: AuthRequest, res: Response) => {
  try {
    const { userId: targetUserId } = req.body;
    if (!targetUserId) return res.status(400).json({ error: 'userId обязателен' });

    // Check if private chat already exists
    const existing = await prisma.chat.findFirst({
      where: {
        type: 'PRIVATE',
        AND: [
          { members: { some: { userId: req.userId } } },
          { members: { some: { userId: targetUserId } } },
        ],
      },
      include: {
        members: {
          include: {
            user: { select: { id: true, displayName: true, avatar: true, isOnline: true, lastSeen: true } },
          },
        },
      },
    });

    if (existing) return res.json(existing);

    const chat = await prisma.chat.create({
      data: {
        type: 'PRIVATE',
        members: {
          create: [
            { userId: req.userId! },
            { userId: targetUserId },
          ],
        },
      },
      include: {
        members: {
          include: {
            user: { select: { id: true, displayName: true, avatar: true, isOnline: true, lastSeen: true } },
          },
        },
      },
    });

    res.json(chat);
  } catch (err) {
    console.error('Create private chat error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Create group chat
router.post('/group', async (req: AuthRequest, res: Response) => {
  try {
    const { name, memberIds } = req.body;
    if (!name || !memberIds?.length) return res.status(400).json({ error: 'Имя и участники обязательны' });

    const allMemberIds = [req.userId!, ...memberIds.filter((id: string) => id !== req.userId)];

    const chat = await prisma.chat.create({
      data: {
        type: 'GROUP',
        name,
        members: {
          create: allMemberIds.map((userId: string, i: number) => ({
            userId,
            role: i === 0 ? 'ADMIN' as const : 'MEMBER' as const,
          })),
        },
      },
      include: {
        members: {
          include: {
            user: { select: { id: true, displayName: true, avatar: true, isOnline: true, lastSeen: true } },
          },
        },
      },
    });

    res.json(chat);
  } catch (err) {
    console.error('Create group chat error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Get single chat
router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const chat = await prisma.chat.findFirst({
      where: {
        id: req.params.id as string,
        members: { some: { userId: req.userId } },
      },
      include: {
        members: {
          include: {
            user: { select: { id: true, displayName: true, avatar: true, isOnline: true, lastSeen: true, bio: true } },
          },
        },
      },
    });

    if (!chat) return res.status(404).json({ error: 'Чат не найден' });
    res.json(chat);
  } catch (err) {
    console.error('Get chat error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

export default router;
