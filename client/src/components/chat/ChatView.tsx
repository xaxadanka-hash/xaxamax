import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useChatStore, type ChatMessage } from '../../store/chatStore';
import { useAuthStore } from '../../store/authStore';
import { getSocket } from '../../services/socket';
import api from '../../services/api';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import {
  ArrowLeft, Send, Paperclip, Phone as PhoneIcon, Video,
  Monitor, Mic, X, Check, CheckCheck, Image, Pin, Reply as ReplyIcon,
  Pencil, Users, Search,
} from 'lucide-react';
import MessageContextMenu from './MessageContextMenu';
import { VoiceRecorder, VoicePlayer } from './VoiceMessage';

interface ChatViewProps {
  onBack: () => void;
}

interface ContextMenuState {
  message: ChatMessage;
  x: number;
  y: number;
}

interface EditState {
  messageId: string;
  text: string;
}

interface ForwardState {
  messageId: string;
}

export default function ChatView({ onBack }: ChatViewProps) {
  const {
    activeChat, messages, isLoadingMessages,
    sendMessage, editMessage, deleteMessage, pinMessage, reactMessage,
  } = useChatStore();
  const { user } = useAuthStore();
  const navigate = useNavigate();

  const [text, setText] = useState('');
  const [showAttach, setShowAttach] = useState(false);
  const [showVoice, setShowVoice] = useState(false);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [forwardState, setForwardState] = useState<ForwardState | null>(null);
  const [reactionPicker, setReactionPicker] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);

  const REACTION_EMOJIS = ['👍', '❤️', '🔥', '😂', '😮', '👎'];

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input when entering edit mode
  useEffect(() => {
    if (editState) {
      setText(editState.text);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [editState]);

  const handleSend = useCallback(() => {
    if (!activeChat) return;

    if (editState) {
      // Submit edit
      if (text.trim()) {
        editMessage(editState.messageId, activeChat.id, text.trim());
      }
      setEditState(null);
      setText('');
      return;
    }

    if (!text.trim()) return;
    sendMessage({
      chatId: activeChat.id,
      text: text.trim(),
      ...(replyTo && { replyToId: replyTo.id }),
    });
    setText('');
    setReplyTo(null);
    inputRef.current?.focus();
  }, [text, activeChat, sendMessage, editMessage, editState, replyTo]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
    if (e.key === 'Escape') { setEditState(null); setReplyTo(null); setText(''); }
  };

  const handleTyping = () => {
    if (!activeChat) return;
    const socket = getSocket();
    socket?.emit('message:typing', { chatId: activeChat.id });
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      socket?.emit('message:stop-typing', { chatId: activeChat.id });
    }, 2000);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length || !activeChat) return;
    const formData = new FormData();
    formData.append('file', files[0]);
    try {
      const { data: media } = await api.post('/media/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const type = media.mimeType.startsWith('image/') ? 'IMAGE'
        : media.mimeType.startsWith('video/') ? 'VIDEO'
        : media.mimeType.startsWith('audio/') ? 'AUDIO' : 'FILE';
      sendMessage({ chatId: activeChat.id, type, mediaIds: [media.id] });
    } catch (err) {
      console.error('Upload error:', err);
    }
    e.target.value = '';
    setShowAttach(false);
  };

  const handleVoiceSend = useCallback((mediaId: string, duration: number) => {
    if (!activeChat) return;
    sendMessage({ chatId: activeChat.id, type: 'VOICE', mediaIds: [mediaId] });
    setShowVoice(false);
  }, [activeChat, sendMessage]);

  const handleCall = (type: 'AUDIO' | 'VIDEO' | 'SCREEN_SHARE') => {
    if (!activeChat) return;
    if (activeChat.type === 'GROUP') {
      const memberIds = activeChat.members.filter(m => m.userId !== user?.id).map(m => m.userId);
      const members = activeChat.members
        .filter(m => m.userId !== user?.id)
        .map(m => ({ id: m.user.id, displayName: m.user.displayName, avatar: m.user.avatar }));
      (window as any).__xaxamaxInitiateGroupCall?.(activeChat.id, memberIds, members);
    } else {
      const other = activeChat.members.find(m => m.userId !== user?.id);
      if (!other) return;
      (window as any).__xaxamaxInitiateCall?.(other.userId, type, other.user);
      getSocket()?.emit('call:initiate', { targetUserId: other.userId, type });
    }
  };

  // Context menu handlers
  const handleContextMenu = (e: React.MouseEvent, msg: ChatMessage) => {
    e.preventDefault();
    setContextMenu({ message: msg, x: e.clientX, y: e.clientY });
  };

  const handleLongPress = useCallback((msg: ChatMessage) => {
    return {
      onContextMenu: (e: React.MouseEvent) => handleContextMenu(e, msg),
    };
  }, []);

  const handleForward = async (targetChatId: string) => {
    if (!forwardState) return;
    try {
      await api.post(`/messages/${forwardState.messageId}/forward`, { targetChatId });
    } catch (err) {
      console.error('Forward error:', err);
    }
    setForwardState(null);
  };

  // Pinned messages banner
  const pinnedMessages = messages.filter(m => m.pinnedAt && !m.deletedForAll);
  const latestPinned = pinnedMessages[pinnedMessages.length - 1];

  const otherUser = activeChat?.members.find(m => m.userId !== user?.id)?.user;
  const isGroup = activeChat?.type === 'GROUP';

  const getInitials = (name: string) => name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  const fmt = (date: string) => { try { return format(new Date(date), 'HH:mm', { locale: ru }); } catch { return ''; } };

  const StatusIcon = ({ status }: { status: string }) => {
    if (status === 'READ') return <CheckCheck className="w-3.5 h-3.5 text-primary-400" />;
    if (status === 'DELIVERED') return <CheckCheck className="w-3.5 h-3.5 text-dark-500" />;
    return <Check className="w-3.5 h-3.5 text-dark-500" />;
  };

  if (!activeChat) return null;

  return (
    <div className="h-full flex flex-col bg-dark-950 relative">
      {/* Context menu */}
      {contextMenu && (
        <MessageContextMenu
          message={contextMenu.message}
          x={contextMenu.x}
          y={contextMenu.y}
          isMine={contextMenu.message.senderId === user?.id}
          isPinned={!!contextMenu.message.pinnedAt}
          onClose={() => setContextMenu(null)}
          onReply={() => setReplyTo(contextMenu.message)}
          onEdit={() => {
            setEditState({ messageId: contextMenu.message.id, text: contextMenu.message.text || '' });
          }}
          onDelete={(forAll) => deleteMessage(contextMenu.message.id, activeChat.id, forAll)}
          onForward={() => setForwardState({ messageId: contextMenu.message.id })}
          onPin={() => pinMessage(contextMenu.message.id, activeChat.id, !contextMenu.message.pinnedAt)}
          onCopy={() => navigator.clipboard.writeText(contextMenu.message.text || '')}
        />
      )}

      {/* Forward chat picker */}
      {forwardState && (
        <ForwardPicker
          onSelect={handleForward}
          onClose={() => setForwardState(null)}
        />
      )}

      {/* ── HEADER ── */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-dark-800/50 glass shrink-0">
        <button onClick={onBack} className="md:hidden btn-ghost p-1.5 rounded-lg">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="relative shrink-0">
          <div className="w-10 h-10 rounded-full bg-dark-700 flex items-center justify-center text-sm font-medium overflow-hidden">
            {activeChat.avatar
              ? <img src={activeChat.avatar} className="w-full h-full object-cover" alt="" />
              : getInitials(activeChat.name || '?')}
          </div>
          {otherUser?.isOnline && !isGroup && (
            <div className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-green-500 border-2 border-dark-900" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-white truncate">{activeChat.name || 'Чат'}</h3>
          <p className="text-xs text-dark-400">
            {isGroup
              ? <span className="flex items-center gap-1"><Users className="w-3 h-3" />{activeChat.members.length} участников</span>
              : otherUser?.isOnline ? 'в сети' : 'не в сети'}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => { setShowSearch(s => !s); setSearchQuery(''); }} className="btn-ghost p-2 rounded-xl" title="Поиск">
            <Search className="w-5 h-5" />
          </button>
          <button onClick={() => handleCall('AUDIO')} className="btn-ghost p-2 rounded-xl" title="Аудиозвонок">
            <PhoneIcon className="w-5 h-5" />
          </button>
          <button onClick={() => handleCall('VIDEO')} className="btn-ghost p-2 rounded-xl" title="Видеозвонок">
            <Video className="w-5 h-5" />
          </button>
          {!isGroup && (
            <button onClick={() => handleCall('SCREEN_SHARE')} className="btn-ghost p-2 rounded-xl" title="Экран">
              <Monitor className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* Search bar */}
      {showSearch && (
        <div className="flex items-center gap-2 px-4 py-2 border-b border-dark-800/30 shrink-0">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-dark-500" />
            <input
              autoFocus
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Поиск в сообщениях..."
              className="w-full bg-dark-800/40 rounded-xl pl-9 pr-4 py-2 text-sm text-white placeholder:text-dark-500 focus:outline-none focus:ring-1 focus:ring-primary-500/30"
            />
          </div>
          {searchQuery && (
            <span className="text-xs text-dark-400">
              {messages.filter(m => m.text?.toLowerCase().includes(searchQuery.toLowerCase())).length} нашлось
            </span>
          )}
          <button onClick={() => { setShowSearch(false); setSearchQuery(''); }} className="p-1.5 text-dark-500 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Pinned message banner */}
      {latestPinned && (
        <div className="flex items-center gap-2 px-4 py-2 bg-dark-900/80 border-b border-dark-800/30 text-xs shrink-0">
          <Pin className="w-3.5 h-3.5 text-primary-400 shrink-0" />
          <span className="text-dark-400 truncate">
            <span className="text-primary-400">Закреплено: </span>
            {latestPinned.text || 'Медиафайл'}
          </span>
          <button
            onClick={() => pinMessage(latestPinned.id, activeChat.id, false)}
            className="ml-auto text-dark-500 hover:text-white"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ── MESSAGES ── */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-1">
        {isLoadingMessages && (
          <div className="flex justify-center py-4">
            <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {(searchQuery
          ? messages.filter(m => m.text?.toLowerCase().includes(searchQuery.toLowerCase()))
          : messages
        ).map((msg) => {
          const isMine = msg.senderId === user?.id;
          const isDeleted = msg.deletedForAll || (msg as any).deletedAt;

          if (isDeleted && msg.deletedForAll) {
            return (
              <div key={msg.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                <div className="px-3 py-1.5 rounded-xl bg-dark-800/40 italic text-dark-500 text-xs max-w-[60%]">
                  Сообщение удалено
                </div>
              </div>
            );
          }

          return (
            <div
              key={msg.id}
              className={`flex ${isMine ? 'justify-end' : 'justify-start'} group`}
              onContextMenu={(e) => handleContextMenu(e, msg)}
            >
              {/* Sender avatar for group chats */}
              {isGroup && !isMine && (
                <button
                  onClick={() => navigate(`/profile/${msg.sender.id}`)}
                  className="w-7 h-7 rounded-full bg-dark-700 flex items-center justify-center text-xs font-medium mr-1.5 mt-auto mb-0.5 shrink-0 overflow-hidden hover:ring-2 hover:ring-primary-500/50 transition-all"
                >
                  {msg.sender.avatar
                    ? <img src={msg.sender.avatar} className="w-full h-full object-cover" alt="" />
                    : getInitials(msg.sender.displayName)}
                </button>
              )}

              <div className={`max-w-[75%] md:max-w-[60%] ${isMine ? 'chat-bubble-sent' : 'chat-bubble-received'}`}>
                {/* Group sender name */}
                {isGroup && !isMine && (
                  <button
                    onClick={() => navigate(`/profile/${msg.sender.id}`)}
                    className="text-xs font-semibold text-primary-400 mb-0.5 hover:underline text-left"
                  >
                    {msg.sender.displayName}
                  </button>
                )}

                {/* Forwarded from */}
                {msg.forwardedFrom && (
                  <div className="text-xs border-l-2 border-primary-500 pl-2 mb-1 opacity-70">
                    <span className="font-medium">Переслано от {msg.forwardedFrom.sender.displayName}:</span>
                    <p className="truncate">{msg.forwardedFrom.text}</p>
                  </div>
                )}

                {/* Reply to */}
                {msg.replyTo && (
                  <div className="text-xs border-l-2 border-current pl-2 mb-1 opacity-70 truncate">
                    {msg.replyTo.sender.displayName}: {msg.replyTo.text || 'Медиафайл'}
                  </div>
                )}

                {/* Media */}
                {msg.media?.map((m) => (
                  <div key={m.id} className="mb-1">
                    {m.mimeType.startsWith('image/') && (
                      <img src={m.url} alt="" className="rounded-lg max-h-60 object-cover cursor-pointer" />
                    )}
                    {m.mimeType.startsWith('video/') && (
                      <video src={m.url} controls className="rounded-lg max-h-60" />
                    )}
                    {(m.mimeType.startsWith('audio/') && msg.type !== 'VOICE') && (
                      <audio src={m.url} controls className="max-w-full" />
                    )}
                    {msg.type === 'VOICE' && (
                      <VoicePlayer src={m.url} duration={m.duration} isMine={isMine} />
                    )}
                  </div>
                ))}

                {/* Text */}
                {msg.text && !msg.deletedForAll && (
                  <p className="text-sm whitespace-pre-wrap break-words">{msg.text}</p>
                )}

                {/* Reactions display */}
                {msg.reactions && msg.reactions.length > 0 && (() => {
                  const map = new Map<string, number>();
                  msg.reactions.forEach(r => map.set(r.emoji, (map.get(r.emoji) || 0) + 1));
                  return (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {Array.from(map.entries()).map(([emoji, count]) => {
                        const mine = msg.reactions!.some(r => r.userId === user?.id && r.emoji === emoji);
                        return (
                          <button
                            key={emoji}
                            onClick={() => reactMessage(msg.id, activeChat!.id, emoji)}
                            className={`flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded-full transition-colors
                              ${mine ? 'bg-primary-600/30 text-primary-200' : 'bg-white/10 text-white/70 hover:bg-white/20'}`}
                          >
                            {emoji} {count}
                          </button>
                        );
                      })}
                    </div>
                  );
                })()}

                {/* Footer: time + edited + status */}
                <div className={`flex items-center gap-1 mt-0.5 ${isMine ? 'justify-end' : 'justify-start'}`}>
                  {msg.editedAt && (
                    <span className="text-[10px] opacity-50 italic">изм.</span>
                  )}
                  {msg.pinnedAt && (
                    <Pin className="w-2.5 h-2.5 opacity-40" />
                  )}
                  <span className="text-[10px] opacity-60">{fmt(msg.createdAt)}</span>
                  {isMine && <StatusIcon status={msg.status} />}
                </div>
              </div>

              {/* Quick action buttons on hover */}
              <div className="self-center flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                {/* Quick react */}
                <div className="relative">
                  <button
                    onClick={() => setReactionPicker(reactionPicker === msg.id ? null : msg.id)}
                    className="p-1 text-dark-500 hover:text-yellow-400"
                  >
                    <span className="text-sm">😊</span>
                  </button>
                  {reactionPicker === msg.id && (
                    <div className={`absolute bottom-full ${isMine ? 'right-0' : 'left-0'} mb-1 flex gap-1 bg-dark-800 border border-dark-700 rounded-xl px-2 py-1.5 shadow-xl z-20`}>
                      {REACTION_EMOJIS.map(e => (
                        <button key={e} onClick={() => { reactMessage(msg.id, activeChat!.id, e); setReactionPicker(null); }} className="text-lg hover:scale-125 transition-transform">{e}</button>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => setReplyTo(msg)}
                  className="p-1 text-dark-500 hover:text-primary-400"
                >
                  <ReplyIcon className="w-4 h-4" />
                </button>
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* ── INPUT AREA ── */}
      <div className="px-4 py-3 border-t border-dark-800/50 glass shrink-0">
        {/* Reply / Edit banner */}
        {(replyTo || editState) && (
          <div className="flex items-center gap-2 mb-2 px-3 py-1.5 bg-dark-800/50 rounded-xl">
            {editState
              ? <Pencil className="w-4 h-4 text-primary-400 shrink-0" />
              : <ReplyIcon className="w-4 h-4 text-primary-400 shrink-0" />
            }
            <div className="flex-1 min-w-0">
              <p className="text-xs text-primary-400 font-medium">
                {editState ? 'Редактирование' : `Ответ ${replyTo?.sender.displayName}`}
              </p>
              <p className="text-xs text-dark-400 truncate">
                {editState ? editState.text : (replyTo?.text || 'Медиафайл')}
              </p>
            </div>
            <button
              onClick={() => { setReplyTo(null); setEditState(null); setText(''); }}
              className="p-1 text-dark-500 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Voice recorder */}
        {showVoice ? (
          <VoiceRecorder
            chatId={activeChat.id}
            onSend={handleVoiceSend}
            onCancel={() => setShowVoice(false)}
          />
        ) : (
          <div className="flex items-center gap-2">
            {/* Attach */}
            <div className="relative">
              <button onClick={() => setShowAttach(!showAttach)} className="btn-ghost p-2 rounded-xl">
                <Paperclip className="w-5 h-5" />
              </button>
              {showAttach && (
                <div className="absolute bottom-full left-0 mb-2 glass rounded-xl p-1 min-w-[150px] shadow-xl">
                  <button
                    onClick={() => { fileInputRef.current?.click(); setShowAttach(false); }}
                    className="sidebar-item w-full text-left text-sm"
                  >
                    <Image className="w-4 h-4" /> Фото/Видео
                  </button>
                  <button
                    onClick={() => { fileInputRef.current?.click(); setShowAttach(false); }}
                    className="sidebar-item w-full text-left text-sm"
                  >
                    <Paperclip className="w-4 h-4" /> Файл
                  </button>
                </div>
              )}
            </div>

            {/* Text input */}
            <input
              ref={inputRef}
              type="text"
              placeholder={editState ? 'Редактировать...' : 'Сообщение...'}
              value={text}
              onChange={(e) => { setText(e.target.value); handleTyping(); }}
              onKeyDown={handleKeyDown}
              className="flex-1 bg-dark-800/40 border-none rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-dark-500 focus:outline-none focus:ring-1 focus:ring-primary-500/30"
            />

            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={handleFileUpload}
              accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.zip"
            />

            {/* Send or Mic */}
            {text.trim() || editState ? (
              <button onClick={handleSend} className="btn-primary p-2.5 rounded-xl">
                <Send className="w-5 h-5" />
              </button>
            ) : (
              <button
                onClick={() => setShowVoice(true)}
                className="btn-ghost p-2.5 rounded-xl"
                title="Голосовое сообщение"
              >
                <Mic className="w-5 h-5" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── FORWARD CHAT PICKER ──────────────────────────────────────
function ForwardPicker({
  onSelect,
  onClose,
}: {
  onSelect: (chatId: string) => void;
  onClose: () => void;
}) {
  const { chats } = useChatStore();
  return (
    <div className="absolute inset-0 z-50 bg-dark-950/95 backdrop-blur-sm flex flex-col">
      <div className="flex items-center gap-3 p-4 border-b border-dark-800">
        <button onClick={onClose} className="btn-ghost p-2 rounded-xl">
          <X className="w-5 h-5" />
        </button>
        <h3 className="text-base font-semibold text-white">Переслать в...</h3>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-1">
        {chats.map(chat => (
          <button
            key={chat.id}
            onClick={() => onSelect(chat.id)}
            className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl hover:bg-dark-800/60 transition-colors text-left"
          >
            <div className="w-10 h-10 rounded-full bg-dark-700 flex items-center justify-center text-sm font-medium shrink-0">
              {chat.avatar
                ? <img src={chat.avatar} className="w-full h-full rounded-full object-cover" alt="" />
                : (chat.name || '?').charAt(0).toUpperCase()}
            </div>
            <span className="text-sm text-white truncate">{chat.name || 'Чат'}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
