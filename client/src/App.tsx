import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import { useChatStore } from './store/chatStore';
import { getSocket } from './services/socket';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import MainLayout from './components/layout/MainLayout';
import { AnimatePresence } from 'framer-motion';

function App() {
  const { isAuthenticated, isLoading, checkAuth } = useAuthStore();
  const { addMessage, setTyping } = useChatStore();

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const socket = getSocket();
    if (!socket) return;

    socket.on('message:new', (message) => {
      addMessage(message);
    });

    socket.on('message:typing', ({ chatId, userId }) => {
      setTyping(chatId, userId, true);
    });

    socket.on('message:stop-typing', ({ chatId, userId }) => {
      setTyping(chatId, userId, false);
    });

    return () => {
      socket.off('message:new');
      socket.off('message:typing');
      socket.off('message:stop-typing');
    };
  }, [isAuthenticated, addMessage, setTyping]);

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
    <AnimatePresence mode="wait">
      <Routes>
        <Route path="/login" element={!isAuthenticated ? <LoginPage /> : <Navigate to="/" />} />
        <Route path="/register" element={!isAuthenticated ? <RegisterPage /> : <Navigate to="/" />} />
        <Route path="/*" element={isAuthenticated ? <MainLayout /> : <Navigate to="/login" />} />
      </Routes>
    </AnimatePresence>
  );
}

export default App;
