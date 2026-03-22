import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// userId -> Set of socketIds
const onlineUsers = new Map<string, Set<string>>();

function getUserSockets(userId: string): Set<string> {
  return onlineUsers.get(userId) || new Set();
}

export function setupSocketHandlers(io: Server) {
  // Auth middleware for socket connections
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('Требуется авторизация'));

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as { userId: string };
      (socket as any).userId = decoded.userId;
      next();
    } catch {
      next(new Error('Недействительный токен'));
    }
  });

  io.on('connection', async (socket: Socket) => {
    const userId = (socket as any).userId as string;
    console.log(`✅ User connected: ${userId} (socket: ${socket.id})`);

    // Track online status
    if (!onlineUsers.has(userId)) {
      onlineUsers.set(userId, new Set());
    }
    onlineUsers.get(userId)!.add(socket.id);

    // Update user online status
    await prisma.user.update({
      where: { id: userId },
      data: { isOnline: true, lastSeen: new Date() },
    });

    // Join user's chat rooms
    const chatMembers = await prisma.chatMember.findMany({
      where: { userId },
      select: { chatId: true },
    });
    chatMembers.forEach((m) => socket.join(`chat:${m.chatId}`));

    // Broadcast online status
    socket.broadcast.emit('user:online', { userId, isOnline: true });

    // === MESSAGING ===

    socket.on('message:send', async (data: {
      chatId: string;
      text?: string;
      type?: string;
      replyToId?: string;
      mediaIds?: string[];
    }) => {
      try {
        const message = await prisma.message.create({
          data: {
            chatId: data.chatId,
            senderId: userId,
            text: data.text,
            type: (data.type as any) || 'TEXT',
            replyToId: data.replyToId,
            ...(data.mediaIds?.length && {
              media: { connect: data.mediaIds.map((id) => ({ id })) },
            }),
          },
          include: {
            sender: { select: { id: true, displayName: true, avatar: true } },
            replyTo: {
              include: { sender: { select: { id: true, displayName: true } } },
            },
            media: true,
          },
        });

        // Update chat timestamp
        await prisma.chat.update({
          where: { id: data.chatId },
          data: { updatedAt: new Date() },
        });

        // Emit to all members of the chat
        io.to(`chat:${data.chatId}`).emit('message:new', message);

        // Send delivery status
        socket.emit('message:status', { messageId: message.id, status: 'DELIVERED' });
      } catch (err) {
        console.error('Send message error:', err);
        socket.emit('error', { message: 'Ошибка отправки сообщения' });
      }
    });

    socket.on('message:typing', (data: { chatId: string }) => {
      socket.to(`chat:${data.chatId}`).emit('message:typing', { chatId: data.chatId, userId });
    });

    socket.on('message:stop-typing', (data: { chatId: string }) => {
      socket.to(`chat:${data.chatId}`).emit('message:stop-typing', { chatId: data.chatId, userId });
    });

    socket.on('message:read', async (data: { chatId: string; messageIds: string[] }) => {
      try {
        await prisma.message.updateMany({
          where: { id: { in: data.messageIds }, chatId: data.chatId },
          data: { status: 'READ' },
        });
        io.to(`chat:${data.chatId}`).emit('message:read', { chatId: data.chatId, messageIds: data.messageIds, readBy: userId });
      } catch (err) {
        console.error('Read message error:', err);
      }
    });

    // === CALLS (WebRTC Signaling) ===

    socket.on('call:initiate', async (data: { targetUserId: string; type: 'AUDIO' | 'VIDEO' | 'SCREEN_SHARE' }) => {
      try {
        const call = await prisma.call.create({
          data: {
            initiatorId: userId,
            type: data.type,
            participants: {
              create: [{ userId: data.targetUserId }],
            },
          },
          include: {
            initiator: { select: { id: true, displayName: true, avatar: true } },
          },
        });

        const targetSockets = getUserSockets(data.targetUserId);
        targetSockets.forEach((socketId) => {
          io.to(socketId).emit('call:incoming', {
            callId: call.id,
            caller: call.initiator,
            type: data.type,
          });
        });

        socket.emit('call:initiated', { callId: call.id });
      } catch (err) {
        console.error('Initiate call error:', err);
        socket.emit('error', { message: 'Ошибка инициализации звонка' });
      }
    });

    socket.on('call:accept', async (data: { callId: string }) => {
      try {
        await prisma.call.update({
          where: { id: data.callId },
          data: { status: 'ACTIVE', startedAt: new Date() },
        });

        const call = await prisma.call.findUnique({
          where: { id: data.callId },
          include: { participants: true },
        });

        if (call) {
          const initiatorSockets = getUserSockets(call.initiatorId);
          initiatorSockets.forEach((socketId) => {
            io.to(socketId).emit('call:accepted', { callId: data.callId, userId });
          });
        }
      } catch (err) {
        console.error('Accept call error:', err);
      }
    });

    socket.on('call:decline', async (data: { callId: string }) => {
      try {
        await prisma.call.update({
          where: { id: data.callId },
          data: { status: 'DECLINED', endedAt: new Date() },
        });

        const call = await prisma.call.findUnique({ where: { id: data.callId } });
        if (call) {
          const initiatorSockets = getUserSockets(call.initiatorId);
          initiatorSockets.forEach((socketId) => {
            io.to(socketId).emit('call:declined', { callId: data.callId });
          });
        }
      } catch (err) {
        console.error('Decline call error:', err);
      }
    });

    socket.on('call:end', async (data: { callId: string }) => {
      try {
        const call = await prisma.call.update({
          where: { id: data.callId },
          data: { status: 'ENDED', endedAt: new Date() },
          include: { participants: true },
        });

        // Notify all participants
        const allUserIds = [call.initiatorId, ...call.participants.map((p) => p.userId)];
        allUserIds.forEach((uid) => {
          if (uid !== userId) {
            const sockets = getUserSockets(uid);
            sockets.forEach((socketId) => {
              io.to(socketId).emit('call:ended', { callId: data.callId });
            });
          }
        });
      } catch (err) {
        console.error('End call error:', err);
      }
    });

    // WebRTC signaling — stateless relays (supports renegotiation for screen share)
    socket.on('webrtc:offer', (data: { targetUserId: string; offer: any; callId: string }) => {
      try {
        const targetSockets = getUserSockets(data.targetUserId);
        console.log(`📡 webrtc:offer ${userId} → ${data.targetUserId} (${targetSockets.size} sockets)`);
        targetSockets.forEach((socketId) => {
          io.to(socketId).emit('webrtc:offer', { offer: data.offer, callId: data.callId, userId });
        });
      } catch (err) {
        console.error('webrtc:offer relay error:', err);
      }
    });

    socket.on('webrtc:answer', (data: { targetUserId: string; answer: any; callId: string }) => {
      try {
        const targetSockets = getUserSockets(data.targetUserId);
        console.log(`📡 webrtc:answer ${userId} → ${data.targetUserId} (${targetSockets.size} sockets)`);
        targetSockets.forEach((socketId) => {
          io.to(socketId).emit('webrtc:answer', { answer: data.answer, callId: data.callId, userId });
        });
      } catch (err) {
        console.error('webrtc:answer relay error:', err);
      }
    });

    socket.on('webrtc:ice-candidate', (data: { targetUserId: string; candidate: any; callId: string }) => {
      try {
        const targetSockets = getUserSockets(data.targetUserId);
        targetSockets.forEach((socketId) => {
          io.to(socketId).emit('webrtc:ice-candidate', { candidate: data.candidate, callId: data.callId, userId });
        });
      } catch (err) {
        console.error('webrtc:ice-candidate relay error:', err);
      }
    });

    // === JOIN CHAT ===
    socket.on('chat:join', (data: { chatId: string }) => {
      socket.join(`chat:${data.chatId}`);
    });

    // === DISCONNECT ===
    socket.on('disconnect', async () => {
      console.log(`❌ User disconnected: ${userId} (socket: ${socket.id})`);

      const userSocketSet = onlineUsers.get(userId);
      if (userSocketSet) {
        userSocketSet.delete(socket.id);
        if (userSocketSet.size === 0) {
          onlineUsers.delete(userId);
          await prisma.user.update({
            where: { id: userId },
            data: { isOnline: false, lastSeen: new Date() },
          });
          socket.broadcast.emit('user:online', { userId, isOnline: false, lastSeen: new Date() });
        }
      }
    });
  });
}
