const SOCKET_EVENTS = {
  connection: {
    userOnline: 'user:online',
    userOffline: 'user:offline',
    error: 'error',
  },
  chat: {
    join: 'chat:join',
  },
  message: {
    send: 'message:send',
    new: 'message:new',
    status: 'message:status',
    typing: 'message:typing',
    stopTyping: 'message:stop-typing',
    read: 'message:read',
    forward: 'message:forward',
    edit: 'message:edit',
    edited: 'message:edited',
    delete: 'message:delete',
    deleted: 'message:deleted',
    pin: 'message:pin',
    pinned: 'message:pinned',
    react: 'message:react',
    reaction: 'message:reaction',
  },
  call: {
    initiate: 'call:initiate',
    initiated: 'call:initiated',
    incoming: 'call:incoming',
    accept: 'call:accept',
    accepted: 'call:accepted',
    decline: 'call:decline',
    declined: 'call:declined',
    end: 'call:end',
    ended: 'call:ended',
  },
  webrtc: {
    offer: 'webrtc:offer',
    answer: 'webrtc:answer',
    iceCandidate: 'webrtc:ice-candidate',
  },
  groupCall: {
    create: 'group:create',
    created: 'group:created',
    incoming: 'group:incoming',
    join: 'group:join',
    leave: 'group:leave',
    participants: 'group:participants',
    peerJoined: 'group:peer-joined',
    peerLeft: 'group:peer-left',
    offer: 'group:offer',
    answer: 'group:answer',
    iceCandidate: 'group:ice-candidate',
  },
  watchTogether: {
    selectMovie: 'movie:select',
    stopMovie: 'movie:stop',
  },
  notification: {
    new: 'notification:new',
    read: 'notification:read',
    clear: 'notification:clear',
  },
  channel: {
    post: 'channel:post',
    newPost: 'channel:new_post',
    updatedPost: 'channel:updated_post',
  },
  story: {
    new: 'story:new',
    viewed: 'story:viewed',
    deleted: 'story:deleted',
  },
};

module.exports = {
  SOCKET_EVENTS,
};
