import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuthStore } from '../../store/authStore';
import { getSocket } from '../../services/socket';
import {
  Phone, PhoneOff, Video, VideoOff, Mic, MicOff,
  Maximize2, Minimize2, Film, X,
} from 'lucide-react';
import MovieSearch, { type TmdbMovie } from './MovieSearch';

export type CallType = 'AUDIO' | 'VIDEO' | 'SCREEN_SHARE';

interface CallState {
  isActive: boolean;
  isIncoming: boolean;
  isConnected: boolean;
  callId: string | null;
  type: CallType;
  remoteUserId: string | null;
  remoteUser: { id: string; displayName: string; avatar: string | null } | null;
}

// Production ICE config (simple-peer + mirotalk patterns)
const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:global.stun.twilio.com:3478'] },
    { urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] },
  ],
  iceCandidatePoolSize: 5,
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require',
  // @ts-ignore sdpSemantics needed for cross-browser compat (simple-peer pattern)
  sdpSemantics: 'unified-plan'
};

const ICE_RESTART_MAX = 3;
const CONNECTION_TIMEOUT_MS = 30_000; // 30s to establish connection
const ICE_FAILED_WAIT_MS = 10_000;  // callee waits 10s for caller restart

const EMPTY_CALL: CallState = {
  isActive: false, isIncoming: false, isConnected: false,
  callId: null, type: 'AUDIO', remoteUserId: null, remoteUser: null,
};

const log = (msg: string, ...args: any[]) => console.log(`[xaxamax:call] ${msg}`, ...args);
const logErr = (msg: string, ...args: any[]) => console.error(`[xaxamax:call] ${msg}`, ...args);

