import React from 'react';
import VideoPlayer from '../VideoPlayer';
import ChatPanel from '../ChatPanel';

export default function CameraScreen({
  status,
  reconnectAttempt,
  MAX_RECONNECT,
  allPeerList,
  roomCode,
  manualRetry,
  stopEverything,
  localStream,
  roomDisplayName,
  isCrying,
  cryThreshold,
  setCryThreshold,
  chatMessages,
  sendChat
}) {
  const parentPeers = allPeerList.filter(([, d]) => d.stream);

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
          <span className="material-symbols-outlined" style={{ color: 'white', fontSize: '18px' }}>call_end</span> Stop
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
