import { Router, Response } from 'express';
import webpush from 'web-push';
import { prisma } from '../index';
import { AuthRequest } from '../middleware/auth';

const router = Router();

// Configure VAPID on module load
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    `mailto:${process.env.VAPID_CONTACT || 'admin@xaxamax.app'}`,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  );
}

// Return public VAPID key for client to use
router.get('/vapid-public-key', (_req, res) => {
  res.json({ key: process.env.VAPID_PUBLIC_KEY || '' });
});

// Save push subscription
router.post('/subscribe', async (req: AuthRequest, res: Response) => {
  try {
    const { endpoint, keys } = req.body;
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return res.status(400).json({ error: 'Неверные данные подписки' });
    }

    await prisma.pushSubscription.upsert({
      where: { endpoint },
      update: { p256dh: keys.p256dh, auth: keys.auth },
      create: {
        userId: req.userId!,
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
      },
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Push subscribe error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Remove push subscription
router.post('/unsubscribe', async (req: AuthRequest, res: Response) => {
  try {
    const { endpoint } = req.body;
    if (!endpoint) return res.status(400).json({ error: 'endpoint обязателен' });

    await prisma.pushSubscription.deleteMany({
      where: { endpoint, userId: req.userId },
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Push unsubscribe error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Helper used from socket handler
export async function sendPushToUser(
  userId: string,
  payload: { title: string; body: string; tag?: string; url?: string },
) {
  if (!process.env.VAPID_PUBLIC_KEY) return;
  try {
    const subs = await prisma.pushSubscription.findMany({ where: { userId } });
    await Promise.allSettled(
      subs.map(sub =>
        webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload),
        ).catch(async err => {
          // 410 Gone = subscription expired, remove it
          if (err.statusCode === 410) {
            await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
          }
        })
      )
    );
  } catch (err) {
    console.error('sendPushToUser error:', err);
  }
}

export default router;
