import { useState, useEffect } from 'react';
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { MessageCircle, Newspaper, User, Settings, Hash, Users } from 'lucide-react';
import Sidebar from './Sidebar';
import ChatView from '../chat/ChatView';
import FeedPage from '../feed/FeedPage';
import ProfilePage from '../profile/ProfilePage';
import SettingsPage from '../settings/SettingsPage';
import ChannelsPage from '../channels/ChannelsPage';
import AdminDashboard from '../admin/AdminDashboard';
import ContactsPage from '../contacts/ContactsPage';
import { useChatStore } from '../../store/chatStore';
import { motion, AnimatePresence } from 'framer-motion';

const NAV_ITEMS = [
  { path: '/', label: 'Чаты', icon: MessageCircle },
  { path: '/contacts', label: 'Контакты', icon: Users },
  { path: '/feed', label: 'Лента', icon: Newspaper },
  { path: '/profile', label: 'Профиль', icon: User },
  { path: '/settings', label: 'Настройки', icon: Settings },
];

export default function MainLayout() {
  const [showSidebar, setShowSidebar] = useState(true);
  const { activeChat, totalUnread } = useChatStore();
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (isMobile && activeChat) setShowSidebar(false);
  }, [activeChat, isMobile]);

  // On mobile: show sidebar when navigating to '/'
  useEffect(() => {
    if (isMobile && location.pathname === '/' && !activeChat) {
      setShowSidebar(true);
    }
  }, [location.pathname, isMobile, activeChat]);

  const isChatsRoute = location.pathname === '/';
  const showChat = isChatsRoute && !!activeChat && (!isMobile || !showSidebar);
  const showMainSidebar = isChatsRoute && (!isMobile || showSidebar);

  return (
    <div className="h-full flex flex-col bg-dark-950 overflow-hidden">
      {/* ── TOP AREA (desktop: sidebar+content, mobile: full screen panels) ── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* Sidebar (chat list) */}
        <AnimatePresence>
          {showMainSidebar && (
            <motion.div
              key="sidebar"
              initial={isMobile ? { x: -320 } : false}
              animate={{ x: 0 }}
              exit={{ x: -320 }}
              transition={{ type: 'spring', damping: 28, stiffness: 260 }}
              className={`${isMobile ? 'absolute inset-0 z-30' : 'relative'} w-full md:w-80 lg:w-96 flex-shrink-0 ${isMobile ? 'pb-nav' : ''}`}
            >
              <Sidebar onChatSelect={() => isMobile && setShowSidebar(false)} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Main panel */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <Routes>
            <Route path="/feed" element={<FeedPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/profile/:userId" element={<ProfilePage />} />
            <Route path="/channels" element={<ChannelsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/admin" element={<AdminDashboard />} />
            <Route path="/contacts" element={<ContactsPage />} />
            <Route
              path="*"
              element={
                showChat ? (
                  <ChatView
                    onBack={() => {
                      setShowSidebar(true);
                      useChatStore.getState().setActiveChat(null);
                    }}
                  />
                ) : !isMobile ? (
                  /* Desktop: empty state when no chat selected */
                  <div className="h-full flex items-center justify-center">
                    <div className="text-center select-none">
                      <div className="w-24 h-24 bg-dark-800/50 rounded-full flex items-center justify-center mx-auto mb-4">
                        <MessageCircle className="w-12 h-12 text-dark-600" />
                      </div>
                      <h3 className="text-dark-400 text-lg font-medium">Выберите чат</h3>
                      <p className="text-dark-600 text-sm mt-1">или начните новый разговор</p>
                    </div>
                  </div>
                ) : null
              }
            />
          </Routes>
        </div>
      </div>

      {/* ── BOTTOM NAVIGATION (mobile only) ── */}
      {isMobile && !activeChat && (
        <div
          className="fixed bottom-0 left-0 right-0 z-40 flex items-stretch
                     bg-dark-900/95 backdrop-blur-xl border-t border-dark-800/60"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          {NAV_ITEMS.map(({ path, label, icon: Icon }) => {
            const isActive = path === '/'
              ? location.pathname === '/'
              : location.pathname.startsWith(path);
            return (
              <button
                key={path}
                onClick={() => { navigate(path); setShowSidebar(true); }}
                className={`flex-1 flex flex-col items-center justify-center py-2 gap-0.5 transition-colors
                  ${isActive ? 'text-primary-400' : 'text-dark-500 hover:text-dark-300'}`}
              >
                <div className="relative">
                  <Icon className="w-5 h-5" />
                  {path === '/' && totalUnread > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center px-0.5">
                      {totalUnread > 99 ? '99+' : totalUnread}
                    </span>
                  )}
                </div>
                <span className="text-[10px] font-medium">{label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
