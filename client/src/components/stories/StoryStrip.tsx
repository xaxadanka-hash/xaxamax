import { useEffect, useRef, useState } from 'react';
import { Plus, Camera } from 'lucide-react';
import { useStoryStore, type StoryGroup } from '../../store/storyStore';
import { useAuthStore } from '../../store/authStore';
import StoryViewer from './StoryViewer';
import api from '../../services/api';

export default function StoryStrip() {
  const { groups, fetchStories, addGroup } = useStoryStore();
  const { user } = useAuthStore();
  const [viewing, setViewing] = useState<{ groupIndex: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    fetchStories();
  }, [fetchStories]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append('media', file);
      form.append('duration', '5');
      const { data } = await api.post('/stories', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      if (data.story) {
        addGroup({
          author: { id: user!.id, displayName: user!.displayName, avatar: user!.avatar ?? null },
          stories: [{ ...data.story, viewed: true }],
        });
        await fetchStories();
      }
    } catch (err) {
      console.error('Story upload error:', err);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const myGroup = groups.find(g => g.author.id === user?.id);
  const otherGroups = groups.filter(g => g.author.id !== user?.id);
  const ordered: StoryGroup[] = myGroup ? [myGroup, ...otherGroups] : otherGroups;

  const hasUnviewed = (group: StoryGroup) => group.stories.some(s => !s.viewed);

  return (
    <>
      <div className="flex items-center gap-2 px-3 py-2 overflow-x-auto scrollbar-none">
        {/* Add story button */}
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="flex flex-col items-center gap-1 shrink-0"
        >
          <div className="relative w-14 h-14 rounded-full bg-dark-800/60 border-2 border-dashed border-dark-600 hover:border-primary-500 flex items-center justify-center transition-colors">
            {user?.avatar
              ? <img src={user.avatar} className="w-full h-full rounded-full object-cover" alt="" />
              : <div className="w-full h-full rounded-full bg-gradient-to-br from-primary-600 to-primary-800 flex items-center justify-center text-sm font-bold text-white">
                  {user?.displayName?.slice(0, 2).toUpperCase()}
                </div>
            }
            <div className="absolute -bottom-0.5 -right-0.5 w-5 h-5 bg-primary-600 rounded-full flex items-center justify-center border-2 border-dark-950">
              {uploading
                ? <div className="w-2.5 h-2.5 border border-white border-t-transparent rounded-full animate-spin" />
                : <Plus className="w-3 h-3 text-white" />
              }
            </div>
          </div>
          <span className="text-[10px] text-dark-400 truncate w-14 text-center">Мой</span>
        </button>
        <input ref={fileInputRef} type="file" accept="image/*,video/*" className="hidden" onChange={handleUpload} />

        {/* Story rings */}
        {ordered.map((group, idx) => (
          <button
            key={group.author.id}
            onClick={() => setViewing({ groupIndex: idx })}
            className="flex flex-col items-center gap-1 shrink-0"
          >
            <div className={`w-14 h-14 rounded-full p-0.5 ${
              hasUnviewed(group)
                ? 'bg-gradient-to-br from-primary-500 via-pink-500 to-orange-400'
                : 'bg-dark-700'
            }`}>
              <div className="w-full h-full rounded-full overflow-hidden bg-dark-950 p-0.5">
                {group.author.avatar
                  ? <img src={group.author.avatar} className="w-full h-full rounded-full object-cover" alt="" />
                  : <div className="w-full h-full rounded-full bg-gradient-to-br from-primary-600 to-primary-800 flex items-center justify-center text-sm font-bold text-white">
                      {group.author.displayName.slice(0, 2).toUpperCase()}
                    </div>
                }
              </div>
            </div>
            <span className="text-[10px] text-dark-300 truncate w-14 text-center">
              {group.author.id === user?.id ? 'Мой' : group.author.displayName.split(' ')[0]}
            </span>
          </button>
        ))}

        {groups.length === 0 && (
          <div className="flex items-center gap-2 text-dark-600 text-xs py-1">
            <Camera className="w-4 h-4" />
            <span>Сторис от контактов появятся здесь</span>
          </div>
        )}
      </div>

      {viewing !== null && (
        <StoryViewer
          groups={ordered}
          initialGroupIndex={viewing.groupIndex}
          onClose={() => setViewing(null)}
        />
      )}
    </>
  );
}
