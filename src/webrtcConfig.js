const DEFAULT_ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

const parseIceServers = () => {
  const raw = import.meta.env.VITE_ICE_SERVERS_JSON;
  if (!raw) return DEFAULT_ICE_SERVERS;

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch (error) {
    console.warn('Invalid VITE_ICE_SERVERS_JSON; using default STUN servers.', error);
  }

  return DEFAULT_ICE_SERVERS;
};

export const peerOptions = {
  debug: import.meta.env.DEV ? 2 : 0,
  config: {
    iceServers: parseIceServers(),
  },
};
