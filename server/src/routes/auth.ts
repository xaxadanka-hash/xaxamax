import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { prisma } from '../index';
import { authMiddleware, AuthRequest } from '../middleware/auth';

const router = Router();

const registerSchema = z.object({
  phone: z.string().min(10).max(15),
  password: z.string().min(6),
  displayName: z.string().min(1).max(50),
});

const loginSchema = z.object({
  phone: z.string(),
  password: z.string(),
});

function generateTokens(userId: string) {
  const token = jwt.sign({ userId }, process.env.JWT_SECRET!, { expiresIn: '7d' });
  const refreshToken = jwt.sign({ userId }, process.env.JWT_REFRESH_SECRET!, { expiresIn: '30d' });
  return { token, refreshToken };
}

// Register
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { phone, password, displayName } = registerSchema.parse(req.body);

    const existing = await prisma.user.findUnique({ where: { phone } });
    if (existing) {
      return res.status(400).json({ error: 'Этот номер уже зарегистрирован' });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { phone, password: hashedPassword, displayName },
      select: { id: true, phone: true, displayName: true, avatar: true, createdAt: true },
    });

    const tokens = generateTokens(user.id);
    res.cookie('refreshToken', tokens.refreshToken, { httpOnly: true, secure: true, sameSite: 'strict', maxAge: 30 * 24 * 60 * 60 * 1000 });
    res.json({ user, token: tokens.token });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Неверные данные', details: err.errors });
    }
    console.error('Register error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Login
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { phone, password } = loginSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { phone } });
    if (!user) {
      return res.status(401).json({ error: 'Неверный номер или пароль' });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ error: 'Неверный номер или пароль' });
    }

    await prisma.user.update({ where: { id: user.id }, data: { isOnline: true, lastSeen: new Date() } });

    const tokens = generateTokens(user.id);
    res.cookie('refreshToken', tokens.refreshToken, { httpOnly: true, secure: true, sameSite: 'strict', maxAge: 30 * 24 * 60 * 60 * 1000 });
    res.json({
      user: { id: user.id, phone: user.phone, displayName: user.displayName, avatar: user.avatar, bio: user.bio },
      token: tokens.token,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Неверные данные' });
    }
    console.error('Login error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Refresh token
router.post('/refresh', async (req: Request, res: Response) => {
  try {
    const refreshToken = req.cookies?.refreshToken;
    if (!refreshToken) return res.status(401).json({ error: 'Нет refresh token' });

    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET!) as { userId: string };
    const tokens = generateTokens(decoded.userId);
    res.cookie('refreshToken', tokens.refreshToken, { httpOnly: true, secure: true, sameSite: 'strict', maxAge: 30 * 24 * 60 * 60 * 1000 });
    res.json({ token: tokens.token });
  } catch {
    res.status(401).json({ error: 'Недействительный refresh token' });
  }
});

// Get current user
router.get('/me', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { id: true, phone: true, displayName: true, avatar: true, bio: true, lastSeen: true, isOnline: true, createdAt: true },
    });
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
    res.json(user);
  } catch (err) {
    console.error('Get me error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Logout
router.post('/logout', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    await prisma.user.update({ where: { id: req.userId }, data: { isOnline: false, lastSeen: new Date() } });
    res.clearCookie('refreshToken');
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

export default router;
