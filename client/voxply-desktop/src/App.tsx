// App.tsx — Root component
//
// React concepts for Blazor devs:
// - useState(initial) returns [value, setter] — private field + setter
// - useEffect(fn, [deps]) runs fn when deps change — like OnParametersSet
// - useRef(initial) persists a value across renders — like a field that doesn't trigger re-render
// - Event handlers use camelCase: onClick, onChange, onSubmit

import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";

interface Channel {
  id: string;
  name: string;
  created_by: string;
  parent_id: string | null;
  is_category: boolean;
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

  // Create channel dialog
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [newChannelName, setNewChannelName] = useState("");
  const [newChannelIsCategory, setNewChannelIsCategory] = useState(false);
  const [newChannelParentId, setNewChannelParentId] = useState<string | null>(null);

  // Context menu
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; channel: Channel } | null>(null);

  // Ref to the messages container for auto-scroll
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Ref to the currently selected channel ID (for the event listener closure).
  // Why a ref? Because event listeners capture the state at time of setup — using
  // a ref ensures we always read the latest value without re-registering the listener.
  const selectedChannelIdRef = useRef<string | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Keep the ref in sync with the state
  useEffect(() => {
    selectedChannelIdRef.current = selectedChannel?.id ?? null;
  }, [selectedChannel]);

  // Listen for real-time chat messages from the Rust backend.
  // This runs once when the component mounts.
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;

    (async () => {
      unlisten = await listen<{ channel_id: string; message: Message }>(
        "chat-message",
        (event) => {
          const { channel_id, message } = event.payload;
          // Only update if it's for the currently open channel
          if (channel_id === selectedChannelIdRef.current) {
            setMessages((prev) => {
              // Deduplicate — message might arrive via WS right after we sent it via HTTP
              if (prev.some((m) => m.id === message.id)) return prev;
              return [...prev, message];
            });
          }
        }
      );
    })();

    // Cleanup on unmount — like IDisposable in C#
    return () => {
      unlisten?.();
    };
  }, []);

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
    // Unsubscribe from previous channel's WS updates
    if (selectedChannel && selectedChannel.id !== channel.id) {
      await invoke("unsubscribe_channel", { channelId: selectedChannel.id });
    }

    setSelectedChannel(channel);
    setMessages([]);
    try {
      const msgs = await invoke<Message[]>("get_messages", {
        channelId: channel.id,
      });
      setMessages(msgs);

      // Subscribe to real-time updates for this channel
      await invoke("subscribe_channel", { channelId: channel.id });
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
      // Dedup: the WebSocket may have already added this message
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
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

  // Build a nested tree: categories contain their child channels.
  // Top-level = channels with no parent.
  function buildChannelTree(): { node: Channel; children: Channel[] }[] {
    const tree: { node: Channel; children: Channel[] }[] = [];
    const topLevel = channels.filter((c) => !c.parent_id);
    for (const ch of topLevel) {
      const children = channels.filter((c) => c.parent_id === ch.id);
      tree.push({ node: ch, children });
    }
    return tree;
  }

  async function handleCreateChannel() {
    const name = newChannelName.trim();
    if (!name) return;
    try {
      const channel = await invoke<Channel>("create_channel", {
        name,
        parentId: newChannelParentId,
        isCategory: newChannelIsCategory,
      });
      setChannels((prev) => [...prev, channel]);
      setNewChannelName("");
      setNewChannelIsCategory(false);
      setNewChannelParentId(null);
      setShowCreateChannel(false);
      if (!channel.is_category) {
        selectChannel(channel);
      }
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleDeleteChannel(channelId: string) {
    if (!confirm("Delete this channel? Messages will be lost.")) return;
    try {
      await invoke("delete_channel", { channelId });
      setChannels((prev) => prev.filter((c) => c.id !== channelId));
      if (selectedChannel?.id === channelId) {
        setSelectedChannel(null);
        setMessages([]);
      }
      setContextMenu(null);
    } catch (e) {
      setError(String(e));
    }
  }

  function openContextMenu(e: React.MouseEvent, channel: Channel) {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, channel });
  }

  function openCreateChannelUnder(parentId: string | null, isCategory: boolean) {
    setNewChannelParentId(parentId);
    setNewChannelIsCategory(isCategory);
    setShowCreateChannel(true);
    setContextMenu(null);
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
        <>
        <div className="main-layout">
          <div className="sidebar">
            <div className="sidebar-header">
              <h3>Channels</h3>
              <button
                className="btn-icon"
                onClick={() => openCreateChannelUnder(null, false)}
                title="Create channel"
              >
                +
              </button>
            </div>
            <ul className="channel-list">
              {buildChannelTree().map(({ node, children }) =>
                node.is_category ? (
                  <li key={node.id} className="category-group">
                    <div
                      className="category-header"
                      onContextMenu={(e) => openContextMenu(e, node)}
                    >
                      <span className="category-name">{node.name.toUpperCase()}</span>
                      <button
                        className="btn-icon-small"
                        onClick={() => openCreateChannelUnder(node.id, false)}
                        title="Add channel"
                      >
                        +
                      </button>
                    </div>
                    <ul className="channel-sublist">
                      {children.map((c) => (
                        <li
                          key={c.id}
                          className={`channel-item ${
                            selectedChannel?.id === c.id ? "selected" : ""
                          }`}
                          onClick={() => selectChannel(c)}
                          onContextMenu={(e) => openContextMenu(e, c)}
                        >
                          # {c.name}
                        </li>
                      ))}
                    </ul>
                  </li>
                ) : (
                  <li
                    key={node.id}
                    className={`channel-item ${
                      selectedChannel?.id === node.id ? "selected" : ""
                    }`}
                    onClick={() => selectChannel(node)}
                    onContextMenu={(e) => openContextMenu(e, node)}
                  >
                    # {node.name}
                  </li>
                )
              )}
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

        {showCreateChannel && (
          <div className="modal-overlay" onClick={() => setShowCreateChannel(false)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <h3>
                Create {newChannelIsCategory ? "Category" : "Channel"}
                {newChannelParentId && " (under category)"}
              </h3>
              <input
                type="text"
                value={newChannelName}
                onChange={(e) => setNewChannelName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateChannel();
                  if (e.key === "Escape") setShowCreateChannel(false);
                }}
                placeholder={newChannelIsCategory ? "category-name" : "channel-name"}
                autoFocus
              />
              {!newChannelParentId && (
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={newChannelIsCategory}
                    onChange={(e) => setNewChannelIsCategory(e.target.checked)}
                  />
                  Create as category (holds other channels)
                </label>
              )}
              <div className="modal-actions">
                <button onClick={() => setShowCreateChannel(false)} className="btn-secondary">
                  Cancel
                </button>
                <button onClick={handleCreateChannel}>Create</button>
              </div>
            </div>
          </div>
        )}

        {contextMenu && (
          <div
            className="context-menu-overlay"
            onClick={() => setContextMenu(null)}
            onContextMenu={(e) => { e.preventDefault(); setContextMenu(null); }}
          >
            <div
              className="context-menu"
              style={{ top: contextMenu.y, left: contextMenu.x }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                className="context-menu-item danger"
                onClick={() => handleDeleteChannel(contextMenu.channel.id)}
              >
                Delete {contextMenu.channel.is_category ? "category" : "channel"}
              </button>
            </div>
          </div>
        )}
        </>
      )}
    </div>
  );
}

export default App;
