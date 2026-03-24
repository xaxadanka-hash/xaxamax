import { useEffect, useRef } from 'react';
import { MicOff } from 'lucide-react';
import type { RemoteUser } from './hooks/useCallManager';

interface Participant {
  userId: string;
  user: RemoteUser;
  stream: MediaStream | null;
  isConnected: boolean;
}

interface GroupCallGridProps {
  participants: Participant[];
  localStream: MediaStream | null;
  localUser: { id: string; displayName: string; avatar: string | null } | null;
}

function VideoTile({
  stream,
  displayName,
  avatar,
  isMuted,
  isLocal,
  isConnected,
}: {
  stream: MediaStream | null;
  displayName: string;
  avatar: string | null;
  isMuted?: boolean;
  isLocal?: boolean;
  isConnected?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  const hasVideo = stream?.getVideoTracks().some(t => t.enabled && t.readyState === 'live');
  const initials = displayName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();

  return (
    <div className="relative w-full h-full bg-dark-800 rounded-xl overflow-hidden">
      {hasVideo && stream ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={isLocal}
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          {avatar ? (
            <img src={avatar} className="w-16 h-16 rounded-full object-cover" alt="" />
          ) : (
            <div className="w-16 h-16 rounded-full bg-dark-600 flex items-center justify-center text-xl font-bold text-white">
              {initials}
            </div>
          )}
        </div>
      )}

      {/* Name overlay */}
      <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between">
        <span className="text-xs text-white bg-black/50 px-2 py-0.5 rounded-lg truncate">
          {isLocal ? 'Вы' : displayName}
        </span>
        {isMuted && (
          <span className="bg-red-500/80 p-1 rounded-full">
            <MicOff className="w-3 h-3 text-white" />
          </span>
        )}
      </div>

      {/* Connecting overlay */}
      {!isLocal && !isConnected && (
        <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
          <div className="flex flex-col items-center gap-2">
            <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-xs text-dark-300">Подключение...</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default function GroupCallGrid({ participants, localStream, localUser }: GroupCallGridProps) {
  const total = participants.length + 1; // +1 for local user

  // Grid layout based on participant count
  const getGridClass = () => {
    if (total <= 2) return 'grid-cols-1 sm:grid-cols-2';
    if (total <= 4) return 'grid-cols-2';
    return 'grid-cols-2 sm:grid-cols-3';
  };

  return (
    <div className={`grid ${getGridClass()} gap-2 p-2 w-full h-full`}>
      {/* Local user tile */}
      <VideoTile
        stream={localStream}
        displayName={localUser?.displayName || 'Вы'}
        avatar={localUser?.avatar || null}
        isLocal
        isConnected
      />

      {/* Remote participants */}
      {participants.map((p) => (
        <VideoTile
          key={p.userId}
          stream={p.stream}
          displayName={p.user.displayName}
          avatar={p.user.avatar}
          isConnected={p.isConnected}
        />
      ))}
    </div>
  );
}
