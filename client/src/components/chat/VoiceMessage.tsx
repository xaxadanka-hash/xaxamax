import { useState, useRef, useEffect, useCallback } from 'react';
import { Mic, Square, Play, Pause, Trash2, Send } from 'lucide-react';
import api from '../../services/api';
import { createAudioRecorder, getAudioFileExtension } from '../../utils/audioRecording';

// ─── RECORDER ─────────────────────────────────────────────────
interface VoiceRecorderProps {
  chatId: string;
  onSend: (mediaId: string, duration: number) => void;
  onCancel: () => void;
}

export function VoiceRecorder({ chatId, onSend, onCancel }: VoiceRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [uploading, setUploading] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mimeTypeRef = useRef('audio/webm');

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const { recorder, mimeType } = createAudioRecorder(stream);
      mediaRecorderRef.current = recorder;
      mimeTypeRef.current = mimeType;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.start(100);
      setIsRecording(true);
      setDuration(0);
      timerRef.current = setInterval(() => setDuration(d => d + 1), 1000);
    } catch (err) {
      console.error('Microphone access error:', err);
    }
  }, []);

  const stopAndSend = useCallback(async () => {
    if (!mediaRecorderRef.current || !isRecording) return;

    return new Promise<void>((resolve) => {
      const recorder = mediaRecorderRef.current!;
      recorder.onstop = async () => {
        const mimeType = mimeTypeRef.current || recorder.mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type: mimeType });
        streamRef.current?.getTracks().forEach(t => t.stop());
        if (timerRef.current) clearInterval(timerRef.current);

        setUploading(true);
        try {
          const form = new FormData();
          form.append('file', blob, `voice_${Date.now()}.${getAudioFileExtension(mimeType)}`);
          form.append('duration', duration.toString());
          const { data: media } = await api.post('/media/upload', form, {
            headers: { 'Content-Type': 'multipart/form-data' },
          });
          onSend(media.id, duration);
        } catch (err) {
          console.error('Voice upload error:', err);
        } finally {
          setUploading(false);
        }
        resolve();
      };
      recorder.stop();
      setIsRecording(false);
    });
  }, [isRecording, duration, onSend]);

  const cancel = useCallback(() => {
    if (mediaRecorderRef.current?.state !== 'inactive') {
      mediaRecorderRef.current?.stop();
    }
    streamRef.current?.getTracks().forEach(t => t.stop());
    if (timerRef.current) clearInterval(timerRef.current);
    setIsRecording(false);
    onCancel();
  }, [onCancel]);

  useEffect(() => {
    startRecording();
    return () => {
      streamRef.current?.getTracks().forEach(t => t.stop());
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const fmt = (s: number) => `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;

  return (
    <div className="flex items-center gap-3 px-3 py-2 bg-dark-800/60 rounded-xl border border-red-500/30">
      {/* Pulsing dot */}
      <div className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse shrink-0" />

      {/* Duration */}
      <span className="text-sm font-mono text-white min-w-[40px]">{fmt(duration)}</span>

      {/* Waveform animation */}
      <div className="flex-1 flex items-center gap-0.5 h-6">
        {Array.from({ length: 20 }).map((_, i) => (
          <div
            key={i}
            className="w-1 bg-red-400/60 rounded-full"
            style={{
              height: `${20 + Math.sin((Date.now() / 200) + i) * 10}%`,
              animationDelay: `${i * 50}ms`,
            }}
          />
        ))}
      </div>

      {/* Cancel */}
      <button onClick={cancel} className="p-1.5 text-dark-400 hover:text-red-400 transition-colors">
        <Trash2 className="w-4 h-4" />
      </button>

      {/* Send */}
      <button
        onClick={stopAndSend}
        disabled={uploading}
        className="p-2 bg-primary-500 rounded-full text-white hover:bg-primary-600 transition-colors disabled:opacity-50"
      >
        {uploading
          ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          : <Send className="w-4 h-4" />
        }
      </button>
    </div>
  );
}

// ─── PLAYER ───────────────────────────────────────────────────
interface VoicePlayerProps {
  src: string;
  duration?: number;
  isMine: boolean;
}

export function VoicePlayer({ src, duration, isMine }: VoicePlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [totalDuration, setTotalDuration] = useState(duration || 0);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
      setProgress(audio.duration ? (audio.currentTime / audio.duration) * 100 : 0);
    };
    const onLoadedMetadata = () => setTotalDuration(audio.duration || duration || 0);
    const onEnded = () => { setIsPlaying(false); setProgress(0); setCurrentTime(0); };

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('ended', onEnded);
    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('ended', onEnded);
    };
  }, [duration]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) { audio.pause(); setIsPlaying(false); }
    else { audio.play(); setIsPlaying(true); }
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    audio.currentTime = ratio * audio.duration;
  };

  const fmt = (s: number) => `${Math.floor(s / 60).toString().padStart(2, '0')}:${Math.floor(s % 60).toString().padStart(2, '0')}`;

  return (
    <div className="flex items-center gap-2.5 min-w-[180px] max-w-[260px]">
      <audio ref={audioRef} src={src} preload="metadata" />

      {/* Play button */}
      <button
        onClick={togglePlay}
        className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition-colors
          ${isMine ? 'bg-white/20 hover:bg-white/30' : 'bg-dark-600 hover:bg-dark-500'}`}
      >
        {isPlaying
          ? <Pause className="w-4 h-4 text-white" />
          : <Play className="w-4 h-4 text-white ml-0.5" />
        }
      </button>

      <div className="flex-1 flex flex-col gap-1">
        {/* Progress bar */}
        <div
          className="h-1.5 rounded-full bg-white/20 cursor-pointer relative"
          onClick={handleSeek}
        >
          <div
            className={`h-full rounded-full transition-all ${isMine ? 'bg-white/80' : 'bg-primary-500'}`}
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Time */}
        <div className="flex justify-between">
          <span className="text-[10px] opacity-60">{fmt(isPlaying ? currentTime : 0)}</span>
          <span className="text-[10px] opacity-60">{fmt(totalDuration)}</span>
        </div>
      </div>

      {/* Mic icon */}
      <Mic className="w-3.5 h-3.5 opacity-40 shrink-0" />
    </div>
  );
}
