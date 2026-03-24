export const messageInclude = {
  sender: { select: { id: true, displayName: true, avatar: true } },
  replyTo: {
    include: {
      sender: { select: { id: true, displayName: true } },
    },
  },
  forwardedFrom: {
    include: {
      sender: { select: { id: true, displayName: true } },
    },
  },
  media: true,
  reactions: true,
} as const;

export const messageSearchInclude = {
  ...messageInclude,
  chat: { select: { id: true, name: true, type: true } },
} as const;
