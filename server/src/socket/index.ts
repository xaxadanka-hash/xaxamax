import { Server, Socket } from 'socket.io';
import { SOCKET_EVENTS } from '@xaxamax/shared/socket-events';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { sendPushToUser } from '../routes/push';
import { messageInclude } from '../lib/messageInclude';
import { prisma } from '../lib/prisma';

// userId -> Set of socketIds
const onlineUsers = new Map<string, Set<string>>();

// === GROUP CALL ROOMS ===
interface GroupRoom {
  roomId: string;
  callId: string;
  chatId: string;
  allowedUserIds: Set<string>;
  participants: Map<string, { id: string; displayName: string; avatar: string | null }>;
  watchMovie: any | null;
}
const groupRooms = new Map<string, GroupRoom>();
// userId -> roomId (track which room a user is in)
const userRoomMap = new Map<string, string>();

function getUserSockets(userId: string): Set<string> {
  return onlineUsers.get(userId) || new Set();
}

function getMessagePreview(message: { text?: string | null; type?: string | null }) {
  if (message.text?.trim()) {
    return message.text.trim().slice(0, 100);
  }

  switch (message.type) {
    case 'IMAGE':
      return '🖼 Фото';
    case 'VIDEO':
      return '🎬 Видео';
    case 'VOICE':
      return '🎤 Голосовое сообщение';
    case 'AUDIO':
      return '🎵 Аудио';
    default:
      return '📎 Медиафайл';
  }
}

async function notifyChatMembersAboutMessage(
  io: Server,
  senderId: string,
  chatId: string,
  message: { id: string; text?: string | null; type?: string | null },
  senderName?: string | null,
) {
  const members = await prisma.chatMember.findMany({
    where: { chatId, userId: { not: senderId } },
  });

  if (members.length === 0) return;

  const title = senderName || 'xaxamax';
  const body = getMessagePreview(message);

  await prisma.notification.createMany({
    data: members.map((member) => ({
      userId: member.userId,
      type: 'MESSAGE' as const,
      title,
      body,
      data: { chatId, messageId: message.id },
    })),
    skipDuplicates: true,
  });

  members.forEach((member) => {
    const sockets = getUserSockets(member.userId);
    sockets.forEach((socketId) => {
      io.to(socketId).emit(SOCKET_EVENTS.notification.new, {
        type: 'MESSAGE',
        title,
        body,
        data: { chatId, messageId: message.id },
      });
    });
  });

  const offlineMembers = members.filter((member) => {
    const sockets = onlineUsers.get(member.userId);
    return !sockets || sockets.size === 0;
  });

  await Promise.allSettled(
    offlineMembers.map((member) =>
      sendPushToUser(member.userId, {
        title,
        body,
        tag: `msg-${chatId}`,
        url: '/',
      }),
    ),
  );
}

