import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import { useChatStore } from './store/chatStore';
import { useChannelStore } from './store/channelStore';
import { useNotificationStore } from './store/notificationStore';
import { getSocket } from './services/socket';
import { SOCKET_EVENTS } from '@xaxamax/shared/socket-events';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import MainLayout from './components/layout/MainLayout';
import CallModal from './components/call/CallModal';
import { AnimatePresence } from 'framer-motion';
import { normalizeMediaUrls } from './utils/mediaUrl';

function App() {
  const { isAuthenticated, isLoading, checkAuth, user } = useAuthStore();
  const {
    addMessage,
    setTyping,
    applyEditedMessage,
    applyDeletedMessage,
    applyPinnedMessage,
    applyReaction,
    updateMessageStatus,
  } = useChatStore();
  const { addPost } = useChannelStore();
  const { addNotification } = useNotificationStore();

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const socket = getSocket();
    if (!socket) return;

    const shouldShowSystemNotification = () =>
      document.visibilityState !== 'visible' || !document.hasFocus();

    const showBrowserNotification = (title: string, body?: string | null) => {
      if (!('Notification' in window) || Notification.permission !== 'granted') return;

      const notification = new Notification(title, {
        body: body || '',
        tag: 'xaxamax-realtime',
      });

      notification.onclick = () => {
        window.focus();
        window.electronAPI?.focusWindow?.();
        notification.close();
      };
    };

    socket.on(SOCKET_EVENTS.message.new, (message) => addMessage(normalizeMediaUrls(message)));
    socket.on(SOCKET_EVENTS.message.status, ({ messageId, status }) => {
      updateMessageStatus(messageId, status);
    });
    socket.on(SOCKET_EVENTS.message.read, ({ messageIds }) => {
      messageIds.forEach((messageId: string) => {
        updateMessageStatus(messageId, 'READ');
      });
    });
    socket.on(SOCKET_EVENTS.message.typing, ({ chatId, userId: uid }) => setTyping(chatId, uid, true));
    socket.on(SOCKET_EVENTS.message.stopTyping, ({ chatId, userId: uid }) => setTyping(chatId, uid, false));
    socket.on(SOCKET_EVENTS.message.edited, (message) => applyEditedMessage(normalizeMediaUrls(message)));
    socket.on(SOCKET_EVENTS.message.deleted, ({ messageId, chatId, forAll }) => {
      applyDeletedMessage(messageId, chatId, forAll, user?.id || '');
    });
    socket.on(SOCKET_EVENTS.message.pinned, ({ messageId, chatId, pinned }) => {
      applyPinnedMessage(messageId, chatId, pinned);
    });
    socket.on(SOCKET_EVENTS.channel.newPost, ({ post }) => addPost(post));
    socket.on(SOCKET_EVENTS.message.reaction, ({ messageId, userId: uid, emoji, reacted }) => {
      applyReaction(messageId, uid, emoji, reacted);
    });
    socket.on(SOCKET_EVENTS.notification.new, (n) => {
      addNotification(n);
      if (!shouldShowSystemNotification()) {
        return;
      }

      if (window.electronAPI?.showNotification) {
        window.electronAPI.showNotification({
          title: n.title,
          body: n.body,
        });
        return;
      }

      showBrowserNotification(n.title, n.body);
    });

    return () => {
      socket.off(SOCKET_EVENTS.message.new);
      socket.off(SOCKET_EVENTS.message.status);
      socket.off(SOCKET_EVENTS.message.read);
      socket.off(SOCKET_EVENTS.message.typing);
      socket.off(SOCKET_EVENTS.message.stopTyping);
      socket.off(SOCKET_EVENTS.message.edited);
      socket.off(SOCKET_EVENTS.message.deleted);
      socket.off(SOCKET_EVENTS.message.pinned);
      socket.off(SOCKET_EVENTS.channel.newPost);
      socket.off(SOCKET_EVENTS.message.reaction);
      socket.off(SOCKET_EVENTS.notification.new);
    };
  }, [
    isAuthenticated,
    addMessage,
    setTyping,
    applyEditedMessage,
    applyDeletedMessage,
    applyPinnedMessage,
    applyReaction,
    updateMessageStatus,
    addNotification,
    addPost,
    user?.id,
  ]);

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center bg-dark-950">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-primary-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-dark-400 text-sm">Загрузка...</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <AnimatePresence mode="wait">
        <Routes>
          <Route path="/login" element={!isAuthenticated ? <LoginPage /> : <Navigate to="/" />} />
          <Route path="/register" element={!isAuthenticated ? <RegisterPage /> : <Navigate to="/" />} />
          <Route path="/*" element={isAuthenticated ? <MainLayout /> : <Navigate to="/login" />} />
        </Routes>
      </AnimatePresence>
      {isAuthenticated && <CallModal />}
    </>
  );
}

export default App;
