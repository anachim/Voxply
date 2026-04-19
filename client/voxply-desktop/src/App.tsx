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

interface User {
  public_key: string;
  display_name: string | null;
  online: boolean;
}

interface VoiceParticipant {
  public_key: string;
  display_name: string | null;
}

interface Friend {
  public_key: string;
  display_name: string | null;
  since: number;
}

interface Conversation {
  id: string;
  conv_type: string;
  members: string[];
  created_at: number;
}

interface DmMessage {
  sender: string;
  sender_name: string | null;
  content: string;
  timestamp: number;
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

  // Hub users
  const [users, setUsers] = useState<User[]>([]);

  // Voice
  const [voiceChannelId, setVoiceChannelId] = useState<string | null>(null);
  const [voiceParticipants, setVoiceParticipants] = useState<VoiceParticipant[]>([]);

  // Settings
  const [showSettings, setShowSettings] = useState(false);
  const [settingsDisplayName, setSettingsDisplayName] = useState("");
  const [recoveryPhrase, setRecoveryPhrase] = useState<string | null>(null);

  // Friends
  const [showFriends, setShowFriends] = useState(false);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [pendingFriends, setPendingFriends] = useState<Friend[]>([]);
  const [friendRequestKey, setFriendRequestKey] = useState("");

  // DMs
  const [view, setView] = useState<"channels" | "dms">("channels");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [dmMessages, setDmMessages] = useState<Record<string, DmMessage[]>>({});
  const selectedConversationIdRef = useRef<string | null>(null);

  useEffect(() => {
    selectedConversationIdRef.current = selectedConversation?.id ?? null;
  }, [selectedConversation]);

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
    const unlistens: UnlistenFn[] = [];

    (async () => {
      unlistens.push(
        await listen<{ channel_id: string; message: Message }>(
          "chat-message",
          (event) => {
            const { channel_id, message } = event.payload;
            if (channel_id === selectedChannelIdRef.current) {
              setMessages((prev) => {
                if (prev.some((m) => m.id === message.id)) return prev;
                return [...prev, message];
              });
            }
          }
        )
      );

      unlistens.push(
        await listen<{
          channel_id: string;
          hub_udp_port: number;
          participants: VoiceParticipant[];
        }>("voice-joined", (event) => {
          setVoiceChannelId(event.payload.channel_id);
          setVoiceParticipants(event.payload.participants);
        })
      );

      unlistens.push(
        await listen<{ channel_id: string; participant: VoiceParticipant }>(
          "voice-participant-joined",
          (event) => {
            setVoiceParticipants((prev) => {
              if (prev.some((p) => p.public_key === event.payload.participant.public_key)) return prev;
              return [...prev, event.payload.participant];
            });
          }
        )
      );

      unlistens.push(
        await listen<{ channel_id: string; public_key: string }>(
          "voice-participant-left",
          (event) => {
            setVoiceParticipants((prev) =>
              prev.filter((p) => p.public_key !== event.payload.public_key)
            );
          }
        )
      );

      unlistens.push(
        await listen<DmMessage & { conversation_id: string }>("dm", (event) => {
          const { conversation_id, ...msg } = event.payload;
          setDmMessages((prev) => {
            const list = prev[conversation_id] || [];
            return { ...prev, [conversation_id]: [...list, msg] };
          });
        })
      );
    })();

