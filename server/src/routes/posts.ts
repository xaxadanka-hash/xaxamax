import { Router, Response } from 'express';
import { prisma } from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';

const router = Router();

// Get global feed
router.get('/feed', async (req: AuthRequest, res: Response) => {
  try {
    const cursor = req.query.cursor as string | undefined;
    const limit = parseInt(req.query.limit as string) || 20;

    const posts = await prisma.post.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: limit,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
      include: {
        author: { select: { id: true, displayName: true, avatar: true } },
        media: true,
        likes: { select: { id: true, userId: true, reaction: true } },
        comments: {
          take: 3,
          orderBy: { createdAt: 'desc' },
          include: {
            author: { select: { id: true, displayName: true, avatar: true } },
          },
        },
        _count: { select: { likes: true, comments: true } },
      },
    });

    const postsWithMeta = posts.map((post) => ({
      ...post,
      isLiked: post.likes.some((l) => l.userId === req.userId),
      likesCount: post._count.likes,
      commentsCount: post._count.comments,
    }));

    res.json({
      posts: postsWithMeta,
      nextCursor: posts.length === limit ? posts[posts.length - 1]?.id : null,
    });
  } catch (err) {
    console.error('Get feed error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Get user's wall
router.get('/wall/:userId', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.params.userId as string;
    const posts = await prisma.post.findMany({
      where: { authorId: userId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: {
        author: { select: { id: true, displayName: true, avatar: true } },
        media: true,
        likes: { select: { id: true, userId: true, reaction: true } },
        _count: { select: { likes: true, comments: true } },
      },
    });

    const postsWithMeta = posts.map((post) => ({
      ...post,
      isLiked: post.likes.some((l) => l.userId === req.userId),
      likesCount: post._count.likes,
      commentsCount: post._count.comments,
    }));

    res.json(postsWithMeta);
  } catch (err) {
    console.error('Get wall error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Create post
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const { text, mediaIds } = req.body;
    if (!text && (!mediaIds || mediaIds.length === 0)) {
      return res.status(400).json({ error: 'Пост не может быть пустым' });
    }

    const post = await prisma.post.create({
      data: {
        authorId: req.userId!,
        text,
        ...(mediaIds?.length && {
          media: { connect: mediaIds.map((id: string) => ({ id })) },
        }),
      },
      include: {
        author: { select: { id: true, displayName: true, avatar: true } },
        media: true,
        likes: true,
        _count: { select: { likes: true, comments: true } },
      },
    });

    res.json(post);
  } catch (err) {
    console.error('Create post error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Like/unlike post
router.post('/:id/like', async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const existing = await prisma.postLike.findUnique({
      where: { postId_userId: { postId: id, userId: req.userId! } },
    });

    if (existing) {
      await prisma.postLike.delete({ where: { id: existing.id } });
      res.json({ liked: false });
    } else {
      await prisma.postLike.create({
        data: { postId: id, userId: req.userId!, reaction: req.body.reaction || 'like' },
      });
      res.json({ liked: true });
    }
  } catch (err) {
    console.error('Like post error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Get comments for a post
router.get('/:id/comments', async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const comments = await prisma.comment.findMany({
      where: { postId: id, deletedAt: null, parentId: null },
      orderBy: { createdAt: 'asc' },
      include: {
        author: { select: { id: true, displayName: true, avatar: true } },
        media: true,
        likes: { select: { id: true, userId: true } },
        replies: {
          include: {
            author: { select: { id: true, displayName: true, avatar: true } },
            media: true,
            likes: { select: { id: true, userId: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
        _count: { select: { likes: true, replies: true } },
      },
    });
    res.json(comments);
  } catch (err) {
    console.error('Get comments error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Add comment (text or voice)
router.post('/:id/comments', async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const { text, type, parentId, mediaId } = req.body;

    const comment = await prisma.comment.create({
      data: {
        postId: id,
        authorId: req.userId!,
        text,
        type: type || 'TEXT',
        parentId,
        ...(mediaId && { media: { connect: [{ id: mediaId }] } }),
      },
      include: {
        author: { select: { id: true, displayName: true, avatar: true } },
        media: true,
      },
    });

    res.json(comment);
  } catch (err) {
    console.error('Add comment error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Like comment
router.post('/comments/:commentId/like', async (req: AuthRequest, res: Response) => {
  try {
    const commentId = req.params.commentId as string;
    const existing = await prisma.commentLike.findUnique({
      where: { commentId_userId: { commentId, userId: req.userId! } },
    });

    if (existing) {
      await prisma.commentLike.delete({ where: { id: existing.id } });
      res.json({ liked: false });
    } else {
      await prisma.commentLike.create({ data: { commentId, userId: req.userId! } });
      res.json({ liked: true });
    }
  } catch (err) {
    console.error('Like comment error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Delete post
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    await prisma.post.update({
      where: { id, authorId: req.userId },
      data: { deletedAt: new Date() },
    });
    res.json({ success: true });
  } catch (err) {
    console.error('Delete post error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

export default router;
