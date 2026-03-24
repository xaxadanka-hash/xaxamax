import { useState, useRef, useEffect } from 'react';
import { Phone, PhoneOff } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { useCallManager } from './hooks/useCallManager';
import CallControls from './CallControls';
import VideoLayout from './VideoLayout';
import GroupCallGrid from './GroupCallGrid';
import WatchTogether from './WatchTogether';
import MovieSearch from './MovieSearch';

const formatDuration = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
};

const getInitials = (name: string) =>
  name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();

export default function CallModal() {
  const { user } = useAuthStore();
  const [isFullscreen, setIsFullscreen] = useState(false);

  const {
    call,
    callDuration,
    media,
    watchTogether,
    acceptIncomingCall,
    hangUp,
    rejectCall,
    startScreenShare,
    stopScreenShare,
    toggleVideo,
    selectMovie,
    stopMovie,
    toggleMovieSearch,
  } = useCallManager();

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);

  // Get first remote stream for 1-on-1 calls
  const firstRemoteStream = call.remoteUserId
    ? call.remoteStreams.get(call.remoteUserId) || null
    : call.remoteStreams.values().next().value || null;
  const localHasVideo = !!media.localStreamRef.current?.getVideoTracks().length;
  const remoteHasVideoTrack = !!firstRemoteStream?.getVideoTracks().length;
  const screenHasVideo = !!media.screenStreamRef.current?.getVideoTracks().length;
  const showVideo = call.type !== 'AUDIO' || localHasVideo || remoteHasVideoTrack || screenHasVideo;

  // ─── RENDER ─────────────────────────────────────────────────
  if (call.mode === 'IDLE') return null;

  const isConnected = call.mode === 'CONNECTED';
  const isIncoming = call.isIncoming && call.mode === 'RINGING';
  const isWatching = !!watchTogether.movie;

  return (
    <div className={`fixed inset-0 z-50 bg-dark-950/95 backdrop-blur-sm flex flex-col ${isFullscreen ? '' : 'p-4'}`}>

      {/* Movie search overlay */}
      {watchTogether.showSearch && (
        <MovieSearch onSelect={selectMovie} onClose={toggleMovieSearch} />
      )}

      {/* ── MAIN CONTENT ── */}
      <div className="relative flex-1 w-full flex items-center justify-center overflow-hidden">

        {/* WATCH TOGETHER MODE */}
        {isWatching && isConnected ? (
          <WatchTogether
            movie={watchTogether.movie!}
            onStop={stopMovie}
            localVideoRef={localVideoRef}
            remoteVideoRef={remoteVideoRef}
            localStream={media.localStreamRef.current}
            remoteStream={firstRemoteStream}
            isGroup={call.isGroup}
          />

        /* GROUP CALL GRID */
        ) : call.isGroup && isConnected ? (
          <GroupCallGrid
            participants={Array.from(call.participants.entries()).map(([userId, u]) => ({
              userId,
              user: u,
              stream: call.remoteStreams.get(userId) || null,
              isConnected: call.connectedPeers.has(userId),
            }))}
            localStream={media.localStreamRef.current}
            localUser={user ? { id: user.id, displayName: user.displayName, avatar: user.avatar || null } : null}
          />

        /* NORMAL 1-ON-1 VIDEO CALL */
        ) : showVideo && isConnected ? (
          <VideoLayout
            mode={media.isScreenSharing ? 'screen-share' : 'normal'}
            localStream={media.localStreamRef.current}
            remoteStream={firstRemoteStream}
            screenStream={media.screenStreamRef.current}
            isScreenSharing={media.isScreenSharing}
            isVideoOff={media.isVideoOff}
            remoteUser={call.remoteUser}
          />

        /* CONNECTING / AUDIO CALL / INCOMING */
        ) : (
          <div className="flex flex-col items-center gap-4">
            <div className="w-32 h-32 rounded-full bg-primary-600/30 flex items-center justify-center text-4xl font-bold text-primary-300 overflow-hidden">
              {call.remoteUser?.avatar
                ? <img src={call.remoteUser.avatar} className="w-full h-full rounded-full object-cover" alt="" />
                : getInitials(call.remoteUser?.displayName || '?')}
            </div>
            <h3 className="text-xl font-semibold text-white">
              {call.isGroup ? 'Групповой звонок' : call.remoteUser?.displayName}
            </h3>
            <p className="text-dark-400 text-sm animate-pulse">
              {isIncoming
                ? 'Входящий звонок...'
                : isConnected
                  ? formatDuration(callDuration)
                  : 'Соединение...'}
            </p>
            {call.isGroup && call.participants.size > 0 && (
              <p className="text-dark-500 text-xs">
                {Array.from(call.participants.values()).map(p => p.displayName).join(', ')}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Duration bar */}
      {isConnected && !isIncoming && (
        <div className="text-center py-2">
          <p className="text-white font-medium text-sm">
            {call.isGroup
              ? `Групповой звонок · ${call.connectedPeers.size + 1} участников`
              : call.remoteUser?.displayName}
          </p>
          <p className="text-dark-400 text-xs font-mono">{formatDuration(callDuration)}</p>
        </div>
      )}

      {/* Incoming call buttons */}
      {isIncoming && (
        <div className="flex items-center justify-center gap-8 py-8">
          <div className="flex flex-col items-center gap-2">
            <button
              onClick={rejectCall}
              className="w-16 h-16 rounded-full bg-red-500 flex items-center justify-center hover:bg-red-600 transition-colors shadow-lg shadow-red-500/30"
            >
              <PhoneOff className="w-7 h-7 text-white" />
            </button>
            <span className="text-xs text-dark-400">Отклонить</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <button
              onClick={acceptIncomingCall}
              className="w-16 h-16 rounded-full bg-green-500 flex items-center justify-center hover:bg-green-600 transition-colors animate-pulse shadow-lg shadow-green-500/30"
            >
              <Phone className="w-7 h-7 text-white" />
            </button>
            <span className="text-xs text-dark-400">Принять</span>
          </div>
        </div>
      )}

      {/* Active call controls */}
      {!isIncoming && (
        <CallControls
          isMuted={media.isMuted}
          isVideoOff={media.isVideoOff}
          isScreenSharing={media.isScreenSharing}
          isFullscreen={isFullscreen}
          showMovieButton={isConnected}
          onToggleMute={media.toggleMute}
          onToggleVideo={toggleVideo}
          onToggleScreenShare={media.isScreenSharing ? stopScreenShare : startScreenShare}
          onToggleFullscreen={() => setIsFullscreen(f => !f)}
          onToggleMovieSearch={toggleMovieSearch}
          onHangUp={hangUp}
        />
      )}
    </div>
  );
}
