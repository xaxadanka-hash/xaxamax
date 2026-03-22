import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuthStore } from '../../store/authStore';
import { getSocket } from '../../services/socket';
import {
  Phone, PhoneOff, Video, VideoOff, Mic, MicOff, Monitor, MonitorOff,
  Maximize2, Minimize2,
} from 'lucide-react';

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

// Production ICE config: STUN + TURN (like mirotalk)
const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.relay.metered.ca:80' },
    {
      urls: [
        'turn:global.relay.metered.ca:80',
        'turn:global.relay.metered.ca:443',
        'turn:global.relay.metered.ca:443?transport=tcp',
      ],
      username: 'open',
      credential: 'open',
    },
  ],
  iceCandidatePoolSize: 10,
  iceTransportPolicy: 'all',
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require',
};

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
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [hasLocalStream, setHasLocalStream] = useState(false);
  const [hasRemoteScreen, setHasRemoteScreen] = useState(false);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const remoteScreenStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const remoteScreenRef = useRef<HTMLVideoElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const iceCandidateQueue = useRef<RTCIceCandidateInit[]>([]);
  const callRef = useRef<CallState>(EMPTY_CALL);
  const endedRef = useRef(false);
  const makingOfferRef = useRef(false);
  const iceRestartCountRef = useRef(0);
  const isCallerRef = useRef(false);

  useEffect(() => { callRef.current = call; }, [call]);

  // ─── CLEANUP ──────────────────────────────────────────────
  const cleanup = useCallback(() => {
    endedRef.current = true;
    makingOfferRef.current = false;
    iceRestartCountRef.current = 0;
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
    [localStreamRef, screenStreamRef].forEach((ref) => {
      if (ref.current) {
        ref.current.getTracks().forEach((t) => t.stop());
        ref.current = null;
      }
    });
    remoteStreamRef.current = null;
    remoteScreenStreamRef.current = null;
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    [localVideoRef, remoteVideoRef, remoteScreenRef].forEach((ref) => {
      if (ref.current) ref.current.srcObject = null;
    });
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;
    iceCandidateQueue.current = [];
    setCallDuration(0);
    setIsMuted(false);
    setIsVideoOff(false);
    setIsScreenSharing(false);
    setIsFullscreen(false);
    setHasLocalStream(false);
    setHasRemoteScreen(false);
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

    // Track handler — store streams in refs, sync to DOM via effects
    const remoteStreamTypes = new Map<string, 'camera' | 'screen'>();
    pc.ontrack = (e) => {
      if (!e.streams?.[0]) return;
      const stream = e.streams[0];
      const track = e.track;
      const streamId = stream.id;

      log('ontrack:', track.kind, 'label:', track.label, 'streamId:', streamId);

      // Detect screen share track (mirotalk pattern)
      const settings = track.getSettings?.() || {};
      const isScreen =
        (settings as any).displaySurface != null ||
        (settings as any).mediaSource === 'screen' ||
        /screen|window|monitor|display/i.test(track.label || '');

      if (track.kind === 'video' && isScreen) {
        remoteStreamTypes.set(streamId, 'screen');
        remoteScreenStreamRef.current = stream;
        setHasRemoteScreen(true);
        // Sync to DOM immediately if element available
        if (remoteScreenRef.current) remoteScreenRef.current.srcObject = stream;
      } else {
        if (!remoteStreamTypes.has(streamId)) remoteStreamTypes.set(streamId, 'camera');
        remoteStreamRef.current = stream;
        // Sync to DOM immediately if elements available
        if (remoteVideoRef.current) remoteVideoRef.current.srcObject = stream;
        if (remoteAudioRef.current) remoteAudioRef.current.srcObject = stream;
      }

      // When remote screen share track ends → clear
      track.onended = () => {
        if (remoteStreamTypes.get(streamId) === 'screen') {
          remoteStreamTypes.delete(streamId);
          remoteScreenStreamRef.current = null;
          setHasRemoteScreen(false);
          if (remoteScreenRef.current) remoteScreenRef.current.srcObject = null;
        }
      };
    };

    // onnegotiationneeded — auto-renegotiation (mirotalk key pattern)
    // Fires when addTrack/removeTrack is called (e.g., screen share toggle)
    pc.onnegotiationneeded = async () => {
      if (!isCallerRef.current) return; // Only offerer renegotiates
      try {
        makingOfferRef.current = true;
        const offer = await pc.createOffer();
        if (pc.signalingState !== 'stable') return; // Abort if state changed
        await pc.setLocalDescription(offer);
        log('onnegotiationneeded → sending offer');
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
    };

    // Connection state (mirotalk: only log, never auto-disconnect on 'disconnected')
    pc.onconnectionstatechange = () => {
      log('connectionState:', pc.connectionState);
      if (pc.connectionState === 'connected') {
        iceRestartCountRef.current = 0;
        setCall((prev) => ({ ...prev, isConnected: true }));
        if (!timerRef.current) {
          timerRef.current = setInterval(() => setCallDuration((d) => d + 1), 1000);
        }
      }
    };

    // ICE connection state — more reliable for detecting actual connectivity
    pc.oniceconnectionstatechange = () => {
      log('iceConnectionState:', pc.iceConnectionState);

      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        iceRestartCountRef.current = 0;
        setCall((prev) => ({ ...prev, isConnected: true }));
        if (!timerRef.current) {
          timerRef.current = setInterval(() => setCallDuration((d) => d + 1), 1000);
        }
      }

      // ICE restart on disconnected (mirotalk pattern: don't kill, try restart)
      if (pc.iceConnectionState === 'disconnected') {
        log('ICE disconnected — waiting for recovery...');
        // Browser will attempt recovery automatically; we just log
      }

      // ICE failed → attempt ICE restart up to 3 times (like production calling apps)
      if (pc.iceConnectionState === 'failed') {
        if (iceRestartCountRef.current < 3 && isCallerRef.current) {
          iceRestartCountRef.current++;
          log(`ICE failed → restart attempt ${iceRestartCountRef.current}/3`);
          pc.restartIce();
          // restartIce() will trigger onnegotiationneeded → new offer
        } else {
          log('ICE failed permanently → ending call');
          endCall();
        }
      }
    };

    pc.onsignalingstatechange = () => {
      log('signalingState:', pc.signalingState);
    };

    pcRef.current = pc;
    return pc;
  }, [cleanup, endCall]);

  // ─── LOCAL MEDIA ──────────────────────────────────────────
  const getLocalStream = useCallback(async (type: CallType) => {
    try {
      if (type === 'SCREEN_SHARE') {
        const screen = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        screenStreamRef.current = screen;
        const audio = await navigator.mediaDevices.getUserMedia({ audio: true });
        const combined = new MediaStream([...screen.getVideoTracks(), ...audio.getAudioTracks()]);
        localStreamRef.current = combined;
        screen.getVideoTracks()[0].onended = () => stopScreenShare();
      } else {
        const constraints: MediaStreamConstraints = {
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          video: type === 'VIDEO'
            ? { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 }, facingMode: 'user' }
            : false,
        };
        localStreamRef.current = await navigator.mediaDevices.getUserMedia(constraints);
      }
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

  // Screen share: adds as separate stream (mirotalk: separate localScreenMediaStream)
  const toggleScreenShare = async () => {
    if (isScreenSharing) {
      stopScreenShare();
    } else {
      try {
        const screen = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        screenStreamRef.current = screen;
        const screenTrack = screen.getVideoTracks()[0];

        // Add as separate track/stream — keeps camera track, triggers onnegotiationneeded
        if (pcRef.current && screenTrack) {
          pcRef.current.addTrack(screenTrack, screen);
        }
        // Also add screen audio if available
        screen.getAudioTracks().forEach((t) => {
          pcRef.current?.addTrack(t, screen);
        });

        screenTrack.onended = () => stopScreenShare();
        setIsScreenSharing(true);
        if (localVideoRef.current) localVideoRef.current.srcObject = screen;
      } catch (err) {
        logErr('toggleScreenShare error:', err);
      }
    }
  };

  const stopScreenShare = () => {
    if (screenStreamRef.current && pcRef.current) {
      const screenTracks = screenStreamRef.current.getTracks();
      // Remove from PC senders (triggers onnegotiationneeded → renegotiation)
      pcRef.current.getSenders().forEach((sender) => {
        if (sender.track && screenTracks.includes(sender.track)) {
          try { pcRef.current?.removeTrack(sender); } catch (_) {}
        }
      });
      screenTracks.forEach((t) => t.stop());
      screenStreamRef.current = null;
    }
    if (localVideoRef.current && localStreamRef.current) {
      localVideoRef.current.srcObject = localStreamRef.current;
    }
    setIsScreenSharing(false);
  };

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

        // Add tracks — this fires onnegotiationneeded which auto-creates offer
        stream.getTracks().forEach((t) => pc.addTrack(t, stream));

        // Fallback: if onnegotiationneeded didn't fire (some browsers), create offer manually
        setTimeout(async () => {
          if (pc.signalingState === 'stable' && !pc.localDescription) {
            log('Fallback: manually creating offer');
            try {
              const offer = await pc.createOffer();
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
        }, 500);
      } catch (err) {
        logErr('onCallAccepted error:', err);
      }
    };

    // CALLEE: receives offer → set remote desc → create answer
    const onOffer = async (data: {
      callId: string; offer: RTCSessionDescriptionInit; userId: string;
    }) => {
      try {
        const c = callRef.current;
        if (!c.isActive) return;
        const pc = pcRef.current;
        if (!pc) { logErr('No PC for offer'); return; }

        log('webrtc:offer received from', data.userId);

        // Perfect negotiation: handle offer collision (glare)
        const offerCollision = makingOfferRef.current || pc.signalingState !== 'stable';
        const isPolite = !isCallerRef.current; // callee is always the polite peer

        if (offerCollision && !isPolite) {
          log('Ignoring offer — collision and we are impolite');
          return;
        }

        if (offerCollision && isPolite) {
          // Rollback current local description
          await pc.setLocalDescription({ type: 'rollback' } as any);
        }

        await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        log('Sending answer to', data.userId);
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
        const pc = pcRef.current;
        if (!pc) return;
        if (pc.signalingState !== 'have-local-offer') {
          log('Ignoring answer — signalingState is', pc.signalingState);
          return;
        }
        log('webrtc:answer received');
        await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
        await flushIceCandidates();
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

    socket.on('call:initiated', onCallInitiated);
    socket.on('call:incoming', onIncomingCall);
    socket.on('call:accepted', onCallAccepted);
    socket.on('webrtc:offer', onOffer);
    socket.on('webrtc:answer', onAnswer);
    socket.on('webrtc:ice-candidate', onIceCandidate);
    socket.on('call:ended', onCallEnded);
    socket.on('call:declined', onCallDeclined);

    return () => {
      socket.off('call:initiated', onCallInitiated);
      socket.off('call:incoming', onIncomingCall);
      socket.off('call:accepted', onCallAccepted);
      socket.off('webrtc:offer', onOffer);
      socket.off('webrtc:answer', onAnswer);
      socket.off('webrtc:ice-candidate', onIceCandidate);
      socket.off('call:ended', onCallEnded);
      socket.off('call:declined', onCallDeclined);
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
  // ontrack fires BEFORE isConnected, so video elements may not exist yet.
  // These effects re-assign srcObject when elements mount or streams change.
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
    if (remoteScreenRef.current && remoteScreenStreamRef.current) {
      remoteScreenRef.current.srcObject = remoteScreenStreamRef.current;
    }
  }, [hasRemoteScreen]);

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

  return (
    <div className={`fixed inset-0 z-50 bg-dark-950/95 backdrop-blur-sm flex flex-col items-center justify-center ${isFullscreen ? '' : 'p-4'}`}>
      {/* Hidden audio element — ALWAYS rendered so remote audio plays even before isConnected */}
      <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" />

      {/* Remote video / Avatar */}
      <div className="relative flex-1 w-full max-w-4xl flex items-center justify-center overflow-hidden">
        {showVideo && call.isConnected ? (
          <div className="relative w-full h-full flex items-center justify-center">
            {/* Remote screen share — main view when active */}
            {hasRemoteScreen && (
              <video
                ref={remoteScreenRef}
                autoPlay
                playsInline
                className="w-full h-full max-h-[70vh] object-contain rounded-2xl bg-dark-900"
              />
            )}
            {/* Remote camera — main view normally, PiP when screen share active */}
            <div className={hasRemoteScreen
              ? 'absolute top-4 right-4 w-40 h-28 rounded-xl overflow-hidden border-2 border-dark-600 shadow-2xl bg-dark-900 z-10'
              : 'w-full h-full flex items-center justify-center'
            }>
              <video
                ref={remoteVideoRef}
                autoPlay
                playsInline
                className={hasRemoteScreen
                  ? 'w-full h-full object-cover'
                  : 'w-full h-full max-h-[70vh] object-contain rounded-2xl bg-dark-900'
                }
              />
            </div>
          </div>
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

        {/* Local PiP */}
        {showVideo && hasLocalStream && call.isConnected && (
          <div className="absolute bottom-4 right-4 w-36 h-24 rounded-xl overflow-hidden border-2 border-dark-600 shadow-2xl bg-dark-900 z-10">
            <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
          </div>
        )}
      </div>

      {/* Duration — audio only */}
      {call.isConnected && !showVideo && (
        <p className="text-primary-400 text-lg font-mono">{formatDuration(callDuration)}</p>
      )}

      {/* Duration — video */}
      {call.isConnected && showVideo && (
        <div className="text-center py-2">
          <p className="text-white font-medium">{call.remoteUser?.displayName}</p>
          <p className="text-dark-400 text-sm">{formatDuration(callDuration)}</p>
        </div>
      )}

      {/* Incoming call buttons */}
      {call.isIncoming && (
        <div className="flex items-center gap-8 py-8">
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
        <div className="flex items-center gap-3 py-6">
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
          <button onClick={toggleScreenShare}
            className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${isScreenSharing ? 'bg-primary-500/20 text-primary-400' : 'bg-dark-800 text-white hover:bg-dark-700'}`}>
            {isScreenSharing ? <MonitorOff className="w-5 h-5" /> : <Monitor className="w-5 h-5" />}
          </button>
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
