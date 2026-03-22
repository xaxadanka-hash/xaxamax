import { Router, Response } from 'express';
import { prisma } from '../index';
import { AuthRequest } from '../middleware/auth';

const router = Router();

// Get messages for a chat (paginated)
router.get('/:chatId', async (req: AuthRequest, res: Response) => {
  try {
    const chatId = req.params.chatId as string;
    const cursor = req.query.cursor as string | undefined;
    const limit = parseInt(req.query.limit as string) || 50;

    const member = await prisma.chatMember.findFirst({
      where: { chatId, userId: req.userId },
    });
    if (!member) return res.status(403).json({ error: 'Нет доступа к этому чату' });

    const messages = await prisma.message.findMany({
      where: { chatId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: limit,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
      include: {
        sender: { select: { id: true, displayName: true, avatar: true } },
        replyTo: {
          include: { sender: { select: { id: true, displayName: true } } },
        },
        media: true,
      },
    });

    res.json({
      messages: messages.reverse(),
      nextCursor: messages.length === limit ? messages[0]?.id : null,
    });
  } catch (err) {
    console.error('Get messages error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Mark messages as read
router.post('/:chatId/read', async (req: AuthRequest, res: Response) => {
  try {
    const chatId = req.params.chatId as string;
    await prisma.message.updateMany({
      where: {
        chatId,
        senderId: { not: req.userId },
        status: { not: 'READ' },
      },
      data: { status: 'READ' },
    });
    res.json({ success: true });
  } catch (err) {
    console.error('Mark read error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Search messages
router.get('/search/all', async (req: AuthRequest, res: Response) => {
  try {
    const { q } = req.query;
    if (!q || typeof q !== 'string') return res.json([]);

    const messages = await prisma.message.findMany({
      where: {
        text: { contains: q, mode: 'insensitive' },
        chat: { members: { some: { userId: req.userId } } },
        deletedAt: null,
      },
      include: {
        sender: { select: { id: true, displayName: true, avatar: true } },
        chat: { select: { id: true, name: true, type: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });

    res.json(messages);
  } catch (err) {
    console.error('Search messages error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

export default router;
