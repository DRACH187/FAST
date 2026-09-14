export type ChatMessage = {
  id: string;
  content: string;
  author: string;
  channelId: string;
  channelSlug?: string;
  createdAt: string;
};

export type ChannelInfo = {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  messageCount: number;
  lastMessage: {
    author: string;
    content: string;
    createdAt: string;
  } | null;
};
