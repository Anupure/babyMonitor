import { useEffect, useRef, useState } from 'react';
import { Maximize2, Volume2, VolumeX } from 'lucide-react';

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
              {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
            </button>
          )}
          <button className="icon-btn" onClick={toggleFullscreen} title="Fullscreen">
            <Maximize2 size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
