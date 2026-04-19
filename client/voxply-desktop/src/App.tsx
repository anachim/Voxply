// App.tsx — Root component
//
// React concepts for Blazor devs:
// - useState(initial) returns [value, setter] — private field + setter
// - useEffect(fn, [deps]) runs fn when deps change — like OnParametersSet
// - useRef(initial) persists a value across renders — like a field that doesn't trigger re-render
// - Event handlers use camelCase: onClick, onChange, onSubmit

import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

interface Channel {
  id: string;
  name: string;
  created_by: string;
  created_at: number;
}

interface Message {
  id: string;
  channel_id: string;
  sender: string;
  sender_name: string | null;
  content: string;
  created_at: number;
}

function App() {
  // Connection state
  const [hubUrl, setHubUrl] = useState("http://localhost:3000");
  const [connected, setConnected] = useState(false);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Chat state
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");

  // Ref to the messages container for auto-scroll
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when messages change.
  // useEffect runs after render. Deps array [messages] means "run when messages changes".
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleConnect() {
    setLoading(true);
    setError(null);
    try {
      const pubKey = await invoke<string>("connect", { hubUrl });
      setPublicKey(pubKey);
      const ch = await invoke<Channel[]>("list_channels");
      setChannels(ch);
      setConnected(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleDisconnect() {
    await invoke("disconnect");
    setConnected(false);
    setChannels([]);
    setMessages([]);
    setSelectedChannel(null);
    setPublicKey(null);
  }

  async function selectChannel(channel: Channel) {
    setSelectedChannel(channel);
    setMessages([]);
    try {
      const msgs = await invoke<Message[]>("get_messages", {
        channelId: channel.id,
      });
      setMessages(msgs);
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleSend() {
    if (!inputText.trim() || !selectedChannel) return;
    const content = inputText;
    setInputText("");
    try {
      const msg = await invoke<Message>("send_message", {
        channelId: selectedChannel.id,
        content,
      });
      // Append to local state (WebSocket would push updates from others too)
      setMessages((prev) => [...prev, msg]);
    } catch (e) {
      setError(String(e));
    }
  }

  // Handle Enter key in input
  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="app">
      {!connected ? (
        <div className="connect-screen">
          <h1>Voxply</h1>
          <p>Decentralized voice chat + community platform</p>
          <div className="connect-form">
            <input
              type="text"
              value={hubUrl}
              onChange={(e) => setHubUrl(e.target.value)}
              placeholder="Hub URL"
              disabled={loading}
            />
            <button onClick={handleConnect} disabled={loading}>
              {loading ? "Connecting..." : "Connect"}
            </button>
          </div>
          {error && <div className="error">{error}</div>}
        </div>
      ) : (
        <div className="main-layout">
          <div className="sidebar">
            <h3>Channels</h3>
            <ul className="channel-list">
              {channels.map((c) => (
                <li
                  key={c.id}
                  className={`channel-item ${
                    selectedChannel?.id === c.id ? "selected" : ""
                  }`}
                  onClick={() => selectChannel(c)}
                >
                  # {c.name}
                </li>
              ))}
            </ul>
            {channels.length === 0 && (
              <p className="muted">No channels yet</p>
            )}
            <div className="user-info">
              <p className="muted">You: {publicKey?.slice(0, 16)}...</p>
              <button onClick={handleDisconnect} className="btn-small">
                Disconnect
              </button>
            </div>
          </div>

          <div className="content">
            {selectedChannel ? (
              <>
                <div className="channel-header">
                  <h3># {selectedChannel.name}</h3>
                </div>
                <div className="messages">
                  {messages.map((m) => (
                    <div key={m.id} className="message">
                      <span className="message-sender">
                        {m.sender_name || m.sender.slice(0, 16)}
                      </span>
                      <span className="message-content">{m.content}</span>
                    </div>
                  ))}
                  <div ref={messagesEndRef} />
                </div>
                <div className="input-area">
                  <input
                    type="text"
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={`Message #${selectedChannel.name}`}
                  />
                  <button onClick={handleSend}>Send</button>
                </div>
              </>
            ) : (
              <div className="no-channel">
                <p>Select a channel to start chatting</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
