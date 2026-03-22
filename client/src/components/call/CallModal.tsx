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

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

const EMPTY_CALL: CallState = {
  isActive: false, isIncoming: false, isConnected: false,
  callId: null, type: 'AUDIO', remoteUserId: null, remoteUser: null,
};

export default function CallModal() {
  const { user } = useAuthStore();
  const [call, setCall] = useState<CallState>(EMPTY_CALL);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [hasLocalStream, setHasLocalStream] = useState(false);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const iceCandidateQueue = useRef<RTCIceCandidateInit[]>([]);
  const callRef = useRef<CallState>(EMPTY_CALL);
  const endedRef = useRef(false);

  // Keep ref in sync with state
  useEffect(() => { callRef.current = call; }, [call]);

  const cleanup = useCallback(() => {
    endedRef.current = true;
    if (pcRef.current) {
      pcRef.current.onicecandidate = null;
      pcRef.current.ontrack = null;
      pcRef.current.onconnectionstatechange = null;
      pcRef.current.close();
      pcRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    iceCandidateQueue.current = [];
    setCallDuration(0);
    setIsMuted(false);
    setIsVideoOff(false);
    setIsScreenSharing(false);
    setIsFullscreen(false);
    setHasLocalStream(false);
  }, []);

  const createPeerConnection = useCallback((remoteUserId: string, callId: string) => {
    if (pcRef.current) {
      pcRef.current.close();
    }
    const pc = new RTCPeerConnection(ICE_SERVERS);
    const socket = getSocket();

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        socket?.emit('webrtc:ice-candidate', {
          callId,
          targetUserId: remoteUserId,
          candidate: e.candidate,
        });
      }
    };

    pc.ontrack = (e) => {
      if (remoteVideoRef.current && e.streams[0]) {
        remoteVideoRef.current.srcObject = e.streams[0];
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        setCall((prev) => ({ ...prev, isConnected: true }));
        if (!timerRef.current) {
          timerRef.current = setInterval(() => {
            setCallDuration((d) => d + 1);
          }, 1000);
        }
      }
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        if (!endedRef.current) {
          endedRef.current = true;
          const cid = callRef.current.callId;
          if (cid) socket?.emit('call:end', { callId: cid });
          cleanup();
          setCall(EMPTY_CALL);
        }
      }
    };

    pcRef.current = pc;
    return pc;
  }, [cleanup]);

  const getLocalStream = useCallback(async (type: CallType) => {
    try {
      if (type === 'SCREEN_SHARE') {
        const screen = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        screenStreamRef.current = screen;
        const audio = await navigator.mediaDevices.getUserMedia({ audio: true });
        const combined = new MediaStream([
          ...screen.getVideoTracks(),
          ...audio.getAudioTracks(),
        ]);
        localStreamRef.current = combined;
        screen.getVideoTracks()[0].onended = () => stopScreenShare();
      } else {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: type === 'VIDEO' ? { width: 1280, height: 720, facingMode: 'user' } : false,
        });
        localStreamRef.current = stream;
      }
      if (localVideoRef.current && localStreamRef.current) {
        localVideoRef.current.srcObject = localStreamRef.current;
      }
      setHasLocalStream(true);
      return localStreamRef.current;
    } catch (err) {
      console.error('Get media error:', err);
      return null;
    }
  }, []);

  const flushIceCandidates = useCallback(async () => {
    const pc = pcRef.current;
    if (!pc || !pc.remoteDescription) return;
    while (iceCandidateQueue.current.length > 0) {
      const candidate = iceCandidateQueue.current.shift()!;
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.error('ICE candidate error:', err);
      }
    }
  }, []);

  const hangUp = useCallback(() => {
    if (endedRef.current) return;
    endedRef.current = true;
    const socket = getSocket();
    const cid = callRef.current.callId;
    if (cid) socket?.emit('call:end', { callId: cid });
    cleanup();
    setCall(EMPTY_CALL);
  }, [cleanup]);

  const rejectCall = useCallback(() => {
    if (endedRef.current) return;
    endedRef.current = true;
    const socket = getSocket();
    const cid = callRef.current.callId;
    if (cid) socket?.emit('call:decline', { callId: cid });
    cleanup();
    setCall(EMPTY_CALL);
  }, [cleanup]);

  const toggleMute = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach((t) => { t.enabled = !t.enabled; });
      setIsMuted(!isMuted);
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
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } });
        const track = stream.getVideoTracks()[0];
        localStreamRef.current.addTrack(track);
        pcRef.current?.addTrack(track, localStreamRef.current);
        if (localVideoRef.current) localVideoRef.current.srcObject = localStreamRef.current;
        setIsVideoOff(false);
      } catch (err) {
        console.error('Toggle video error:', err);
      }
    }
  };

  const toggleScreenShare = async () => {
    if (isScreenSharing) {
      stopScreenShare();
    } else {
      try {
        const screen = await navigator.mediaDevices.getDisplayMedia({ video: true });
        screenStreamRef.current = screen;
        const videoTrack = screen.getVideoTracks()[0];
        const sender = pcRef.current?.getSenders().find((s) => s.track?.kind === 'video');
        if (sender) await sender.replaceTrack(videoTrack);
        videoTrack.onended = () => stopScreenShare();
        setIsScreenSharing(true);
        if (localVideoRef.current) localVideoRef.current.srcObject = screen;
      } catch (err) {
        console.error('Screen share error:', err);
      }
    }
  };

  const stopScreenShare = () => {
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
    }
    const videoTrack = localStreamRef.current?.getVideoTracks()[0];
    if (videoTrack) {
      const sender = pcRef.current?.getSenders().find((s) => s.track?.kind === 'video');
      if (sender) sender.replaceTrack(videoTrack);
    }
    if (localVideoRef.current && localStreamRef.current) {
      localVideoRef.current.srcObject = localStreamRef.current;
    }
    setIsScreenSharing(false);
  };

  // === SOCKET EVENT LISTENERS ===
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    // CALLER: receives callId after initiating
    const onCallInitiated = (data: { callId: string }) => {
      setCall((prev) => ({ ...prev, callId: data.callId }));
    };

    // CALLEE: receives incoming call
    const onIncomingCall = (data: {
      callId: string; type: CallType;
      caller: { id: string; displayName: string; avatar: string | null };
    }) => {
      if (callRef.current.isActive) return; // already in a call
      endedRef.current = false;
      setCall({
        isActive: true, isIncoming: true, isConnected: false,
        callId: data.callId, type: data.type,
        remoteUserId: data.caller.id, remoteUser: data.caller,
      });
    };

    // CALLER: callee accepted → get media and send offer
    const onCallAccepted = async (data: { callId: string; userId: string }) => {
      const c = callRef.current;
      if (!c.isActive || c.callId !== data.callId) return;

      const remoteUid = data.userId;
      setCall((prev) => ({ ...prev, isIncoming: false, remoteUserId: remoteUid }));

      const stream = await getLocalStream(c.type);
      if (!stream) return;

      const pc = createPeerConnection(remoteUid, data.callId);
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      socket.emit('webrtc:offer', {
        callId: data.callId,
        targetUserId: remoteUid,
        offer,
      });
    };

    // CALLEE: receives offer from caller → create answer
    const onOffer = async (data: {
      callId: string; offer: RTCSessionDescriptionInit; userId: string;
    }) => {
      const c = callRef.current;
      if (!c.isActive) return;

      const pc = pcRef.current;
      if (!pc) return;

      await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      socket.emit('webrtc:answer', {
        callId: data.callId,
        targetUserId: data.userId,
        answer,
      });

      await flushIceCandidates();
    };

    // CALLER: receives answer from callee
    const onAnswer = async (data: { answer: RTCSessionDescriptionInit; callId: string }) => {
      const pc = pcRef.current;
      if (!pc) return;
      await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
      await flushIceCandidates();
    };

    // BOTH: ICE candidates
    const onIceCandidate = async (data: { candidate: RTCIceCandidateInit; callId: string }) => {
      const pc = pcRef.current;
      if (!pc || !pc.remoteDescription) {
        iceCandidateQueue.current.push(data.candidate);
        return;
      }
      try {
        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
      } catch (err) {
        console.error('ICE candidate error:', err);
      }
    };

    const onCallEnded = () => {
      if (endedRef.current) return;
      endedRef.current = true;
      cleanup();
      setCall(EMPTY_CALL);
    };

    const onCallDeclined = () => {
      if (endedRef.current) return;
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
  }, [cleanup, createPeerConnection, getLocalStream, flushIceCandidates]);

  // CALLEE: when user clicks Accept → get media, create PC, notify server
  const answerCall = useCallback(async () => {
    endedRef.current = false;
    const c = callRef.current;
    if (!c.callId || !c.remoteUserId) return;

    const stream = await getLocalStream(c.type);
    if (!stream) return;

    const pc = createPeerConnection(c.remoteUserId, c.callId);
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));

    setCall((prev) => ({ ...prev, isIncoming: false }));
    const socket = getSocket();
    socket?.emit('call:accept', { callId: c.callId });
  }, [createPeerConnection, getLocalStream]);

  // CALLER: ChatView triggers this via socket 'call:initiate'
  // We listen for 'call:initiated' to get callId, then 'call:accepted' to start WebRTC
  const handleInitiateCall = useCallback((targetUserId: string, type: CallType, remoteUser: { id: string; displayName: string; avatar: string | null }) => {
    endedRef.current = false;
    setCall({
      isActive: true, isIncoming: false, isConnected: false,
      callId: null, type, remoteUserId: targetUserId, remoteUser,
    });
  }, []);

  // Expose for ChatView
  useEffect(() => {
    (window as any).__xaxamaxInitiateCall = handleInitiateCall;
    return () => { delete (window as any).__xaxamaxInitiateCall; };
  }, [handleInitiateCall]);

  const formatDuration = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  };

  const getInitials = (name: string) =>
    name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();

  if (!call.isActive) return null;

  const showVideo = call.type !== 'AUDIO';

  return (
    <div className={`fixed inset-0 z-50 bg-dark-950/95 backdrop-blur-sm flex flex-col items-center justify-center ${isFullscreen ? '' : 'p-4'}`}>
      {/* Remote video / Avatar */}
      <div className="relative flex-1 w-full max-w-4xl flex items-center justify-center overflow-hidden">
        {showVideo && call.isConnected ? (
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="w-full h-full max-h-[70vh] object-contain rounded-2xl bg-dark-900"
          />
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

        {/* Local video PiP — only when connected and video */}
        {showVideo && hasLocalStream && call.isConnected && (
          <div className="absolute bottom-4 right-4 w-36 h-24 rounded-xl overflow-hidden border-2 border-dark-600 shadow-2xl bg-dark-900 z-10">
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />
          </div>
        )}
      </div>

      {/* Duration when connected + audio only */}
      {call.isConnected && !showVideo && (
        <p className="text-primary-400 text-lg font-mono">{formatDuration(callDuration)}</p>
      )}

      {/* Duration overlay for video */}
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
          <button
            onClick={toggleMute}
            className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${isMuted ? 'bg-red-500/20 text-red-400' : 'bg-dark-800 text-white hover:bg-dark-700'}`}
          >
            {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
          </button>
          {showVideo && (
            <button
              onClick={toggleVideo}
              className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${isVideoOff ? 'bg-red-500/20 text-red-400' : 'bg-dark-800 text-white hover:bg-dark-700'}`}
            >
              {isVideoOff ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
            </button>
          )}
          <button
            onClick={toggleScreenShare}
            className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${isScreenSharing ? 'bg-primary-500/20 text-primary-400' : 'bg-dark-800 text-white hover:bg-dark-700'}`}
          >
            {isScreenSharing ? <MonitorOff className="w-5 h-5" /> : <Monitor className="w-5 h-5" />}
          </button>
          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="w-12 h-12 rounded-full bg-dark-800 text-white hover:bg-dark-700 flex items-center justify-center transition-colors"
          >
            {isFullscreen ? <Minimize2 className="w-5 h-5" /> : <Maximize2 className="w-5 h-5" />}
          </button>
          <button
            onClick={hangUp}
            className="w-14 h-14 rounded-full bg-red-500 flex items-center justify-center hover:bg-red-600 transition-colors shadow-lg shadow-red-500/30"
          >
            <PhoneOff className="w-6 h-6 text-white" />
          </button>
        </div>
      )}
    </div>
  );
}
