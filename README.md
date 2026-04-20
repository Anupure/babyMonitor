# Baby Monitor

A Vite + React web baby monitor that lets one device stream as the baby camera and one or more parent devices join by room code.

## Features

- Baby camera mode with camera and microphone streaming
- Parent monitor mode with room-code join
- Peer-to-peer audio/video through PeerJS and WebRTC
- Firebase Authentication with Google, email/password, and anonymous guest access
- Firebase Realtime Database chat, room saves, and presence
- Multi-parent sessions
- Parent mic/camera talkback
- Audio-level cry alert with adjustable sensitivity
- Night-vision display filter on the monitor view
- Basic reconnect and heartbeat handling

## Tech Stack

- React 19
- Vite
- Firebase Auth
- Firebase Realtime Database
- PeerJS
- Lucide React

## Getting Started

Install dependencies:

```bash
npm install
```

Run the local development server:

```bash
npm run dev
```

Build for production:

```bash
npm run build
```

Run lint checks:

```bash
npm run lint
```

## Configuration

The app has fallback Firebase values in `src/firebase.js` so the current project can run as cloned. For your own Firebase project, copy `.env.example` to `.env.local` and fill in the `VITE_FIREBASE_*` values.

Firebase web config values are not secrets by themselves. Access control must be enforced with Firebase Auth providers and Realtime Database security rules.

## WebRTC Network Reliability

The default config uses public Google STUN servers. That works on many home/mobile networks, but some carrier, office, school, or restrictive Wi-Fi networks require a TURN relay.

Add TURN credentials through `VITE_ICE_SERVERS_JSON` when needed:

```bash
VITE_ICE_SERVERS_JSON=[{"urls":"stun:stun.l.google.com:19302"},{"urls":"turn:turn.example.com:3478","username":"user","credential":"pass"}]
```

## Firebase Data Paths

The active implementation uses these Realtime Database paths:

```text
users/{uid}/rooms/{roomCode}
rooms/{roomCode}/presence/{uid}
rooms/{roomCode}/chat
```

Suggested rules should require authentication for reads/writes, allow users to manage only their own saved rooms, and restrict room access to authenticated users. Guest parents sign in anonymously through Firebase.

## Manual Test Checklist

Use two browsers or two devices for the real-time checks:

1. Sign in with Google or email/password.
2. Create a baby camera room and grant camera/microphone permission.
3. Confirm the room code appears and the local baby video plays.
4. Join the room from another device as a parent guest.
5. Confirm the baby video/audio reaches the parent monitor.
6. Send chat messages both ways.
7. Toggle the parent microphone and camera.
8. Toggle night vision on the parent monitor.
9. Raise/lower cry sensitivity and verify the cry alert appears after sustained loud audio.
10. Stop/leave the room and confirm media tracks end and presence clears.
11. Reopen a saved room from the signed-in account.

## Notes

`src/App.jsx` owns the session flow and active PeerJS connection logic. `src/VideoPlayer.jsx`, `src/ChatPanel.jsx`, `src/AuthContext.jsx`, `src/firebase.js`, and `src/webrtcConfig.js` hold the reusable UI and platform setup around it.
