import { useState, useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import Sidebar from './Sidebar';
import ChatView from '../chat/ChatView';
import FeedPage from '../feed/FeedPage';
import ProfilePage from '../profile/ProfilePage';
import { useChatStore } from '../../store/chatStore';
import { motion } from 'framer-motion';

export default function MainLayout() {
  const [showSidebar, setShowSidebar] = useState(true);
  const { activeChat } = useChatStore();
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (isMobile && activeChat) setShowSidebar(false);
  }, [activeChat, isMobile]);

  return (
    <div className="h-full flex bg-dark-950 overflow-hidden safe-top safe-bottom">
      {/* Sidebar */}
      {(!isMobile || showSidebar) && (
        <motion.div
          initial={isMobile ? { x: -320 } : false}
          animate={{ x: 0 }}
          exit={{ x: -320 }}
          className={`${isMobile ? 'absolute inset-0 z-30' : 'relative'} w-full md:w-80 lg:w-96 flex-shrink-0`}
        >
          <Sidebar onChatSelect={() => isMobile && setShowSidebar(false)} />
        </motion.div>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        <Routes>
          <Route path="/feed" element={<FeedPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/profile/:userId" element={<ProfilePage />} />
          <Route
            path="*"
            element={
              activeChat ? (
                <ChatView onBack={() => { setShowSidebar(true); useChatStore.getState().setActiveChat(null); }} />
              ) : (
                <div className="h-full flex items-center justify-center">
                  <div className="text-center">
                    <div className="w-24 h-24 bg-dark-800/50 rounded-full flex items-center justify-center mx-auto mb-4">
                      <svg className="w-12 h-12 text-dark-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                      </svg>
                    </div>
                    <h3 className="text-dark-400 text-lg font-medium">Выберите чат</h3>
                    <p className="text-dark-600 text-sm mt-1">или начните новый разговор</p>
                  </div>
                </div>
              )
            }
          />
        </Routes>
      </div>
    </div>
  );
}
