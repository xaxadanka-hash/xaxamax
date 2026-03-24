import { useState, useEffect, useRef, useCallback } from 'react';
import { getSocket } from '../../../services/socket';
import { useAuthStore } from '../../../store/authStore';
import { useWebRTC } from './useWebRTC';
import { useMediaStreams, type CallMediaType } from './useMediaStreams';
import type { TmdbMovie } from '../MovieSearch';

// ─── TYPES ────────────────────────────────────────────────────
export type CallMode = 'IDLE' | 'RINGING' | 'CONNECTING' | 'CONNECTED' | 'RECONNECTING' | 'ENDED';

export interface RemoteUser {
  id: string;
  displayName: string;
  avatar: string | null;
}

export interface CallState {
  mode: CallMode;
  isIncoming: boolean;
  callId: string | null;
  type: CallMediaType;
  isGroup: boolean;
  // 1-on-1
  remoteUserId: string | null;
  remoteUser: RemoteUser | null;
  // Group
  groupRoomId: string | null;
  participants: Map<string, RemoteUser>;
  // Streams
  remoteStreams: Map<string, MediaStream>;
  connectedPeers: Set<string>;
}

export interface WatchTogetherState {
  movie: TmdbMovie | null;
  showSearch: boolean;
}

const EMPTY_CALL: CallState = {
  mode: 'IDLE',
  isIncoming: false,
  callId: null,
  type: 'AUDIO',
  isGroup: false,
  remoteUserId: null,
  remoteUser: null,
  groupRoomId: null,
  participants: new Map(),
  remoteStreams: new Map(),
  connectedPeers: new Set(),
};

const log = (msg: string, ...a: any[]) => console.log(`[xaxamax:call] ${msg}`, ...a);
const logErr = (msg: string, ...a: any[]) => console.error(`[xaxamax:call] ${msg}`, ...a);

