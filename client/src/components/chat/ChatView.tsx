import { useState, useRef, useEffect, useCallback } from 'react';
import { useChatStore } from '../../store/chatStore';
import { useAuthStore } from '../../store/authStore';
import { getSocket } from '../../services/socket';
import api from '../../services/api';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import {
  ArrowLeft, Send, Paperclip, Smile, Phone as PhoneIcon, Video,
  Monitor, MoreVertical, Mic, X, Check, CheckCheck, Image,
} from 'lucide-react';

interface ChatViewProps {
  onBack: () => void;
}

export default function ChatView({ onBack }: ChatViewProps) {
  const { activeChat, messages, isLoadingMessages, sendMessage } = useChatStore();
  const { user } = useAuthStore();
  const [text, setText] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [showAttach, setShowAttach] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = useCallback(() => {
    if (!text.trim() || !activeChat) return;
    sendMessage({ chatId: activeChat.id, text: text.trim() });
    setText('');
    inputRef.current?.focus();
  }, [text, activeChat, sendMessage]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
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

  const handleCall = (type: 'AUDIO' | 'VIDEO' | 'SCREEN_SHARE') => {
    if (!activeChat) return;
    const otherMember = activeChat.members.find((m) => m.userId !== user?.id);
    if (!otherMember) return;
    const socket = getSocket();
    // Show call UI immediately
    const initiate = (window as any).__xaxamaxInitiateCall;
    if (initiate) {
      initiate(otherMember.userId, type, otherMember.user);
    }
    // Tell server to create the call and notify the other user
    socket?.emit('call:initiate', { targetUserId: otherMember.userId, type });
  };

  const otherUser = activeChat?.members.find((m) => m.userId !== user?.id)?.user;

  const getInitials = (name: string) => name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();

  const formatMsgTime = (date: string) => {
    try { return format(new Date(date), 'HH:mm', { locale: ru }); }
    catch { return ''; }
  };

  const StatusIcon = ({ status }: { status: string }) => {
    if (status === 'READ') return <CheckCheck className="w-3.5 h-3.5 text-primary-400" />;
    if (status === 'DELIVERED') return <CheckCheck className="w-3.5 h-3.5 text-dark-500" />;
    return <Check className="w-3.5 h-3.5 text-dark-500" />;
  };

  if (!activeChat) return null;

  return (
    <div className="h-full flex flex-col bg-dark-950">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-dark-800/50 glass">
        <button onClick={onBack} className="md:hidden btn-ghost p-1.5 rounded-lg">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="relative">
          <div className="w-10 h-10 rounded-full bg-dark-700 flex items-center justify-center text-sm font-medium">
            {activeChat.avatar
              ? <img src={activeChat.avatar} className="w-full h-full rounded-full object-cover" alt="" />
              : getInitials(activeChat.name || '?')}
          </div>
          {otherUser?.isOnline && (
            <div className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-green-500 border-2 border-dark-900" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-white truncate">{activeChat.name || 'Чат'}</h3>
          <p className="text-xs text-dark-400">
            {otherUser?.isOnline ? 'в сети' : 'не в сети'}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => handleCall('AUDIO')} className="btn-ghost p-2 rounded-xl" title="Аудиозвонок">
            <PhoneIcon className="w-5 h-5" />
          </button>
          <button onClick={() => handleCall('VIDEO')} className="btn-ghost p-2 rounded-xl" title="Видеозвонок">
            <Video className="w-5 h-5" />
          </button>
          <button onClick={() => handleCall('SCREEN_SHARE')} className="btn-ghost p-2 rounded-xl" title="Трансляция экрана">
            <Monitor className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {isLoadingMessages && (
          <div className="flex justify-center py-4">
            <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
        {messages.map((msg) => {
          const isMine = msg.senderId === user?.id;
          return (
            <div key={msg.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[75%] md:max-w-[60%] ${isMine ? 'chat-bubble-sent' : 'chat-bubble-received'}`}>
                {msg.replyTo && (
                  <div className="text-xs opacity-70 border-l-2 border-current pl-2 mb-1 truncate">
                    {msg.replyTo.sender.displayName}: {msg.replyTo.text}
                  </div>
                )}
                {msg.media?.map((m) => (
                  <div key={m.id} className="mb-1">
                    {m.mimeType.startsWith('image/') && (
                      <img src={m.url} alt="" className="rounded-lg max-h-60 object-cover" />
                    )}
                    {m.mimeType.startsWith('video/') && (
                      <video src={m.url} controls className="rounded-lg max-h-60" />
                    )}
                    {m.mimeType.startsWith('audio/') && (
                      <audio src={m.url} controls className="max-w-full" />
                    )}
                  </div>
                ))}
                {msg.text && <p className="text-sm whitespace-pre-wrap break-words">{msg.text}</p>}
                <div className={`flex items-center gap-1 mt-1 ${isMine ? 'justify-end' : 'justify-start'}`}>
                  <span className="text-[10px] opacity-60">{formatMsgTime(msg.createdAt)}</span>
                  {isMine && <StatusIcon status={msg.status} />}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="px-4 py-3 border-t border-dark-800/50 glass">
        <div className="flex items-center gap-2">
          <div className="relative">
            <button onClick={() => setShowAttach(!showAttach)} className="btn-ghost p-2 rounded-xl">
              <Paperclip className="w-5 h-5" />
            </button>
            {showAttach && (
              <div className="absolute bottom-full left-0 mb-2 glass rounded-xl p-1 min-w-[150px] shadow-xl">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="sidebar-item w-full text-left text-sm"
                >
                  <Image className="w-4 h-4" /> Фото/Видео
                </button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="sidebar-item w-full text-left text-sm"
                >
                  <Paperclip className="w-4 h-4" /> Файл
                </button>
              </div>
            )}
          </div>
          <input
            ref={inputRef}
            type="text"
            placeholder="Сообщение..."
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
          {text.trim() ? (
            <button onClick={handleSend} className="btn-primary p-2.5 rounded-xl">
              <Send className="w-5 h-5" />
            </button>
          ) : (
            <button
              onClick={() => setIsRecording(!isRecording)}
              className={`p-2.5 rounded-xl transition-colors ${isRecording ? 'bg-red-500 text-white' : 'btn-ghost'}`}
            >
              <Mic className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
