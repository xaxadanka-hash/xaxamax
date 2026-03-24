import { Router, Response } from 'express';
import { prisma } from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';
import { messageInclude, messageSearchInclude } from '../lib/messageInclude';

const router = Router();

const searchMessages = async (req: AuthRequest, res: Response) => {
  try {
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const chatId = typeof req.query.chatId === 'string' ? req.query.chatId : undefined;
    const requestedLimit = Number.parseInt(req.query.limit as string, 10);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), 100)
      : 30;

    if (!query) {
      return res.json({ messages: [] });
    }

    const messages = await prisma.message.findMany({
      where: {
        text: { contains: query, mode: 'insensitive' },
        deletedAt: null,
        chat: chatId
          ? {
            id: chatId,
            members: { some: { userId: req.userId } },
          }
          : {
            members: { some: { userId: req.userId } },
          },
      },
      include: messageSearchInclude,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return res.json({ messages });
  } catch (err) {
    console.error('Search messages error:', err);
    return res.status(500).json({ error: 'Ошибка сервера' });
  }
};

// Search messages
router.get('/search', searchMessages);
router.get('/search/all', searchMessages);

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
      where: {
        chatId,
        OR: [
          { deletedAt: null },
          { deletedForAll: true },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
      include: messageInclude,
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
      include: messageInclude,
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
    if (!deleteForAll) {
      return res.json({ success: true, messageId: id, chatId: msg.chatId, forAll: false, localOnly: true });
    }

    await prisma.message.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        deletedForAll: true,
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
      include: messageInclude,
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

export default router;
