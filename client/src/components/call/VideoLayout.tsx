import { useEffect, useRef } from 'react';

interface VideoLayoutProps {
  mode: 'normal' | 'screen-share';
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  screenStream: MediaStream | null;
  isScreenSharing: boolean;
  isVideoOff: boolean;
  remoteUser: { displayName: string; avatar: string | null } | null;
}

export default function VideoLayout({
  mode,
  localStream,
  remoteStream,
  screenStream,
  isScreenSharing,
  isVideoOff,
  remoteUser,
}: VideoLayoutProps) {
  const mainVideoRef = useRef<HTMLVideoElement>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remotePipRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);

  // Main video: screen share or remote video
  useEffect(() => {
    if (!mainVideoRef.current) return;
    if (mode === 'screen-share' && isScreenSharing && screenStream) {
      mainVideoRef.current.srcObject = screenStream;
    } else if (remoteStream) {
      mainVideoRef.current.srcObject = remoteStream;
    }
  }, [mode, isScreenSharing, screenStream, remoteStream]);

  // Local PiP
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  // Remote camera PiP (when screen sharing)
  useEffect(() => {
    if (remotePipRef.current && remoteStream) {
      remotePipRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  // Hidden audio element for audio-only calls / screen share mode
  useEffect(() => {
    if (remoteAudioRef.current && remoteStream) {
      remoteAudioRef.current.srcObject = remoteStream;
      remoteAudioRef.current.play().catch(() => {});
    }
  }, [remoteStream]);

  const remoteInitials = remoteUser?.displayName
    ?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || '?';

  const hasRemoteVideo = remoteStream?.getVideoTracks().some(t => t.enabled && t.readyState === 'live');

  return (
    <div className="relative w-full h-full bg-dark-900">
      {/* Hidden audio element — always plays remote audio */}
      <audio ref={remoteAudioRef as any} autoPlay playsInline className="hidden" />

      {/* MAIN VIDEO */}
      {mode === 'screen-share' && isScreenSharing ? (
        // Screen share: main = screen, remote camera = PiP top-right
        <>
          <video
            ref={mainVideoRef as any}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-contain bg-black"
          />
          {/* Remote camera PiP */}
          <div className="absolute top-3 right-3 w-36 h-24 rounded-xl overflow-hidden bg-dark-800 shadow-xl border border-dark-700/50 z-10">
            {hasRemoteVideo ? (
              <video
                ref={remotePipRef as any}
                autoPlay
                playsInline
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                {remoteUser?.avatar ? (
                  <img src={remoteUser.avatar} className="w-10 h-10 rounded-full" alt="" />
                ) : (
                  <span className="text-sm font-bold text-dark-400">{remoteInitials}</span>
                )}
              </div>
            )}
          </div>
        </>
      ) : (
        // Normal call: main = remote video
        <>
          {hasRemoteVideo ? (
            <video
              ref={mainVideoRef as any}
              autoPlay
              playsInline
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <div className="flex flex-col items-center gap-3">
                {remoteUser?.avatar ? (
                  <img src={remoteUser.avatar} className="w-24 h-24 rounded-full object-cover" alt="" />
                ) : (
                  <div className="w-24 h-24 rounded-full bg-dark-700 flex items-center justify-center text-3xl font-bold text-white">
                    {remoteInitials}
                  </div>
                )}
                <span className="text-sm text-dark-300">{remoteUser?.displayName || 'Собеседник'}</span>
              </div>
            </div>
          )}
        </>
      )}

      {/* LOCAL PiP (always visible) */}
      <div className="absolute bottom-3 right-3 w-28 h-20 rounded-xl overflow-hidden bg-dark-800 shadow-xl border border-dark-700/50 z-10">
        {!isVideoOff && localStream?.getVideoTracks().length ? (
          <video
            ref={localVideoRef as any}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover mirror"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-xs text-dark-400">Камера выкл</span>
          </div>
        )}
      </div>
    </div>
  );
}
