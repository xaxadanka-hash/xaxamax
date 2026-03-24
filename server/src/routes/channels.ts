import { Router, Response } from 'express';
import { prisma } from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';

const router = Router();

const postInclude = {
  author: { select: { id: true, displayName: true, avatar: true } },
  media: true,
  reactions: true,
};

// List public channels + subscribed channels
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const { q } = req.query;
    const channels = await prisma.channel.findMany({
      where: {
        isPublic: true,
        ...(q && { title: { contains: q as string, mode: 'insensitive' } }),
      },
      include: {
        _count: { select: { subscribers: true, posts: true } },
        subscribers: { where: { userId: req.userId }, select: { isAdmin: true } },
      },
      orderBy: { subscriberCount: 'desc' },
      take: 40,
    });
    res.json(channels);
  } catch (err) {
    console.error('List channels error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// My subscribed channels
router.get('/my', async (req: AuthRequest, res: Response) => {
  try {
    const subs = await prisma.channelSubscriber.findMany({
      where: { userId: req.userId },
      include: {
        channel: {
          include: {
            _count: { select: { subscribers: true, posts: true } },
            posts: { orderBy: { createdAt: 'desc' }, take: 1, include: postInclude },
          },
        },
      },
      orderBy: { joinedAt: 'desc' },
    });
    res.json(subs.map(s => ({ ...s.channel, isAdmin: s.isAdmin, isSubscribed: true })));
  } catch (err) {
    console.error('My channels error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Create channel
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const { title, description, slug, isPublic } = req.body;
    if (!title?.trim() || !slug?.trim()) return res.status(400).json({ error: 'title и slug обязательны' });

    const existing = await prisma.channel.findUnique({ where: { slug: slug.trim().toLowerCase() } });
    if (existing) return res.status(409).json({ error: 'Канал с таким slug уже существует' });

    const channel = await prisma.channel.create({
      data: {
        title: title.trim(),
        slug: slug.trim().toLowerCase(),
        description: description?.trim() || null,
        isPublic: isPublic !== false,
        ownerId: req.userId!,
        subscribers: { create: { userId: req.userId!, isAdmin: true } },
        subscriberCount: 1,
      },
    });
    res.status(201).json(channel);
  } catch (err) {
    console.error('Create channel error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Get channel by slug
router.get('/:slug', async (req: AuthRequest, res: Response) => {
  try {
    const channel = await prisma.channel.findUnique({
      where: { slug: req.params.slug as string },
      include: {
        _count: { select: { subscribers: true, posts: true } },
        subscribers: { where: { userId: req.userId }, select: { isAdmin: true } },
      },
    });
    if (!channel) return res.status(404).json({ error: 'Канал не найден' });
    res.json(channel);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Subscribe / unsubscribe
router.post('/:slug/subscribe', async (req: AuthRequest, res: Response) => {
  try {
    const channel = await prisma.channel.findUnique({ where: { slug: req.params.slug as string } });
    if (!channel) return res.status(404).json({ error: 'Канал не найден' });

    const existing = await prisma.channelSubscriber.findUnique({
      where: { channelId_userId: { channelId: channel.id, userId: req.userId! } },
    });

    if (existing) {
      await prisma.channelSubscriber.delete({
        where: { channelId_userId: { channelId: channel.id, userId: req.userId! } },
      });
      await prisma.channel.update({ where: { id: channel.id }, data: { subscriberCount: { decrement: 1 } } });
      return res.json({ subscribed: false });
    }

    await prisma.channelSubscriber.create({ data: { channelId: channel.id, userId: req.userId! } });
    await prisma.channel.update({ where: { id: channel.id }, data: { subscriberCount: { increment: 1 } } });
    res.json({ subscribed: true });
  } catch (err) {
    console.error('Subscribe error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Get channel posts (paginated)
router.get('/:slug/posts', async (req: AuthRequest, res: Response) => {
  try {
    const channel = await prisma.channel.findUnique({ where: { slug: req.params.slug as string } });
    if (!channel) return res.status(404).json({ error: 'Канал не найден' });

    const cursor = req.query.cursor as string | undefined;
    const limit = parseInt(req.query.limit as string) || 30;

    const posts = await prisma.channelPost.findMany({
      where: { channelId: channel.id, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: limit,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
      include: postInclude,
    });

    res.json({ posts: posts.reverse(), nextCursor: posts.length === limit ? posts[0]?.id : null });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Create post (admin only)
router.post('/:slug/posts', async (req: AuthRequest, res: Response) => {
  try {
    const channel = await prisma.channel.findUnique({ where: { slug: req.params.slug as string } });
    if (!channel) return res.status(404).json({ error: 'Канал не найден' });

    const sub = await prisma.channelSubscriber.findUnique({
      where: { channelId_userId: { channelId: channel.id, userId: req.userId! } },
    });
    if (!sub?.isAdmin && channel.ownerId !== req.userId) {
      return res.status(403).json({ error: 'Только администраторы могут публиковать' });
    }

    const { text, mediaIds } = req.body;
    if (!text?.trim() && !mediaIds?.length) return res.status(400).json({ error: 'Пустой пост' });

    const post = await prisma.channelPost.create({
      data: {
        channelId: channel.id,
        authorId: req.userId!,
        text: text?.trim() || null,
        ...(mediaIds?.length && {
          media: {
            create: await Promise.all(
              mediaIds.map(async (id: string) => {
                const m = await prisma.media.findUnique({ where: { id } });
                return { url: m!.url, mimeType: m!.mimeType, filename: m!.filename, size: m!.size };
              })
            ),
          },
        }),
      },
      include: postInclude,
    });

    await prisma.channel.update({ where: { id: channel.id }, data: { updatedAt: new Date() } });
    res.status(201).json({ post, channelId: channel.id, channelSlug: channel.slug });
  } catch (err) {
    console.error('Create post error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Delete post
router.delete('/:slug/posts/:postId', async (req: AuthRequest, res: Response) => {
  try {
    const channel = await prisma.channel.findUnique({ where: { slug: req.params.slug as string } });
    if (!channel) return res.status(404).json({ error: 'Канал не найден' });
    const post = await prisma.channelPost.findUnique({ where: { id: req.params.postId as string } });
    if (!post) return res.status(404).json({ error: 'Пост не найден' });
    if (post.authorId !== req.userId && channel.ownerId !== req.userId) {
      return res.status(403).json({ error: 'Нет доступа' });
    }
    await prisma.channelPost.update({ where: { id: post.id }, data: { deletedAt: new Date() } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// React to post
router.post('/:slug/posts/:postId/react', async (req: AuthRequest, res: Response) => {
  try {
    const { emoji = '👍' } = req.body;
    const post = await prisma.channelPost.findUnique({ where: { id: req.params.postId as string } });
    if (!post) return res.status(404).json({ error: 'Пост не найден' });

    const existing = await prisma.channelPostReaction.findUnique({
      where: { postId_userId_emoji: { postId: post.id, userId: req.userId!, emoji } },
    });
    if (existing) {
      await prisma.channelPostReaction.delete({ where: { id: existing.id } });
      return res.json({ reacted: false, emoji });
    }
    await prisma.channelPostReaction.create({ data: { postId: post.id, userId: req.userId!, emoji } });
    res.json({ reacted: true, emoji });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

export default router;
