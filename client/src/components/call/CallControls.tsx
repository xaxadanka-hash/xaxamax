import {
  Mic, MicOff, Video, VideoOff, Monitor, MonitorOff,
  PhoneOff, Maximize, Minimize, Film,
} from 'lucide-react';

interface CallControlsProps {
  isMuted: boolean;
  isVideoOff: boolean;
  isScreenSharing: boolean;
  isFullscreen: boolean;
  showMovieButton: boolean;
  onToggleMute: () => void;
  onToggleVideo: () => void;
  onToggleScreenShare: () => void;
  onToggleFullscreen: () => void;
  onToggleMovieSearch: () => void;
  onHangUp: () => void;
}

export default function CallControls({
  isMuted,
  isVideoOff,
  isScreenSharing,
  isFullscreen,
  showMovieButton,
  onToggleMute,
  onToggleVideo,
  onToggleScreenShare,
  onToggleFullscreen,
  onToggleMovieSearch,
  onHangUp,
}: CallControlsProps) {
  return (
    <div className="flex items-center justify-center gap-3 py-4 px-6">
      {/* Mic */}
      <button
        onClick={onToggleMute}
        className={`p-3.5 rounded-full transition-all duration-200 ${
          isMuted
            ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
            : 'bg-dark-700/60 text-white hover:bg-dark-600/60'
        }`}
        title={isMuted ? 'Включить микрофон' : 'Выключить микрофон'}
      >
        {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
      </button>

      {/* Video */}
      <button
        onClick={onToggleVideo}
        className={`p-3.5 rounded-full transition-all duration-200 ${
          isVideoOff
            ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
            : 'bg-dark-700/60 text-white hover:bg-dark-600/60'
        }`}
        title={isVideoOff ? 'Включить камеру' : 'Выключить камеру'}
      >
        {isVideoOff ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
      </button>

      {/* Screen Share */}
      <button
        onClick={onToggleScreenShare}
        className={`p-3.5 rounded-full transition-all duration-200 ${
          isScreenSharing
            ? 'bg-primary-500/20 text-primary-400 hover:bg-primary-500/30'
            : 'bg-dark-700/60 text-white hover:bg-dark-600/60'
        }`}
        title={isScreenSharing ? 'Остановить трансляцию' : 'Транслировать экран'}
      >
        {isScreenSharing ? <MonitorOff className="w-5 h-5" /> : <Monitor className="w-5 h-5" />}
      </button>

      {/* Watch Together */}
      {showMovieButton && (
        <button
          onClick={onToggleMovieSearch}
          className="p-3.5 rounded-full bg-dark-700/60 text-white hover:bg-dark-600/60 transition-all duration-200"
          title="Смотреть вместе"
        >
          <Film className="w-5 h-5" />
        </button>
      )}

      {/* Fullscreen */}
      <button
        onClick={onToggleFullscreen}
        className="p-3.5 rounded-full bg-dark-700/60 text-white hover:bg-dark-600/60 transition-all duration-200"
        title={isFullscreen ? 'Выход из полноэкранного' : 'Полноэкранный'}
      >
        {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
      </button>

      {/* Hang Up */}
      <button
        onClick={onHangUp}
        className="p-3.5 rounded-full bg-red-500 text-white hover:bg-red-600 transition-all duration-200 shadow-lg shadow-red-500/25"
        title="Завершить звонок"
      >
        <PhoneOff className="w-5 h-5" />
      </button>
    </div>
  );
}
