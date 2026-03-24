import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import ChannelList from './ChannelList';
import ChannelView from './ChannelView';
import { type Channel } from '../../store/channelStore';

export default function ChannelsPage() {
  const [active, setActive] = useState<Channel | null>(null);

  return (
    <div className="h-full relative overflow-hidden">
      <AnimatePresence initial={false}>
        {active ? (
          <motion.div
            key="channel-view"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 260 }}
            className="absolute inset-0"
          >
            <ChannelView channel={active} onBack={() => setActive(null)} />
          </motion.div>
        ) : (
          <motion.div
            key="channel-list"
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 260 }}
            className="absolute inset-0"
          >
            <ChannelList onSelect={setActive} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
