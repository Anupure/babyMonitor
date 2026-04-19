import React, { useState, useEffect, useRef, useCallback } from 'react';
import Peer from 'peerjs';
import { Camera, MonitorSmartphone, PhoneOff, Baby, Send, LogOut, Plus, Trash2, ArrowLeft } from 'lucide-react';
import { database, ensureAuthenticated } from './firebase';
import { ref, set, get, update, onValue, onDisconnect, push, remove } from 'firebase/database';
import { useAuth } from './AuthContext';
import './index.css';

const generateRoomCode = () => Math.random().toString(36).substring(2, 6).toUpperCase();
const PEER_PREFIX = 'bmon-';

// VideoPlayer: handles autoplay, mute toggle, and fullscreen
const VideoPlayer = ({ stream, isLocal, label, initiallyMuted, nightVision }) => {
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
      <video ref={videoRef} autoPlay playsInline muted={muted} className={nightVision ? 'night-vision-filter' : ''} />
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
  const { user, loading, isSignedIn, signIn, emailSignIn, signOut } = useAuth();

  const [mode, setMode] = useState(null); // null | 'create' | 'camera' | 'monitor'
  const [userName, setUserName] = useState('');
  const [devEmail, setDevEmail] = useState('');
  const [devPassword, setDevPassword] = useState('');
  const [inputCode, setInputCode] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [status, setStatus] = useState('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [newRoomName, setNewRoomName] = useState('');
  const [roomDisplayName, setRoomDisplayName] = useState('Baby Camera');
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const MAX_RECONNECT = 5;

  // Feature #6: Audio-Level Cry Alert State
  const [cryThreshold, setCryThreshold] = useState(50);
  const [isCrying, setIsCrying] = useState(false);
  const [babyCrying, setBabyCrying] = useState(false);

  // Feature #9: Night Vision Mode
  const [nightVision, setNightVision] = useState(false);

  const [peers, setPeers] = useState({});
  const [chatMessages, setChatMessages] = useState([]);
  const [savedRooms, setSavedRooms] = useState([]);

  const [localStream, setLocalStream] = useState(null);
  const [micOn, setMicOn] = useState(false);
  const [camOn, setCamOn] = useState(false);

  // Load saved rooms when signed in
  useEffect(() => {
    if (!isSignedIn || !user) return;
    setUserName(user.displayName || '');
    const roomsRef = ref(database, `users/${user.uid}/rooms`);
    const unsub = onValue(roomsRef, (snap) => {
      if (!snap.exists()) { setSavedRooms([]); return; }
      const rooms = [];
      console.log('[Rooms] raw data:', JSON.stringify(snap.val()));
      snap.forEach(child => {
        console.log('[Rooms] child:', child.key, JSON.stringify(child.val()));
        rooms.push({ code: child.key, ...child.val() });
      });
      console.log('[Rooms] parsed rooms array:', JSON.stringify(rooms));
      setSavedRooms(rooms);
    });
    return () => unsub();
  }, [isSignedIn, user]);

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
  const reconnectTimer = useRef(null);
  const peerIdRef = useRef(null);  // store peer ID for reconnect

  // Firebase refs
  const myFbUidRef = useRef(null);
  const databaseRoomsRef = useRef(null);
  const fbUnsubsRef = useRef([]);

  // Feature #6: Audio-Level Cry Alert Refs
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const sourceRef = useRef(null);
  const audioLoopRef = useRef(null);
  const cryDurationRef = useRef(0);
  const silenceDurationRef = useRef(0);

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
      } else if (data.type === 'CHAT') {
        setChatMessages(prev => [...prev, data.message]);
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
    if (id) peerIdRef.current = id;
    const peerId = id || peerIdRef.current;

    // Destroy old peer if exists
    if (peerRef.current) {
      try { peerRef.current.destroy(); } catch (_) {}
      peerRef.current = null;
    }

    const p = peerId ? new Peer(peerId, { debug: 2 }) : new Peer({ debug: 2 });
    p.on('open', (myId) => {
      console.log('[Peer] open', myId);
      setReconnectAttempt(0); // reset on success
      if (isHostRef.current) { setStatus('waiting'); startHeartbeat(); }
      else setStatus('connected');
    });
    p.on('disconnected', () => {
      console.log('[Peer] disconnected — attempting reconnect');
      attemptReconnect();
    });
    p.on('error', (err) => {
      console.error('[Peer] error:', err.type, err.message);
      const recoverable = ['disconnected', 'network', 'server-error', 'socket-error', 'socket-closed'];
      if (recoverable.includes(err.type)) {
        attemptReconnect();
      } else if (err.type === 'unavailable-id') {
        // Peer ID already taken (stale session) — wait and retry
        attemptReconnect(3000);
      } else {
        setErrorMsg(err.message || 'Connection error');
        setStatus('error');
      }
    });
    p.on('connection', (conn) => setupDataConn(conn));
    p.on('call', (call) => handleIncomingCall(call));
    peerRef.current = p;
    return p;
  }, [setupDataConn, handleIncomingCall, startHeartbeat]);

  const attemptReconnect = useCallback((delayOverride) => {
    setReconnectAttempt(prev => {
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
        // Clean up old connections
        dataConns.current = {};
        mediaCalls.current = {};
        peerNames.current = {};
        peerLastSeen.current = {};
        setPeers({});
        initPeer(); // re-init with stored peerIdRef
        // If monitor, re-connect to host after peer opens
        if (!isHostRef.current && roomCode) {
          const waitForOpen = () => {
            if (peerRef.current?.open) {
              connectToPeer(`${PEER_PREFIX}${roomCode}`);
            } else {
              setTimeout(waitForOpen, 500);
            }
          };
          waitForOpen();
        }
      }, delay);
      return attempt;
    });
  }, [initPeer, connectToPeer, roomCode]);

  const manualRetry = useCallback(() => {
    setReconnectAttempt(0);
    setErrorMsg('');
    attemptReconnect(500);
  }, [attemptReconnect]);

  // ── Camera mode ────────────────────────────────────────────
  const startCameraMode = async (existingCode, roomName) => {
    const displayName = roomName || 'Baby Camera';
    myNameRef.current = displayName;
    setRoomDisplayName(displayName);
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

      // Feature #6: Setup Audio Analyzer
      try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        const source = audioCtx.createMediaStreamSource(stream);
        source.connect(analyser);
        
        audioContextRef.current = audioCtx;
        analyserRef.current = analyser;
        sourceRef.current = source;

        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        
        const monitorAudio = () => {
          if (!analyserRef.current) return;
          analyserRef.current.getByteFrequencyData(dataArray);
          
          let sum = 0;
          for(let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i];
          }
          const average = sum / dataArray.length;
          // Scale average (0-255) to percentage (0-100)
          const volumePercent = (average / 255) * 100;

          // Note: we can't easily access the latest state in requestAnimationFrame without refs,
          // so we use a functional state update trick or just read from a ref, but to keep it simple,
          // we'll dispatch an event or use a ref for the threshold if needed.
          // Wait, cryThreshold is captured in closure? No, it's stale. 
          // We will handle threshold in a useEffect that listens to cryThreshold instead, or update a ref.
        };
        // We'll actually start the loop below using a cleaner approach.
      } catch(err) {
        console.error('AudioContext setup failed', err);
      }

      const code = existingCode || generateRoomCode();
      setRoomCode(code);
      initPeer(`${PEER_PREFIX}${code}`);
      await initFirebase(code, displayName, true);
      // Save room — use update() to merge, not overwrite sibling rooms
      if (isSignedIn && user) {
        await update(ref(database, `users/${user.uid}/rooms`), {
          [code]: { name: displayName, createdAt: Date.now() }
        });
      }
    } catch (err) {
      setErrorMsg('Could not access camera/mic. Please grant permissions.');
      setStatus('error');
    }
  };

  // Update audio loop when threshold changes or host mode starts
  useEffect(() => {
    if (mode !== 'camera' || !analyserRef.current) return;
    
    if (audioLoopRef.current) clearInterval(audioLoopRef.current);
    
    const dataArray = new Uint8Array(analyserRef.current.fftSize);
    let lastTime = Date.now();

    const checkAudio = () => {
      if (!analyserRef.current) return;
      
      const time = Date.now();
      const dt = time - lastTime;
      lastTime = time;

      analyserRef.current.getByteTimeDomainData(dataArray);
      let sumSquares = 0;
      for (let i = 0; i < dataArray.length; i++) {
        const normalized = (dataArray[i] - 128) / 128;
        sumSquares += normalized * normalized;
      }
      const rms = Math.sqrt(sumSquares / dataArray.length);
      
      // Scale RMS up. Typical speaking might be 0.1-0.2 RMS. Crying might be 0.3-0.5.
      // Multiply by 300 so that an RMS of 0.16 is ~50%.
      const volume = Math.min(100, rms * 300);

      if (volume >= cryThreshold) {
        cryDurationRef.current += dt;
        silenceDurationRef.current = 0;
        if (cryDurationRef.current > 1500) { // 1.5 seconds of loud noise
          setIsCrying(prev => {
            if (!prev) broadcastCryState(true);
            return true;
          });
        }
      } else {
        silenceDurationRef.current += dt;
        if (silenceDurationRef.current > 2000) { // 2 seconds of quiet
          cryDurationRef.current = 0;
          setIsCrying(prev => {
            if (prev) broadcastCryState(false);
            return false;
          });
        }
      }
    };
    audioLoopRef.current = setInterval(checkAudio, 100);
    
    return () => {
      if (audioLoopRef.current) clearInterval(audioLoopRef.current);
    };
  }, [mode, cryThreshold]);

  const broadcastCryState = (state) => {
    Object.values(dataConns.current).forEach(conn => {
      if (conn.open) conn.send({ type: 'CRY_STATE', state });
    });
  };

  const deleteRoom = async (code) => {
    if (!isSignedIn || !user) return;
    await remove(ref(database, `users/${user.uid}/rooms/${code}`)).catch(() => {});
  };

  // ── Monitor mode ───────────────────────────────────────────
  const goToMonitor = async () => {
    if (!userName.trim()) { setErrorMsg('Please enter your name.'); return; }
    
    // Feature 7: Mandatory Notifications
    if ('Notification' in window) {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setErrorMsg('You must allow notifications to use the Monitor mode.');
        return;
      }
    } else {
      setErrorMsg('Notifications are not supported by your browser, which are required for monitoring.');
      return;
    }
    
    setErrorMsg('');
    myNameRef.current = userName.trim();
    isHostRef.current = false;
    setMode('monitor');
  };

  useEffect(() => {
    if (babyCrying && mode === 'monitor') {
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('⚠️ Baby is Crying!', {
          body: `Loud noise detected in ${roomDisplayName || 'the baby room'}!`,
          icon: '/pwa-192x192.png',
          requireInteraction: true
        });
      }
    }
  }, [babyCrying, mode, roomDisplayName]);

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
    if (audioLoopRef.current) clearInterval(audioLoopRef.current);
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(()=>{});
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    sourceRef.current = null;
    cryDurationRef.current = 0;
    silenceDurationRef.current = 0;

    if (reconnectTimer.current) { clearTimeout(reconnectTimer.current); reconnectTimer.current = null; }
    if (heartbeatInterval.current) { clearInterval(heartbeatInterval.current); heartbeatInterval.current = null; }
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    peerRef.current?.destroy(); peerRef.current = null;
    dataConns.current = {}; mediaCalls.current = {};
    localStreamRef.current = null; peerNames.current = {}; peerLastSeen.current = {};
    peerIdRef.current = null;
    await cleanupFirebase();
    setLocalStream(null); setPeers({}); setChatMessages([]);
    setStatus('idle'); setErrorMsg(''); setRoomCode(''); setInputCode('');
    setMicOn(false); setCamOn(false); setMode(null); setNewRoomName(''); setRoomDisplayName('Baby Camera'); setReconnectAttempt(0);
    setIsCrying(false); setBabyCrying(false);
  };

  useEffect(() => () => { stopEverything(); }, []);

  // ─── RENDER ─────────────────────────────────────────────────

  if (loading) {
    return <div className="card"><p className="muted-text">Loading...</p></div>;
  }

  const allPeerList = Object.entries(peers);

  // Create room screen — enter camera name
  if (mode === 'create') {
    return (
      <div className="card" style={{ maxWidth: '400px' }}>
        <Camera className="icon-large" />
        <h1>New Baby Camera</h1>
        <p className="muted-text">Give your camera a name</p>
        <input
          type="text" placeholder="e.g. Bedroom, Kids Room"
          value={newRoomName} onChange={e => setNewRoomName(e.target.value)}
          style={{ textTransform: 'none', letterSpacing: 'normal', marginTop: '1rem' }}
          autoFocus
        />
        {errorMsg && <p style={{ color: 'var(--error-color)' }}>{errorMsg}</p>}
        <div className="flex-row" style={{ marginTop: '1rem' }}>
          <button className="btn-secondary" onClick={() => { setMode(null); setErrorMsg(''); setNewRoomName(''); }}>
            <ArrowLeft size={16} /> Back
          </button>
          <button className="btn-primary" onClick={() => {
            const name = newRoomName.trim();
            if (!name) { setErrorMsg('Please enter a camera name.'); return; }
            setErrorMsg('');
            startCameraMode(null, name);
          }}>
            <Camera size={16} color="white" /> Start Camera
          </button>
        </div>
      </div>
    );
  }

  // Landing page
  if (!mode) {
    return (
      <div className="card">
        <Baby className="icon-large" />
        <h1>Baby Monitor</h1>
        <p className="muted-text">Secure, peer-to-peer baby monitoring.</p>

        {isSignedIn ? (
          <div className="flex-col" style={{ marginTop: '2rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', marginBottom: '0.5rem' }}>
              <span className="muted-text" style={{ fontSize: '0.85rem' }}>👋 {user.displayName}</span>
              <button onClick={signOut} className="icon-btn" title="Sign Out" style={{ padding: '0.4rem' }}>
                <LogOut size={16} color="#94a3b8" />
              </button>
            </div>

            <button className="btn-primary" onClick={() => setMode('create')}>
              <Plus size={20} color="white" /> New Baby Camera
            </button>

            {savedRooms.length > 0 && (
              <>
                <p className="muted-text" style={{ marginTop: '1rem', fontSize: '0.8rem' }}>Your Saved Rooms</p>
                {savedRooms.map(r => (
                  <div key={r.code} style={{ display: 'flex', gap: '0.5rem', width: '100%' }}>
                    <button className="btn-secondary" onClick={() => startCameraMode(r.code, r.name)} style={{ flex: 1, justifyContent: 'space-between' }}>
                      <span>📷 {r.name || 'Baby Camera'}</span>
                      <span style={{ fontFamily: 'monospace', fontSize: '0.85rem', opacity: 0.6 }}>{r.code}</span>
                    </button>
                    <button className="icon-btn" onClick={(e) => { e.stopPropagation(); deleteRoom(r.code); }} title="Delete room" style={{ padding: '0.5rem', flexShrink: 0 }}>
                      <Trash2 size={14} color="#ef4444" />
                    </button>
                  </div>
                ))}
              </>
            )}

            <hr style={{ width: '100%', borderColor: 'var(--surface-hover)', margin: '1.25rem 0' }} />
            <button className="btn-secondary" onClick={goToMonitor}>
              <MonitorSmartphone size={20} color="#94a3b8" /> Join as Monitor (Parent)
            </button>
            {errorMsg && <p style={{ color: 'var(--error-color)', marginTop: '0.5rem' }}>{errorMsg}</p>}
          </div>
        ) : (
          <div className="flex-col" style={{ marginTop: '2rem' }}>
            <button className="btn-google" onClick={signIn}>
              <svg width="20" height="20" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
              Sign in with Google
            </button>
            <p className="muted-text" style={{ fontSize: '0.75rem', marginTop: '0.5rem' }}>Sign in to create baby cameras & save rooms</p>

            <hr style={{ width: '100%', borderColor: 'var(--surface-hover)', margin: '1.25rem 0' }} />
            <p className="muted-text" style={{ fontSize: '0.85rem' }}>Or join as a guest parent</p>
            <input
              type="text" placeholder="Your Name (e.g. Mom)"
              value={userName} onChange={e => setUserName(e.target.value)}
              style={{ textTransform: 'none', letterSpacing: 'normal' }}
            />
            <button className="btn-secondary" onClick={goToMonitor}>
              <MonitorSmartphone size={20} color="#94a3b8" /> Join Room as Guest
            </button>
            {errorMsg && <p style={{ color: 'var(--error-color)', marginTop: '0.5rem' }}>{errorMsg}</p>}

            <hr style={{ width: '100%', borderColor: 'var(--surface-hover)', margin: '1.25rem 0' }} />
            <details style={{ width: '100%', textAlign: 'left' }}>
              <summary className="muted-text" style={{ cursor: 'pointer', fontSize: '0.75rem', textAlign: 'center' }}>Dev / Email Login</summary>
              <div className="flex-col" style={{ marginTop: '0.5rem' }}>
                <input type="email" placeholder="Email" value={devEmail} onChange={e => setDevEmail(e.target.value)}
                  style={{ textTransform: 'none', letterSpacing: 'normal', fontSize: '0.9rem', padding: '0.7rem' }} />
                <input type="password" placeholder="Password" value={devPassword} onChange={e => setDevPassword(e.target.value)}
                  style={{ textTransform: 'none', letterSpacing: 'normal', fontSize: '0.9rem', padding: '0.7rem' }} />
                <button className="btn-secondary" onClick={async () => {
                  try {
                    setErrorMsg('');
                    await emailSignIn(devEmail, devPassword);
                  } catch (e) {
                    setErrorMsg(e.message || 'Login failed');
                  }
                }} style={{ fontSize: '0.85rem', padding: '0.6rem' }}>Sign In / Sign Up</button>
              </div>
            </details>
          </div>
        )}
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
            <div className="pulsing-dot" style={{ backgroundColor: status === 'reconnecting' ? '#f59e0b' : status === 'disconnected' ? '#ef4444' : allPeerList.length > 0 ? '#22c55e' : '#ef4444' }} />
            {status === 'reconnecting' ? `Reconnecting (${reconnectAttempt}/${MAX_RECONNECT})...` :
             status === 'disconnected' ? 'Disconnected' :
             `${allPeerList.length} Parent(s) Connected`}
          </div>
          {(status === 'waiting' || status === 'reconnecting') && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span className="muted-text" style={{ fontSize: '0.85rem' }}>Code:</span>
              <div className="room-code" style={{ fontSize: '1.2rem', padding: '0.3rem 0.8rem' }}>{roomCode}</div>
            </div>
          )}
          {status === 'disconnected' && (
            <button className="btn-primary" onClick={manualRetry} style={{ padding: '0.4rem 1rem', fontSize: '0.85rem' }}>Retry</button>
          )}
          <button className="btn-danger" onClick={stopEverything} style={{ padding: '0.5rem 1rem' }}>
            <PhoneOff size={16} color="white" /> Stop
          </button>
        </div>
        <div className="main-content">
          <div className="video-section">
            <div className="primary-video" style={{ position: 'relative' }}>
              {localStream && <VideoPlayer stream={localStream} isLocal label={`👶 ${roomDisplayName}`} initiallyMuted />}
              {isCrying && (
                <div style={{ position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)', backgroundColor: 'var(--error-color)', color: 'white', padding: '0.2rem 1rem', borderRadius: '12px', fontWeight: 'bold', fontSize: '0.85rem', zIndex: 10, animation: 'pulse-red 1s infinite alternate' }}>
                  Baby is Crying!
                </div>
              )}
            </div>
            
            <div style={{ backgroundColor: 'rgba(0,0,0,0.2)', padding: '0.8rem', borderRadius: '12px', marginTop: '1rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <span className="muted-text" style={{ fontSize: '0.85rem', whiteSpace: 'nowrap' }}>Cry Alert Sensitivity:</span>
              <input type="range" min="10" max="90" value={cryThreshold} onChange={(e) => setCryThreshold(parseInt(e.target.value))} style={{ flex: 1, accentColor: 'var(--primary-color)' }} />
              <span className="muted-text" style={{ fontSize: '0.85rem', minWidth: '30px' }}>{cryThreshold}%</span>
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
          <div className="pulsing-dot" style={{ backgroundColor: status === 'reconnecting' ? '#f59e0b' : status === 'disconnected' ? '#ef4444' : hostPeerEntry ? '#22c55e' : '#f59e0b' }} />
          {status === 'reconnecting' ? `Reconnecting (${reconnectAttempt}/${MAX_RECONNECT})...` :
           status === 'disconnected' ? 'Disconnected' :
           hostPeerEntry ? 'Baby Connected' : 'Waiting for Baby...'}
        </div>
        {status === 'disconnected' && (
          <button className="btn-primary" onClick={manualRetry} style={{ padding: '0.4rem 1rem', fontSize: '0.85rem' }}>Retry</button>
        )}
        <div className="media-toggles">
          <button className={`icon-btn ${micOn ? 'active' : ''}`} title={micOn ? 'Mute Mic' : 'Unmute Mic'} onClick={toggleMic}>
            <span style={{fontSize: '18px', lineHeight: 1}}>{micOn ? '🎙️' : '🔇'}</span>
          </button>
          <button className={`icon-btn ${camOn ? 'active' : ''}`} title={camOn ? 'Turn Off Camera' : 'Turn On Camera'} onClick={toggleCam}>
            <span style={{fontSize: '18px', lineHeight: 1}}>{camOn ? '📷' : '📵'}</span>
          </button>
          <button className={`icon-btn ${nightVision ? 'active' : ''}`} title={nightVision ? 'Turn Off Night Vision' : 'Turn On Night Vision'} onClick={() => setNightVision(!nightVision)}>
            <span style={{fontSize: '18px', lineHeight: 1}}>{nightVision ? '🌞' : '🌙'}</span>
          </button>
        </div>
        <button className="btn-danger" onClick={stopEverything} style={{ padding: '0.5rem 1rem' }}>
          <PhoneOff size={16} color="white" /> Leave
        </button>
      </div>
      <div className={`main-content ${babyCrying ? 'cry-alert' : ''}`} style={{ borderRadius: '12px', transition: 'box-shadow 0.3s' }}>
        <div className="video-section">
          <div className="primary-video" style={{ position: 'relative' }}>
            {hostPeerEntry ? (
              <VideoPlayer stream={hostPeerEntry[1].stream} label={`👶 ${hostPeerEntry[1].name || 'Baby Camera'}`} initiallyMuted={false} nightVision={nightVision} />
            ) : (
              <div className="video-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '250px' }}>
                <p className="muted-text">Waiting for baby's video...</p>
              </div>
            )}
            {babyCrying && (
              <div style={{ position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)', backgroundColor: 'var(--error-color)', color: 'white', padding: '0.4rem 1.5rem', borderRadius: '20px', fontWeight: 'bold', fontSize: '1.2rem', zIndex: 10, boxShadow: '0 4px 6px rgba(0,0,0,0.3)' }}>
                ⚠️ Baby is Crying!
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
