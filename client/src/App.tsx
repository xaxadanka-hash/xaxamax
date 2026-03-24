import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import { useChatStore } from './store/chatStore';
import { useChannelStore } from './store/channelStore';
import { getSocket } from './services/socket';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import MainLayout from './components/layout/MainLayout';
import CallModal from './components/call/CallModal';
import { AnimatePresence } from 'framer-motion';

function App() {
  const { isAuthenticated, isLoading, checkAuth, user } = useAuthStore();
  const { addMessage, setTyping, applyEditedMessage, applyDeletedMessage, applyPinnedMessage } = useChatStore();
  const { addPost } = useChannelStore();

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const socket = getSocket();
    if (!socket) return;

    socket.on('message:new', (message) => addMessage(message));
    socket.on('message:typing', ({ chatId, userId: uid }) => setTyping(chatId, uid, true));
    socket.on('message:stop-typing', ({ chatId, userId: uid }) => setTyping(chatId, uid, false));
    socket.on('message:edited', (message) => applyEditedMessage(message));
    socket.on('message:deleted', ({ messageId, chatId, forAll }) => {
      applyDeletedMessage(messageId, chatId, forAll, user?.id || '');
    });
    socket.on('message:pinned', ({ messageId, chatId, pinned }) => {
      applyPinnedMessage(messageId, chatId, pinned);
    });
    socket.on('channel:new_post', ({ post }) => addPost(post));

    return () => {
      socket.off('message:new');
      socket.off('message:typing');
      socket.off('message:stop-typing');
      socket.off('message:edited');
      socket.off('message:deleted');
      socket.off('message:pinned');
      socket.off('channel:new_post');
    };
  }, [isAuthenticated, addMessage, setTyping, applyEditedMessage, applyDeletedMessage, applyPinnedMessage, addPost, user?.id]);

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