function handleGroupLeave(userId: string, roomId: string, socket: Socket, io: Server) {
  const room = groupRooms.get(roomId);
  if (!room) return;

  room.participants.delete(userId);
  userRoomMap.delete(userId);
  socket.leave(roomId);

  // Notify remaining participants
  socket.to(roomId).emit(SOCKET_EVENTS.groupCall.peerLeft, { userId });

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
  io.use(async (socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('Требуется авторизация'));

    try {
      const decoded = jwt.verify(token, env.JWT_SECRET) as { userId: string };
      const user = await prisma.user.findUnique({
        where: { id: decoded.userId },
        select: { id: true, isBanned: true },
      });
      if (!user) {
        return next(new Error('Пользователь не найден'));
      }
      if (user.isBanned) {
        return next(new Error('Аккаунт заблокирован'));
      }
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
    const accessibleChatIds = new Set(chatMembers.map((member) => member.chatId));
    chatMembers.forEach((m) => socket.join(`chat:${m.chatId}`));

    const ensureChatAccess = async (chatId: string) => {
      if (accessibleChatIds.has(chatId)) return true;

      const member = await prisma.chatMember.findFirst({
        where: { chatId, userId },
        select: { chatId: true },
      });

      if (!member) return false;

      accessibleChatIds.add(chatId);
      return true;
    };

    const getCurrentGroupRoom = () => {
      const roomId = userRoomMap.get(userId);
      return roomId ? groupRooms.get(roomId) || null : null;
    };

    const getAccessibleCall = async (callId: string) => prisma.call.findFirst({
      where: {
        id: callId,
        OR: [
          { initiatorId: userId },
          { participants: { some: { userId } } },
        ],
      },
      select: {
        id: true,
        initiatorId: true,
        status: true,
        participants: {
          select: { userId: true },
        },
      },
    });

    const callHasUser = (
      call: { initiatorId: string; participants: Array<{ userId: string }> },
      targetUserId: string,
    ) => call.initiatorId === targetUserId || call.participants.some((participant) => participant.userId === targetUserId);

    const getGroupRoomByCallId = (callId: string) => {
      for (const room of groupRooms.values()) {
        if (room.callId === callId) {
          return room;
        }
      }
      return null;
    };

    // Broadcast online status
    socket.broadcast.emit(SOCKET_EVENTS.connection.userOnline, { userId, isOnline: true });

    // === MESSAGING ===

    socket.on(SOCKET_EVENTS.message.send, async (data: {
      chatId: string;
      text?: string;
      type?: string;
      replyToId?: string;
      mediaIds?: string[];
    }) => {
      try {
        if (!(await ensureChatAccess(data.chatId))) {
          socket.emit(SOCKET_EVENTS.connection.error, { message: 'Нет доступа к чату' });
          return;
        }

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
          include: messageInclude,
        });

        // Update chat timestamp
        await prisma.chat.update({
          where: { id: data.chatId },
          data: { updatedAt: new Date() },
        });

        // Emit to all members of the chat
        io.to(`chat:${data.chatId}`).emit(SOCKET_EVENTS.message.new, message);

        // Send delivery status
        socket.emit(SOCKET_EVENTS.message.status, { messageId: message.id, status: 'DELIVERED' });

        await notifyChatMembersAboutMessage(io, userId, data.chatId, message, message.sender.displayName);
      } catch (err) {
        console.error('Send message error:', err);
        socket.emit('error', { message: 'Ошибка отправки сообщения' });
      }
    });

    socket.on(SOCKET_EVENTS.message.typing, async (data: { chatId: string }) => {
      if (!(await ensureChatAccess(data.chatId))) return;
      socket.to(`chat:${data.chatId}`).emit(SOCKET_EVENTS.message.typing, { chatId: data.chatId, userId });
    });

    socket.on(SOCKET_EVENTS.message.stopTyping, async (data: { chatId: string }) => {
      if (!(await ensureChatAccess(data.chatId))) return;
      socket.to(`chat:${data.chatId}`).emit(SOCKET_EVENTS.message.stopTyping, { chatId: data.chatId, userId });
    });

    socket.on(SOCKET_EVENTS.message.read, async (data: { chatId: string; messageIds: string[] }) => {
      try {
        if (!(await ensureChatAccess(data.chatId))) return;

        const readableMessages = await prisma.message.findMany({
          where: {
            id: { in: data.messageIds },
            chatId: data.chatId,
            senderId: { not: userId },
            status: { not: 'READ' },
          },
          select: { id: true },
        });

        const readableMessageIds = readableMessages.map((message) => message.id);
        if (readableMessageIds.length === 0) return;

        await prisma.message.updateMany({
          where: { id: { in: readableMessageIds }, chatId: data.chatId },
          data: { status: 'READ' },
        });
        io.to(`chat:${data.chatId}`).emit(SOCKET_EVENTS.message.read, {
          chatId: data.chatId,
          messageIds: readableMessageIds,
          readBy: userId,
        });
      } catch (err) {
        console.error('Read message error:', err);
      }
    });

    socket.on(
      SOCKET_EVENTS.message.forward,
      async (
        data: { messageId: string; targetChatId: string },
        callback?: (result: { ok: boolean; error?: string }) => void,
      ) => {
        try {
          const original = await prisma.message.findUnique({
            where: { id: data.messageId },
            include: { media: true },
          });

          if (!original || original.deletedAt) {
            callback?.({ ok: false, error: 'Сообщение не найдено' });
            return;
          }

          if (!(await ensureChatAccess(original.chatId))) {
            callback?.({ ok: false, error: 'Нет доступа к исходному чату' });
            return;
          }

          const member = await prisma.chatMember.findFirst({
            where: { chatId: data.targetChatId, userId },
          });

          if (!member) {
            callback?.({ ok: false, error: 'Нет доступа к целевому чату' });
            return;
          }

          const forwarded = await prisma.message.create({
            data: {
              chatId: data.targetChatId,
              senderId: userId,
              text: original.text,
              type: original.type,
              forwardedFromId: original.id,
              ...(original.media.length > 0 && {
                media: {
                  connect: original.media.map((media) => ({ id: media.id })),
                },
              }),
            },
            include: messageInclude,
          });

          await prisma.chat.update({
            where: { id: data.targetChatId },
            data: { updatedAt: new Date() },
          });

          io.to(`chat:${data.targetChatId}`).emit(SOCKET_EVENTS.message.new, forwarded);
          await notifyChatMembersAboutMessage(
            io,
            userId,
            data.targetChatId,
            forwarded,
            forwarded.sender.displayName,
          );

          callback?.({ ok: true });
        } catch (err) {
          console.error('socket message:forward error:', err);
          callback?.({ ok: false, error: 'Ошибка пересылки сообщения' });
        }
      },
    );

    // === CALLS (WebRTC Signaling) ===

    socket.on(SOCKET_EVENTS.call.initiate, async (data: { targetUserId: string; type: 'AUDIO' | 'VIDEO' | 'SCREEN_SHARE' }) => {
      try {
        if (data.targetUserId === userId) {
          socket.emit(SOCKET_EVENTS.connection.error, { message: 'Нельзя позвонить самому себе' });
          return;
        }

        const targetUser = await prisma.user.findUnique({
          where: { id: data.targetUserId },
          select: { id: true, displayName: true, avatar: true, isBanned: true },
        });
        if (!targetUser || targetUser.isBanned) {
          socket.emit(SOCKET_EVENTS.connection.error, { message: 'Собеседник недоступен для звонка' });
          return;
        }

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
          io.to(socketId).emit(SOCKET_EVENTS.call.incoming, {
            callId: call.id,
            caller: call.initiator,
            type: data.type,
          });
        });

        socket.emit(SOCKET_EVENTS.call.initiated, { callId: call.id });
      } catch (err) {
        console.error('Initiate call error:', err);
        socket.emit('error', { message: 'Ошибка инициализации звонка' });
      }
    });

    socket.on(SOCKET_EVENTS.call.accept, async (data: { callId: string }) => {
      try {
        const call = await getAccessibleCall(data.callId);
        if (!call || call.initiatorId === userId) return;

        await prisma.call.update({
          where: { id: data.callId },
          data: { status: 'ACTIVE', startedAt: new Date() },
        });

        if (call) {
          const initiatorSockets = getUserSockets(call.initiatorId);
          initiatorSockets.forEach((socketId) => {
            io.to(socketId).emit(SOCKET_EVENTS.call.accepted, { callId: data.callId, userId });
          });
        }
      } catch (err) {
        console.error('Accept call error:', err);
      }
    });

    socket.on(SOCKET_EVENTS.call.decline, async (data: { callId: string }) => {
      try {
        const call = await getAccessibleCall(data.callId);
        if (!call || call.initiatorId === userId) return;

        await prisma.call.update({
          where: { id: data.callId },
          data: { status: 'DECLINED', endedAt: new Date() },
        });
        if (call) {
          const initiatorSockets = getUserSockets(call.initiatorId);
          initiatorSockets.forEach((socketId) => {
            io.to(socketId).emit(SOCKET_EVENTS.call.declined, { callId: data.callId });
          });
        }
      } catch (err) {
        console.error('Decline call error:', err);
      }
    });

    socket.on(SOCKET_EVENTS.call.end, async (data: { callId: string }) => {
      try {
        const accessibleCall = await getAccessibleCall(data.callId);
        if (!accessibleCall) return;

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
              io.to(socketId).emit(SOCKET_EVENTS.call.ended, { callId: data.callId });
            });
          }
        });
      } catch (err) {
        console.error('End call error:', err);
      }
    });

    // WebRTC signaling — stateless relays (supports renegotiation for screen share)
    socket.on(SOCKET_EVENTS.webrtc.offer, async (data: { targetUserId: string; offer: any; callId: string }) => {
      try {
        const call = await getAccessibleCall(data.callId);
        if (!call || !callHasUser(call, data.targetUserId)) return;
        const targetSockets = getUserSockets(data.targetUserId);
        console.log(`📡 webrtc:offer ${userId} → ${data.targetUserId} (${targetSockets.size} sockets)`);
        targetSockets.forEach((socketId) => {
          io.to(socketId).emit(SOCKET_EVENTS.webrtc.offer, { offer: data.offer, callId: data.callId, userId });
        });
      } catch (err) {
        console.error('webrtc:offer relay error:', err);
      }
    });

    socket.on(SOCKET_EVENTS.webrtc.answer, async (data: { targetUserId: string; answer: any; callId: string }) => {
      try {
        const call = await getAccessibleCall(data.callId);
        if (!call || !callHasUser(call, data.targetUserId)) return;
        const targetSockets = getUserSockets(data.targetUserId);
        console.log(`📡 webrtc:answer ${userId} → ${data.targetUserId} (${targetSockets.size} sockets)`);
        targetSockets.forEach((socketId) => {
          io.to(socketId).emit(SOCKET_EVENTS.webrtc.answer, { answer: data.answer, callId: data.callId, userId });
        });
      } catch (err) {
        console.error('webrtc:answer relay error:', err);
      }
    });

    socket.on(SOCKET_EVENTS.webrtc.iceCandidate, async (data: { targetUserId: string; candidate: any; callId: string }) => {
      try {
        const call = await getAccessibleCall(data.callId);
        if (!call || !callHasUser(call, data.targetUserId)) return;
        const targetSockets = getUserSockets(data.targetUserId);
        targetSockets.forEach((socketId) => {
          io.to(socketId).emit(SOCKET_EVENTS.webrtc.iceCandidate, { candidate: data.candidate, callId: data.callId, userId });
        });
      } catch (err) {
        console.error('webrtc:ice-candidate relay error:', err);
      }
    });

    // === MESSAGE EDIT / DELETE / PIN (real-time broadcast) ===

    socket.on(SOCKET_EVENTS.message.edit, async (data: { messageId: string; chatId: string; text: string }) => {
      try {
        const msg = await prisma.message.findUnique({ where: { id: data.messageId } });
        if (!msg || msg.senderId !== userId || msg.chatId !== data.chatId) return;
        if (!(await ensureChatAccess(data.chatId))) return;
        const updated = await prisma.message.update({
          where: { id: data.messageId },
          data: { text: data.text.trim(), editedAt: new Date() },
          include: messageInclude,
        });
        io.to(`chat:${data.chatId}`).emit(SOCKET_EVENTS.message.edited, updated);
      } catch (err) {
        console.error('socket message:edit error:', err);
      }
    });

    socket.on(SOCKET_EVENTS.message.delete, async (data: { messageId: string; chatId: string; forAll: boolean }) => {
      try {
        const msg = await prisma.message.findUnique({ where: { id: data.messageId } });
        if (!msg || msg.senderId !== userId || msg.chatId !== data.chatId) return;

        if (data.forAll) {
          await prisma.message.update({
            where: { id: data.messageId },
            data: { deletedAt: new Date(), deletedForAll: true },
          });
          io.to(`chat:${data.chatId}`).emit(SOCKET_EVENTS.message.deleted, {
            messageId: data.messageId,
            chatId: data.chatId,
            forAll: true,
            deletedBy: userId,
          });
          return;
        }

        socket.emit(SOCKET_EVENTS.message.deleted, {
          messageId: data.messageId,
          chatId: data.chatId,
          forAll: false,
          deletedBy: userId,
        });
      } catch (err) {
        console.error('socket message:delete error:', err);
      }
    });

    socket.on(SOCKET_EVENTS.message.pin, async (data: { messageId: string; chatId: string; pin: boolean }) => {
      try {
        if (!(await ensureChatAccess(data.chatId))) return;
        const message = await prisma.message.findUnique({ where: { id: data.messageId } });
        if (!message || message.chatId !== data.chatId) return;
        await prisma.message.update({
          where: { id: data.messageId },
          data: { pinnedAt: data.pin ? new Date() : null },
        });
        io.to(`chat:${data.chatId}`).emit(SOCKET_EVENTS.message.pinned, {
          messageId: data.messageId,
          chatId: data.chatId,
          pinned: data.pin,
        });
      } catch (err) {
        console.error('socket message:pin error:', err);
      }
    });

    // === MESSAGE REACTIONS ===
    socket.on(SOCKET_EVENTS.message.react, async (data: { messageId: string; chatId: string; emoji: string }) => {
      try {
        if (!(await ensureChatAccess(data.chatId))) return;

        const message = await prisma.message.findUnique({
          where: { id: data.messageId },
          select: { id: true, chatId: true, deletedAt: true },
        });
        if (!message || message.chatId !== data.chatId || message.deletedAt) return;

        const existing = await prisma.messageReaction.findUnique({
          where: { messageId_userId_emoji: { messageId: data.messageId, userId, emoji: data.emoji } },
        });
        if (existing) {
          await prisma.messageReaction.delete({ where: { id: existing.id } });
          io.to(`chat:${data.chatId}`).emit(SOCKET_EVENTS.message.reaction, { messageId: data.messageId, chatId: data.chatId, userId, emoji: data.emoji, reacted: false });
        } else {
          await prisma.messageReaction.create({ data: { messageId: data.messageId, userId, emoji: data.emoji } });
          io.to(`chat:${data.chatId}`).emit(SOCKET_EVENTS.message.reaction, { messageId: data.messageId, chatId: data.chatId, userId, emoji: data.emoji, reacted: true });
        }
      } catch (err) {
        console.error('message:react error:', err);
      }
    });

    // === CHANNEL NOTIFICATIONS ===
    // Join channel rooms for subscribed channels on connect
    (async () => {
      try {
        const subs = await prisma.channelSubscriber.findMany({ where: { userId } });
        subs.forEach(sub => socket.join(`channel:${sub.channelId}`));
      } catch { /* ignore */ }
    })();

    // Admin publishes a post → broadcast to all subscribers
    socket.on(SOCKET_EVENTS.channel.post, (data: { channelId: string; post: any }) => {
      io.to(`channel:${data.channelId}`).emit(SOCKET_EVENTS.channel.newPost, data);
    });

    // === WATCH TOGETHER (movie sync) ===
    socket.on(SOCKET_EVENTS.watchTogether.selectMovie, async (data: { targetUserId: string; callId: string; movie: any }) => {
      try {
        const call = await getAccessibleCall(data.callId);
        if (!call || !callHasUser(call, data.targetUserId)) return;

        const room = getGroupRoomByCallId(data.callId);
        if (room && room.allowedUserIds.has(userId)) {
          room.watchMovie = data.movie;
        }

        const targetSockets = getUserSockets(data.targetUserId);
        console.log(`🎬 movie:select ${userId} → ${data.targetUserId}`);
        targetSockets.forEach((socketId) => {
          io.to(socketId).emit(SOCKET_EVENTS.watchTogether.selectMovie, { movie: data.movie, callId: data.callId, userId });
        });
      } catch (err) {
        console.error('movie:select relay error:', err);
      }
    });

    socket.on(SOCKET_EVENTS.watchTogether.stopMovie, async (data: { targetUserId: string; callId: string }) => {
      try {
        const call = await getAccessibleCall(data.callId);
        if (!call || !callHasUser(call, data.targetUserId)) return;

        const room = getGroupRoomByCallId(data.callId);
        if (room && room.allowedUserIds.has(userId)) {
          room.watchMovie = null;
        }

        const targetSockets = getUserSockets(data.targetUserId);
        targetSockets.forEach((socketId) => {
          io.to(socketId).emit(SOCKET_EVENTS.watchTogether.stopMovie, { callId: data.callId, userId });
        });
      } catch (err) {
        console.error('movie:stop relay error:', err);
      }
    });

    // === JOIN CHAT ===
    socket.on(SOCKET_EVENTS.chat.join, async (data: { chatId: string }) => {
      if (!(await ensureChatAccess(data.chatId))) {
        socket.emit(SOCKET_EVENTS.connection.error, { message: 'Нет доступа к чату' });
        return;
      }

      socket.join(`chat:${data.chatId}`);
    });

    // === GROUP CALLS (Mesh P2P signaling) ===

    // Create a group call room from a chat
    socket.on(SOCKET_EVENTS.groupCall.create, async (data: { chatId: string; memberIds: string[] }) => {
      try {
        if (!(await ensureChatAccess(data.chatId))) {
          socket.emit(SOCKET_EVENTS.connection.error, { message: 'Нет доступа к групповому чату' });
          return;
        }

        const chat = await prisma.chat.findUnique({
          where: { id: data.chatId },
          select: {
            type: true,
            members: {
              select: {
                userId: true,
                user: { select: { id: true, displayName: true, avatar: true } },
              },
            },
          },
        });
        if (!chat || chat.type !== 'GROUP') {
          socket.emit(SOCKET_EVENTS.connection.error, { message: 'Групповой звонок доступен только в групповых чатах' });
          return;
        }

        const existingRoomId = userRoomMap.get(userId);
        if (existingRoomId) {
          handleGroupLeave(userId, existingRoomId, socket, io);
        }

        const availableMembers = new Map(chat.members.map((member) => [member.userId, member.user]));
        const requestedInvitees = [...new Set(data.memberIds)]
          .filter((memberId) => memberId !== userId && availableMembers.has(memberId));
        const inviteeIds = requestedInvitees.length > 0
          ? requestedInvitees
          : [...availableMembers.keys()].filter((memberId) => memberId !== userId);

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
              create: inviteeIds.map((uid) => ({ userId: uid })),
            },
          },
        });

        const roomId = `group_${call.id}`;
        const room: GroupRoom = {
          roomId,
          callId: call.id,
          chatId: data.chatId,
          allowedUserIds: new Set([userId, ...inviteeIds]),
          participants: new Map(),
          watchMovie: null,
        };
        room.participants.set(userId, caller);
        groupRooms.set(roomId, room);
        userRoomMap.set(userId, roomId);

        // Join socket.io room
        socket.join(roomId);

        // Notify caller
        socket.emit(SOCKET_EVENTS.groupCall.created, { roomId, callId: call.id });

        // Notify all members about incoming group call
        for (const memberId of inviteeIds) {
          const memberSockets = getUserSockets(memberId);
          memberSockets.forEach((socketId) => {
            io.to(socketId).emit(SOCKET_EVENTS.groupCall.incoming, {
              roomId,
              callId: call.id,
              chatId: data.chatId,
              caller,
              participants: Array.from(room.participants.values()),
            });
          });
        }

        console.log(`📞 Group call created: ${roomId} by ${caller.displayName} (${inviteeIds.length} invitees)`);
      } catch (err) {
        console.error('group:create error:', err);
        socket.emit('error', { message: 'Ошибка создания группового звонка' });
      }
    });

    // Join an existing group call room
    socket.on(SOCKET_EVENTS.groupCall.join, async (data: { roomId: string }) => {
      try {
        const room = groupRooms.get(data.roomId);
        if (!room) {
          socket.emit('error', { message: 'Комната не найдена' });
          return;
        }
        if (!room.allowedUserIds.has(userId) || !(await ensureChatAccess(room.chatId))) {
          socket.emit(SOCKET_EVENTS.connection.error, { message: 'Нет доступа к этому звонку' });
          return;
        }

        const existingRoomId = userRoomMap.get(userId);
        if (existingRoomId && existingRoomId !== data.roomId) {
          handleGroupLeave(userId, existingRoomId, socket, io);
        }

        const joiner = await prisma.user.findUnique({
          where: { id: userId },
          select: { id: true, displayName: true, avatar: true },
        });
        if (!joiner) return;

        // Send existing participants to the joiner
        const existingParticipants = Array.from(room.participants.values()).filter(p => p.id !== userId);
        socket.emit(SOCKET_EVENTS.groupCall.participants, { participants: existingParticipants });

        // Add joiner to room
        room.participants.set(userId, joiner);
        userRoomMap.set(userId, data.roomId);
        socket.join(data.roomId);

        if (room.watchMovie) {
          const currentPresenterId = room.participants.keys().next().value || room.allowedUserIds.values().next().value || userId;
          socket.emit(SOCKET_EVENTS.watchTogether.selectMovie, {
            movie: room.watchMovie,
            callId: room.callId,
            userId: currentPresenterId,
          });
        }

        // Notify others about new peer
        socket.to(data.roomId).emit(SOCKET_EVENTS.groupCall.peerJoined, { userId, user: joiner });

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
    socket.on(SOCKET_EVENTS.groupCall.leave, (data: { roomId: string }) => {
      handleGroupLeave(userId, data.roomId, socket, io);
    });

    // Group WebRTC signaling (peer-to-peer within group)
    socket.on(SOCKET_EVENTS.groupCall.offer, (data: { targetUserId: string; offer: any }) => {
      try {
        const room = getCurrentGroupRoom();
        if (!room || !room.participants.has(userId) || !room.participants.has(data.targetUserId)) return;
        const targetSockets = getUserSockets(data.targetUserId);
        targetSockets.forEach((socketId) => {
          io.to(socketId).emit(SOCKET_EVENTS.groupCall.offer, { userId, offer: data.offer });
        });
      } catch (err) {
        console.error('group:offer relay error:', err);
      }
    });

    socket.on(SOCKET_EVENTS.groupCall.answer, (data: { targetUserId: string; answer: any }) => {
      try {
        const room = getCurrentGroupRoom();
        if (!room || !room.participants.has(userId) || !room.participants.has(data.targetUserId)) return;
        const targetSockets = getUserSockets(data.targetUserId);
        targetSockets.forEach((socketId) => {
          io.to(socketId).emit(SOCKET_EVENTS.groupCall.answer, { userId, answer: data.answer });
        });
      } catch (err) {
        console.error('group:answer relay error:', err);
      }
    });

    socket.on(SOCKET_EVENTS.groupCall.iceCandidate, (data: { targetUserId: string; candidate: any }) => {
      try {
        const room = getCurrentGroupRoom();
        if (!room || !room.participants.has(userId) || !room.participants.has(data.targetUserId)) return;
        const targetSockets = getUserSockets(data.targetUserId);
        targetSockets.forEach((socketId) => {
          io.to(socketId).emit(SOCKET_EVENTS.groupCall.iceCandidate, { userId, candidate: data.candidate });
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
          socket.broadcast.emit(SOCKET_EVENTS.connection.userOnline, { userId, isOnline: false, lastSeen: new Date() });

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
