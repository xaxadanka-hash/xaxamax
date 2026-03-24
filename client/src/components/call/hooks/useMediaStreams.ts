import { useRef, useCallback, useState } from 'react';

const log = (msg: string, ...a: any[]) => console.log(`[xaxamax:media] ${msg}`, ...a);
const logErr = (msg: string, ...a: any[]) => console.error(`[xaxamax:media] ${msg}`, ...a);

export type CallMediaType = 'AUDIO' | 'VIDEO' | 'SCREEN_SHARE';

export interface UseMediaStreamsReturn {
  localStream: MediaStream | null;
  screenStream: MediaStream | null;
  isScreenSharing: boolean;
  isMuted: boolean;
  isVideoOff: boolean;
  hasLocalStream: boolean;
  getLocalMedia: (type: CallMediaType) => Promise<MediaStream | null>;
  getScreenMedia: () => Promise<MediaStream | null>;
  stopScreenShare: () => void;
  toggleMute: () => void;
  toggleVideo: () => Promise<void>;
  stopAllMedia: () => void;
  localStreamRef: React.RefObject<MediaStream | null>;
  screenStreamRef: React.RefObject<MediaStream | null>;
}

export function useMediaStreams(): UseMediaStreamsReturn {
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [hasLocalStream, setHasLocalStream] = useState(false);

  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);

  // ─── GET CAMERA/MIC ────────────────────────────────────────
  const getLocalMedia = useCallback(async (type: CallMediaType): Promise<MediaStream | null> => {
    try {
      const constraints: MediaStreamConstraints = {
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: type === 'VIDEO' || type === 'SCREEN_SHARE'
          ? {
              width: { ideal: 1280 },
              height: { ideal: 720 },
              frameRate: { ideal: 30 },
              facingMode: 'user',
            }
          : false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      localStreamRef.current = stream;
      setHasLocalStream(true);
      setIsMuted(false);
      setIsVideoOff(false);
      log('Got local media:', stream.getTracks().map(t => `${t.kind}:${t.label}`).join(', '));
      return stream;
    } catch (err) {
      logErr('getUserMedia error:', err);
      return null;
    }
  }, []);

  // ─── GET SCREEN SHARE ──────────────────────────────────────
  // Uses getDisplayMedia. Returns screen stream with video + optional audio.
  // The caller should use replaceTrack() on the video sender, NOT addTrack().
  const getScreenMedia = useCallback(async (): Promise<MediaStream | null> => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30 },
        },
        audio: true, // System audio (Chrome supports this)
      });

      screenStreamRef.current = stream;
      setIsScreenSharing(true);

      // Listen for user stopping screen share via browser UI
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.onended = () => {
          log('Screen share stopped by user (browser UI)');
          stopScreenShareInternal();
        };
      }

      log('Got screen media:', stream.getTracks().map(t => `${t.kind}:${t.label}`).join(', '));
      return stream;
    } catch (err) {
      // User cancelled the screen share dialog — not an error
      if ((err as any)?.name === 'NotAllowedError') {
        log('Screen share cancelled by user');
      } else {
        logErr('getDisplayMedia error:', err);
      }
      return null;
    }
  }, []);

  // ─── STOP SCREEN SHARE ─────────────────────────────────────
  const stopScreenShareInternal = useCallback(() => {
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(t => t.stop());
      screenStreamRef.current = null;
    }
    setIsScreenSharing(false);
  }, []);

  const stopScreenShare = useCallback(() => {
    stopScreenShareInternal();
  }, [stopScreenShareInternal]);

  // ─── TOGGLE MUTE ───────────────────────────────────────────
  const toggleMute = useCallback(() => {
    if (!localStreamRef.current) return;
    const newMuted = !isMuted;
    localStreamRef.current.getAudioTracks().forEach(t => {
      t.enabled = !newMuted;
    });
    setIsMuted(newMuted);
    log('Mute:', newMuted);
  }, [isMuted]);

  // ─── TOGGLE VIDEO ──────────────────────────────────────────
  const toggleVideo = useCallback(async () => {
    if (!localStreamRef.current) return;

    const videoTracks = localStreamRef.current.getVideoTracks();
    if (videoTracks.length > 0) {
      // Toggle existing video tracks
      const newOff = !isVideoOff;
      videoTracks.forEach(t => { t.enabled = !newOff; });
      setIsVideoOff(newOff);
      log('Video off:', newOff);
    } else {
      // No video track yet — add one (audio-only call upgrading to video)
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        const track = stream.getVideoTracks()[0];
        localStreamRef.current.addTrack(track);
        setIsVideoOff(false);
        log('Added video track to audio call');
        // Note: caller needs to also addTrack to PeerConnections via useWebRTC
        return; // track available via localStreamRef
      } catch (err) {
        logErr('toggleVideo add track error:', err);
      }
    }
  }, [isVideoOff]);

  // ─── STOP ALL MEDIA ────────────────────────────────────────
  const stopAllMedia = useCallback(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
    }
    stopScreenShareInternal();
    setHasLocalStream(false);
    setIsMuted(false);
    setIsVideoOff(false);
  }, [stopScreenShareInternal]);

  return {
    localStream: localStreamRef.current,
    screenStream: screenStreamRef.current,
    isScreenSharing,
    isMuted,
    isVideoOff,
    hasLocalStream,
    getLocalMedia,
    getScreenMedia,
    stopScreenShare,
    toggleMute,
    toggleVideo,
    stopAllMedia,
    localStreamRef,
    screenStreamRef,
  };
}