    return () => {
      unlistens.forEach((u) => u());
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
      const u = await invoke<User[]>("list_users");
      setUsers(u);
      const c = await invoke<Conversation[]>("list_conversations");
      setConversations(c);
      setConnected(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  // Refresh users every 10 seconds while connected (cheap polling for online status)
  useEffect(() => {
    if (!connected) return;
    const interval = setInterval(async () => {
      try {
        const u = await invoke<User[]>("list_users");
        setUsers(u);
      } catch {}
    }, 10000);
    return () => clearInterval(interval);
  }, [connected]);

  async function handleDisconnect() {
    await invoke("disconnect");
    setConnected(false);
    setChannels([]);
    setMessages([]);
    setUsers([]);
    setSelectedChannel(null);
    setPublicKey(null);
    setVoiceChannelId(null);
    setVoiceParticipants([]);
    setConversations([]);
    setSelectedConversation(null);
    setDmMessages({});
    setView("channels");
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

  async function handleVoiceJoin() {
    if (!selectedChannel) return;
    try {
      await invoke("voice_join", { channelId: selectedChannel.id });
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleSaveDisplayName() {
    const name = settingsDisplayName.trim();
    if (!name) return;
    try {
      await invoke("update_display_name", { displayName: name });
      // Refresh user list to show new name
      const u = await invoke<User[]>("list_users");
      setUsers(u);
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleShowRecovery() {
    try {
      const phrase = await invoke<string>("get_recovery_phrase");
      setRecoveryPhrase(phrase);
    } catch (e) {
      setError(String(e));
    }
  }

  async function loadConversations() {
    try {
      const c = await invoke<Conversation[]>("list_conversations");
      setConversations(c);
    } catch (e) {
      setError(String(e));
    }
  }

  async function startDmWith(targetKey: string) {
    try {
      const conv = await invoke<Conversation>("create_conversation", {
        members: [targetKey],
      });
      // Make sure it's in the list
      setConversations((prev) => {
        if (prev.some((c) => c.id === conv.id)) return prev;
        return [...prev, conv];
      });
      setSelectedConversation(conv);
      setView("dms");
      setShowFriends(false);
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleSendDm() {
    if (!inputText.trim() || !selectedConversation) return;
    const content = inputText;
    setInputText("");
    try {
      await invoke("send_dm", {
        conversationId: selectedConversation.id,
        content,
      });
      // Optimistic local append
      setDmMessages((prev) => {
        const list = prev[selectedConversation.id] || [];
        return {
          ...prev,
          [selectedConversation.id]: [
            ...list,
            {
              sender: publicKey || "",
              sender_name: null,
              content,
              timestamp: Math.floor(Date.now() / 1000),
            },
          ],
        };
      });
    } catch (e) {
      setError(String(e));
    }
  }

  async function refreshFriends() {
    try {
      const f = await invoke<Friend[]>("list_friends");
      const p = await invoke<Friend[]>("list_pending_friends");
      setFriends(f);
      setPendingFriends(p);
    } catch (e) {
      setError(String(e));
    }
  }

  async function openFriends() {
    setShowFriends(true);
    await refreshFriends();
  }

  async function handleSendFriendRequest() {
    const key = friendRequestKey.trim();
    if (!key) return;
    try {
      await invoke("send_friend_request", { targetPublicKey: key });
      setFriendRequestKey("");
      await refreshFriends();
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleAcceptFriend(fromKey: string) {
    try {
      await invoke("accept_friend", { fromPublicKey: fromKey });
      await refreshFriends();
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleRemoveFriend(targetKey: string) {
    try {
      await invoke("remove_friend", { targetPublicKey: targetKey });
      await refreshFriends();
    } catch (e) {
      setError(String(e));
    }
  }

  function openSettings() {
    setShowSettings(true);
    setRecoveryPhrase(null);
    // Pre-fill with current display name if known
    const me = users.find((u) => u.public_key === publicKey);
    setSettingsDisplayName(me?.display_name || "");
  }

  async function handleVoiceLeave() {
    try {
      await invoke("voice_leave");
      setVoiceChannelId(null);
      setVoiceParticipants([]);
    } catch (e) {
      setError(String(e));
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
            <div className="view-tabs">
              <button
                className={`view-tab ${view === "channels" ? "active" : ""}`}
                onClick={() => setView("channels")}
              >
                Channels
              </button>
              <button
                className={`view-tab ${view === "dms" ? "active" : ""}`}
                onClick={() => {
                  setView("dms");
                  loadConversations();
                }}
              >
                DMs
                {conversations.length > 0 && (
                  <span className="badge">{conversations.length}</span>
                )}
              </button>
            </div>
            {view === "channels" ? (
              <>
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
              </>
            ) : (
              <>
                <div className="sidebar-header">
                  <h3>Direct Messages</h3>
                </div>
                <ul className="channel-list">
                  {conversations.map((c) => {
                    const others = c.members.filter((m) => m !== publicKey);
                    const label = others
                      .map((k) => {
                        const u = users.find((u) => u.public_key === k);
                        return u?.display_name || k.slice(0, 12);
                      })
                      .join(", ");
                    return (
                      <li
                        key={c.id}
                        className={`channel-item ${
                          selectedConversation?.id === c.id ? "selected" : ""
                        }`}
                        onClick={() => setSelectedConversation(c)}
                      >
                        @ {label || "(empty)"}
                      </li>
                    );
                  })}
                </ul>
                {conversations.length === 0 && (
                  <p className="muted">No conversations. Start one from your friends list.</p>
                )}
              </>
            )}
            <div className="user-info">
              {voiceChannelId && (
                <div className="voice-status">
                  <span className="status-dot online" />
                  <span>
                    In voice: #{channels.find((c) => c.id === voiceChannelId)?.name}
                  </span>
                  <button onClick={handleVoiceLeave} className="btn-small leave">
                    Leave
                  </button>
                </div>
              )}
              <p className="muted">You: {publicKey?.slice(0, 16)}...</p>
              <div className="user-info-buttons">
                <button onClick={openFriends} className="btn-small">
                  Friends
                </button>
                <button onClick={openSettings} className="btn-small">
                  Settings
                </button>
                <button onClick={handleDisconnect} className="btn-small btn-secondary-small">
                  Disconnect
                </button>
              </div>
            </div>
          </div>

          <div className="content">
            {view === "dms" ? (
              selectedConversation ? (
                <>
                  <div className="channel-header">
                    <h3>
                      @{" "}
                      {selectedConversation.members
                        .filter((m) => m !== publicKey)
                        .map((k) => {
                          const u = users.find((u) => u.public_key === k);
                          return u?.display_name || k.slice(0, 12);
                        })
                        .join(", ")}
                    </h3>
                  </div>
                  <div className="messages">
                    {(dmMessages[selectedConversation.id] || []).map((m, i) => (
                      <div key={i} className="message">
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
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          handleSendDm();
                        }
                      }}
                      placeholder="Send a message..."
                    />
                    <button onClick={handleSendDm}>Send</button>
                  </div>
                </>
              ) : (
                <div className="no-channel">
                  <p>Select a conversation</p>
                </div>
              )
            ) : selectedChannel ? (
              <>
                <div className="channel-header">
                  <h3># {selectedChannel.name}</h3>
                  {voiceChannelId === selectedChannel.id ? (
                    <button onClick={handleVoiceLeave} className="btn-voice leave">
                      🔇 Leave Voice
                    </button>
                  ) : (
                    <button
                      onClick={handleVoiceJoin}
                      className="btn-voice join"
                      disabled={voiceChannelId !== null}
                      title={voiceChannelId ? "Leave current voice channel first" : ""}
                    >
                      🎙️ Join Voice
                    </button>
                  )}
                </div>
                {voiceChannelId === selectedChannel.id && voiceParticipants.length > 0 && (
                  <div className="voice-participants">
                    <span className="muted">In voice: </span>
                    {voiceParticipants.map((p) => (
                      <span key={p.public_key} className="voice-participant">
                        🎙️ {p.display_name || p.public_key.slice(0, 16)}
                      </span>
                    ))}
                  </div>
                )}
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

          <div className="user-list-sidebar">
            <h3>Users — {users.length}</h3>
            <div className="user-section">
              <p className="user-section-title">Online — {users.filter((u) => u.online).length}</p>
              <ul className="user-list">
                {users.filter((u) => u.online).map((u) => (
                  <li key={u.public_key} className="user-list-item">
                    <span className="status-dot online" />
                    <span className="user-name">{u.display_name || u.public_key.slice(0, 16)}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="user-section">
              <p className="user-section-title">Offline — {users.filter((u) => !u.online).length}</p>
              <ul className="user-list">
                {users.filter((u) => !u.online).map((u) => (
                  <li key={u.public_key} className="user-list-item offline">
                    <span className="status-dot offline" />
                    <span className="user-name">{u.display_name || u.public_key.slice(0, 16)}</span>
                  </li>
                ))}
              </ul>
            </div>
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

        {showFriends && (
          <div className="modal-overlay" onClick={() => setShowFriends(false)}>
            <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
              <h3>Friends</h3>

              <div className="settings-section">
                <label className="settings-label">Add friend</label>
                <div className="settings-row">
                  <input
                    type="text"
                    value={friendRequestKey}
                    onChange={(e) => setFriendRequestKey(e.target.value)}
                    placeholder="Public key (paste here)"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSendFriendRequest();
                    }}
                  />
                  <button onClick={handleSendFriendRequest}>Send</button>
                </div>
              </div>

              {pendingFriends.length > 0 && (
                <div className="settings-section">
                  <label className="settings-label">
                    Pending requests ({pendingFriends.length})
                  </label>
                  <ul className="friend-list">
                    {pendingFriends.map((f) => (
                      <li key={f.public_key} className="friend-item">
                        <span className="friend-name">
                          {f.display_name || f.public_key.slice(0, 16)}
                        </span>
                        <button onClick={() => handleAcceptFriend(f.public_key)}>
                          Accept
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="settings-section">
                <label className="settings-label">Friends ({friends.length})</label>
                {friends.length === 0 ? (
                  <p className="muted">No friends yet</p>
                ) : (
                  <ul className="friend-list">
                    {friends.map((f) => (
                      <li key={f.public_key} className="friend-item">
                        <span className="friend-name">
                          {f.display_name || f.public_key.slice(0, 16)}
                        </span>
                        <div style={{ display: "flex", gap: "6px" }}>
                          <button onClick={() => startDmWith(f.public_key)}>
                            Message
                          </button>
                          <button
                            onClick={() => handleRemoveFriend(f.public_key)}
                            className="btn-secondary"
                          >
                            Remove
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="modal-actions">
                <button onClick={() => setShowFriends(false)}>Close</button>
              </div>
            </div>
          </div>
        )}

        {showSettings && (
          <div className="modal-overlay" onClick={() => setShowSettings(false)}>
            <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
              <h3>Settings</h3>

              <div className="settings-section">
                <label className="settings-label">Display name</label>
                <div className="settings-row">
                  <input
                    type="text"
                    value={settingsDisplayName}
                    onChange={(e) => setSettingsDisplayName(e.target.value)}
                    placeholder="Your display name"
                  />
                  <button onClick={handleSaveDisplayName}>Save</button>
                </div>
              </div>

              <div className="settings-section">
                <label className="settings-label">Recovery phrase</label>
                <p className="muted">
                  24 words you can use to restore your identity. Write them down
                  and keep them safe — anyone with these words can impersonate you.
                </p>
                {recoveryPhrase ? (
                  <div className="recovery-phrase">{recoveryPhrase}</div>
                ) : (
                  <button onClick={handleShowRecovery} className="btn-secondary">
                    Reveal recovery phrase
                  </button>
                )}
              </div>

              <div className="settings-section">
                <label className="settings-label">Public key</label>
                <div className="public-key">{publicKey}</div>
              </div>

              <div className="modal-actions">
                <button onClick={() => setShowSettings(false)}>Close</button>
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
