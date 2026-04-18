import { useState, useEffect, useRef, useCallback } from 'react';
import { database, ensureAuthenticated } from './firebase';
import {
  ref, set, onValue, onDisconnect, push, remove
} from 'firebase/database';

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ]
};

export function useFirebaseWebRTC(roomCode, userName, isHost, localStream) {
  const [peers, setPeers] = useState({});
  const [chatMessages, setChatMessages] = useState([]);
  const [status, setStatus] = useState('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const myUidRef = useRef(null);
  const pcsRef = useRef({});          // peerUid -> RTCPeerConnection
  const localStreamRef = useRef(localStream);
  const unsubsRef = useRef([]);
  const roomCodeRef = useRef(roomCode);
  const userNameRef = useRef(userName);

  useEffect(() => { localStreamRef.current = localStream; }, [localStream]);
  useEffect(() => { roomCodeRef.current = roomCode; }, [roomCode]);
  useEffect(() => { userNameRef.current = userName; }, [userName]);

  // ── Peer state helpers ───────────────────────────────────────────
  const setPeerInfo = (uid, patch) =>
    setPeers(prev => ({ ...prev, [uid]: { ...(prev[uid] || {}), ...patch } }));

  const removePeer = (uid) => {
    setPeers(prev => { const n = { ...prev }; delete n[uid]; return n; });
    if (pcsRef.current[uid]) {
      try { pcsRef.current[uid].close(); } catch (_) {}
      delete pcsRef.current[uid];
    }
  };

  const boostBitrate = (pc) => {
    try {
      const vs = pc.getSenders().find(s => s.track?.kind === 'video');
      if (!vs) return;
      const p = vs.getParameters();
      if (!p.encodings) p.encodings = [{}];
      p.encodings[0].maxBitrate = 2_500_000;
      vs.setParameters(p).catch(() => {});
    } catch (_) {}
  };

  // ── Create PeerConnection for a given remote uid ─────────────────
  const createPC = useCallback((peerUid) => {
    if (pcsRef.current[peerUid]) return pcsRef.current[peerUid]; // already exists

    const pc = new RTCPeerConnection(ICE_SERVERS);
    pcsRef.current[peerUid] = pc;

    // Add our local tracks
    const stream = localStreamRef.current;
    if (stream) stream.getTracks().forEach(t => pc.addTrack(t, stream));

    // Send ICE candidates to Firebase
    pc.onicecandidate = ({ candidate }) => {
      if (!candidate || !myUidRef.current) return;
      const code = roomCodeRef.current;
      push(ref(database, `rooms/${code}/signals/${peerUid}/${myUidRef.current}/ice`), candidate.toJSON());
    };

    // Receive remote stream
    pc.ontrack = (evt) => {
      console.log('[WebRTC] got track from', peerUid, evt.track.kind);
      setPeerInfo(peerUid, { stream: evt.streams[0] });
    };

    // Detect disconnect
    pc.onconnectionstatechange = () => {
      console.log('[WebRTC]', peerUid, 'connection state:', pc.connectionState);
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        removePeer(peerUid);
      }
    };

    return pc;
  }, []);

  // ── Signaling helpers ────────────────────────────────────────────
  const sendOffer = useCallback(async (peerUid) => {
    const code = roomCodeRef.current;
    const uid = myUidRef.current;
    if (!code || !uid) return;

    const pc = createPC(peerUid);
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await set(ref(database, `rooms/${code}/signals/${peerUid}/${uid}/offer`), {
        type: offer.type, sdp: offer.sdp
      });
      console.log('[WebRTC] sent offer to', peerUid);
      setTimeout(() => boostBitrate(pc), 2000);
    } catch (e) {
      console.error('[WebRTC] sendOffer error', e);
    }
  }, [createPC]);

  const handleOffer = useCallback(async (senderUid, offerData) => {
    const code = roomCodeRef.current;
    const uid = myUidRef.current;
    if (!code || !uid) return;

    console.log('[WebRTC] handling offer from', senderUid);
    const pc = createPC(senderUid);
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(offerData));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await set(ref(database, `rooms/${code}/signals/${senderUid}/${uid}/answer`), {
        type: answer.type, sdp: answer.sdp
      });
      console.log('[WebRTC] sent answer to', senderUid);
      setTimeout(() => boostBitrate(pc), 2000);
    } catch (e) {
      console.error('[WebRTC] handleOffer error', e);
    }
  }, [createPC]);

  const handleAnswer = useCallback(async (senderUid, answerData) => {
    const pc = pcsRef.current[senderUid];
    if (!pc) return;
    console.log('[WebRTC] handling answer from', senderUid, 'state:', pc.signalingState);
    try {
      if (pc.signalingState === 'have-local-offer') {
        await pc.setRemoteDescription(new RTCSessionDescription(answerData));
      }
    } catch (e) {
      console.error('[WebRTC] handleAnswer error', e);
    }
  }, []);

  const handleIce = useCallback(async (senderUid, iceObj) => {
    const pc = pcsRef.current[senderUid];
    if (!pc) return;
    for (const cand of Object.values(iceObj)) {
      try { await pc.addIceCandidate(new RTCIceCandidate(cand)); }
      catch (e) { console.warn('ICE cand error', e); }
    }
  }, []);

  // ── Main init ────────────────────────────────────────────────────
  useEffect(() => {
    if (!roomCode) return;

    let active = true;
    const unsubs = [];

    (async () => {
      try {
        setStatus('connecting');
        const user = await ensureAuthenticated();
        if (!active) return;

        const uid = user.uid;
        myUidRef.current = uid;
        const code = roomCode;

        // Write presence + onDisconnect cleanup
        const myPeerRef = ref(database, `rooms/${code}/peers/${uid}`);
        await set(myPeerRef, { name: userName, isHost, uid, ts: Date.now() });
        await onDisconnect(myPeerRef).remove();

        if (isHost) {
          await set(ref(database, `rooms/${code}/hostUid`), uid);
          await onDisconnect(ref(database, `rooms/${code}/hostUid`)).remove();
        }

        setStatus(isHost ? 'waiting' : 'connected');

        // ── Watch peer list ────────────────────────────────────────
        const peersListRef = ref(database, `rooms/${code}/peers`);
        unsubs.push(onValue(peersListRef, async (snap) => {
          if (!snap.exists()) return;
          const all = snap.val(); // { uid: { name, isHost, uid, ts } }

          // Update peer info in state (for name/count display)
          Object.entries(all).forEach(([peerUid, info]) => {
            if (peerUid === uid) return;
            setPeerInfo(peerUid, { name: info.name, isHost: info.isHost });
          });

          // Remove peers that disappeared
          setPeers(prev => {
            const next = { ...prev };
            let changed = false;
            Object.keys(prev).forEach(peerUid => {
              if (!all[peerUid]) {
                removePeer(peerUid);
                delete next[peerUid];
                changed = true;
              }
            });
            return changed ? next : prev;
          });

          // Decide who sends the offer to avoid glare:
          // RULE: The participant with the LARGER uid string sends the offer.
          // Exception: the host (baby) ALWAYS sends offers (to parents).
          Object.keys(all).forEach(peerUid => {
            if (peerUid === uid) return;
            if (pcsRef.current[peerUid]) return; // already have a connection

            const shouldOffer = isHost
              ? !all[peerUid].isHost          // host offers to all non-hosts (parents)
              : uid > peerUid && !all[peerUid].isHost; // parent offers to other parents with lower uid

            if (shouldOffer) {
              console.log('[App] initiating offer to', peerUid);
              sendOffer(peerUid);
            }
          });
        }));

        // ── Watch signals directed at me ───────────────────────────
        const mySignalsRef = ref(database, `rooms/${code}/signals/${uid}`);
        unsubs.push(onValue(mySignalsRef, async (snap) => {
          if (!snap.exists()) return;
          const signals = snap.val(); // { senderUid: { offer?, answer?, ice? } }

          for (const [senderUid, data] of Object.entries(signals)) {
            if (data.offer) {
              await handleOffer(senderUid, data.offer);
              remove(ref(database, `rooms/${code}/signals/${uid}/${senderUid}/offer`));
            }
            if (data.answer) {
              await handleAnswer(senderUid, data.answer);
              remove(ref(database, `rooms/${code}/signals/${uid}/${senderUid}/answer`));
            }
            if (data.ice) {
              await handleIce(senderUid, data.ice);
              remove(ref(database, `rooms/${code}/signals/${uid}/${senderUid}/ice`));
            }
          }
        }));

        // ── Watch chat ─────────────────────────────────────────────
        const chatRef = ref(database, `rooms/${code}/chat`);
        unsubs.push(onValue(chatRef, (snap) => {
          if (!snap.exists()) { setChatMessages([]); return; }
          const msgs = [];
          snap.forEach(child => {
            const d = child.val();
            msgs.push({ ...d, mine: d.senderId === uid });
          });
          setChatMessages(msgs);
        }));

      } catch (e) {
        console.error('[Firebase init error]', e);
        if (active) {
          setErrorMsg('Connection failed: ' + (e.message || String(e)));
          setStatus('error');
        }
      }
    })();

    unsubsRef.current = unsubs;

    return () => {
      active = false;
      unsubs.forEach(fn => { try { fn(); } catch (_) {} });
      // Remove presence
      const uid = myUidRef.current;
      if (uid && roomCode) {
        remove(ref(database, `rooms/${roomCode}/peers/${uid}`)).catch(() => {});
        remove(ref(database, `rooms/${roomCode}/signals/${uid}`)).catch(() => {});
      }
      Object.values(pcsRef.current).forEach(pc => { try { pc.close(); } catch (_) {} });
      pcsRef.current = {};
    };
  }, [roomCode]); // Re-runs only when roomCode changes

  // ── When localStream changes, replace/add tracks on all PCs ─────
  useEffect(() => {
    if (!localStream) return;
    Object.values(pcsRef.current).forEach(pc => {
      localStream.getTracks().forEach(track => {
        const sender = pc.getSenders().find(s => s.track?.kind === track.kind);
        if (sender) sender.replaceTrack(track).catch(console.error);
        else pc.addTrack(track, localStream);
      });
    });
  }, [localStream]);

  // ── Send chat ────────────────────────────────────────────────────
  const sendChat = useCallback(async (text) => {
    if (!roomCode || !myUidRef.current) return;
    await push(ref(database, `rooms/${roomCode}/chat`), {
      senderId: myUidRef.current,
      sender: userNameRef.current,
      text,
      time: new Date().toLocaleTimeString(),
      ts: Date.now(),
    });
  }, [roomCode]);

  // ── Leave ────────────────────────────────────────────────────────
  const leaveRoom = useCallback(async () => {
    unsubsRef.current.forEach(fn => { try { fn(); } catch (_) {} });
    unsubsRef.current = [];
    const uid = myUidRef.current;
    if (uid && roomCode) {
      await remove(ref(database, `rooms/${roomCode}/peers/${uid}`)).catch(() => {});
      await remove(ref(database, `rooms/${roomCode}/signals/${uid}`)).catch(() => {});
    }
    Object.values(pcsRef.current).forEach(pc => { try { pc.close(); } catch (_) {} });
    pcsRef.current = {};
    myUidRef.current = null;
    setPeers({});
    setChatMessages([]);
    setStatus('idle');
  }, [roomCode]);

  return { peers, chatMessages, status, errorMsg, sendChat, leaveRoom };
}
