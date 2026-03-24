import { useEffect, useRef } from 'react';
import { Reply, Pencil, Trash2, Forward, Pin, PinOff, Copy } from 'lucide-react';
import type { ChatMessage } from '../../store/chatStore';

interface MessageContextMenuProps {
  message: ChatMessage;
  x: number;
  y: number;
  isMine: boolean;
  isPinned: boolean;
  onClose: () => void;
  onReply: () => void;
  onEdit: () => void;
  onDelete: (forAll: boolean) => void;
  onForward: () => void;
  onPin: () => void;
  onCopy: () => void;
}

export default function MessageContextMenu({
  message,
  x,
  y,
  isMine,
  isPinned,
  onClose,
  onReply,
  onEdit,
  onDelete,
  onForward,
  onPin,
  onCopy,
}: MessageContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  // Adjust position so menu stays within viewport
  const menuWidth = 192;
  const menuHeight = 280;
  const adjustedX = Math.min(x, window.innerWidth - menuWidth - 8);
  const adjustedY = Math.min(y, window.innerHeight - menuHeight - 8);

  const Item = ({
    icon: Icon,
    label,
    onClick,
    danger,
  }: {
    icon: React.ElementType;
    label: string;
    onClick: () => void;
    danger?: boolean;
  }) => (
    <button
      onClick={() => { onClick(); onClose(); }}
      className={`flex items-center gap-3 w-full px-3 py-2.5 text-sm rounded-lg transition-colors text-left
        ${danger
          ? 'text-red-400 hover:bg-red-500/10'
          : 'text-dark-100 hover:bg-dark-700/60'
        }`}
    >
      <Icon className="w-4 h-4 shrink-0" />
      {label}
    </button>
  );

  return (
    <div
      ref={menuRef}
      style={{ position: 'fixed', left: adjustedX, top: adjustedY, zIndex: 9999 }}
      className="w-48 bg-dark-800 border border-dark-700/60 rounded-xl shadow-2xl py-1.5 px-1"
    >
      <Item icon={Reply} label="Ответить" onClick={onReply} />
      {message.text && <Item icon={Copy} label="Копировать" onClick={onCopy} />}
      {isMine && message.text && <Item icon={Pencil} label="Редактировать" onClick={onEdit} />}
      <Item icon={Forward} label="Переслать" onClick={onForward} />
      <Item icon={isPinned ? PinOff : Pin} label={isPinned ? 'Открепить' : 'Закрепить'} onClick={onPin} />
      {isMine && (
        <>
          <div className="border-t border-dark-700/50 my-1" />
          <Item icon={Trash2} label="Удалить у меня" onClick={() => onDelete(false)} danger />
          <Item icon={Trash2} label="Удалить у всех" onClick={() => onDelete(true)} danger />
        </>
      )}
    </div>
  );
}
