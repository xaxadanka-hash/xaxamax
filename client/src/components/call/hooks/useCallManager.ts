import { useState, useEffect, useRef, useCallback } from 'react';
import { SOCKET_EVENTS } from '@xaxamax/shared/socket-events';
import { getSocket } from '../../../services/socket';
import { useAuthStore } from '../../../store/authStore';
import { useWebRTC } from './useWebRTC';
import { useMediaStreams, type CallMediaType } from './useMediaStreams';
import type { TmdbMovie } from '../MovieSearch';
import { resolveMediaUrl } from '../../../utils/mediaUrl';

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

const withResolvedAvatar = (remoteUser: RemoteUser): RemoteUser => ({
  ...remoteUser,
  avatar: resolveMediaUrl(remoteUser.avatar),
});

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
  const screenVideoTrackRef = useRef<MediaStreamTrack | null>(null);
  const screenAudioTrackRef = useRef<MediaStreamTrack | null>(null);
  const screenShareUsedReplaceRef = useRef(false);
  const isStoppingScreenShareRef = useRef(false);

  // Keep ref in sync
  useEffect(() => { callRef.current = call; }, [call]);

  // ─── MEDIA STREAMS ──────────────────────────────────────────
  const media = useMediaStreams();

  const resetScreenShareState = useCallback(() => {
    screenVideoTrackRef.current = null;
    screenAudioTrackRef.current = null;
    screenShareUsedReplaceRef.current = false;
    isStoppingScreenShareRef.current = false;
  }, []);

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

  const finishScreenShare = useCallback(async (reason: 'manual' | 'browser-ui' = 'manual') => {
    if (isStoppingScreenShareRef.current) return;
    isStoppingScreenShareRef.current = true;

    try {
      const screenVideoTrack = screenVideoTrackRef.current;
      const screenAudioTrack = screenAudioTrackRef.current;
      const cameraVideoTrack = media.localStreamRef.current?.getVideoTracks()[0] || null;

      if (screenVideoTrack) {
        if (screenShareUsedReplaceRef.current && cameraVideoTrack) {
          await webrtc.replaceTrackOnAll(screenVideoTrack, cameraVideoTrack);
        } else {
          webrtc.removeTrackFromAll(screenVideoTrack);
        }
      }

      if (screenAudioTrack) {
        webrtc.removeTrackFromAll(screenAudioTrack);
      }

      media.stopScreenShare();
      log(`Screen share stopped (${reason})`);
    } finally {
      resetScreenShareState();
    }
  }, [media, resetScreenShareState, webrtc]);

  // ─── CLEANUP ────────────────────────────────────────────────
  const cleanup = useCallback(() => {
    media.setOnScreenShareEnded(null);
    resetScreenShareState();
    webrtc.closeAll();
    media.stopAllMedia();
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setCallDuration(0);
    setWatchTogether({ movie: null, showSearch: false });
    setCall({ ...EMPTY_CALL });
  }, [media, resetScreenShareState, webrtc]);

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
  const endCall = useCallback((event: typeof SOCKET_EVENTS.call.end | typeof SOCKET_EVENTS.call.decline = SOCKET_EVENTS.call.end) => {
    const socket = getSocket();
    const c = callRef.current;
    if (c.callId) socket?.emit(event, { callId: c.callId });
    if (c.isGroup && c.groupRoomId) socket?.emit(SOCKET_EVENTS.groupCall.leave, { roomId: c.groupRoomId });
    cleanup();
  }, [cleanup]);

  const hangUp = useCallback(() => endCall(SOCKET_EVENTS.call.end), [endCall]);
  const rejectCall = useCallback(() => endCall(SOCKET_EVENTS.call.decline), [endCall]);

  useEffect(() => {
    media.setOnScreenShareEnded(() => {
      void finishScreenShare('browser-ui');
    });

    return () => {
      media.setOnScreenShareEnded(null);
    };
  }, [finishScreenShare, media]);

  // ─── SCREEN SHARE (replaceTrack pattern) ───────────────────
  const startScreenShare = useCallback(async () => {
    const screenStream = await media.getScreenMedia();
    if (!screenStream) return;

    const screenVideoTrack = screenStream.getVideoTracks()[0];
    if (!screenVideoTrack) return;

    screenVideoTrackRef.current = screenVideoTrack;
    screenAudioTrackRef.current = null;
    screenShareUsedReplaceRef.current = false;

    const localVideoTrack = media.localStreamRef.current?.getVideoTracks()[0] || null;
    if (localVideoTrack) {
      const replacedCount = await webrtc.replaceTrackOnAll(localVideoTrack, screenVideoTrack);
      screenShareUsedReplaceRef.current = replacedCount > 0;
    }

    if (!screenShareUsedReplaceRef.current) {
      webrtc.addTrackToAll(screenVideoTrack, screenStream);
    }

    // If screen has audio, add it as separate track
    const screenAudioTrack = screenStream.getAudioTracks()[0];
    if (screenAudioTrack) {
      screenAudioTrackRef.current = screenAudioTrack;
      webrtc.addTrackToAll(screenAudioTrack, screenStream);
    }

    log('Screen share started');
  }, [media, webrtc]);

  const stopScreenShare = useCallback(async () => {
    await finishScreenShare('manual');
  }, [finishScreenShare]);

  const toggleVideo = useCallback(async () => {
    const previousTrackCount = media.localStreamRef.current?.getVideoTracks().length || 0;
    await media.toggleVideo();

    const localStream = media.localStreamRef.current;
    const currentVideoTracks = localStream?.getVideoTracks() || [];
    const addedVideoTrack = previousTrackCount === 0 ? currentVideoTracks[0] : null;

    if (localStream && addedVideoTrack) {
      webrtc.addTrackToAll(addedVideoTrack, localStream);
      setCall(prev => ({
        ...prev,
        type: prev.type === 'AUDIO' ? 'VIDEO' : prev.type,
      }));
      log('Video upgraded from audio-only call');
    }
  }, [media, webrtc]);

  // ─── WATCH TOGETHER ────────────────────────────────────────
  const selectMovie = useCallback((movie: TmdbMovie) => {
    setWatchTogether({ movie, showSearch: false });
    const socket = getSocket();
    const c = callRef.current;
    if (c.callId && c.remoteUserId) {
      socket?.emit(SOCKET_EVENTS.watchTogether.selectMovie, { callId: c.callId, targetUserId: c.remoteUserId, movie });
    }
    // For group calls, broadcast to all participants
    if (c.isGroup && c.groupRoomId) {
      for (const [peerId] of c.participants) {
        socket?.emit(SOCKET_EVENTS.watchTogether.selectMovie, { callId: c.callId, targetUserId: peerId, movie });
      }
    }
  }, []);

  const stopMovie = useCallback(() => {
    setWatchTogether(prev => ({ ...prev, movie: null }));
    const socket = getSocket();
    const c = callRef.current;
    if (c.callId && c.remoteUserId) {
      socket?.emit(SOCKET_EVENTS.watchTogether.stopMovie, { callId: c.callId, targetUserId: c.remoteUserId });
    }
    if (c.isGroup && c.groupRoomId) {
      for (const [peerId] of c.participants) {
        socket?.emit(SOCKET_EVENTS.watchTogether.stopMovie, { callId: c.callId, targetUserId: peerId });
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
      remoteUser: withResolvedAvatar(remoteUser),
    });
    const socket = getSocket();
    socket?.emit(SOCKET_EVENTS.call.initiate, { targetUserId, type });
  }, [webrtc]);

  // ─── ANSWER INCOMING CALL ─────────────────────────────────
  const answerCall = useCallback(async () => {
    webrtc.resetEnded();
    const c = callRef.current;
    if (!c.callId || !c.remoteUserId) return;

    setCall(prev => ({ ...prev, isIncoming: false, mode: 'CONNECTING' }));
    const socket = getSocket();
    socket?.emit(SOCKET_EVENTS.call.accept, { callId: c.callId });

    const stream = await media.getLocalMedia(c.type);
    if (!stream) {
      logErr('No local stream for answerCall; continuing in receive-only mode');
    }

    // Create PC as callee (polite peer)
    webrtc.createPeer(c.remoteUserId, false, stream, 'direct');
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
    socket?.emit(SOCKET_EVENTS.groupCall.create, { chatId, memberIds });
  }, [webrtc]);

  // ─── JOIN GROUP CALL ───────────────────────────────────────
  const joinGroupCall = useCallback(async (roomId: string) => {
    webrtc.resetEnded();
    const stream = await media.getLocalMedia('VIDEO');
    if (!stream) return;

    setCall(prev => ({
      ...prev,
      mode: 'CONNECTING',
      isIncoming: false,
      isGroup: true,
      groupRoomId: roomId,
    }));

    const socket = getSocket();
    socket?.emit(SOCKET_EVENTS.groupCall.join, { roomId });
  }, [webrtc, media]);

  const acceptIncomingCall = useCallback(async () => {
    const c = callRef.current;
    if (c.isGroup && c.groupRoomId) {
      await joinGroupCall(c.groupRoomId);
      return;
    }
    await answerCall();
  }, [answerCall, joinGroupCall]);

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
      const caller = withResolvedAvatar(data.caller);
      webrtc.resetEnded();
      setCall({
        ...EMPTY_CALL,
        mode: 'RINGING',
        isIncoming: true,
        callId: data.callId,
        type: data.type,
        remoteUserId: caller.id,
        remoteUser: caller,
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
        if (!stream) {
          logErr('Failed to get local stream on caller side; continuing in receive-only mode');
        }

        // Create PC as caller (impolite peer)
        webrtc.createPeer(data.userId, true, stream, 'direct');
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
      socket?.emit(SOCKET_EVENTS.groupCall.join, { roomId: data.roomId });
    };

    const onGroupParticipants = (data: { participants: Array<{ id: string; displayName: string; avatar: string | null }> }) => {
      log('group:participants', data.participants.map(p => p.displayName));
      // Create PC to each existing participant (we are caller since we're joining)
      const stream = media.localStreamRef.current;
      for (const p of data.participants) {
        if (p.id === user?.id) continue;
        const participant = withResolvedAvatar(p);
        setCall(prev => {
          const newP = new Map(prev.participants);
          newP.set(participant.id, participant);
          return { ...prev, participants: newP };
        });
        webrtc.createPeer(participant.id, true, stream, 'group');
      }
    };

    const onGroupPeerJoined = (data: { userId: string; user: RemoteUser }) => {
      if (data.userId === user?.id) return;
      const joinedUser = withResolvedAvatar(data.user);
      log('group:peer-joined', joinedUser.displayName);
      setCall(prev => {
        const newP = new Map(prev.participants);
        newP.set(data.userId, joinedUser);
        return { ...prev, participants: newP };
      });
      // New peer joined — they will be caller to us, so we are callee
      const stream = media.localStreamRef.current;
      webrtc.createPeer(data.userId, false, stream, 'group');
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
      const caller = withResolvedAvatar(data.caller);
      log('group:incoming from', caller.displayName);
      webrtc.resetEnded();
      const participants = new Map<string, RemoteUser>();
      data.participants.forEach((participant) => {
        const resolvedParticipant = withResolvedAvatar(participant);
        participants.set(resolvedParticipant.id, resolvedParticipant);
      });
      setCall({
        ...EMPTY_CALL,
        mode: 'RINGING',
        isIncoming: true,
        isGroup: true,
        callId: data.callId,
        groupRoomId: data.roomId,
        type: 'VIDEO',
        remoteUser: caller,
        remoteUserId: caller.id,
        participants,
      });
    };

    // ── Register all events ──
    socket.on(SOCKET_EVENTS.call.initiated, onCallInitiated);
    socket.on(SOCKET_EVENTS.call.incoming, onIncomingCall);
    socket.on(SOCKET_EVENTS.call.accepted, onCallAccepted);
    socket.on(SOCKET_EVENTS.webrtc.offer, onOffer);
    socket.on(SOCKET_EVENTS.webrtc.answer, onAnswer);
    socket.on(SOCKET_EVENTS.webrtc.iceCandidate, onIceCandidate);
    socket.on(SOCKET_EVENTS.call.ended, onCallEnded);
    socket.on(SOCKET_EVENTS.call.declined, onCallDeclined);
    socket.on(SOCKET_EVENTS.watchTogether.selectMovie, onMovieSelect);
    socket.on(SOCKET_EVENTS.watchTogether.stopMovie, onMovieStop);
    socket.on(SOCKET_EVENTS.groupCall.created, onGroupCreated);
    socket.on(SOCKET_EVENTS.groupCall.participants, onGroupParticipants);
    socket.on(SOCKET_EVENTS.groupCall.peerJoined, onGroupPeerJoined);
    socket.on(SOCKET_EVENTS.groupCall.peerLeft, onGroupPeerLeft);
    socket.on(SOCKET_EVENTS.groupCall.offer, onGroupOffer);
    socket.on(SOCKET_EVENTS.groupCall.answer, onGroupAnswer);
    socket.on(SOCKET_EVENTS.groupCall.iceCandidate, onGroupIce);
    socket.on(SOCKET_EVENTS.groupCall.incoming, onGroupIncoming);

    return () => {
      socket.off(SOCKET_EVENTS.call.initiated, onCallInitiated);
      socket.off(SOCKET_EVENTS.call.incoming, onIncomingCall);
      socket.off(SOCKET_EVENTS.call.accepted, onCallAccepted);
      socket.off(SOCKET_EVENTS.webrtc.offer, onOffer);
      socket.off(SOCKET_EVENTS.webrtc.answer, onAnswer);
      socket.off(SOCKET_EVENTS.webrtc.iceCandidate, onIceCandidate);
      socket.off(SOCKET_EVENTS.call.ended, onCallEnded);
      socket.off(SOCKET_EVENTS.call.declined, onCallDeclined);
      socket.off(SOCKET_EVENTS.watchTogether.selectMovie, onMovieSelect);
      socket.off(SOCKET_EVENTS.watchTogether.stopMovie, onMovieStop);
      socket.off(SOCKET_EVENTS.groupCall.created, onGroupCreated);
      socket.off(SOCKET_EVENTS.groupCall.participants, onGroupParticipants);
      socket.off(SOCKET_EVENTS.groupCall.peerJoined, onGroupPeerJoined);
      socket.off(SOCKET_EVENTS.groupCall.peerLeft, onGroupPeerLeft);
      socket.off(SOCKET_EVENTS.groupCall.offer, onGroupOffer);
      socket.off(SOCKET_EVENTS.groupCall.answer, onGroupAnswer);
      socket.off(SOCKET_EVENTS.groupCall.iceCandidate, onGroupIce);
      socket.off(SOCKET_EVENTS.groupCall.incoming, onGroupIncoming);
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
    acceptIncomingCall,
    hangUp,
    rejectCall,
    startScreenShare,
    stopScreenShare,
    toggleVideo,
    selectMovie,
    stopMovie,
    toggleMovieSearch,
    initiateGroupCall,
    joinGroupCall,
  };
}
