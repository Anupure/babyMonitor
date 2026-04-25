import React, { useState, useEffect } from 'react';
import { PhoneOff } from 'lucide-react';
import VideoPlayer from '../VideoPlayer';
import ChatPanel from '../ChatPanel';

export default function MonitorScreen({
  status,
  reconnectAttempt,
  MAX_RECONNECT,
  hostPeerEntry,
  otherParentPeers,
  manualRetry,
  micOn,
  toggleMic,
  camOn,
  toggleCam,
  nightVision,
  toggleNightVision,
  stopEverything,
  babyCrying,
  localStream,
  userName,
  chatMessages,
  sendChat
}) {
  const [notificationState, setNotificationState] = useState(
    !('Notification' in window) ? 'unsupported' : Notification.permission
  );

  const requestNotification = () => {
    if ('Notification' in window) {
      Notification.requestPermission().then(perm => setNotificationState(perm));
    }
  };

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
          <button className={`icon-btn ${nightVision ? 'active' : ''}`} title={nightVision ? 'Turn Off Night Vision' : 'Turn On Night Vision'} onClick={toggleNightVision}>
            <span style={{fontSize: '18px', lineHeight: 1}}>{nightVision ? '🌞' : '🌙'}</span>
          </button>
        </div>
        <button className="btn-danger" onClick={stopEverything} style={{ padding: '0.5rem 1rem' }}>
          <PhoneOff size={16} color="white" /> Leave
        </button>
      </div>
      
      {notificationState !== 'granted' && (
        <div className="warning-banner">
          <div>
            <strong>Warning:</strong> Notifications are {notificationState === 'unsupported' ? 'not supported in your browser. On iPhone, tap Share and "Add to Home Screen" to enable alerts.' : 'disabled on this device. You won't receive background alerts if the baby cries.'}
          </div>
          {notificationState === 'default' && (
            <button className="btn-primary" onClick={requestNotification} style={{ padding: '0.4rem 1rem', fontSize: '0.85rem', marginLeft: '1rem', whiteSpace: 'nowrap' }}>
              Enable Alerts
            </button>
          )}
        </div>
      )}

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
