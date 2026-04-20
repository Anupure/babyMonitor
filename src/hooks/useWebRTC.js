import { useState, useRef, useCallback } from 'react';
import Peer from 'peerjs';
import { peerOptions } from '../webrtcConfig';

const PEER_PREFIX = 'bmon-';
const MAX_RECONNECT = 1000;

export function useWebRTC() {
  const [peers, setPeers] = useState({});
  const [status, setStatus] = useState('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [babyCrying, setBabyCrying] = useState(false);

  const peerRef = useRef(null);
  const dataConns = useRef({});
  const mediaCalls = useRef({});
  const peerNames = useRef({});
  const peerLastSeen = useRef({});
  const heartbeatInterval = useRef(null);
  const reconnectTimer = useRef(null);
  
  const stateRef = useRef({
    roomCode: '',
    myName: '',
    isHost: false,
    localStream: null,
    peerId: null,
    stopRequested: false
  });

  const updatePeer = useCallback((id, patch) => {
    setPeers(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }, []);

  const dropPeer = useCallback((id) => {
    setPeers(prev => { const n = { ...prev }; delete n[id]; return n; });
    delete dataConns.current[id];
    delete mediaCalls.current[id];
    delete peerNames.current[id];
    delete peerLastSeen.current[id];
  }, []);

  const boostVideoBitrate = (call) => {
    if (!call?.peerConnection) return;
    try {
      const videoSender = call.peerConnection.getSenders().find(s => s.track?.kind === 'video');
      if (videoSender) {
        const params = videoSender.getParameters();
        if (!params.encodings) params.encodings = [{}];
        params.encodings[0].maxBitrate = 2_500_000;
        videoSender.setParameters(params).catch(() => {});
      }
    } catch { }
  };

  const handleIncomingCall = useCallback((call) => {
    call.answer(stateRef.current.localStream || undefined);
    mediaCalls.current[call.peer] = call;
    call.on('stream', (remoteStream) => {
      const knownName = peerNames.current[call.peer];
      updatePeer(call.peer, { stream: remoteStream, ...(knownName ? { name: knownName } : {}) });
    });
    call.on('close', () => updatePeer(call.peer, { stream: null }));
    call.on('error', (e) => console.error('[Call] error', e));
  }, [updatePeer]);

  const callPeer = useCallback((peerId, forceReplace = false) => {
    const stream = stateRef.current.localStream;
    if (!stream) return;
    if (mediaCalls.current[peerId] && !forceReplace) return;
    if (mediaCalls.current[peerId]) {
      mediaCalls.current[peerId].close();
      delete mediaCalls.current[peerId];
    }
    const call = peerRef.current.call(peerId, stream);
    mediaCalls.current[peerId] = call;
    setTimeout(() => boostVideoBitrate(call), 1000);
    call.on('stream', (remoteStream) => updatePeer(call.peer, { stream: remoteStream }));
    call.on('close', () => updatePeer(call.peer, { stream: null }));
    call.on('error', (e) => console.error('[Call] error', e));
  }, [updatePeer]);

  const connectToPeer = useCallback((peerId) => {
    if (dataConns.current[peerId] || !peerRef.current) return;
    const conn = peerRef.current.connect(peerId, { reliable: true });
    setupDataConn(conn);
    callPeer(peerId);
  }, [callPeer]);

  const setupDataConn = useCallback((conn) => {
    dataConns.current[conn.peer] = conn;
    conn.on('open', () => {
      conn.send({ type: 'INFO', name: stateRef.current.myName, isHost: stateRef.current.isHost });
      if (!stateRef.current.isHost) {
        setReconnectAttempt(0);
        setStatus('connected');
      } else {
        const existingIds = Object.keys(dataConns.current).filter(id => id !== conn.peer);
        if (existingIds.length > 0) conn.send({ type: 'PEER_LIST', peers: existingIds });
        callPeer(conn.peer);
      }
    });
    conn.on('data', (data) => {
      if (data.type === 'INFO') {
        peerNames.current[conn.peer] = data.name;
        updatePeer(conn.peer, { name: data.name, isHost: data.isHost });
      } else if (data.type === 'PING') {
        if (conn.open) conn.send({ type: 'PONG' });
      } else if (data.type === 'CRY_STATE') {
        setBabyCrying(data.state);
      } else if (data.type === 'PONG') {
        peerLastSeen.current[conn.peer] = Date.now();
      } else if (data.type === 'PEER_LIST') {
        data.peers.forEach(id => {
          if (id !== peerRef.current?.id && !dataConns.current[id]) connectToPeer(id);
        });
      }
    });
    conn.on('close', () => {
      dropPeer(conn.peer);
      const hostPeerId = `${PEER_PREFIX}${stateRef.current.roomCode}`;
      if (!stateRef.current.isHost && conn.peer === hostPeerId && !stateRef.current.stopRequested) {
        attemptReconnect(null, true);
      }
    });
    conn.on('error', (e) => console.error('[Data] error', e));
    if (stateRef.current.isHost) {
      conn.on('open', () => { peerLastSeen.current[conn.peer] = Date.now(); });
    }
  }, [updatePeer, dropPeer, callPeer, connectToPeer]);

  const startHeartbeat = useCallback(() => {
    if (heartbeatInterval.current) return;
    heartbeatInterval.current = setInterval(() => {
      const now = Date.now();
      const TIMEOUT_MS = 10000;
      Object.entries(dataConns.current).forEach(([peerId, conn]) => {
        if (!conn.open) { dropPeer(peerId); return; }
        try { conn.send({ type: 'PING' }); } catch { }
        const lastSeen = peerLastSeen.current[peerId];
        if (lastSeen && now - lastSeen > TIMEOUT_MS) {
          console.log('[Heartbeat] peer timed out:', peerId);
          dropPeer(peerId);
        }
      });
    }, 5000);
  }, [dropPeer]);

  const attemptReconnect = useCallback((delayOverride, fullRecreate = true) => {
    if (stateRef.current.stopRequested) return;
    setReconnectAttempt(prev => {
      if (stateRef.current.stopRequested) return prev;
      const attempt = prev + 1;
      if (attempt > MAX_RECONNECT) {
        setStatus('disconnected');
        setErrorMsg('Connection lost. Tap Retry to reconnect.');
        return prev;
      }
      setStatus('reconnecting');
      const delay = delayOverride || Math.min(1000 * Math.pow(2, attempt - 1), 10000);
      console.log(`[Reconnect] attempt ${attempt}/${MAX_RECONNECT} in ${delay}ms`);
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      reconnectTimer.current = setTimeout(() => {
        if (stateRef.current.stopRequested) return;
        
        if (fullRecreate) {
          dataConns.current = {};
          mediaCalls.current = {};
          peerNames.current = {};
          peerLastSeen.current = {};
          setPeers({});
          initPeerCore();
        }
        
        if (!stateRef.current.isHost && stateRef.current.roomCode) {
          const waitForOpen = () => {
            if (stateRef.current.stopRequested) return;
            if (peerRef.current?.open) {
              connectToPeer(`${PEER_PREFIX}${stateRef.current.roomCode}`);
            } else {
              if (fullRecreate) setTimeout(waitForOpen, 500);
            }
          };
          waitForOpen();
        }
      }, delay);
      return attempt;
    });
  }, [connectToPeer]);

  const initPeerCore = useCallback(() => {
    if (peerRef.current) {
      try { peerRef.current.destroy(); } catch { }
      peerRef.current = null;
    }

    const peerId = stateRef.current.peerId;
    const p = peerId ? new Peer(peerId, peerOptions) : new Peer(peerOptions);
    
    p.on('open', (myId) => {
      if (stateRef.current.stopRequested || peerRef.current !== p) return;
      console.log('[Peer] open', myId);
      if (stateRef.current.isHost) { 
        setReconnectAttempt(0);
        setStatus('waiting'); 
        startHeartbeat(); 
      }
    });
    
    p.on('disconnected', () => {
      if (stateRef.current.stopRequested || peerRef.current !== p) return;
      console.log('[Peer] disconnected from server. Reconnecting...');
      if (!p.destroyed) {
        p.reconnect();
      }
    });
    
    p.on('error', (err) => {
      if (stateRef.current.stopRequested || peerRef.current !== p) return;
      console.error('[Peer] error:', err.type, err.message);
      
      if (err.type === 'peer-unavailable') {
        // Just log it. Do NOT tear down the entire peer!
        console.warn('A target peer was unavailable:', err.message);
        // If we are the parent and we haven't connected to the host yet, we should retry.
        if (!stateRef.current.isHost) {
           attemptReconnect(null, true);
        }
        return;
      }
      
      if (['disconnected', 'network', 'server-error', 'socket-error', 'socket-closed'].includes(err.type)) {
        console.log('[Peer] recoverable server error, attempting reconnect to signaling...');
        if (!p.destroyed) p.reconnect();
        return;
      } 
      
      if (err.type === 'unavailable-id') {
        attemptReconnect(3000);
      } else {
        setErrorMsg(err.message || 'Connection error');
        setStatus('error');
      }
    });
    
    p.on('connection', setupDataConn);
    p.on('call', handleIncomingCall);
    peerRef.current = p;
    return p;
  }, [attemptReconnect, setupDataConn, handleIncomingCall, startHeartbeat]);

  const initPeer = useCallback((roomCode, isHost, myName, stream) => {
    stateRef.current.stopRequested = false;
    stateRef.current.roomCode = roomCode;
    stateRef.current.isHost = isHost;
    stateRef.current.myName = myName;
    stateRef.current.localStream = stream;
    stateRef.current.peerId = isHost ? `${PEER_PREFIX}${roomCode}` : null;
    
    setStatus('connecting');
    setErrorMsg('');
    initPeerCore();

    if (!isHost) {
      const p = peerRef.current;
      p.on('open', () => connectToPeer(`${PEER_PREFIX}${roomCode}`));
    }
  }, [initPeerCore, connectToPeer]);

  const stopPeer = useCallback(() => {
    stateRef.current.stopRequested = true;
    if (reconnectTimer.current) { clearTimeout(reconnectTimer.current); reconnectTimer.current = null; }
    if (heartbeatInterval.current) { clearInterval(heartbeatInterval.current); heartbeatInterval.current = null; }
    
    peerRef.current?.destroy(); 
    peerRef.current = null;
    
    dataConns.current = {}; 
    mediaCalls.current = {};
    peerNames.current = {}; 
    peerLastSeen.current = {};
    
    setPeers({});
    setStatus('idle');
    setErrorMsg('');
    setReconnectAttempt(0);
    setBabyCrying(false);
  }, []);

  const callAllPeers = useCallback((stream) => {
    stateRef.current.localStream = stream;
    Object.keys(dataConns.current).forEach(peerId => {
      const call = peerRef.current?.call(peerId, stream);
      if (call) {
        mediaCalls.current[`out_${peerId}`] = call;
        setTimeout(() => boostVideoBitrate(call), 1000);
        call.on('stream', () => {});
        call.on('error', e => console.error('[outCall] error', e));
      }
    });
  }, []);

  const broadcastCryState = useCallback((state) => {
    Object.values(dataConns.current).forEach(conn => {
      if (conn.open) conn.send({ type: 'CRY_STATE', state });
    });
  }, []);

  const manualRetry = useCallback(() => {
    setReconnectAttempt(0);
    setErrorMsg('');
    attemptReconnect(500);
  }, [attemptReconnect]);

  return {
    peers,
    status,
    errorMsg,
    reconnectAttempt,
    babyCrying,
    initPeer,
    stopPeer,
    callAllPeers,
    broadcastCryState,
    manualRetry,
    MAX_RECONNECT
  };
}
