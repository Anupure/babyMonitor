import React, { useState, useEffect, useRef, useCallback } from 'react';
import Peer from 'peerjs';
import { Camera, MonitorSmartphone, PhoneOff, Baby, Send } from 'lucide-react';
import { database, ensureAuthenticated } from './firebase';
import { ref, set, onValue, onDisconnect, push, remove } from 'firebase/database';
import './index.css';

const generateRoomCode = () => Math.random().toString(36).substring(2, 6).toUpperCase();
const PEER_PREFIX = 'bmon-';

// VideoPlayer: handles autoplay, mute toggle, and fullscreen
const VideoPlayer = ({ stream, isLocal, label, initiallyMuted }) => {
  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const [muted, setMuted] = useState(!!initiallyMuted);
  const [needsTap, setNeedsTap] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) return;
    if (video.srcObject === stream) return;
    video.srcObject = stream;
    video.play().catch(() => setNeedsTap(true));
  }, [stream]);

  const handleTap = () => {
    setNeedsTap(false);
    setMuted(false);
    videoRef.current?.play().catch(console.error);
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen().catch(console.error);
    } else {
      document.exitFullscreen();
    }
  };

  return (
    <div className="video-container" ref={containerRef}>
      <video ref={videoRef} autoPlay playsInline muted={muted} />
      {needsTap && (
        <div className="interaction-overlay" onClick={handleTap}>
          <button className="btn-primary">▶ Tap to Play</button>
        </div>
      )}
      <div className="video-controls">
        <span className="video-name">{label}</span>
        <div className="video-actions">
          {!isLocal && (
            <button className="icon-btn" onClick={() => setMuted(m => !m)}>
              <span style={{fontSize:'15px',lineHeight:1}}>{muted ? '🔇' : '🔊'}</span>
            </button>
          )}
          <button className="icon-btn" onClick={toggleFullscreen}>
            <span style={{fontSize:'15px',lineHeight:1}}>⛶</span>
          </button>
        </div>
      </div>
    </div>
  );
};

