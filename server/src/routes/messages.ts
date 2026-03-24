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
        reactions: true,
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

// Edit message
router.patch('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { text } = req.body;
    const id = req.params.id as string;
    const msg = await prisma.message.findUnique({ where: { id } });
    if (!msg) return res.status(404).json({ error: 'Сообщение не найдено' });
    if (msg.senderId !== req.userId) return res.status(403).json({ error: 'Нет доступа' });
    if (!text?.trim()) return res.status(400).json({ error: 'Пустой текст' });

    const updated = await prisma.message.update({
      where: { id },
      data: { text: text.trim(), editedAt: new Date() },
      include: {
        sender: { select: { id: true, displayName: true, avatar: true } },
        replyTo: { include: { sender: { select: { id: true, displayName: true } } } },
        media: true,
      },
    });
    res.json(updated);
  } catch (err) {
    console.error('Edit message error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Delete message (soft delete)
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { forAll } = req.query;
    const id = req.params.id as string;
    const msg = await prisma.message.findUnique({ where: { id } });
    if (!msg) return res.status(404).json({ error: 'Сообщение не найдено' });
    if (msg.senderId !== req.userId) return res.status(403).json({ error: 'Нет доступа' });

    const deleteForAll = forAll === 'true';
    await prisma.message.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        deletedForAll: deleteForAll,
      },
    });
    res.json({ success: true, messageId: id, chatId: msg.chatId, forAll: deleteForAll });
  } catch (err) {
    console.error('Delete message error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Forward message to another chat
router.post('/:id/forward', async (req: AuthRequest, res: Response) => {
  try {
    const { targetChatId } = req.body;
    const original = await prisma.message.findUnique({
      where: { id: req.params.id as string },
      include: { media: true },
    });
    if (!original) return res.status(404).json({ error: 'Сообщение не найдено' });

    const member = await prisma.chatMember.findFirst({
      where: { chatId: targetChatId, userId: req.userId },
    });
    if (!member) return res.status(403).json({ error: 'Нет доступа к целевому чату' });

    const forwarded = await prisma.message.create({
      data: {
        chatId: targetChatId,
        senderId: req.userId!,
        text: original.text,
        type: original.type,
        forwardedFromId: original.id,
        ...(original.media.length && {
          media: { connect: original.media.map((m: { id: string }) => ({ id: m.id })) },
        }),
      },
      include: {
        sender: { select: { id: true, displayName: true, avatar: true } },
        replyTo: { include: { sender: { select: { id: true, displayName: true } } } },
        forwardedFrom: { include: { sender: { select: { id: true, displayName: true } } } },
        media: true,
      },
    });

    await prisma.chat.update({ where: { id: targetChatId }, data: { updatedAt: new Date() } });
    res.json(forwarded);
  } catch (err) {
    console.error('Forward message error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Pin / unpin message
router.patch('/:id/pin', async (req: AuthRequest, res: Response) => {
  try {
    const { pin } = req.body;
    const id = req.params.id as string;
    const msg = await prisma.message.findUnique({ where: { id } });
    if (!msg) return res.status(404).json({ error: 'Сообщение не найдено' });

    const member = await prisma.chatMember.findFirst({
      where: { chatId: msg.chatId, userId: req.userId },
    });
    if (!member) return res.status(403).json({ error: 'Нет доступа' });

    await prisma.message.update({
      where: { id },
      data: { pinnedAt: pin ? new Date() : null },
    });
    res.json({ success: true, messageId: req.params.id, chatId: msg.chatId, pinned: !!pin });
  } catch (err) {
    console.error('Pin message error:', err);
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
