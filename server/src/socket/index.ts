import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// userId -> Set of socketIds
const onlineUsers = new Map<string, Set<string>>();

// === GROUP CALL ROOMS ===
interface GroupRoom {
  roomId: string;
  callId: string;
  chatId: string;
  participants: Map<string, { id: string; displayName: string; avatar: string | null }>;
}
const groupRooms = new Map<string, GroupRoom>();
// userId -> roomId (track which room a user is in)
const userRoomMap = new Map<string, string>();

function getUserSockets(userId: string): Set<string> {
  return onlineUsers.get(userId) || new Set();
}

function handleGroupLeave(userId: string, roomId: string, socket: Socket, io: Server) {
  const room = groupRooms.get(roomId);
  if (!room) return;

  room.participants.delete(userId);
  userRoomMap.delete(userId);
  socket.leave(roomId);

  // Notify remaining participants
  socket.to(roomId).emit('group:peer-left', { userId });

  console.log(`📞 ${userId} left group ${roomId} (${room.participants.size} remaining)`);

  // If room is empty, clean up
  if (room.participants.size === 0) {
    groupRooms.delete(roomId);
    // End call in DB
    prisma.call.update({
      where: { id: room.callId },
      data: { status: 'ENDED', endedAt: new Date() },
    }).catch(() => {});
    console.log(`📞 Group room ${roomId} destroyed (empty)`);
  }
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

    // === MESSAGE EDIT / DELETE / PIN (real-time broadcast) ===

    socket.on('message:edit', async (data: { messageId: string; chatId: string; text: string }) => {
      try {
        const msg = await prisma.message.findUnique({ where: { id: data.messageId } });
        if (!msg || msg.senderId !== userId) return;
        const updated = await prisma.message.update({
          where: { id: data.messageId },
          data: { text: data.text.trim(), editedAt: new Date() },
          include: {
            sender: { select: { id: true, displayName: true, avatar: true } },
            replyTo: { include: { sender: { select: { id: true, displayName: true } } } },
            media: true,
          },
        });
        io.to(`chat:${data.chatId}`).emit('message:edited', updated);
      } catch (err) {
        console.error('socket message:edit error:', err);
      }
    });

    socket.on('message:delete', async (data: { messageId: string; chatId: string; forAll: boolean }) => {
      try {
        const msg = await prisma.message.findUnique({ where: { id: data.messageId } });
        if (!msg || msg.senderId !== userId) return;
        await prisma.message.update({
          where: { id: data.messageId },
          data: { deletedAt: new Date(), deletedForAll: data.forAll },
        });
        io.to(`chat:${data.chatId}`).emit('message:deleted', {
          messageId: data.messageId,
          chatId: data.chatId,
          forAll: data.forAll,
          deletedBy: userId,
        });
      } catch (err) {
        console.error('socket message:delete error:', err);
      }
    });

    socket.on('message:pin', async (data: { messageId: string; chatId: string; pin: boolean }) => {
      try {
        const member = await prisma.chatMember.findFirst({ where: { chatId: data.chatId, userId } });
        if (!member) return;
        await prisma.message.update({
          where: { id: data.messageId },
          data: { pinnedAt: data.pin ? new Date() : null },
        });
        io.to(`chat:${data.chatId}`).emit('message:pinned', {
          messageId: data.messageId,
          chatId: data.chatId,
          pinned: data.pin,
        });
      } catch (err) {
        console.error('socket message:pin error:', err);
      }
    });

    // === WATCH TOGETHER (movie sync) ===
    socket.on('movie:select', (data: { targetUserId: string; callId: string; movie: any }) => {
      try {
        const targetSockets = getUserSockets(data.targetUserId);
        console.log(`🎬 movie:select ${userId} → ${data.targetUserId}`);
        targetSockets.forEach((socketId) => {
          io.to(socketId).emit('movie:select', { movie: data.movie, callId: data.callId, userId });
        });
      } catch (err) {
        console.error('movie:select relay error:', err);
      }
    });

    socket.on('movie:stop', (data: { targetUserId: string; callId: string }) => {
      try {
        const targetSockets = getUserSockets(data.targetUserId);
        targetSockets.forEach((socketId) => {
          io.to(socketId).emit('movie:stop', { callId: data.callId, userId });
        });
      } catch (err) {
        console.error('movie:stop relay error:', err);
      }
    });

    // === JOIN CHAT ===
    socket.on('chat:join', (data: { chatId: string }) => {
      socket.join(`chat:${data.chatId}`);
    });

    // === GROUP CALLS (Mesh P2P signaling) ===

    // Create a group call room from a chat
    socket.on('group:create', async (data: { chatId: string; memberIds: string[] }) => {
      try {
        const caller = await prisma.user.findUnique({
          where: { id: userId },
          select: { id: true, displayName: true, avatar: true },
        });
        if (!caller) return;

        // Create call record in DB
        const call = await prisma.call.create({
          data: {
            initiatorId: userId,
            type: 'VIDEO',
            participants: {
              create: data.memberIds.map((uid) => ({ userId: uid })),
            },
          },
        });

        const roomId = `group_${call.id}`;
        const room: GroupRoom = {
          roomId,
          callId: call.id,
          chatId: data.chatId,
          participants: new Map(),
        };
        room.participants.set(userId, caller);
        groupRooms.set(roomId, room);
        userRoomMap.set(userId, roomId);

        // Join socket.io room
        socket.join(roomId);

        // Notify caller
        socket.emit('group:created', { roomId, callId: call.id });

        // Notify all members about incoming group call
        for (const memberId of data.memberIds) {
          if (memberId === userId) continue;
          const memberSockets = getUserSockets(memberId);
          memberSockets.forEach((socketId) => {
            io.to(socketId).emit('group:incoming', {
              roomId,
              callId: call.id,
              chatId: data.chatId,
              caller,
              participants: Array.from(room.participants.values()),
            });
          });
        }

        console.log(`📞 Group call created: ${roomId} by ${caller.displayName} (${data.memberIds.length} members)`);
      } catch (err) {
        console.error('group:create error:', err);
        socket.emit('error', { message: 'Ошибка создания группового звонка' });
      }
    });

    // Join an existing group call room
    socket.on('group:join', async (data: { roomId: string }) => {
      try {
        const room = groupRooms.get(data.roomId);
        if (!room) {
          socket.emit('error', { message: 'Комната не найдена' });
          return;
        }

        const joiner = await prisma.user.findUnique({
          where: { id: userId },
          select: { id: true, displayName: true, avatar: true },
        });
        if (!joiner) return;

        // Send existing participants to the joiner
        const existingParticipants = Array.from(room.participants.values()).filter(p => p.id !== userId);
        socket.emit('group:participants', { participants: existingParticipants });

        // Add joiner to room
        room.participants.set(userId, joiner);
        userRoomMap.set(userId, data.roomId);
        socket.join(data.roomId);

        // Notify others about new peer
        socket.to(data.roomId).emit('group:peer-joined', { userId, user: joiner });

        // Update call status if not active
        try {
          await prisma.call.update({
            where: { id: room.callId },
            data: { status: 'ACTIVE', startedAt: new Date() },
          });
        } catch (_) { /* might already be ACTIVE */ }

        console.log(`📞 ${joiner.displayName} joined group ${data.roomId} (${room.participants.size} participants)`);
      } catch (err) {
        console.error('group:join error:', err);
      }
    });

    // Leave group call
    socket.on('group:leave', (data: { roomId: string }) => {
      handleGroupLeave(userId, data.roomId, socket, io);
    });

    // Group WebRTC signaling (peer-to-peer within group)
    socket.on('group:offer', (data: { targetUserId: string; offer: any }) => {
      try {
        const targetSockets = getUserSockets(data.targetUserId);
        targetSockets.forEach((socketId) => {
          io.to(socketId).emit('group:offer', { userId, offer: data.offer });
        });
      } catch (err) {
        console.error('group:offer relay error:', err);
      }
    });

    socket.on('group:answer', (data: { targetUserId: string; answer: any }) => {
      try {
        const targetSockets = getUserSockets(data.targetUserId);
        targetSockets.forEach((socketId) => {
          io.to(socketId).emit('group:answer', { userId, answer: data.answer });
        });
      } catch (err) {
        console.error('group:answer relay error:', err);
      }
    });

    socket.on('group:ice-candidate', (data: { targetUserId: string; candidate: any }) => {
      try {
        const targetSockets = getUserSockets(data.targetUserId);
        targetSockets.forEach((socketId) => {
          io.to(socketId).emit('group:ice-candidate', { userId, candidate: data.candidate });
        });
      } catch (err) {
        console.error('group:ice-candidate relay error:', err);
      }
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

          // Handle group call cleanup on disconnect
          const roomId = userRoomMap.get(userId);
          if (roomId) {
            handleGroupLeave(userId, roomId, socket, io);
          }
        }
      }
    });
  });
}
