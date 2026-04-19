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
import {
  DndContext,
  DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface Channel {
  id: string;
  name: string;
  created_by: string;
  parent_id: string | null;
  is_category: boolean;
  display_order: number;
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

interface Hub {
  hub_id: string;
  hub_name: string;
  hub_url: string;
  is_active: boolean;
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

interface DmMessageFull {
  id: string;
  conversation_id: string;
  sender: string;
  sender_name: string | null;
  content: string;
  created_at: number;
}

function SortableChannelItem({
  channel,
  selected,
  onClick,
  onContextMenu,
}: {
  channel: Channel;
  selected: boolean;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: channel.id });

  return (
    <li
      ref={setNodeRef}
      className={`channel-item ${selected ? "selected" : ""} ${isDragging ? "dragging" : ""}`}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      onClick={onClick}
      onContextMenu={onContextMenu}
      {...attributes}
      {...listeners}
    >
      # {channel.name}
    </li>
  );
}

function SortableCategoryItem({
  channel,
  children,
  onContextMenu,
  onAddChannel,
}: {
  channel: Channel;
  children: React.ReactNode;
  onContextMenu: (e: React.MouseEvent) => void;
  onAddChannel: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: channel.id });

  return (
    <li
      ref={setNodeRef}
      className={`category-group ${isDragging ? "dragging" : ""}`}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
    >
      <div
        className="category-header"
        onContextMenu={onContextMenu}
        {...attributes}
        {...listeners}
      >
        <span className="category-name">{channel.name.toUpperCase()}</span>
        <button
          className="btn-icon-small"
          onClick={(e) => { e.stopPropagation(); onAddChannel(); }}
          title="Add channel"
        >
          +
        </button>
      </div>
      {children}
    </li>
  );
}

function App() {
  // Multi-hub state
  const [hubs, setHubs] = useState<Hub[]>([]);
  const [activeHubId, setActiveHubId] = useState<string | null>(null);
  const [showAddHub, setShowAddHub] = useState(false);
  const [hubUrl, setHubUrl] = useState("http://localhost:3000");
  const [unreadByHub, setUnreadByHub] = useState<Record<string, number>>({});

  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const activeHubIdRef = useRef<string | null>(null);
  useEffect(() => {
    activeHubIdRef.current = activeHubId;
  }, [activeHubId]);

  const hasActiveHub = hubs.length > 0 && activeHubId !== null;

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
  const [speakingKeys, setSpeakingKeys] = useState<Set<string>>(new Set());

  // Settings
  const [showSettings, setShowSettings] = useState(false);
  const [settingsDisplayName, setSettingsDisplayName] = useState("");
  const [recoveryPhrase, setRecoveryPhrase] = useState<string | null>(null);

  // Voice settings
  const [audioInputs, setAudioInputs] = useState<string[]>([]);
  const [audioOutputs, setAudioOutputs] = useState<string[]>([]);
  const [voiceInputDevice, setVoiceInputDevice] = useState<string>("");
  const [voiceOutputDevice, setVoiceOutputDevice] = useState<string>("");
  const [vadThreshold, setVadThreshold] = useState<number>(0.02);
  const [micTesting, setMicTesting] = useState(false);

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

  // Auto-dismiss toast after 5 seconds
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

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
        await listen<{ hub_id: string; channel_id: string; message: Message }>(
          "chat-message",
          (event) => {
            const { hub_id, channel_id, message } = event.payload;
            const isActiveHub = hub_id === activeHubIdRef.current;
            const isActiveChannel =
              isActiveHub && channel_id === selectedChannelIdRef.current;

            if (isActiveChannel) {
              setMessages((prev) => {
                if (prev.some((m) => m.id === message.id)) return prev;
                return [...prev, message];
              });
            } else if (!isActiveHub) {
              // Unread bump: only for hubs the user isn't currently viewing
              setUnreadByHub((prev) => ({
                ...prev,
                [hub_id]: (prev[hub_id] || 0) + 1,
              }));
            }
          }
        )
      );

      unlistens.push(
        await listen<{
          hub_id: string;
          channel_id: string;
          hub_udp_port: number;
          participants: VoiceParticipant[];
        }>("voice-joined", (event) => {
          if (event.payload.hub_id !== activeHubIdRef.current) return;
          setVoiceChannelId(event.payload.channel_id);
          setVoiceParticipants(event.payload.participants);
        })
      );

      unlistens.push(
        await listen<{ hub_id: string; channel_id: string; participant: VoiceParticipant }>(
          "voice-participant-joined",
          (event) => {
            if (event.payload.hub_id !== activeHubIdRef.current) return;
            setVoiceParticipants((prev) => {
              if (prev.some((p) => p.public_key === event.payload.participant.public_key)) return prev;
              return [...prev, event.payload.participant];
            });
          }
        )
      );

      unlistens.push(
        await listen<{ hub_id: string; channel_id: string; public_key: string }>(
          "voice-participant-left",
          (event) => {
            if (event.payload.hub_id !== activeHubIdRef.current) return;
            setVoiceParticipants((prev) =>
              prev.filter((p) => p.public_key !== event.payload.public_key)
            );
            setSpeakingKeys((prev) => {
              if (!prev.has(event.payload.public_key)) return prev;
              const next = new Set(prev);
              next.delete(event.payload.public_key);
              return next;
            });
          }
        )
      );

      unlistens.push(
        await listen<{ hub_id: string; channel_id: string; public_key: string; speaking: boolean }>(
          "voice-participant-speaking",
          (event) => {
            if (event.payload.hub_id !== activeHubIdRef.current) return;
            setSpeakingKeys((prev) => {
              const next = new Set(prev);
              if (event.payload.speaking) next.add(event.payload.public_key);
              else next.delete(event.payload.public_key);
              return next;
            });
          }
        )
      );

      unlistens.push(
        await listen<DmMessage & { hub_id: string; conversation_id: string }>("dm", (event) => {
          if (event.payload.hub_id !== activeHubIdRef.current) return;
          const { conversation_id, hub_id: _, ...msg } = event.payload;
          setDmMessages((prev) => {
            const list = prev[conversation_id] || [];
            return { ...prev, [conversation_id]: [...list, msg] };
          });
        })
      );

      unlistens.push(
        await listen<{ hub_id: string; hub_name: string }>("hub-session-lost", async (event) => {
          const { hub_id, hub_name } = event.payload;
          setToast(`Disconnected from "${hub_name}" — you may have been banned or kicked`);
          try {
            await invoke("remove_hub", { hubId: hub_id });
            const remaining = await invoke<Hub[]>("list_hubs");
            setHubs(remaining);
            if (activeHubIdRef.current === hub_id) {
              setActiveHubId(remaining[0]?.hub_id ?? null);
            }
          } catch {}
        })
      );
    })();

    return () => {
      unlistens.forEach((u) => u());
    };
  }, []);

  async function loadHubData() {
    try {
      const ch = await invoke<Channel[]>("list_channels");
      setChannels(ch);
      const u = await invoke<User[]>("list_users");
      setUsers(u);
      const c = await invoke<Conversation[]>("list_conversations");
      setConversations(c);
      // Reset selection when switching hub
      setSelectedChannel(null);
      setSelectedConversation(null);
      setMessages([]);
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleAddHub() {
    setLoading(true);
    setError(null);
    try {
      const hub = await invoke<Hub>("add_hub", { hubUrl });
      const allHubs = await invoke<Hub[]>("list_hubs");
      setHubs(allHubs);
      // Get our public key (assuming it's the same identity for all hubs)
      if (!publicKey) {
        const phrase = await invoke<string>("get_recovery_phrase").catch(() => "");
        // We can't easily get the pub key — pull from /me of the new hub later
        setPublicKey(null);
      }
      // If this is the first hub, set it active
      if (!activeHubId) {
        setActiveHubId(hub.hub_id);
      }
      setShowAddHub(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleSwitchHub(hubId: string) {
    if (hubId === activeHubId) return;
    try {
      await invoke("set_active_hub", { hubId });
      setActiveHubId(hubId);
      setHubs((prev) =>
        prev.map((h) => ({ ...h, is_active: h.hub_id === hubId }))
      );
      setUnreadByHub((prev) => {
        if (!prev[hubId]) return prev;
        const next = { ...prev };
        delete next[hubId];
        return next;
      });
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleRemoveHub(hubId: string) {
    const hub = hubs.find((h) => h.hub_id === hubId);
    const name = hub?.hub_name ?? "this hub";
    if (!confirm(`Leave "${name}"?`)) return;
    try {
      await invoke("remove_hub", { hubId });
      const remaining = await invoke<Hub[]>("list_hubs");
      setHubs(remaining);
      if (activeHubId === hubId) {
        setActiveHubId(remaining[0]?.hub_id ?? null);
      }
      setUnreadByHub((prev) => {
        if (!prev[hubId]) return prev;
        const next = { ...prev };
        delete next[hubId];
        return next;
      });
    } catch (e) {
      setError(String(e));
    }
  }

  // Auto-connect saved hubs on app start
  useEffect(() => {
    (async () => {
      try {
        const allHubs = await invoke<Hub[]>("auto_connect_saved");
        if (allHubs.length > 0) {
          setHubs(allHubs);
          const active = allHubs.find((h) => h.is_active) ?? allHubs[0];
          setActiveHubId(active.hub_id);
        }
      } catch (e) {
        console.error("Auto-connect failed:", e);
      }
    })();
  }, []);

  // Reload data when switching hubs
  useEffect(() => {
    if (activeHubId) {
      loadHubData();
    }
  }, [activeHubId]);

  // Refresh users every 10 seconds for active hub
  useEffect(() => {
    if (!hasActiveHub) return;
    const interval = setInterval(async () => {
      try {
        const u = await invoke<User[]>("list_users");
        setUsers(u);
      } catch {}
    }, 10000);
    return () => clearInterval(interval);
  }, [hasActiveHub, activeHubId]);

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

  async function selectConversation(conv: Conversation) {
    setSelectedConversation(conv);
    try {
      const history = await invoke<DmMessageFull[]>("get_dm_messages", {
        conversationId: conv.id,
      });
      setDmMessages((prev) => ({
        ...prev,
        [conv.id]: history.map((m) => ({
          sender: m.sender,
          sender_name: m.sender_name,
          content: m.content,
          timestamp: m.created_at,
        })),
      }));
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
      await selectConversation(conv);
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

  async function openSettings() {
    setShowSettings(true);
    setRecoveryPhrase(null);
    // Pre-fill with current display name if known
    const me = users.find((u) => u.public_key === publicKey);
    setSettingsDisplayName(me?.display_name || "");

    // Load voice devices + stored settings
    try {
      const devices = await invoke<{ inputs: string[]; outputs: string[] }>(
        "list_audio_devices"
      );
      setAudioInputs(devices.inputs);
      setAudioOutputs(devices.outputs);

      const saved = await invoke<{
        input_device?: string;
        output_device?: string;
        vad_threshold?: number;
      }>("get_voice_settings");
      setVoiceInputDevice(saved.input_device || "");
      setVoiceOutputDevice(saved.output_device || "");
      setVadThreshold(saved.vad_threshold ?? 0.02);
    } catch (e) {
      console.error("Failed to load voice settings:", e);
    }
  }

  async function persistVoiceSettings(
    input: string,
    output: string,
    threshold: number
  ) {
    try {
      await invoke("save_voice_settings", {
        settings: {
          input_device: input || null,
          output_device: output || null,
          vad_threshold: threshold,
        },
      });
    } catch (e) {
      setError(String(e));
    }
  }

  async function toggleMicTest() {
    try {
      if (micTesting) {
        await invoke("mic_test_stop");
        setMicTesting(false);
      } else {
        await invoke("mic_test_start");
        setMicTesting(true);
      }
    } catch (e) {
      setError(String(e));
    }
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
  // Top-level = channels with no parent. Sorted by display_order.
  function buildChannelTree(): { node: Channel; children: Channel[] }[] {
    const sorted = [...channels].sort((a, b) => a.display_order - b.display_order);
    const tree: { node: Channel; children: Channel[] }[] = [];
    const topLevel = sorted.filter((c) => !c.parent_id);
    for (const ch of topLevel) {
      const children = sorted.filter((c) => c.parent_id === ch.id);
      tree.push({ node: ch, children });
    }
    return tree;
  }

  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const sorted = [...channels].sort((a, b) => a.display_order - b.display_order);
    const oldIndex = sorted.findIndex((c) => c.id === active.id);
    const newIndex = sorted.findIndex((c) => c.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const reordered = arrayMove(sorted, oldIndex, newIndex);

    // Update local state immediately
    const reIndexed = reordered.map((c, i) => ({ ...c, display_order: i }));
    setChannels(reIndexed);

    // Persist to hub
    try {
      await invoke("reorder_channels", {
        channelIds: reordered.map((c) => c.id),
      });
    } catch (e) {
      setError(String(e));
    }
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
      {toast && (
        <div className="toast" onClick={() => setToast(null)}>
          {toast}
        </div>
      )}
      <>
        <div className="main-layout">
          <div className="hub-sidebar">
            <button
              className={`hub-icon dm ${view === "dms" ? "active" : ""}`}
              onClick={() => {
                setView("dms");
                if (hasActiveHub) loadConversations();
              }}
              disabled={!hasActiveHub}
              title="Direct Messages"
            >
              @
            </button>
            <div className="hub-sidebar-divider" />
            {hubs.map((h) => {
              const unread = unreadByHub[h.hub_id] || 0;
              return (
                <button
                  key={h.hub_id}
                  className={`hub-icon ${h.hub_id === activeHubId && view === "channels" ? "active" : ""}`}
                  onClick={() => {
                    handleSwitchHub(h.hub_id);
                    setView("channels");
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    handleRemoveHub(h.hub_id);
                  }}
                  title={`${h.hub_name} (${h.hub_url})`}
                >
                  {h.hub_name.slice(0, 2).toUpperCase()}
                  {unread > 0 && (
                    <span className="hub-unread-badge">
                      {unread > 99 ? "99+" : unread}
                    </span>
                  )}
                </button>
              );
            })}
            <button
              className="hub-icon add"
              onClick={() => setShowAddHub(true)}
              title="Add hub"
            >
              +
            </button>
          </div>
          {!hasActiveHub ? (
            <div className="empty-state">
              <h1>Voxply</h1>
              <p>Decentralized voice chat + community platform</p>
              <button className="primary" onClick={() => setShowAddHub(true)}>
                Add a hub to get started
              </button>
            </div>
          ) : (
            <>
          <div className="sidebar">
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
            <DndContext sensors={dndSensors} onDragEnd={handleDragEnd}>
              <SortableContext
                items={buildChannelTree().map(({ node }) => node.id)}
                strategy={verticalListSortingStrategy}
              >
                <ul className="channel-list">
                  {buildChannelTree().map(({ node, children }) =>
                    node.is_category ? (
                      <SortableCategoryItem
                        key={node.id}
                        channel={node}
                        onContextMenu={(e) => openContextMenu(e, node)}
                        onAddChannel={() => openCreateChannelUnder(node.id, false)}
                      >
                        <SortableContext
                          items={children.map((c) => c.id)}
                          strategy={verticalListSortingStrategy}
                        >
                          <ul className="channel-sublist">
                            {children.map((c) => (
                              <SortableChannelItem
                                key={c.id}
                                channel={c}
                                selected={selectedChannel?.id === c.id}
                                onClick={() => selectChannel(c)}
                                onContextMenu={(e) => openContextMenu(e, c)}
                              />
                            ))}
                          </ul>
                        </SortableContext>
                      </SortableCategoryItem>
                    ) : (
                      <SortableChannelItem
                        key={node.id}
                        channel={node}
                        selected={selectedChannel?.id === node.id}
                        onClick={() => selectChannel(node)}
                        onContextMenu={(e) => openContextMenu(e, node)}
                      />
                    )
                  )}
                </ul>
              </SortableContext>
            </DndContext>
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
                        onClick={() => selectConversation(c)}
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
                    {voiceParticipants.map((p) => {
                      const isSpeaking = speakingKeys.has(p.public_key);
                      return (
                        <span
                          key={p.public_key}
                          className={`voice-participant ${isSpeaking ? "speaking" : ""}`}
                        >
                          🎙️ {p.display_name || p.public_key.slice(0, 16)}
                        </span>
                      );
                    })}
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
            </>
          )}
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

        {showAddHub && (
          <div className="modal-overlay" onClick={() => setShowAddHub(false)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <h3>Add Hub</h3>
              <input
                type="text"
                value={hubUrl}
                onChange={(e) => setHubUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAddHub();
                  if (e.key === "Escape") setShowAddHub(false);
                }}
                placeholder="http://hub-url:3000"
                autoFocus
              />
              <div className="modal-actions">
                <button onClick={() => setShowAddHub(false)} className="btn-secondary">
                  Cancel
                </button>
                <button onClick={handleAddHub} disabled={loading}>
                  {loading ? "Connecting..." : "Connect"}
                </button>
              </div>
              {error && <div className="error">{error}</div>}
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
                <label className="settings-label">Voice — microphone</label>
                <select
                  value={voiceInputDevice}
                  onChange={(e) => {
                    setVoiceInputDevice(e.target.value);
                    persistVoiceSettings(e.target.value, voiceOutputDevice, vadThreshold);
                  }}
                >
                  <option value="">System default</option>
                  {audioInputs.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>

              <div className="settings-section">
                <label className="settings-label">Voice — speaker</label>
                <select
                  value={voiceOutputDevice}
                  onChange={(e) => {
                    setVoiceOutputDevice(e.target.value);
                    persistVoiceSettings(voiceInputDevice, e.target.value, vadThreshold);
                  }}
                >
                  <option value="">System default</option>
                  {audioOutputs.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>

              <div className="settings-section">
                <label className="settings-label">
                  Mic sensitivity — threshold {vadThreshold.toFixed(3)}
                </label>
                <p className="muted">
                  Lower values trigger the speaking indicator more easily.
                  Changes apply on the next voice channel you join.
                </p>
                <input
                  type="range"
                  min={0.001}
                  max={0.2}
                  step={0.001}
                  value={vadThreshold}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setVadThreshold(v);
                    persistVoiceSettings(voiceInputDevice, voiceOutputDevice, v);
                  }}
                />
              </div>

              <div className="settings-section">
                <label className="settings-label">Microphone test</label>
                <p className="muted">
                  Plays your mic back through your speaker. Use headphones to
                  avoid feedback.
                </p>
                <button onClick={toggleMicTest} className="btn-secondary">
                  {micTesting ? "Stop test" : "Start mic test"}
                </button>
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
    </div>
  );
}

export default App;
