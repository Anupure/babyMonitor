import React from 'react';
import { Camera, ArrowLeft } from 'lucide-react';

export default function CreateRoomScreen({ 
  newRoomName, 
  setNewRoomName, 
  errorMsg, 
  onBack, 
  onStartCamera 
}) {
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
        <button className="btn-secondary" onClick={onBack}>
          <ArrowLeft size={16} /> Back
        </button>
        <button className="btn-primary" onClick={() => onStartCamera(newRoomName)}>
          <Camera size={16} color="white" /> Start Camera
        </button>
      </div>
    </div>
  );
}