// ─── HOOK ─────────────────────────────────────────────────────
export function useCallManager() {
  const { user } = useAuthStore();
  const [call, setCall] = useState<CallState>({ ...EMPTY_CALL });
  const [callDuration, setCallDuration] = useState(0);
  const [watchTogether, setWatchTogether] = useState<WatchTogetherState>({ movie: null, showSearch: false });

  const callRef = useRef<CallState>({ ...EMPTY_CALL });
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Keep ref in sync
  useEffect(() => { callRef.current = call; }, [call]);

  // ─── MEDIA STREAMS ──────────────────────────────────────────
  const media = useMediaStreams();

  // ─── WEBRTC CALLBACKS ───────────────────────────────────────
  const webrtcCallbacks = useRef({
    onRemoteStream: (peerId: string, stream: MediaStream) => {
      setCall(prev => {
        const newStreams = new Map(prev.remoteStreams);
        newStreams.set(peerId, stream);
        return { ...prev, remoteStreams: newStreams };
      });
    },
    onPeerConnected: (peerId: string) => {
      log(`Peer connected: ${peerId}`);
      setCall(prev => {
        const newConnected = new Set(prev.connectedPeers);
        newConnected.add(peerId);
        const isFirstConnection = prev.mode !== 'CONNECTED';
        return {
          ...prev,
          connectedPeers: newConnected,
          mode: 'CONNECTED',
        };
      });
      // Start timer on first connection
      if (!timerRef.current) {
        timerRef.current = setInterval(() => setCallDuration(d => d + 1), 1000);
      }
    },
    onPeerDisconnected: (peerId: string) => {
      log(`Peer disconnected: ${peerId}`);
      handlePeerGone(peerId);
    },
    onPeerFailed: (peerId: string) => {
      log(`Peer failed: ${peerId}`);
      handlePeerGone(peerId);
    },
    getCallId: () => callRef.current.callId,
  }).current;

  const webrtc = useWebRTC(webrtcCallbacks);

  // ─── CLEANUP ────────────────────────────────────────────────
  const cleanup = useCallback(() => {
    webrtc.closeAll();
    media.stopAllMedia();
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setCallDuration(0);
    setWatchTogether({ movie: null, showSearch: false });
    setCall({ ...EMPTY_CALL });
  }, [webrtc, media]);

  // ─── HANDLE PEER GONE ──────────────────────────────────────
  const handlePeerGone = useCallback((peerId: string) => {
    webrtc.closePeer(peerId);
    setCall(prev => {
      const newStreams = new Map(prev.remoteStreams);
      newStreams.delete(peerId);
      const newConnected = new Set(prev.connectedPeers);
      newConnected.delete(peerId);
      const newParticipants = new Map(prev.participants);
      newParticipants.delete(peerId);

      // If no peers left in 1-on-1, end call
      if (!prev.isGroup && newConnected.size === 0 && prev.mode === 'CONNECTED') {
        // Will be cleaned up by endCall
        return prev;
      }
      return { ...prev, remoteStreams: newStreams, connectedPeers: newConnected, participants: newParticipants };
    });

    // End 1-on-1 if peer gone
    const c = callRef.current;
    if (!c.isGroup && c.mode === 'CONNECTED') {
      cleanup();
    }
  }, [webrtc, cleanup]);

  // ─── END CALL ──────────────────────────────────────────────
  const endCall = useCallback((event: 'call:end' | 'call:decline' = 'call:end') => {
    const socket = getSocket();
    const c = callRef.current;
    if (c.callId) socket?.emit(event, { callId: c.callId });
    if (c.isGroup && c.groupRoomId) socket?.emit('group:leave', { roomId: c.groupRoomId });
    cleanup();
  }, [cleanup]);

  const hangUp = useCallback(() => endCall('call:end'), [endCall]);
  const rejectCall = useCallback(() => endCall('call:decline'), [endCall]);

  // ─── SCREEN SHARE (replaceTrack pattern) ───────────────────
  const startScreenShare = useCallback(async () => {
    const screenStream = await media.getScreenMedia();
    if (!screenStream) return;

    const screenVideoTrack = screenStream.getVideoTracks()[0];
    if (!screenVideoTrack) return;

    // Replace video track on all peers (no renegotiation needed!)
    const localVideoTrack = media.localStreamRef.current?.getVideoTracks()[0] || null;
    await webrtc.replaceTrackOnAll(localVideoTrack, screenVideoTrack);

    // If screen has audio, add it as separate track
    const screenAudioTrack = screenStream.getAudioTracks()[0];
    if (screenAudioTrack && media.localStreamRef.current) {
      webrtc.addTrackToAll(screenAudioTrack, screenStream);
    }

    log('Screen share started');
  }, [media, webrtc]);

  const stopScreenShare = useCallback(async () => {
    // Restore camera video track
    const cameraVideoTrack = media.localStreamRef.current?.getVideoTracks()[0];
    if (cameraVideoTrack) {
      await webrtc.replaceTrackOnAll(null, cameraVideoTrack);
    }
    media.stopScreenShare();
    log('Screen share stopped');
  }, [media, webrtc]);

  // ─── WATCH TOGETHER ────────────────────────────────────────
  const selectMovie = useCallback((movie: TmdbMovie) => {
    setWatchTogether({ movie, showSearch: false });
    const socket = getSocket();
    const c = callRef.current;
    if (c.callId && c.remoteUserId) {
      socket?.emit('movie:select', { callId: c.callId, targetUserId: c.remoteUserId, movie });
    }
    // For group calls, broadcast to all participants
    if (c.isGroup && c.groupRoomId) {
      for (const [peerId] of c.participants) {
        socket?.emit('movie:select', { callId: c.callId, targetUserId: peerId, movie });
      }
    }
  }, []);

  const stopMovie = useCallback(() => {
    setWatchTogether(prev => ({ ...prev, movie: null }));
    const socket = getSocket();
    const c = callRef.current;
    if (c.callId && c.remoteUserId) {
      socket?.emit('movie:stop', { callId: c.callId, targetUserId: c.remoteUserId });
    }
    if (c.isGroup && c.groupRoomId) {
      for (const [peerId] of c.participants) {
        socket?.emit('movie:stop', { callId: c.callId, targetUserId: peerId });
      }
    }
  }, []);

  const toggleMovieSearch = useCallback(() => {
    setWatchTogether(prev => ({ ...prev, showSearch: !prev.showSearch }));
  }, []);

  // ─── INITIATE 1-ON-1 CALL ─────────────────────────────────
  const initiateCall = useCallback((targetUserId: string, type: CallMediaType, remoteUser: RemoteUser) => {
    webrtc.resetEnded();
    setCall({
      ...EMPTY_CALL,
      mode: 'RINGING',
      isIncoming: false,
      type,
      remoteUserId: targetUserId,
      remoteUser,
    });
    const socket = getSocket();
    socket?.emit('call:initiate', { targetUserId, type });
  }, [webrtc]);

  // ─── ANSWER INCOMING CALL ─────────────────────────────────
  const answerCall = useCallback(async () => {
    webrtc.resetEnded();
    const c = callRef.current;
    if (!c.callId || !c.remoteUserId) return;

    const stream = await media.getLocalMedia(c.type);
    if (!stream) return;

    // Create PC as callee (polite peer)
    webrtc.createPeer(c.remoteUserId, false, stream);

    setCall(prev => ({ ...prev, isIncoming: false, mode: 'CONNECTING' }));
    const socket = getSocket();
    socket?.emit('call:accept', { callId: c.callId });
  }, [webrtc, media]);

  // ─── INITIATE GROUP CALL ───────────────────────────────────
  const initiateGroupCall = useCallback((chatId: string, memberIds: string[], members: RemoteUser[]) => {
    webrtc.resetEnded();
    const participants = new Map<string, RemoteUser>();
    members.forEach(m => participants.set(m.id, m));

    setCall({
      ...EMPTY_CALL,
      mode: 'CONNECTING',
      isIncoming: false,
      type: 'VIDEO',
      isGroup: true,
      participants,
    });

    const socket = getSocket();
    socket?.emit('group:create', { chatId, memberIds });
  }, [webrtc]);

  // ─── JOIN GROUP CALL ───────────────────────────────────────
  const joinGroupCall = useCallback(async (roomId: string) => {
    webrtc.resetEnded();
    const stream = await media.getLocalMedia('VIDEO');
    if (!stream) return;

    setCall(prev => ({
      ...prev,
      mode: 'CONNECTING',
      isGroup: true,
      groupRoomId: roomId,
    }));

    const socket = getSocket();
    socket?.emit('group:join', { roomId });
  }, [webrtc, media]);

  // ─── SOCKET EVENT HANDLERS ─────────────────────────────────
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    // ── 1-ON-1: call:initiated (caller gets callId) ──
    const onCallInitiated = (data: { callId: string }) => {
      log('call:initiated, callId=', data.callId);
      setCall(prev => ({ ...prev, callId: data.callId }));
    };

    // ── 1-ON-1: incoming call ──
    const onIncomingCall = (data: { callId: string; type: CallMediaType; caller: RemoteUser }) => {
      if (callRef.current.mode !== 'IDLE') return;
      log('call:incoming from', data.caller.displayName);
      webrtc.resetEnded();
      setCall({
        ...EMPTY_CALL,
        mode: 'RINGING',
        isIncoming: true,
        callId: data.callId,
        type: data.type,
        remoteUserId: data.caller.id,
        remoteUser: data.caller,
      });
    };

    // ── 1-ON-1: callee accepted ──
    const onCallAccepted = async (data: { callId: string; userId: string }) => {
      try {
        const c = callRef.current;
        if (c.mode === 'IDLE' || c.callId !== data.callId) return;
        log('call:accepted by', data.userId);

        setCall(prev => ({ ...prev, mode: 'CONNECTING', remoteUserId: data.userId }));

        const stream = await media.getLocalMedia(c.type);
        if (!stream) { logErr('Failed to get local stream'); return; }

        // Create PC as caller (impolite peer)
        webrtc.createPeer(data.userId, true, stream);
      } catch (err) {
        logErr('onCallAccepted error:', err);
      }
    };

    // ── WebRTC signaling ──
    const onOffer = (data: { callId: string; offer: RTCSessionDescriptionInit; userId: string }) => {
      if (callRef.current.mode === 'IDLE') return;
      webrtc.handleOffer(data.userId, data.offer);
    };

    const onAnswer = (data: { answer: RTCSessionDescriptionInit; callId: string; userId: string }) => {
      webrtc.handleAnswer(data.userId, data.answer);
    };

    const onIceCandidate = (data: { candidate: RTCIceCandidateInit; callId: string; userId: string }) => {
      webrtc.handleIceCandidate(data.userId, data.candidate);
    };

    // ── Call ended/declined ──
    const onCallEnded = () => {
      if (callRef.current.mode === 'IDLE') return;
      log('call:ended received');
      cleanup();
    };

    const onCallDeclined = () => {
      if (callRef.current.mode === 'IDLE') return;
      log('call:declined received');
      cleanup();
    };

    // ── Watch Together sync ──
    const onMovieSelect = (data: { movie: TmdbMovie }) => {
      log('movie:select received', data.movie.title);
      setWatchTogether({ movie: data.movie, showSearch: false });
    };
    const onMovieStop = () => {
      log('movie:stop received');
      setWatchTogether(prev => ({ ...prev, movie: null }));
    };

    // ── GROUP CALL EVENTS ──
    const onGroupCreated = async (data: { roomId: string; callId: string }) => {
      log('group:created, roomId=', data.roomId);
      setCall(prev => ({ ...prev, callId: data.callId, groupRoomId: data.roomId }));

      const stream = await media.getLocalMedia(callRef.current.type || 'VIDEO');
      if (!stream) return;

      // Server will send group:peer-joined for each existing participant
      const socket = getSocket();
      socket?.emit('group:join', { roomId: data.roomId });
    };

    const onGroupParticipants = (data: { participants: Array<{ id: string; displayName: string; avatar: string | null }> }) => {
      log('group:participants', data.participants.map(p => p.displayName));
      // Create PC to each existing participant (we are caller since we're joining)
      const stream = media.localStreamRef.current;
      for (const p of data.participants) {
        if (p.id === user?.id) continue;
        setCall(prev => {
          const newP = new Map(prev.participants);
          newP.set(p.id, p);
          return { ...prev, participants: newP };
        });
        webrtc.createPeer(p.id, true, stream);
      }
    };

    const onGroupPeerJoined = (data: { userId: string; user: RemoteUser }) => {
      if (data.userId === user?.id) return;
      log('group:peer-joined', data.user.displayName);
      setCall(prev => {
        const newP = new Map(prev.participants);
        newP.set(data.userId, data.user);
        return { ...prev, participants: newP };
      });
      // New peer joined — they will be caller to us, so we are callee
      const stream = media.localStreamRef.current;
      webrtc.createPeer(data.userId, false, stream);
    };

    const onGroupPeerLeft = (data: { userId: string }) => {
      log('group:peer-left', data.userId);
      handlePeerGone(data.userId);
    };

    // ── GROUP SIGNALING ──
    const onGroupOffer = (data: { userId: string; offer: RTCSessionDescriptionInit }) => {
      webrtc.handleOffer(data.userId, data.offer);
    };
    const onGroupAnswer = (data: { userId: string; answer: RTCSessionDescriptionInit }) => {
      webrtc.handleAnswer(data.userId, data.answer);
    };
    const onGroupIce = (data: { userId: string; candidate: RTCIceCandidateInit }) => {
      webrtc.handleIceCandidate(data.userId, data.candidate);
    };

    // ── Incoming group call notification ──
    const onGroupIncoming = (data: { roomId: string; callId: string; chatId: string; caller: RemoteUser; participants: RemoteUser[] }) => {
      if (callRef.current.mode !== 'IDLE') return;
      log('group:incoming from', data.caller.displayName);
      webrtc.resetEnded();
      const participants = new Map<string, RemoteUser>();
      data.participants.forEach(p => participants.set(p.id, p));
      setCall({
        ...EMPTY_CALL,
        mode: 'RINGING',
        isIncoming: true,
        isGroup: true,
        callId: data.callId,
        groupRoomId: data.roomId,
        type: 'VIDEO',
        remoteUser: data.caller,
        remoteUserId: data.caller.id,
        participants,
      });
    };

    // ── Register all events ──
    socket.on('call:initiated', onCallInitiated);
    socket.on('call:incoming', onIncomingCall);
    socket.on('call:accepted', onCallAccepted);
    socket.on('webrtc:offer', onOffer);
    socket.on('webrtc:answer', onAnswer);
    socket.on('webrtc:ice-candidate', onIceCandidate);
    socket.on('call:ended', onCallEnded);
    socket.on('call:declined', onCallDeclined);
    socket.on('movie:select', onMovieSelect);
    socket.on('movie:stop', onMovieStop);
    socket.on('group:created', onGroupCreated);
    socket.on('group:participants', onGroupParticipants);
    socket.on('group:peer-joined', onGroupPeerJoined);
    socket.on('group:peer-left', onGroupPeerLeft);
    socket.on('group:offer', onGroupOffer);
    socket.on('group:answer', onGroupAnswer);
    socket.on('group:ice-candidate', onGroupIce);
    socket.on('group:incoming', onGroupIncoming);

    return () => {
      socket.off('call:initiated', onCallInitiated);
      socket.off('call:incoming', onIncomingCall);
      socket.off('call:accepted', onCallAccepted);
      socket.off('webrtc:offer', onOffer);
      socket.off('webrtc:answer', onAnswer);
      socket.off('webrtc:ice-candidate', onIceCandidate);
      socket.off('call:ended', onCallEnded);
      socket.off('call:declined', onCallDeclined);
      socket.off('movie:select', onMovieSelect);
      socket.off('movie:stop', onMovieStop);
      socket.off('group:created', onGroupCreated);
      socket.off('group:participants', onGroupParticipants);
      socket.off('group:peer-joined', onGroupPeerJoined);
      socket.off('group:peer-left', onGroupPeerLeft);
      socket.off('group:offer', onGroupOffer);
      socket.off('group:answer', onGroupAnswer);
      socket.off('group:ice-candidate', onGroupIce);
      socket.off('group:incoming', onGroupIncoming);
    };
  }, [webrtc, media, cleanup, handlePeerGone, user?.id]);

  // ─── EXPOSE INITIATE VIA WINDOW ────────────────────────────
  useEffect(() => {
    (window as any).__xaxamaxInitiateCall = initiateCall;
    (window as any).__xaxamaxInitiateGroupCall = initiateGroupCall;
    return () => {
      delete (window as any).__xaxamaxInitiateCall;
      delete (window as any).__xaxamaxInitiateGroupCall;
    };
  }, [initiateCall, initiateGroupCall]);

  return {
    call,
    callDuration,
    media,
    watchTogether,
    // Actions
    initiateCall,
    answerCall,
    hangUp,
    rejectCall,
    startScreenShare,
    stopScreenShare,
    selectMovie,
    stopMovie,
    toggleMovieSearch,
    initiateGroupCall,
    joinGroupCall,
  };
}
