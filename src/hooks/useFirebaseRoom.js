import { useState, useCallback, useRef } from 'react';
import { ref, set, onValue, onDisconnect, push, remove, update } from 'firebase/database';
import { database, ensureAuthenticated } from '../firebase';

export function useFirebaseRoom() {
  const [chatMessages, setChatMessages] = useState([]);
  const myFbUidRef = useRef(null);
  const fbUnsubsRef = useRef([]);

  const initFirebase = useCallback(async (code, name, isHost, onHostDisconnect) => {
    try {
      const user = await ensureAuthenticated();
      const uid = user.uid;
      myFbUidRef.current = uid;

      const myPresenceRef = ref(database, `rooms/${code}/presence/${uid}`);
      await set(myPresenceRef, { name, isHost, ts: Date.now() });
      await onDisconnect(myPresenceRef).remove();

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

      if (isHost && onHostDisconnect) {
        const presenceRef = ref(database, `rooms/${code}/presence`);
        const unsubPresence = onValue(presenceRef, (snap) => {
          if (!snap.exists()) onHostDisconnect();
        });
        fbUnsubsRef.current.push(unsubPresence);
      }
    } catch (e) {
      console.error('[Firebase]', e);
    }
  }, []);

  const sendChat = useCallback(async (roomCode, text, myName) => {
    if (!roomCode || !myFbUidRef.current) return;
    await push(ref(database, `rooms/${roomCode}/chat`), {
      senderId: myFbUidRef.current,
      sender: myName,
      text,
      time: new Date().toLocaleTimeString(),
      ts: Date.now(),
    });
  }, []);

  const cleanupFirebase = useCallback(async (roomCode) => {
    fbUnsubsRef.current.forEach(fn => { try { fn(); } catch { } });
    fbUnsubsRef.current = [];
    if (myFbUidRef.current && roomCode) {
      await remove(ref(database, `rooms/${roomCode}/presence/${myFbUidRef.current}`)).catch(() => {});
    }
    myFbUidRef.current = null;
    setChatMessages([]);
  }, []);

  const saveRoom = useCallback(async (uid, code, displayName) => {
    if (uid) {
      await update(ref(database, `users/${uid}/rooms`), {
        [code]: { name: displayName, createdAt: Date.now() }
      });
    }
  }, []);

  const deleteRoom = useCallback(async (uid, code) => {
    if (uid) {
      await remove(ref(database, `users/${uid}/rooms/${code}`)).catch(() => {});
    }
  }, []);

  return { initFirebase, sendChat, cleanupFirebase, saveRoom, deleteRoom, chatMessages };
}
