import { useEffect, useRef, useState } from 'react';
import { X, Trash2, ChevronLeft, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStoryStore, type StoryGroup } from '../../store/storyStore';
import { useAuthStore } from '../../store/authStore';

interface StoryViewerProps {
  groups: StoryGroup[];
  initialGroupIndex: number;
  onClose: () => void;
}

export default function StoryViewer({ groups, initialGroupIndex, onClose }: StoryViewerProps) {
  const { markViewed, deleteStory } = useStoryStore();
  const { user } = useAuthStore();
  const [groupIdx, setGroupIdx] = useState(initialGroupIndex);
  const [storyIdx, setStoryIdx] = useState(0);
  const [progress, setProgress] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const TICK = 50;

  const group = groups[groupIdx];
  const story = group?.stories[storyIdx];

  useEffect(() => {
    if (!story) return;
    markViewed(story.id);
    setProgress(0);

    const duration = story.duration * 1000;
    timerRef.current = setInterval(() => {
      setProgress(prev => {
        const next = prev + (TICK / duration) * 100;
        if (next >= 100) {
          clearInterval(timerRef.current!);
          handleNext();
          return 100;
        }
        return next;
      });
    }, TICK);

    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [story?.id, groupIdx, storyIdx]);

  const handleNext = () => {
    if (storyIdx < (group?.stories.length ?? 1) - 1) {
      setStoryIdx(i => i + 1);
    } else if (groupIdx < groups.length - 1) {
      setGroupIdx(i => i + 1);
      setStoryIdx(0);
    } else {
      onClose();
    }
  };

  const handlePrev = () => {
    if (storyIdx > 0) {
      setStoryIdx(i => i - 1);
    } else if (groupIdx > 0) {
      setGroupIdx(i => i - 1);
      setStoryIdx(0);
    }
  };

  if (!group || !story) return null;

  const isOwn = story.authorId === user?.id;

  return (
    <AnimatePresence>
      <motion.div
        key="story-viewer"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black flex items-center justify-center"
        onClick={onClose}
      >
        {/* Story container */}
        <div
          className="relative w-full max-w-sm h-full max-h-[100dvh] flex flex-col"
          onClick={e => e.stopPropagation()}
        >
          {/* Progress bars */}
          <div className="absolute top-0 left-0 right-0 z-10 flex gap-1 px-3 pt-3">
            {group.stories.map((s, i) => (
              <div key={s.id} className="flex-1 h-0.5 bg-white/30 rounded-full overflow-hidden">
                <div
                  className="h-full bg-white transition-none rounded-full"
                  style={{
                    width: i < storyIdx ? '100%' : i === storyIdx ? `${progress}%` : '0%',
                  }}
                />
              </div>
            ))}
          </div>

          {/* Header */}
          <div className="absolute top-6 left-0 right-0 z-10 flex items-center gap-3 px-3 pt-2">
            <div className="w-9 h-9 rounded-full overflow-hidden ring-2 ring-white/60 shrink-0">
              {group.author.avatar
                ? <img src={group.author.avatar} className="w-full h-full object-cover" alt="" />
                : <div className="w-full h-full bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center text-xs font-bold text-white">
                    {group.author.displayName.slice(0, 2).toUpperCase()}
                  </div>
              }
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white text-sm font-semibold truncate">{group.author.displayName}</p>
              <p className="text-white/60 text-xs">{new Date(story.createdAt).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })}</p>
            </div>
            {isOwn && (
              <button
                onClick={() => { deleteStory(story.id, group.author.id); handleNext(); }}
                className="p-2 text-white/70 hover:text-red-400 transition-colors"
              >
                <Trash2 className="w-5 h-5" />
              </button>
            )}
            <button onClick={onClose} className="p-2 text-white/70 hover:text-white">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Media */}
          <div className="flex-1 bg-dark-900">
            {story.mimeType.startsWith('video/') ? (
              <video
                key={story.id}
                src={story.mediaUrl}
                autoPlay
                muted
                playsInline
                className="w-full h-full object-contain"
              />
            ) : (
              <img
                key={story.id}
                src={story.mediaUrl}
                className="w-full h-full object-contain"
                alt=""
              />
            )}
          </div>

          {/* Caption */}
          {story.text && (
            <div className="absolute bottom-8 left-0 right-0 px-4">
              <p className="text-white text-sm text-center bg-black/40 rounded-xl px-3 py-2 backdrop-blur-sm">
                {story.text}
              </p>
            </div>
          )}

          {/* Tap zones */}
          <button
            onClick={handlePrev}
            className="absolute left-0 top-16 bottom-0 w-1/3 z-20 flex items-center justify-start pl-2 opacity-0 hover:opacity-100 transition-opacity"
          >
            <ChevronLeft className="w-8 h-8 text-white drop-shadow-lg" />
          </button>
          <button
            onClick={handleNext}
            className="absolute right-0 top-16 bottom-0 w-1/3 z-20 flex items-center justify-end pr-2 opacity-0 hover:opacity-100 transition-opacity"
          >
            <ChevronRight className="w-8 h-8 text-white drop-shadow-lg" />
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
