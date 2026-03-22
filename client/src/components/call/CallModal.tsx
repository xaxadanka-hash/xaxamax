import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuthStore } from '../../store/authStore';
import { getSocket } from '../../services/socket';
import {
  Phone, PhoneOff, Video, VideoOff, Mic, MicOff, Monitor, MonitorOff,
  X, Maximize2, Minimize2,
} from 'lucide-react';

export type CallType = 'AUDIO' | 'VIDEO' | 'SCREEN_SHARE';

interface CallState {
  isActive: boolean;
  isIncoming: boolean;
  isConnected: boolean;
  callId: string | null;
  type: CallType;
  remoteUser: { id: string; displayName: string; avatar: string | null } | null;
}

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

export default function CallModal() {
  const { user } = useAuthStore();
  const [call, setCall] = useState<CallState>({
    isActive: false, isIncoming: false, isConnected: false,
    callId: null, type: 'AUDIO', remoteUser: null,
  });
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [callDuration, setCallDuration] = useState(0);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const cleanup = useCallback(() => {
    if (pcRef.current) {
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
    setCallDuration(0);
    setIsMuted(false);
    setIsVideoOff(false);
    setIsScreenSharing(false);
    setIsFullscreen(false);
  }, []);

  const createPeerConnection = useCallback(() => {
    const pc = new RTCPeerConnection(ICE_SERVERS);
    const socket = getSocket();

    pc.onicecandidate = (e) => {
      if (e.candidate && call.callId) {
        socket?.emit('webrtc:ice-candidate', {
          callId: call.callId,
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
        timerRef.current = setInterval(() => {
          setCallDuration((d) => d + 1);
        }, 1000);
      }
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        hangUp();
      }
    };

    pcRef.current = pc;
    return pc;
  }, [call.callId]);

  const getLocalStream = useCallback(async (type: CallType) => {
    try {
      if (type === 'SCREEN_SHARE') {
        const screen = await navigator.mediaDevices.getDisplayMedia({
          video: true, audio: true,
        });
        screenStreamRef.current = screen;
        const audio = await navigator.mediaDevices.getUserMedia({ audio: true });
        const combined = new MediaStream([
          ...screen.getVideoTracks(),
          ...audio.getAudioTracks(),
        ]);
        localStreamRef.current = combined;

        screen.getVideoTracks()[0].onended = () => {
          stopScreenShare();
        };
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

      return localStreamRef.current;
    } catch (err) {
      console.error('Get media error:', err);
      return null;
    }
  }, []);

  const startCall = useCallback(async (targetUserId: string, type: CallType) => {
    const stream = await getLocalStream(type);
    if (!stream) return;

    const pc = createPeerConnection();
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const socket = getSocket();
    socket?.emit('webrtc:offer', {
      callId: call.callId,
      targetUserId,
      offer,
      type,
    });
  }, [call.callId, createPeerConnection, getLocalStream]);

  const answerCall = useCallback(async () => {
    const stream = await getLocalStream(call.type);
    if (!stream) return;

    const pc = createPeerConnection();
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));

    setCall((prev) => ({ ...prev, isIncoming: false }));
    const socket = getSocket();
    socket?.emit('call:accept', { callId: call.callId });
  }, [call.callId, call.type, createPeerConnection, getLocalStream]);

  const hangUp = useCallback(() => {
    const socket = getSocket();
    if (call.callId) {
      socket?.emit('call:end', { callId: call.callId });
    }
    cleanup();
    setCall({
      isActive: false, isIncoming: false, isConnected: false,
      callId: null, type: 'AUDIO', remoteUser: null,
    });
  }, [call.callId, cleanup]);

  const rejectCall = useCallback(() => {
    const socket = getSocket();
    if (call.callId) {
      socket?.emit('call:reject', { callId: call.callId });
    }
    cleanup();
    setCall({
      isActive: false, isIncoming: false, isConnected: false,
      callId: null, type: 'AUDIO', remoteUser: null,
    });
  }, [call.callId, cleanup]);

  const toggleMute = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach((t) => { t.enabled = !t.enabled; });
      setIsMuted(!isMuted);
    }
  };

  const toggleVideo = async () => {
    if (localStreamRef.current) {
      const videoTracks = localStreamRef.current.getVideoTracks();
      if (videoTracks.length > 0) {
        videoTracks.forEach((t) => { t.enabled = !t.enabled; });
        setIsVideoOff(!isVideoOff);
      } else {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } });
          stream.getVideoTracks().forEach((t) => {
            localStreamRef.current?.addTrack(t);
            pcRef.current?.getSenders().forEach((s) => {
              if (s.track?.kind === 'video') s.replaceTrack(t);
              else if (!s.track) pcRef.current?.addTrack(t, localStreamRef.current!);
            });
          });
          if (localVideoRef.current) localVideoRef.current.srcObject = localStreamRef.current;
          setIsVideoOff(false);
        } catch (err) {
          console.error('Toggle video error:', err);
        }
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
        if (sender) {
          await sender.replaceTrack(videoTrack);
        }

        videoTrack.onended = () => stopScreenShare();
        setIsScreenSharing(true);

        if (localVideoRef.current) {
          localVideoRef.current.srcObject = screen;
        }
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

  // Socket event listeners
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const onIncomingCall = (data: { callId: string; type: CallType; caller: { id: string; displayName: string; avatar: string | null } }) => {
      setCall({
        isActive: true, isIncoming: true, isConnected: false,
        callId: data.callId, type: data.type, remoteUser: data.caller,
      });
    };

    const onCallAccepted = async (data: { callId: string }) => {
      setCall((prev) => ({ ...prev, isIncoming: false }));
    };

    const onOffer = async (data: { callId: string; offer: RTCSessionDescriptionInit; from: string }) => {
      const pc = pcRef.current;
      if (!pc) return;
      await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('webrtc:answer', { callId: data.callId, answer });
    };

    const onAnswer = async (data: { answer: RTCSessionDescriptionInit }) => {
      const pc = pcRef.current;
      if (!pc) return;
      await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
    };

    const onIceCandidate = async (data: { candidate: RTCIceCandidateInit }) => {
      const pc = pcRef.current;
      if (!pc) return;
      try {
        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
      } catch (err) {
        console.error('ICE candidate error:', err);
      }
    };

    const onCallEnded = () => {
      cleanup();
      setCall({
        isActive: false, isIncoming: false, isConnected: false,
        callId: null, type: 'AUDIO', remoteUser: null,
      });
    };

    const onCallRejected = () => {
      cleanup();
      setCall({
        isActive: false, isIncoming: false, isConnected: false,
        callId: null, type: 'AUDIO', remoteUser: null,
      });
    };

    socket.on('call:incoming', onIncomingCall);
    socket.on('call:accepted', onCallAccepted);
    socket.on('webrtc:offer', onOffer);
    socket.on('webrtc:answer', onAnswer);
    socket.on('webrtc:ice-candidate', onIceCandidate);
    socket.on('call:ended', onCallEnded);
    socket.on('call:rejected', onCallRejected);

    // Expose startCall globally for ChatView to use
    (window as any).__xaxamaxStartCall = (targetUserId: string, type: CallType, callId: string, remoteUser: any) => {
      setCall({ isActive: true, isIncoming: false, isConnected: false, callId, type, remoteUser });
      startCall(targetUserId, type);
    };

    return () => {
      socket.off('call:incoming', onIncomingCall);
      socket.off('call:accepted', onCallAccepted);
      socket.off('webrtc:offer', onOffer);
      socket.off('webrtc:answer', onAnswer);
      socket.off('webrtc:ice-candidate', onIceCandidate);
      socket.off('call:ended', onCallEnded);
      socket.off('call:rejected', onCallRejected);
      delete (window as any).__xaxamaxStartCall;
    };
  }, [startCall, cleanup]);

  const formatDuration = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  };

  const getInitials = (name: string) => name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();

  if (!call.isActive) return null;

  const showVideo = call.type !== 'AUDIO' || !isVideoOff;

  return (
    <div className={`fixed inset-0 z-50 bg-dark-950/95 flex flex-col items-center justify-center ${isFullscreen ? '' : 'p-4'}`}>
      {/* Remote video / Avatar */}
      <div className="relative flex-1 w-full max-w-4xl flex items-center justify-center">
        {showVideo ? (
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="w-full h-full max-h-[70vh] object-contain rounded-2xl bg-dark-900"
          />
        ) : (
          <div className="flex flex-col items-center gap-4">
            <div className="w-32 h-32 rounded-full bg-primary-600/30 flex items-center justify-center text-4xl font-bold text-primary-300">
              {call.remoteUser?.avatar
                ? <img src={call.remoteUser.avatar} className="w-full h-full rounded-full object-cover" alt="" />
                : getInitials(call.remoteUser?.displayName || '?')}
            </div>
            <h3 className="text-xl font-semibold text-white">{call.remoteUser?.displayName}</h3>
            <p className="text-dark-400 text-sm">
              {call.isIncoming ? 'Входящий звонок...' : call.isConnected ? formatDuration(callDuration) : 'Соединение...'}
            </p>
          </div>
        )}

        {/* Local video PiP */}
        {showVideo && localStreamRef.current && (
          <div className="absolute bottom-4 right-4 w-40 h-28 rounded-xl overflow-hidden border-2 border-dark-700 shadow-xl">
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

      {/* Call info */}
      {call.isConnected && showVideo && (
        <div className="text-center py-2">
          <p className="text-white font-medium">{call.remoteUser?.displayName}</p>
          <p className="text-dark-400 text-sm">{formatDuration(callDuration)}</p>
        </div>
      )}

      {/* Incoming call buttons */}
      {call.isIncoming && (
        <div className="flex items-center gap-6 py-8">
          <button onClick={rejectCall} className="w-16 h-16 rounded-full bg-red-500 flex items-center justify-center hover:bg-red-600 transition-colors">
            <PhoneOff className="w-7 h-7 text-white" />
          </button>
          <button onClick={answerCall} className="w-16 h-16 rounded-full bg-green-500 flex items-center justify-center hover:bg-green-600 transition-colors animate-pulse">
            <Phone className="w-7 h-7 text-white" />
          </button>
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
          <button
            onClick={toggleVideo}
            className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${isVideoOff ? 'bg-red-500/20 text-red-400' : 'bg-dark-800 text-white hover:bg-dark-700'}`}
          >
            {isVideoOff ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
          </button>
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
            className="w-14 h-14 rounded-full bg-red-500 flex items-center justify-center hover:bg-red-600 transition-colors"
          >
            <PhoneOff className="w-6 h-6 text-white" />
          </button>
        </div>
      )}
    </div>
  );
}
