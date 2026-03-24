export declare const SOCKET_EVENTS: {
  readonly connection: {
    readonly userOnline: 'user:online';
    readonly userOffline: 'user:offline';
    readonly error: 'error';
  };
  readonly chat: {
    readonly join: 'chat:join';
  };
  readonly message: {
    readonly send: 'message:send';
    readonly new: 'message:new';
    readonly status: 'message:status';
    readonly typing: 'message:typing';
    readonly stopTyping: 'message:stop-typing';
    readonly read: 'message:read';
    readonly forward: 'message:forward';
    readonly edit: 'message:edit';
    readonly edited: 'message:edited';
    readonly delete: 'message:delete';
    readonly deleted: 'message:deleted';
    readonly pin: 'message:pin';
    readonly pinned: 'message:pinned';
    readonly react: 'message:react';
    readonly reaction: 'message:reaction';
  };
  readonly call: {
    readonly initiate: 'call:initiate';
    readonly initiated: 'call:initiated';
    readonly incoming: 'call:incoming';
    readonly accept: 'call:accept';
    readonly accepted: 'call:accepted';
    readonly decline: 'call:decline';
    readonly declined: 'call:declined';
    readonly end: 'call:end';
    readonly ended: 'call:ended';
  };
  readonly webrtc: {
    readonly offer: 'webrtc:offer';
    readonly answer: 'webrtc:answer';
    readonly iceCandidate: 'webrtc:ice-candidate';
  };
  readonly groupCall: {
    readonly create: 'group:create';
    readonly created: 'group:created';
    readonly incoming: 'group:incoming';
    readonly join: 'group:join';
    readonly leave: 'group:leave';
    readonly participants: 'group:participants';
    readonly peerJoined: 'group:peer-joined';
    readonly peerLeft: 'group:peer-left';
    readonly offer: 'group:offer';
    readonly answer: 'group:answer';
    readonly iceCandidate: 'group:ice-candidate';
  };
  readonly watchTogether: {
    readonly selectMovie: 'movie:select';
    readonly stopMovie: 'movie:stop';
  };
  readonly notification: {
    readonly new: 'notification:new';
    readonly read: 'notification:read';
    readonly clear: 'notification:clear';
  };
  readonly channel: {
    readonly post: 'channel:post';
    readonly newPost: 'channel:new_post';
    readonly updatedPost: 'channel:updated_post';
  };
  readonly story: {
    readonly new: 'story:new';
    readonly viewed: 'story:viewed';
    readonly deleted: 'story:deleted';
  };
};

export type SocketEventCatalog = typeof SOCKET_EVENTS;
export type SocketEventName =
  SocketEventCatalog[keyof SocketEventCatalog][keyof SocketEventCatalog[keyof SocketEventCatalog]];