// Chat Panel — messages from Firebase
const ChatPanel = ({ messages, onSend }) => {
  const [text, setText] = useState('');
  const bottomRef = useRef(null);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const submit = (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    onSend(text.trim());
    setText('');
  };

  return (
    <div className="chat-container">
      <div className="chat-messages">
        {messages.length === 0 && <p className="muted-text" style={{ textAlign: 'center', paddingTop: '1rem' }}>No messages yet</p>}
        {messages.map((m, i) => (
          <div key={i} className={`chat-message ${m.mine ? 'chat-mine' : ''}`}>
            <span className="chat-sender">{m.sender} <span style={{ fontSize: '0.7em', opacity: 0.6 }}>{m.time}</span></span>
            <span className="chat-text">{m.text}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <form className="chat-input-form" onSubmit={submit}>
        <input
          type="text" value={text} onChange={e => setText(e.target.value)}
          placeholder="Type a message..."
          style={{ marginBottom: 0, textTransform: 'none', letterSpacing: 'normal' }}
        />
        <button type="submit" className="btn-primary" style={{ padding: '0.75rem 1rem', flexShrink: 0 }}>
          <Send size={18} color="white" />
        </button>
      </form>
    </div>
  );
};

// ─── Main App ───────────────────────────────────────────────
export default function App() {
  const [mode, setMode] = useState(null);
  const [userName, setUserName] = useState('');
  const [inputCode, setInputCode] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [status, setStatus] = useState('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const [peers, setPeers] = useState({});
  const [chatMessages, setChatMessages] = useState([]);

  const [localStream, setLocalStream] = useState(null);
  const [micOn, setMicOn] = useState(false);
  const [camOn, setCamOn] = useState(false);

  // PeerJS refs
  const peerRef = useRef(null);
  const localStreamRef = useRef(null);
  const myNameRef = useRef('');
  const isHostRef = useRef(false);
  const dataConns = useRef({});
  const mediaCalls = useRef({});
  const peerNames = useRef({});
  const peerLastSeen = useRef({});
  const heartbeatInterval = useRef(null);

  // Firebase refs
  const myFbUidRef = useRef(null);
  const fbUnsubsRef = useRef([]);

  useEffect(() => { localStreamRef.current = localStream; }, [localStream]);

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
    } catch (_) {}
  };

  // ── Firebase Chat & Presence ───────────────────────────────
  const initFirebase = useCallback(async (code, name, isHost) => {
    try {
      const user = await ensureAuthenticated();
      const uid = user.uid;
      myFbUidRef.current = uid;

      // Write presence
      const myPresenceRef = ref(database, `rooms/${code}/presence/${uid}`);
      await set(myPresenceRef, { name, isHost, ts: Date.now() });
      await onDisconnect(myPresenceRef).remove();

      // Watch chat
      const chatRef = ref(database, `rooms/${code}/chat`);
      const unsubChat = onValue(chatRef, (snap) => {
        if (!snap.exists()) { setChatMessages([]); return; }
        const msgs = [];
        snap.forEach(child => {
          const d = child.val();
          msgs.push({ ...d, mine: d.senderId === uid });
        });
        setChatMessages(msgs);
      });
      fbUnsubsRef.current.push(unsubChat);

      // Watch presence for instant disconnect detection (host only)
      if (isHost) {
        const presenceRef = ref(database, `rooms/${code}/presence`);
        const unsubPresence = onValue(presenceRef, (snap) => {
          if (!snap.exists()) return;
          const active = snap.val();
          // Drop PeerJS peers that are no longer in Firebase presence
          Object.keys(dataConns.current).forEach(peerId => {
            // peerId is bmon-XXXX, match against Firebase uid by name
            // We can't directly map peerId to uid, but we can cross-check via peerNames
            // This is used as a supplement to heartbeat, not a replacement
          });
        });
        fbUnsubsRef.current.push(unsubPresence);
      }
    } catch (e) {
      console.error('[Firebase]', e);
    }
  }, []);

  const sendChat = useCallback(async (text) => {
    if (!roomCode || !myFbUidRef.current) return;
    await push(ref(database, `rooms/${roomCode}/chat`), {
      senderId: myFbUidRef.current,
      sender: myNameRef.current,
      text,
      time: new Date().toLocaleTimeString(),
      ts: Date.now(),
    });
  }, [roomCode]);

  const cleanupFirebase = useCallback(async () => {
    fbUnsubsRef.current.forEach(fn => { try { fn(); } catch (_) {} });
    fbUnsubsRef.current = [];
    if (myFbUidRef.current && roomCode) {
      await remove(ref(database, `rooms/${roomCode}/presence/${myFbUidRef.current}`)).catch(() => {});
    }
    myFbUidRef.current = null;
  }, [roomCode]);

  // ── PeerJS helpers ─────────────────────────────────────────

  const updatePeer = (id, patch) =>
    setPeers(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  const dropPeer = (id) => {
    setPeers(prev => { const n = { ...prev }; delete n[id]; return n; });
    delete dataConns.current[id];
    delete mediaCalls.current[id];
    delete peerNames.current[id];
    delete peerLastSeen.current[id];
  };

  const handleIncomingCall = useCallback((call) => {
    call.answer(localStreamRef.current || undefined);
    mediaCalls.current[call.peer] = call;
    call.on('stream', (remoteStream) => {
      const knownName = peerNames.current[call.peer];
      updatePeer(call.peer, { stream: remoteStream, ...(knownName ? { name: knownName } : {}) });
    });
    call.on('close', () => updatePeer(call.peer, { stream: null }));
    call.on('error', (e) => console.error('[Call] error', e));
  }, []);

  const callPeer = useCallback((peerId, forceReplace = false) => {
    const stream = localStreamRef.current;
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
  }, []);

  const setupDataConn = useCallback((conn) => {
    dataConns.current[conn.peer] = conn;
    conn.on('open', () => {
      conn.send({ type: 'INFO', name: myNameRef.current, isHost: isHostRef.current });
      if (isHostRef.current) {
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
      } else if (data.type === 'PONG') {
        peerLastSeen.current[conn.peer] = Date.now();
      } else if (data.type === 'PEER_LIST') {
        data.peers.forEach(id => {
          if (id !== peerRef.current?.id && !dataConns.current[id]) connectToPeer(id);
        });
      }
    });
    conn.on('close', () => dropPeer(conn.peer));
    conn.on('error', (e) => console.error('[Data] error', e));
    if (isHostRef.current) {
      conn.on('open', () => { peerLastSeen.current[conn.peer] = Date.now(); });
    }
  }, [callPeer]);

  const startHeartbeat = useCallback(() => {
    if (heartbeatInterval.current) return;
    heartbeatInterval.current = setInterval(() => {
      const now = Date.now();
      const TIMEOUT_MS = 10000;
      Object.entries(dataConns.current).forEach(([peerId, conn]) => {
        if (!conn.open) { dropPeer(peerId); return; }
        try { conn.send({ type: 'PING' }); } catch (_) {}
        const lastSeen = peerLastSeen.current[peerId];
        if (lastSeen && now - lastSeen > TIMEOUT_MS) {
          console.log('[Heartbeat] peer timed out:', peerId);
          dropPeer(peerId);
        }
      });
    }, 5000);
  }, []);

  const connectToPeer = useCallback((peerId) => {
    if (dataConns.current[peerId]) return;
    const conn = peerRef.current.connect(peerId, { reliable: true });
    setupDataConn(conn);
    callPeer(peerId);
  }, [setupDataConn, callPeer]);

  const initPeer = useCallback((id) => {
    const p = new Peer(id, { debug: 2 });
    p.on('open', (myId) => {
      console.log('[Peer] open', myId);
      if (isHostRef.current) { setStatus('waiting'); startHeartbeat(); }
      else setStatus('connected');
    });
    p.on('error', (err) => { setErrorMsg(err.message || 'Connection error'); setStatus('error'); });
    p.on('connection', (conn) => setupDataConn(conn));
    p.on('call', (call) => handleIncomingCall(call));
    peerRef.current = p;
    return p;
  }, [setupDataConn, handleIncomingCall, startHeartbeat]);

  // ── Camera mode ────────────────────────────────────────────
  const startCameraMode = async () => {
    myNameRef.current = 'Baby Camera';
    isHostRef.current = true;
    setMode('camera');
    setStatus('connecting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920, min: 1280 }, height: { ideal: 1080, min: 720 }, frameRate: { ideal: 30 } },
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
      localStreamRef.current = stream;
      setLocalStream(stream);
      setMicOn(true); setCamOn(true);
      const code = generateRoomCode();
      setRoomCode(code);
      initPeer(`${PEER_PREFIX}${code}`);
      await initFirebase(code, 'Baby Camera', true);
    } catch (err) {
      setErrorMsg('Could not access camera/mic. Please grant permissions.');
      setStatus('error');
    }
  };

  // ── Monitor mode ───────────────────────────────────────────
  const goToMonitor = () => {
    if (!userName.trim()) { setErrorMsg('Please enter your name.'); return; }
    setErrorMsg('');
    myNameRef.current = userName.trim();
    isHostRef.current = false;
    setMode('monitor');
  };

  const connectToRoom = async () => {
    const code = inputCode.trim().toUpperCase();
    if (code.length < 4) { setErrorMsg('Enter a valid 4-character code.'); return; }
    setErrorMsg('');
    setStatus('connecting');
    setRoomCode(code);
    await initFirebase(code, userName.trim(), false);
    initPeer();
    peerRef.current.on('open', () => connectToPeer(`${PEER_PREFIX}${code}`));
  };

  // ── Parent media toggles ───────────────────────────────────
  const callAllPeers = (stream) => {
    Object.keys(dataConns.current).forEach(peerId => {
      const call = peerRef.current.call(peerId, stream);
      if (call) {
        mediaCalls.current[`out_${peerId}`] = call;
        setTimeout(() => boostVideoBitrate(call), 1000);
        call.on('stream', () => {});
        call.on('error', e => console.error('[outCall] error', e));
      }
    });
  };

  const toggleMic = async () => {
    if (!localStream) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
        localStreamRef.current = stream;
        setLocalStream(stream);
        setMicOn(true);
        callAllPeers(stream);
      } catch (_) { alert('Cannot access microphone.'); }
    } else {
      const newVal = !micOn;
      localStream.getAudioTracks().forEach(t => { t.enabled = newVal; });
      setMicOn(newVal);
    }
  };

  const toggleCam = async () => {
    if (!camOn) {
      try {
        if (!localStream) {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
            audio: micOn
          });
          localStreamRef.current = stream;
          setLocalStream(stream);
          setMicOn(stream.getAudioTracks().length > 0);
          callAllPeers(stream);
        } else {
          const videoStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
            audio: false
          });
          localStream.addTrack(videoStream.getVideoTracks()[0]);
          callAllPeers(localStream);
        }
        setCamOn(true);
      } catch (_) { alert('Cannot access camera.'); }
    } else {
      if (localStream) localStream.getVideoTracks().forEach(t => { t.enabled = false; t.stop(); });
      setCamOn(false);
    }
  };

  // ── Cleanup ────────────────────────────────────────────────
  const stopEverything = async () => {
    if (heartbeatInterval.current) { clearInterval(heartbeatInterval.current); heartbeatInterval.current = null; }
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    peerRef.current?.destroy(); peerRef.current = null;
    dataConns.current = {}; mediaCalls.current = {};
    localStreamRef.current = null; peerNames.current = {}; peerLastSeen.current = {};
    await cleanupFirebase();
    setLocalStream(null); setPeers({}); setChatMessages([]);
    setStatus('idle'); setErrorMsg(''); setRoomCode(''); setInputCode('');
    setMicOn(false); setCamOn(false); setMode(null);
  };

  useEffect(() => () => { stopEverything(); }, []);

  // ─── RENDER ─────────────────────────────────────────────────

  const allPeerList = Object.entries(peers);

  if (!mode) {
    return (
      <div className="card">
        <Baby className="icon-large" />
        <h1>Baby Monitor</h1>
        <p className="muted-text">Secure, peer-to-peer baby monitoring.</p>
        <div className="flex-col" style={{ marginTop: '2rem' }}>
          <button className="btn-primary" onClick={startCameraMode}>
            <Camera size={20} color="white" /> Use as Camera (Baby)
          </button>
          <hr style={{ width: '100%', borderColor: 'var(--surface-hover)', margin: '1.25rem 0' }} />
          <input
            type="text" placeholder="Your Name (e.g. Mom)"
            value={userName} onChange={e => setUserName(e.target.value)}
            style={{ textTransform: 'none', letterSpacing: 'normal' }}
          />
          <button className="btn-secondary" onClick={goToMonitor}>
            <MonitorSmartphone size={20} color="#94a3b8" /> Use as Monitor (Parent)
          </button>
          {errorMsg && <p style={{ color: 'var(--error-color)', marginTop: '0.5rem' }}>{errorMsg}</p>}
        </div>
      </div>
    );
  }

  if (mode === 'monitor' && status !== 'connected') {
    return (
      <div className="card" style={{ maxWidth: '400px' }}>
        <MonitorSmartphone className="icon-large" />
        <h1>Join Room</h1>
        <p className="muted-text">Joining as: <strong>{userName}</strong></p>
        {errorMsg && <p style={{ color: 'var(--error-color)' }}>{errorMsg}</p>}
        <input
          type="text" placeholder="Room Code (e.g. A4F2)"
          value={inputCode} onChange={e => setInputCode(e.target.value.toUpperCase().slice(0, 4))}
          maxLength={4}
          style={{ textTransform: 'uppercase', marginTop: '1rem' }}
          disabled={status === 'connecting'}
        />
        <div className="flex-row" style={{ marginTop: '1rem' }}>
          <button className="btn-secondary" onClick={stopEverything}>Back</button>
          <button className="btn-primary" onClick={connectToRoom} disabled={status === 'connecting'}>
            {status === 'connecting' ? 'Connecting...' : 'Connect'}
          </button>
        </div>
      </div>
    );
  }

  if (mode === 'camera') {
    const parentPeers = allPeerList.filter(([_, d]) => d.stream);
    return (
      <div className="card app-container">
        <div className="header-bar">
          <div className="badge">
            <div className="pulsing-dot" style={{ backgroundColor: allPeerList.length > 0 ? '#22c55e' : '#ef4444' }} />
            {allPeerList.length} Parent(s) Connected
          </div>
          {status === 'waiting' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span className="muted-text" style={{ fontSize: '0.85rem' }}>Code:</span>
              <div className="room-code" style={{ fontSize: '1.2rem', padding: '0.3rem 0.8rem' }}>{roomCode}</div>
            </div>
          )}
          <button className="btn-danger" onClick={stopEverything} style={{ padding: '0.5rem 1rem' }}>
            <PhoneOff size={16} color="white" /> Stop
          </button>
        </div>
        <div className="main-content">
          <div className="video-section">
            <div className="primary-video">
              {localStream && <VideoPlayer stream={localStream} isLocal label="👶 Baby Camera" initiallyMuted />}
            </div>
            {parentPeers.length > 0 && (
              <div className="secondary-videos">
                {parentPeers.map(([id, d]) => (
                  <div key={id} className="small-video-wrapper">
                    <VideoPlayer stream={d.stream} label={d.name || 'Parent'} initiallyMuted={false} />
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="chat-section"><ChatPanel messages={chatMessages} onSend={sendChat} /></div>
        </div>
      </div>
    );
  }

  const hostPeerEntry = allPeerList.find(([_, d]) => d.isHost && d.stream);
  const otherParentPeers = allPeerList.filter(([_, d]) => !d.isHost && d.stream);

  return (
    <div className="card app-container">
      <div className="header-bar">
        <div className="badge">
          <div className="pulsing-dot" style={{ backgroundColor: hostPeerEntry ? '#22c55e' : '#f59e0b' }} />
          {hostPeerEntry ? 'Baby Connected' : 'Waiting for Baby...'}
        </div>
        <div className="media-toggles">
          <button className={`icon-btn ${micOn ? 'active' : ''}`} title={micOn ? 'Mute Mic' : 'Unmute Mic'} onClick={toggleMic}>
            <span style={{fontSize: '18px', lineHeight: 1}}>{micOn ? '🎙️' : '🔇'}</span>
          </button>
          <button className={`icon-btn ${camOn ? 'active' : ''}`} title={camOn ? 'Turn Off Camera' : 'Turn On Camera'} onClick={toggleCam}>
            <span style={{fontSize: '18px', lineHeight: 1}}>{camOn ? '📷' : '📵'}</span>
          </button>
        </div>
        <button className="btn-danger" onClick={stopEverything} style={{ padding: '0.5rem 1rem' }}>
          <PhoneOff size={16} color="white" /> Leave
        </button>
      </div>
      <div className="main-content">
        <div className="video-section">
          <div className="primary-video">
            {hostPeerEntry ? (
              <VideoPlayer stream={hostPeerEntry[1].stream} label="👶 Baby Camera" initiallyMuted={false} />
            ) : (
              <div className="video-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '250px' }}>
                <p className="muted-text">Waiting for baby's video...</p>
              </div>
            )}
          </div>
          {(localStream || otherParentPeers.length > 0) && (
            <div className="secondary-videos">
              {localStream && (
                <div className="small-video-wrapper">
                  <VideoPlayer stream={localStream} isLocal label={`${userName} (You)`} initiallyMuted />
                </div>
              )}
              {otherParentPeers.map(([id, d]) => (
                <div key={id} className="small-video-wrapper">
                  <VideoPlayer stream={d.stream} label={d.name || 'Parent'} initiallyMuted={false} />
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="chat-section"><ChatPanel messages={chatMessages} onSend={sendChat} /></div>
      </div>
    </div>
  );
}
