import { useEffect, useRef, useState } from 'react';

export default function VideoPlayer({ stream, isLocal, label, initiallyMuted, nightVision }) {
  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const [muted, setMuted] = useState(!!initiallyMuted);
  const [needsTap, setNeedsTap] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream || video.srcObject === stream) return;

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
          <button className="btn-primary">Play video</button>
        </div>
      )}
      <div className="video-controls">
        <span className="video-name">{label}</span>
        <div className="video-actions">
          {!isLocal && (
            <button className="icon-btn" onClick={() => setMuted((value) => !value)} title={muted ? 'Unmute' : 'Mute'}>
              <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>{muted ? 'volume_off' : 'volume_up'}</span>
            </button>
          )}
          <button className="icon-btn" onClick={toggleFullscreen} title="Fullscreen">
            <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>fullscreen</span>
          </button>
        </div>
      </div>
    </div>
  );
}
