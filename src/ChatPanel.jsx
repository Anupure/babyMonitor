import { useEffect, useRef, useState } from 'react';
import { Send } from 'lucide-react';

export default function ChatPanel({ messages, onSend }) {
  const [text, setText] = useState('');
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const submit = (event) => {
    event.preventDefault();
    const message = text.trim();
    if (!message) return;

    onSend(message);
    setText('');
  };

  return (
    <div className="chat-container">
      <div className="chat-messages">
        {messages.length === 0 && <p className="muted-text chat-empty">No messages yet</p>}
        {messages.map((message, index) => (
          <div key={`${message.ts || index}-${message.senderId || message.sender}`} className={`chat-message ${message.mine ? 'chat-mine' : ''}`}>
            <span className="chat-sender">
              {message.sender} <span className="chat-time">{message.time}</span>
            </span>
            <span className="chat-text">{message.text}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <form className="chat-input-form" onSubmit={submit}>
        <input
          type="text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Type a message..."
          className="chat-input"
        />
        <button type="submit" className="btn-primary chat-send-button">
          <Send size={18} color="white" />
        </button>
      </form>
    </div>
  );
}
