import React from 'react';
import { MonitorSmartphone } from 'lucide-react';

export default function JoinRoomScreen({
  userName,
  inputCode,
  setInputCode,
  errorMsg,
  status,
  onBack,
  onConnect
}) {
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
        <button className="btn-secondary" onClick={onBack}>Back</button>
        <button className="btn-primary" onClick={onConnect} disabled={status === 'connecting'}>
          {status === 'connecting' ? 'Connecting...' : 'Connect'}
        </button>
      </div>
    </div>
  );
}
