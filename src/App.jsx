import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from './useAuth';
import { useWebRTC } from './hooks/useWebRTC';
import { useAudioAnalyzer } from './hooks/useAudioAnalyzer';
import { useFirebaseRoom } from './hooks/useFirebaseRoom';
import { database } from './firebase';
import { ref, onValue } from 'firebase/database';

import LandingScreen from './components/LandingScreen';
import CreateRoomScreen from './components/CreateRoomScreen';
import JoinRoomScreen from './components/JoinRoomScreen';
import CameraScreen from './components/CameraScreen';
import MonitorScreen from './components/MonitorScreen';

import './index.css';

const generateRoomCode = () => Math.random().toString(36).substring(2, 6).toUpperCase();

export default function App() {
  const { user, loading, isSignedIn, signIn, emailSignIn, signOut } = useAuth();

  const [mode, setMode] = useState(null); // null | 'create' | 'camera' | 'monitor'
  const [userName, setUserName] = useState('');
  const [devEmail, setDevEmail] = useState('');
  const [devPassword, setDevPassword] = useState('');
  const [inputCode, setInputCode] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [newRoomName, setNewRoomName] = useState('');
  const [roomDisplayName, setRoomDisplayName] = useState('Baby Camera');
  const [savedRooms, setSavedRooms] = useState([]);
  
  const [localStream, setLocalStream] = useState(null);
  const [micOn, setMicOn] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [nightVision, setNightVision] = useState(false);
  
  const [cryThreshold, setCryThreshold] = useState(50);
  const [appError, setAppError] = useState('');

  const {
    peers,
    status: rtcStatus,
    errorMsg: rtcErrorMsg,
    reconnectAttempt,
    babyCrying,
    initPeer,
    stopPeer,
    callAllPeers,
    broadcastCryState,
    manualRetry,
    MAX_RECONNECT
  } = useWebRTC();

  const { initFirebase, sendChat, cleanupFirebase, saveRoom, deleteRoom, chatMessages } = useFirebaseRoom();

  const onCryStateChange = useCallback((isCrying) => {
    broadcastCryState(isCrying);
  }, [broadcastCryState]);

  const { isCrying, cleanupAudio } = useAudioAnalyzer(localStream, mode, cryThreshold, onCryStateChange);

  // Load saved rooms when signed in
  useEffect(() => {
    if (!isSignedIn || !user) return;
    setUserName(user.displayName || '');
    
    const roomsRef = ref(database, `users/${user.uid}/rooms`);
    const unsub = onValue(roomsRef, (snap) => {
      if (!snap.exists()) { setSavedRooms([]); return; }
      const rooms = [];
      snap.forEach(child => {
        rooms.push({ code: child.key, ...child.val() });
      });
      setSavedRooms(rooms);
    });
    return () => unsub();
  }, [isSignedIn, user]);

  const handleRoomDisconnect = useCallback(() => {
    // If the host disconnects, drop connection? (not fully implemented in original either)
  }, []);

  const startCameraMode = async (existingCode, roomName) => {
    const displayName = roomName || 'Baby Camera';
    setRoomDisplayName(displayName);
    setMode('camera');
    setAppError('');
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920, min: 1280 }, height: { ideal: 1080, min: 720 }, frameRate: { ideal: 30 } },
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
      setLocalStream(stream);
      setMicOn(true); setCamOn(true);

      const code = existingCode || generateRoomCode();
      setRoomCode(code);
      
      initPeer(code, true, displayName, stream);
      await initFirebase(code, displayName, true, handleRoomDisconnect);
      
      if (isSignedIn && user) {
        await saveRoom(user.uid, code, displayName);
      }
    } catch {
      setAppError('Could not access camera/mic. Please grant permissions.');
      setMode(null);
    }
  };

  const goToMonitor = async () => {
    if (!userName.trim()) { setAppError('Please enter your name.'); return; }
    
    if ('Notification' in window && Notification.permission === 'default') {
      try {
        await Notification.requestPermission();
      } catch (e) {
        console.warn('Failed to request notification permission', e);
      }
    }
    
    setAppError('');
    setMode('monitor');
  };

  useEffect(() => {
    if (babyCrying && mode === 'monitor') {
      if ('Notification' in window && Notification.permission === 'granted') {
        try {
          if ('serviceWorker' in navigator && navigator.serviceWorker.ready) {
            navigator.serviceWorker.ready.then(reg => {
              reg.showNotification('⚠️ Baby is Crying!', {
                body: `Loud noise detected in ${roomDisplayName || 'the baby room'}!`,
                icon: '/pwa-192x192.png',
                requireInteraction: true
              }).catch(() => {
                new Notification('⚠️ Baby is Crying!', { body: 'Loud noise detected!' });
              });
            });
          } else {
            new Notification('⚠️ Baby is Crying!', { body: 'Loud noise detected!' });
          }
        } catch (e) {
          console.error('Notification failed', e);
        }
      }
    }
  }, [babyCrying, mode, roomDisplayName]);

  const connectToRoom = async () => {
    const code = inputCode.trim().toUpperCase();
    if (code.length < 4) { setAppError('Enter a valid 4-character code.'); return; }
    setAppError('');
    setRoomCode(code);
    await initFirebase(code, userName.trim(), false, handleRoomDisconnect);
    initPeer(code, false, userName.trim(), localStream);
  };

  const toggleMic = async () => {
    if (!localStream) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
        setLocalStream(stream);
        setMicOn(true);
        callAllPeers(stream);
      } catch { alert('Cannot access microphone.'); }
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
      } catch { alert('Cannot access camera.'); }
    } else {
      if (localStream) localStream.getVideoTracks().forEach(t => { t.enabled = false; t.stop(); });
      setCamOn(false);
    }
  };

  const stopEverything = async () => {
    cleanupAudio();
    stopPeer();
    
    if (localStream) {
      localStream.getTracks().forEach(t => t.stop());
    }
    
    await cleanupFirebase(roomCode);
    setLocalStream(null);
    setAppError(''); setRoomCode(''); setInputCode('');
    setMicOn(false); setCamOn(false); setMode(null); setNewRoomName(''); setRoomDisplayName('Baby Camera');
  };

  useEffect(() => () => { stopEverything(); }, []);

  if (loading) {
    return <div className="card"><p className="muted-text">Loading...</p></div>;
  }

  const allPeerList = Object.entries(peers);
  const errorMsg = appError || rtcErrorMsg;

  if (mode === 'create') {
    return (
      <CreateRoomScreen 
        newRoomName={newRoomName}
        setNewRoomName={setNewRoomName}
        errorMsg={errorMsg}
        onBack={() => { setMode(null); setAppError(''); setNewRoomName(''); }}
        onStartCamera={(name) => {
          if (!name.trim()) { setAppError('Please enter a camera name.'); return; }
          setAppError('');
          startCameraMode(null, name.trim());
        }}
      />
    );
  }

  if (!mode) {
    return (
      <LandingScreen 
        user={user}
        isSignedIn={isSignedIn}
        signIn={signIn}
        emailSignIn={emailSignIn}
        signOut={signOut}
        savedRooms={savedRooms}
        onStartCameraMode={startCameraMode}
        onDeleteRoom={(code) => user && deleteRoom(user.uid, code)}
        onGoToCreateMode={() => setMode('create')}
        onGoToMonitorMode={goToMonitor}
        userName={userName}
        setUserName={setUserName}
        devEmail={devEmail}
        setDevEmail={setDevEmail}
        devPassword={devPassword}
        setDevPassword={setDevPassword}
        errorMsg={errorMsg}
        setErrorMsg={setAppError}
      />
    );
  }

  if (mode === 'monitor' && !roomCode) {
    return (
      <JoinRoomScreen 
        userName={userName}
        inputCode={inputCode}
        setInputCode={setInputCode}
        errorMsg={errorMsg}
        status={rtcStatus}
        onBack={stopEverything}
        onConnect={connectToRoom}
      />
    );
  }

  const handleSendChat = (text) => {
    const senderName = mode === 'camera' ? roomDisplayName : userName;
    sendChat(roomCode, text, senderName);
  };

  if (mode === 'camera') {
    return (
      <CameraScreen 
        status={rtcStatus}
        reconnectAttempt={reconnectAttempt}
        MAX_RECONNECT={MAX_RECONNECT}
        allPeerList={allPeerList}
        roomCode={roomCode}
        manualRetry={manualRetry}
        stopEverything={stopEverything}
        localStream={localStream}
        roomDisplayName={roomDisplayName}
        isCrying={isCrying}
        cryThreshold={cryThreshold}
        setCryThreshold={setCryThreshold}
        chatMessages={chatMessages}
        sendChat={handleSendChat}
      />
    );
  }

  const hostPeerEntry = allPeerList.find(([, d]) => d.isHost && d.stream);
  const otherParentPeers = allPeerList.filter(([, d]) => !d.isHost && d.stream);

  return (
    <MonitorScreen 
      status={rtcStatus}
      reconnectAttempt={reconnectAttempt}
      MAX_RECONNECT={MAX_RECONNECT}
      hostPeerEntry={hostPeerEntry}
      otherParentPeers={otherParentPeers}
      manualRetry={manualRetry}
      micOn={micOn}
      toggleMic={toggleMic}
      camOn={camOn}
      toggleCam={toggleCam}
      nightVision={nightVision}
      toggleNightVision={() => setNightVision(!nightVision)}
      stopEverything={stopEverything}
      babyCrying={babyCrying}
      localStream={localStream}
      userName={userName}
      chatMessages={chatMessages}
      sendChat={handleSendChat}
    />
  );
}
