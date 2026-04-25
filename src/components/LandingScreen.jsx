import React, { useState, useEffect } from 'react';
import { ref, onValue } from 'firebase/database';
import { database } from '../firebase';

export default function LandingScreen({ 
  user, 
  isSignedIn, 
  signIn, 
  emailSignIn, 
  signOut, 
  savedRooms, 
  onStartCameraMode, 
  onDeleteRoom, 
  onGoToCreateMode, 
  onGoToMonitorMode,
  userName,
  setUserName,
  devEmail,
  setDevEmail,
  devPassword,
  setDevPassword,
  errorMsg,
  setErrorMsg,
  onJoinSavedRoom
}) {
  const [activeRooms, setActiveRooms] = useState({});

  useEffect(() => {
    if (!savedRooms || savedRooms.length === 0) return;
    
    const unsubs = savedRooms.map(r => {
      const presenceRef = ref(database, `rooms/${r.code}/presence`);
      return onValue(presenceRef, (snap) => {
        let isActive = false;
        if (snap.exists()) {
          snap.forEach(child => {
            if (child.val().isHost) isActive = true;
          });
        }
        setActiveRooms(prev => ({ ...prev, [r.code]: isActive }));
      });
    });
    
    return () => unsubs.forEach(fn => fn());
  }, [savedRooms]);

  return (
    <div className="card">
      <span className="material-symbols-outlined icon-large" style={{ fontSize: '64px' }}>child_care</span>
      <h1>Baby Monitor</h1>
      <p className="muted-text">Secure, peer-to-peer baby monitoring.</p>

      {isSignedIn ? (
        <div className="flex-col" style={{ marginTop: '2rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', marginBottom: '0.5rem' }}>
            <span className="muted-text" style={{ fontSize: '0.85rem' }}>👋 {user.displayName}</span>
            <button onClick={signOut} className="icon-btn" title="Sign Out" style={{ padding: '0.4rem' }}>
              <span className="material-symbols-outlined" style={{ fontSize: '18px', color: '#94a3b8' }}>logout</span>
            </button>
          </div>

          <button className="btn-primary" onClick={onGoToCreateMode}>
            <span className="material-symbols-outlined">add</span> New Baby Camera
          </button>

          {savedRooms.length > 0 && (
            <>
              <p className="muted-text" style={{ marginTop: '1rem', fontSize: '0.8rem' }}>Your Saved Rooms</p>
              {savedRooms.map(r => {
                const isActive = activeRooms[r.code];
                return (
                  <div key={r.code} style={{ display: 'flex', gap: '0.5rem', width: '100%', marginBottom: '0.5rem' }}>
                    {isActive ? (
                      <button className="btn-secondary" style={{ flex: 1, justifyContent: 'space-between', opacity: 0.5, cursor: 'not-allowed' }} disabled>
                        <span>📷 {r.name || 'Baby Camera'}</span>
                        <span style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>Active Elsewhere</span>
                      </button>
                    ) : (
                      <button className="btn-secondary" onClick={() => onStartCameraMode(r.code, r.name)} style={{ flex: 1, justifyContent: 'space-between' }}>
                        <span>📷 {r.name || 'Baby Camera'}</span>
                        <span style={{ fontFamily: 'monospace', fontSize: '0.85rem', opacity: 0.6 }}>{r.code}</span>
                      </button>
                    )}
                    <button className="icon-btn" onClick={(e) => { e.stopPropagation(); onDeleteRoom(r.code); }} title="Delete room" style={{ padding: '0.5rem', flexShrink: 0 }}>
                      <span className="material-symbols-outlined" style={{ fontSize: '16px', color: '#ef4444' }}>delete</span>
                    </button>
                  </div>
                );
              })}
            </>
          )}

          <hr style={{ width: '100%', borderColor: 'var(--surface-hover)', margin: '1.25rem 0' }} />
          <button className="btn-secondary" onClick={onGoToMonitorMode}>
            <span className="material-symbols-outlined" style={{ color: '#94a3b8' }}>devices</span> Join as Monitor (Parent)
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
          <button className="btn-secondary" onClick={onGoToMonitorMode}>
            <span className="material-symbols-outlined" style={{ color: '#94a3b8' }}>devices</span> Join Room as Guest
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