export default function CallModal() {
  const { user } = useAuthStore();
  const [call, setCall] = useState<CallState>(EMPTY_CALL);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [hasLocalStream, setHasLocalStream] = useState(false);
  const [showMovieSearch, setShowMovieSearch] = useState(false);
  const [watchMovie, setWatchMovie] = useState<TmdbMovie | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const iceCandidateQueue = useRef<RTCIceCandidateInit[]>([]);
  const callRef = useRef<CallState>(EMPTY_CALL);
  const endedRef = useRef(false);
  const makingOfferRef = useRef(false);
  const iceRestartCountRef = useRef(0);
  const isCallerRef = useRef(false);
  const connTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const iceFailedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isNegotiatingRef = useRef(false);     // simple-peer: prevent concurrent negotiations
  const queuedNegotiationRef = useRef(false); // simple-peer: queue renegotiation requests
  const firstNegotiationRef = useRef(true);   // simple-peer: callee skips first negotiation

  useEffect(() => { callRef.current = call; }, [call]);

  // ─── CLEANUP ──────────────────────────────────────────────
  const cleanup = useCallback(() => {
    endedRef.current = true;
    makingOfferRef.current = false;
    iceRestartCountRef.current = 0;
    isNegotiatingRef.current = false;
    queuedNegotiationRef.current = false;
    firstNegotiationRef.current = true;
    if (pcRef.current) {
      pcRef.current.onicecandidate = null;
      pcRef.current.ontrack = null;
      pcRef.current.onconnectionstatechange = null;
      pcRef.current.oniceconnectionstatechange = null;
      pcRef.current.onicecandidateerror = null;
      pcRef.current.onnegotiationneeded = null;
      pcRef.current.onsignalingstatechange = null;
      try { pcRef.current.close(); } catch (_) {}
      pcRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t: MediaStreamTrack) => t.stop());
      localStreamRef.current = null;
    }
    remoteStreamRef.current = null;
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (connTimeoutRef.current) { clearTimeout(connTimeoutRef.current); connTimeoutRef.current = null; }
    if (iceFailedTimeoutRef.current) { clearTimeout(iceFailedTimeoutRef.current); iceFailedTimeoutRef.current = null; }
    [localVideoRef, remoteVideoRef].forEach((ref) => {
      if (ref.current) ref.current.srcObject = null;
    });
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;
    iceCandidateQueue.current = [];
    setCallDuration(0);
    setIsMuted(false);
    setIsVideoOff(false);
    setIsFullscreen(false);
    setHasLocalStream(false);
    setShowMovieSearch(false);
    setWatchMovie(null);
  }, []);

  const endCall = useCallback((emitEvent: 'call:end' | 'call:decline' = 'call:end') => {
    if (endedRef.current) return;
    endedRef.current = true;
    const socket = getSocket();
    const cid = callRef.current.callId;
    if (cid) socket?.emit(emitEvent, { callId: cid });
    cleanup();
    setCall(EMPTY_CALL);
  }, [cleanup]);

  // ─── PEER CONNECTION (mirotalk-inspired) ──────────────────
  const createPeerConnection = useCallback((remoteUserId: string, callId: string, isCaller: boolean) => {
    if (pcRef.current) { try { pcRef.current.close(); } catch (_) {} }
    isCallerRef.current = isCaller;

    const pc = new RTCPeerConnection(RTC_CONFIG);
    const socket = getSocket();

    // ICE candidate → relay to remote (filter empty like mirotalk)
    pc.onicecandidate = (e) => {
      if (!e.candidate || !e.candidate.candidate) return;
      socket?.emit('webrtc:ice-candidate', {
        callId,
        targetUserId: remoteUserId,
        candidate: e.candidate.toJSON(),
      });
    };

    // ICE candidate errors (mirotalk: onicecandidateerror)
    (pc as any).onicecandidateerror = (e: any) => {
      log('ICE candidate error:', e?.url, e?.errorText);
    };

    // Track handler — simple: all remote tracks go to main stream (no screen share)
    pc.ontrack = (e) => {
      if (endedRef.current) return;
      if (!e.streams?.[0]) return;
      const stream = e.streams[0];
      log('ontrack:', e.track.kind, 'label:', e.track.label);

      remoteStreamRef.current = stream;
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = stream;
      if (remoteAudioRef.current) remoteAudioRef.current.srcObject = stream;
    };

    // onnegotiationneeded — BOTH peers can renegotiate (perfect negotiation pattern)
    // Callee skips only the FIRST negotiation (caller initiates it).
    // Subsequent negotiations (screen share, video toggle) work for both sides.
    // Batched via setTimeout(0) to coalesce multiple addTrack calls (simple-peer).
    pc.onnegotiationneeded = () => {
      if (endedRef.current) return;

      // Callee: skip initial negotiation (caller will send the first offer)
      if (!isCallerRef.current && firstNegotiationRef.current) {
        firstNegotiationRef.current = false;
        log('onnegotiationneeded — callee skipping first (caller will offer)');
        return;
      }
      firstNegotiationRef.current = false;

      if (isNegotiatingRef.current) {
        log('onnegotiationneeded — already negotiating, queueing');
        queuedNegotiationRef.current = true;
        return;
      }

      log('onnegotiationneeded → creating offer (isCaller:', isCallerRef.current, ')');
      isNegotiatingRef.current = true;
      makingOfferRef.current = true;

      // setTimeout(0) batches multiple synchronous addTrack calls into one offer
      setTimeout(async () => {
        try {
          if (endedRef.current || !pcRef.current) return;
          const offer = await pc.createOffer();
          if (endedRef.current || !pcRef.current) return;
          if (pc.signalingState !== 'stable') {
            log('onnegotiationneeded — signaling not stable, will retry on stable');
            queuedNegotiationRef.current = true;
            return;
          }
          await pc.setLocalDescription(offer);
          log('Sending offer');
          socket?.emit('webrtc:offer', {
            callId: callRef.current.callId || callId,
            targetUserId: remoteUserId,
            offer: pc.localDescription,
          });
        } catch (err) {
          logErr('onnegotiationneeded error:', err);
        } finally {
          makingOfferRef.current = false;
        }
      }, 0);
    };

    // Helper: mark call connected and clear timeouts
    const markConnected = () => {
      iceRestartCountRef.current = 0;
      if (connTimeoutRef.current) { clearTimeout(connTimeoutRef.current); connTimeoutRef.current = null; }
      if (iceFailedTimeoutRef.current) { clearTimeout(iceFailedTimeoutRef.current); iceFailedTimeoutRef.current = null; }
      setCall((prev) => {
        if (prev.isConnected) return prev; // avoid unnecessary re-render
        return { ...prev, isConnected: true };
      });
      if (!timerRef.current) {
        timerRef.current = setInterval(() => setCallDuration((d) => d + 1), 1000);
      }
    };

    // Connection state (simple-peer: check destroyed in every callback)
    pc.onconnectionstatechange = () => {
      if (endedRef.current) return;
      log('connectionState:', pc.connectionState);
      if (pc.connectionState === 'connected') markConnected();
      if (pc.connectionState === 'failed') {
        log('connectionState failed — attempting recovery');
        if (isCallerRef.current && iceRestartCountRef.current < ICE_RESTART_MAX) {
          iceRestartCountRef.current++;
          pc.restartIce();
        }
      }
    };

    // ICE connection state — more reliable for detecting actual connectivity
    pc.oniceconnectionstatechange = () => {
      if (endedRef.current) return;
      log('iceConnectionState:', pc.iceConnectionState);

      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        markConnected();
      }

      if (pc.iceConnectionState === 'disconnected') {
        log('ICE disconnected — waiting for automatic recovery...');
      }

      // ICE closed → clean end (simple-peer pattern)
      if (pc.iceConnectionState === 'closed') {
        log('ICE closed');
        if (!endedRef.current) endCall();
      }

      // ICE failed → caller retries; callee waits with timeout
      if (pc.iceConnectionState === 'failed') {
        if (isCallerRef.current) {
          if (iceRestartCountRef.current < ICE_RESTART_MAX) {
            iceRestartCountRef.current++;
            log(`ICE failed → restart attempt ${iceRestartCountRef.current}/${ICE_RESTART_MAX}`);
            pc.restartIce();
          } else {
            log('ICE failed permanently (caller) → ending call');
            endCall();
          }
        } else {
          // Callee: wait for caller to restart ICE, timeout as safety net
          log('ICE failed (callee) — waiting for caller restart...');
          if (!iceFailedTimeoutRef.current) {
            iceFailedTimeoutRef.current = setTimeout(() => {
              if (pcRef.current?.iceConnectionState === 'failed') {
                log('ICE still failed after wait → ending call');
                endCall();
              }
            }, ICE_FAILED_WAIT_MS);
          }
        }
      }
    };

    // Signaling state — flush queued negotiations when stable (simple-peer pattern)
    pc.onsignalingstatechange = () => {
      if (endedRef.current) return;
      log('signalingState:', pc.signalingState);

      if (pc.signalingState === 'stable') {
        isNegotiatingRef.current = false;
        if (queuedNegotiationRef.current) {
          log('Flushing queued negotiation');
          queuedNegotiationRef.current = false;
          // Re-trigger onnegotiationneeded
          pc.onnegotiationneeded?.(new Event('negotiationneeded'));
        }
      }
    };

    pcRef.current = pc;
    return pc;
  }, [cleanup, endCall]);

  // ─── LOCAL MEDIA ──────────────────────────────────────────
  const getLocalStream = useCallback(async (type: CallType) => {
    try {
      const constraints: MediaStreamConstraints = {
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: type === 'VIDEO'
          ? { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 }, facingMode: 'user' }
          : false,
      };
      localStreamRef.current = await navigator.mediaDevices.getUserMedia(constraints);
      if (localVideoRef.current && localStreamRef.current) {
        localVideoRef.current.srcObject = localStreamRef.current;
      }
      setHasLocalStream(true);
      return localStreamRef.current;
    } catch (err) {
      logErr('getUserMedia error:', err);
      return null;
    }
  }, []);

  // ─── ICE CANDIDATE QUEUE ─────────────────────────────────
  const flushIceCandidates = useCallback(async () => {
    const pc = pcRef.current;
    if (!pc || !pc.remoteDescription) return;
    const queued = [...iceCandidateQueue.current];
    iceCandidateQueue.current = [];
    for (const c of queued) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(c));
      } catch (err) {
        logErr('flush ICE error:', err);
      }
    }
  }, []);

  // ─── UI ACTIONS ───────────────────────────────────────────
  const hangUp = useCallback(() => endCall('call:end'), [endCall]);
  const rejectCall = useCallback(() => endCall('call:decline'), [endCall]);

  const toggleMute = () => {
    if (localStreamRef.current) {
      const enabled = !isMuted;
      localStreamRef.current.getAudioTracks().forEach((t) => { t.enabled = !enabled; });
      setIsMuted(enabled);
    }
  };

  const toggleVideo = async () => {
    if (!localStreamRef.current) return;
    const videoTracks = localStreamRef.current.getVideoTracks();
    if (videoTracks.length > 0) {
      videoTracks.forEach((t) => { t.enabled = !t.enabled; });
      setIsVideoOff((v) => !v);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        const track = stream.getVideoTracks()[0];
        localStreamRef.current.addTrack(track);
        pcRef.current?.addTrack(track, localStreamRef.current);
        if (localVideoRef.current) localVideoRef.current.srcObject = localStreamRef.current;
        setIsVideoOff(false);
      } catch (err) {
        logErr('toggleVideo error:', err);
      }
    }
  };

  // ─── WATCH TOGETHER ─────────────────────────────────────
  const selectMovie = useCallback((movie: TmdbMovie) => {
    setWatchMovie(movie);
    setShowMovieSearch(false);
    const socket = getSocket();
    const c = callRef.current;
    if (c.callId && c.remoteUserId) {
      socket?.emit('movie:select', { callId: c.callId, targetUserId: c.remoteUserId, movie });
    }
    log('Movie selected:', movie.title, 'tmdbId:', movie.id);
  }, []);

  const stopMovie = useCallback(() => {
    setWatchMovie(null);
    const socket = getSocket();
    const c = callRef.current;
    if (c.callId && c.remoteUserId) {
      socket?.emit('movie:stop', { callId: c.callId, targetUserId: c.remoteUserId });
    }
  }, []);

  // ─── SOCKET EVENTS ────────────────────────────────────────
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    // CALLER: server created call → receive callId
    const onCallInitiated = (data: { callId: string }) => {
      log('call:initiated, callId=', data.callId);
      setCall((prev) => ({ ...prev, callId: data.callId }));
    };

    // CALLEE: incoming call notification
    const onIncomingCall = (data: {
      callId: string; type: CallType;
      caller: { id: string; displayName: string; avatar: string | null };
    }) => {
      if (callRef.current.isActive) return;
      log('call:incoming from', data.caller.displayName);
      endedRef.current = false;
      setCall({
        isActive: true, isIncoming: true, isConnected: false,
        callId: data.callId, type: data.type,
        remoteUserId: data.caller.id, remoteUser: data.caller,
      });
    };

    // CALLER: callee accepted → get local media → create PC → send offer
    const onCallAccepted = async (data: { callId: string; userId: string }) => {
      try {
        const c = callRef.current;
        if (!c.isActive || c.callId !== data.callId) return;
        log('call:accepted by', data.userId);

        const remoteUid = data.userId;
        setCall((prev) => ({ ...prev, isIncoming: false, remoteUserId: remoteUid }));

        const stream = await getLocalStream(c.type);
        if (!stream) { logErr('Failed to get local stream'); return; }

        // isCaller=true → this side creates offers and handles renegotiation
        const pc = createPeerConnection(remoteUid, data.callId, true);

        // Add ALL tracks first — then onnegotiationneeded fires once (batched via setTimeout(0))
        stream.getTracks().forEach((t) => pc.addTrack(t, stream));

        // Connection timeout: if not connected in 30s, end call
        connTimeoutRef.current = setTimeout(() => {
          if (!callRef.current.isConnected && !endedRef.current) {
            log('Connection timeout (30s) → ending call');
            endCall();
          }
        }, CONNECTION_TIMEOUT_MS);

        // Fallback: if onnegotiationneeded didn't fire (some browsers), create offer manually
        setTimeout(async () => {
          if (endedRef.current || !pcRef.current) return;
          if (pc.signalingState === 'stable' && !pc.localDescription) {
            log('Fallback: manually creating offer');
            try {
              const offer = await pc.createOffer();
              if (endedRef.current) return;
              await pc.setLocalDescription(offer);
              socket.emit('webrtc:offer', {
                callId: data.callId,
                targetUserId: remoteUid,
                offer: pc.localDescription,
              });
            } catch (err) {
              logErr('Fallback offer error:', err);
            }
          }
        }, 1000);
      } catch (err) {
        logErr('onCallAccepted error:', err);
      }
    };

    // BOTH: receives offer → set remote desc → create answer (perfect negotiation)
    const onOffer = async (data: {
      callId: string; offer: RTCSessionDescriptionInit; userId: string;
    }) => {
      try {
        if (endedRef.current) return;
        const c = callRef.current;
        if (!c.isActive) return;
        const pc = pcRef.current;
        if (!pc) { logErr('No PC for offer'); return; }

        log('webrtc:offer received, signalingState:', pc.signalingState);

        // Perfect negotiation: handle offer collision (glare)
        const offerCollision = makingOfferRef.current || pc.signalingState !== 'stable';
        const isPolite = !isCallerRef.current; // callee is always the polite peer

        if (offerCollision && !isPolite) {
          log('Ignoring offer — collision and we are impolite');
          return;
        }

        if (offerCollision && isPolite) {
          log('Offer collision — polite peer rolling back');
          await pc.setLocalDescription({ type: 'rollback' } as any);
        }

        await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
        if (endedRef.current) return;

        const answer = await pc.createAnswer();
        if (endedRef.current) return;

        await pc.setLocalDescription(answer);

        log('Sending answer');
        socket.emit('webrtc:answer', {
          callId: data.callId,
          targetUserId: data.userId,
          answer: pc.localDescription,
        });

        await flushIceCandidates();
      } catch (err) {
        logErr('onOffer error:', err);
      }
    };

    // CALLER: receives answer
    const onAnswer = async (data: { answer: RTCSessionDescriptionInit; callId: string }) => {
      try {
        if (endedRef.current) return;
        const pc = pcRef.current;
        if (!pc) return;
        if (pc.signalingState !== 'have-local-offer') {
          log('Ignoring answer — signalingState is', pc.signalingState);
          return;
        }
        log('webrtc:answer received');
        await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
        if (endedRef.current) return;
        await flushIceCandidates();
        // Mark negotiation complete → signalingState will go to 'stable' → flush queued
        isNegotiatingRef.current = false;
      } catch (err) {
        logErr('onAnswer error:', err);
      }
    };

    // BOTH: ICE candidates (filter empty like mirotalk)
    const onIceCandidate = async (data: { candidate: RTCIceCandidateInit; callId: string }) => {
      if (!data.candidate || !data.candidate.candidate) return;
      const pc = pcRef.current;
      if (!pc || !pc.remoteDescription) {
        iceCandidateQueue.current.push(data.candidate);
        return;
      }
      try {
        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
      } catch (err) {
        logErr('addIceCandidate error:', err);
      }
    };

    const onCallEnded = () => {
      if (endedRef.current) return;
      log('call:ended received');
      endedRef.current = true;
      cleanup();
      setCall(EMPTY_CALL);
    };

    const onCallDeclined = () => {
      if (endedRef.current) return;
      log('call:declined received');
      endedRef.current = true;
      cleanup();
      setCall(EMPTY_CALL);
    };

    // Watch Together: remote peer selected/stopped movie
    const onMovieSelect = (data: { movie: TmdbMovie }) => {
      log('movie:select received', data.movie.title);
      setWatchMovie(data.movie);
      setShowMovieSearch(false);
    };
    const onMovieStop = () => {
      log('movie:stop received');
      setWatchMovie(null);
    };

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
    };
  }, [cleanup, createPeerConnection, getLocalStream, flushIceCandidates, endCall]);

  // CALLEE: click Accept → get media → create PC → tell server
  const answerCall = useCallback(async () => {
    endedRef.current = false;
    const c = callRef.current;
    if (!c.callId || !c.remoteUserId) return;

    const stream = await getLocalStream(c.type);
    if (!stream) return;

    // isCaller=false → callee is the polite peer in perfect negotiation
    const pc = createPeerConnection(c.remoteUserId, c.callId, false);
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));

    setCall((prev) => ({ ...prev, isIncoming: false }));
    const socket = getSocket();
    socket?.emit('call:accept', { callId: c.callId });
  }, [createPeerConnection, getLocalStream]);

  // CALLER: ChatView triggers this
  const handleInitiateCall = useCallback((
    targetUserId: string,
    type: CallType,
    remoteUser: { id: string; displayName: string; avatar: string | null },
  ) => {
    endedRef.current = false;
    setCall({
      isActive: true, isIncoming: false, isConnected: false,
      callId: null, type, remoteUserId: targetUserId, remoteUser,
    });
  }, []);

  useEffect(() => {
    (window as any).__xaxamaxInitiateCall = handleInitiateCall;
    return () => { delete (window as any).__xaxamaxInitiateCall; };
  }, [handleInitiateCall]);

  // ─── SYNC STREAMS TO DOM ───────────────────────────────────
  useEffect(() => {
    if (remoteVideoRef.current && remoteStreamRef.current) {
      remoteVideoRef.current.srcObject = remoteStreamRef.current;
    }
  }, [call.isConnected, hasLocalStream]);

  useEffect(() => {
    if (remoteAudioRef.current && remoteStreamRef.current) {
      remoteAudioRef.current.srcObject = remoteStreamRef.current;
    }
  }, [call.isConnected]);

  useEffect(() => {
    if (localVideoRef.current && localStreamRef.current) {
      localVideoRef.current.srcObject = localStreamRef.current;
    }
  }, [call.isConnected, hasLocalStream]);

  // ─── HELPERS ──────────────────────────────────────────────
  const formatDuration = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  };

  const getInitials = (name: string) =>
    name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();

  // ─── RENDER ───────────────────────────────────────────────
  if (!call.isActive) return null;

  const showVideo = call.type !== 'AUDIO';
  const isWatching = !!watchMovie;

  return (
    <div className={`fixed inset-0 z-50 bg-dark-950/95 backdrop-blur-sm flex flex-col ${isFullscreen ? '' : 'p-4'}`}>
      {/* Hidden audio — ALWAYS rendered */}
      <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" />

      {/* Movie search overlay */}
      {showMovieSearch && (
        <MovieSearch onSelect={selectMovie} onClose={() => setShowMovieSearch(false)} />
      )}

      {/* ── MAIN CONTENT ── */}
      <div className="relative flex-1 w-full flex items-center justify-center overflow-hidden">

        {/* WATCH TOGETHER MODE: movie iframe + 2 camera PiPs */}
        {isWatching && call.isConnected ? (
          <div className="relative w-full h-full flex flex-col">
            {/* Movie title bar */}
            <div className="flex items-center gap-3 px-4 py-2 bg-dark-900/80">
              <Film className="w-5 h-5 text-primary-400" />
              <p className="text-sm text-white font-medium flex-1 truncate">{watchMovie.title}</p>
              <button onClick={stopMovie} className="p-1 rounded-full hover:bg-dark-700 text-dark-400 hover:text-white transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            {/* VidSrc iframe */}
            <div className="flex-1 relative bg-black rounded-xl overflow-hidden mx-2">
              <iframe
                src={`https://vidsrc.cc/v3/embed/movie/${watchMovie.id}?autoPlay=true`}
                className="w-full h-full absolute inset-0"
                allowFullScreen
                allow="autoplay; fullscreen; encrypted-media"
                referrerPolicy="origin"
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
              />
              {/* Remote camera PiP — top right */}
              {showVideo && (
                <div className="absolute top-3 right-3 w-36 h-24 rounded-xl overflow-hidden border-2 border-dark-600/80 shadow-2xl bg-dark-900 z-10">
                  <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" />
                </div>
              )}
              {/* Local camera PiP — bottom right */}
              {showVideo && hasLocalStream && (
                <div className="absolute bottom-3 right-3 w-28 h-20 rounded-xl overflow-hidden border-2 border-primary-500/50 shadow-2xl bg-dark-900 z-10">
                  <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                </div>
              )}
            </div>
          </div>

        /* NORMAL VIDEO CALL MODE */
        ) : showVideo && call.isConnected ? (
          <div className="relative w-full h-full max-w-4xl flex items-center justify-center">
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className="w-full h-full max-h-[70vh] object-contain rounded-2xl bg-dark-900"
            />
            {/* Local PiP */}
            {hasLocalStream && (
              <div className="absolute bottom-4 right-4 w-36 h-24 rounded-xl overflow-hidden border-2 border-dark-600 shadow-2xl bg-dark-900 z-10">
                <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
              </div>
            )}
          </div>

        /* CONNECTING / AUDIO CALL / INCOMING */
        ) : (
          <div className="flex flex-col items-center gap-4">
            <div className="w-32 h-32 rounded-full bg-primary-600/30 flex items-center justify-center text-4xl font-bold text-primary-300 overflow-hidden">
              {call.remoteUser?.avatar
                ? <img src={call.remoteUser.avatar} className="w-full h-full rounded-full object-cover" alt="" />
                : getInitials(call.remoteUser?.displayName || '?')}
            </div>
            <h3 className="text-xl font-semibold text-white">{call.remoteUser?.displayName}</h3>
            <p className="text-dark-400 text-sm animate-pulse">
              {call.isIncoming ? 'Входящий звонок...' : call.isConnected ? formatDuration(callDuration) : 'Соединение...'}
            </p>
          </div>
        )}
      </div>

      {/* Duration bar */}
      {call.isConnected && (
        <div className="text-center py-2">
          <p className="text-white font-medium text-sm">{call.remoteUser?.displayName}</p>
          <p className="text-dark-400 text-xs font-mono">{formatDuration(callDuration)}</p>
        </div>
      )}

      {/* Incoming call buttons */}
      {call.isIncoming && (
        <div className="flex items-center justify-center gap-8 py-8">
          <div className="flex flex-col items-center gap-2">
            <button onClick={rejectCall} className="w-16 h-16 rounded-full bg-red-500 flex items-center justify-center hover:bg-red-600 transition-colors shadow-lg shadow-red-500/30">
              <PhoneOff className="w-7 h-7 text-white" />
            </button>
            <span className="text-xs text-dark-400">Отклонить</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <button onClick={answerCall} className="w-16 h-16 rounded-full bg-green-500 flex items-center justify-center hover:bg-green-600 transition-colors animate-pulse shadow-lg shadow-green-500/30">
              <Phone className="w-7 h-7 text-white" />
            </button>
            <span className="text-xs text-dark-400">Принять</span>
          </div>
        </div>
      )}

      {/* Active call controls */}
      {!call.isIncoming && (
        <div className="flex items-center justify-center gap-3 py-4">
          <button onClick={toggleMute}
            className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${isMuted ? 'bg-red-500/20 text-red-400' : 'bg-dark-800 text-white hover:bg-dark-700'}`}>
            {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
          </button>
          {showVideo && (
            <button onClick={toggleVideo}
              className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${isVideoOff ? 'bg-red-500/20 text-red-400' : 'bg-dark-800 text-white hover:bg-dark-700'}`}>
              {isVideoOff ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
            </button>
          )}
          {/* Watch Together button */}
          {call.isConnected && (
            <button onClick={() => setShowMovieSearch(true)}
              className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${isWatching ? 'bg-primary-500/20 text-primary-400' : 'bg-dark-800 text-white hover:bg-dark-700'}`}>
              <Film className="w-5 h-5" />
            </button>
          )}
          <button onClick={() => setIsFullscreen(!isFullscreen)}
            className="w-12 h-12 rounded-full bg-dark-800 text-white hover:bg-dark-700 flex items-center justify-center transition-colors">
            {isFullscreen ? <Minimize2 className="w-5 h-5" /> : <Maximize2 className="w-5 h-5" />}
          </button>
          <button onClick={hangUp}
            className="w-14 h-14 rounded-full bg-red-500 flex items-center justify-center hover:bg-red-600 transition-colors shadow-lg shadow-red-500/30">
            <PhoneOff className="w-6 h-6 text-white" />
          </button>
        </div>
      )}
    </div>
  );
}
