// App.tsx — Root component
//
// React concepts for Blazor devs:
// - useState(initial) returns [value, setter] — private field + setter
// - useEffect(fn, [deps]) runs fn when deps change — like OnParametersSet
// - useRef(initial) persists a value across renders — like a field that doesn't trigger re-render
// - Event handlers use camelCase: onClick, onChange, onSubmit

import React, { useState, useEffect, useRef, useMemo } from "react";
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
  description: string | null;
  created_at: number;
}

interface Attachment {
  name: string;
  mime: string;
  data_b64: string;
}

interface Reaction {
  emoji: string;
  count: number;
  me: boolean;
}

interface ReplyContext {
  message_id: string;
  sender: string;
  sender_name: string | null;
  content_preview: string;
}

interface Message {
  id: string;
  channel_id: string;
  sender: string;
  sender_name: string | null;
  content: string;
  created_at: number;
  edited_at: number | null;
  attachments?: Attachment[];
  reactions?: Reaction[];
  reply_to?: ReplyContext | null;
}

/**
 * Curated emoji catalog for the picker. Each entry is [emoji, keywords].
 * Keywords are matched as substrings against the user's query so "thumb"
 * finds 👍 and "fire" finds 🔥. The first 8 also serve as the always-visible
 * frequent set when the search is empty.
 */
const EMOJI_CATALOG: [string, string][] = [
  ["👍", "thumbs up yes ok approve"],
  ["❤️", "heart love"],
  ["😂", "laugh joy lol cry"],
  ["🎉", "party celebrate tada"],
  ["🔥", "fire lit hot"],
  ["👀", "eyes look watch see"],
  ["😢", "sad cry tear"],
  ["🙏", "pray thanks please"],
  ["👎", "thumbs down no nope"],
  ["✅", "check yes done correct"],
  ["❌", "x cross no wrong"],
  ["💯", "100 perfect score"],
  ["🤔", "think thinking hmm"],
  ["😅", "sweat smile awkward"],
  ["😎", "cool sunglasses"],
  ["😭", "crying sob bawl"],
  ["😡", "angry mad rage"],
  ["🤯", "mind blown shocked"],
  ["🥳", "party celebrate happy"],
  ["🤝", "handshake deal agree"],
  ["💪", "muscle strong flex"],
  ["👏", "clap applause bravo"],
  ["🙌", "raised hands praise"],
  ["✨", "sparkle shiny stars"],
  ["⭐", "star favorite"],
  ["💡", "idea bulb"],
  ["⚡", "lightning fast bolt"],
  ["🐛", "bug insect"],
  ["🚀", "rocket launch ship"],
  ["🎯", "target dart bullseye"],
  ["💀", "skull dead rip"],
  ["👻", "ghost spooky"],
  ["🤖", "robot bot"],
  ["☕", "coffee mug"],
  ["🍕", "pizza"],
  ["🍔", "burger food"],
  ["🍺", "beer drink"],
  ["🍰", "cake birthday"],
  ["🌮", "taco food"],
  ["🎵", "music note song"],
  ["🎮", "game controller play"],
  ["📺", "tv television"],
  ["💻", "laptop computer"],
  ["📱", "phone mobile"],
  ["⌨️", "keyboard"],
  ["🖱️", "mouse"],
  ["🐶", "dog puppy"],
  ["🐱", "cat kitten"],
  ["🦊", "fox"],
  ["🦁", "lion"],
  ["🐧", "penguin"],
  ["🦄", "unicorn magic"],
  ["🐢", "turtle slow"],
  ["🌈", "rainbow"],
  ["☀️", "sun sunny day"],
  ["🌙", "moon night"],
  ["🌧️", "rain"],
  ["❄️", "snow snowflake winter"],
  ["🌊", "wave water ocean"],
  ["🌍", "earth world globe"],
  ["💚", "green heart"],
  ["💙", "blue heart"],
  ["💜", "purple heart"],
  ["🖤", "black heart"],
  ["💛", "yellow heart"],
  ["💔", "broken heart sad"],
  ["💕", "two hearts love"],
  ["😀", "grin smile"],
  ["😊", "smile happy"],
  ["😉", "wink"],
  ["😌", "relieved calm"],
  ["😘", "kiss"],
  ["😏", "smirk smug"],
  ["😴", "sleep zzz tired"],
  ["🤐", "zip mouth shut"],
  ["🤫", "shush quiet"],
  ["🤣", "rofl laugh"],
  ["😬", "grimace awkward"],
  ["🙃", "upside down silly"],
  ["😱", "scream shock fear"],
  ["😳", "flushed embarrassed"],
  ["🥺", "pleading puppy eyes"],
  ["😷", "mask sick"],
  ["🤒", "thermometer sick fever"],
  ["🥵", "hot heat sweat"],
  ["🥶", "cold freeze"],
  ["😈", "devil mischief"],
  ["💩", "poop"],
  ["🎂", "cake birthday"],
  ["🎁", "gift present"],
  ["🏆", "trophy win"],
  ["🥇", "gold medal first"],
  ["💎", "diamond gem"],
  ["💰", "money cash bag"],
  ["📈", "chart up growth"],
  ["📉", "chart down decline"],
  ["🔔", "bell notification"],
  ["🔒", "lock secure"],
  ["🔑", "key"],
  ["🛠️", "tools wrench fix"],
  ["📌", "pin"],
  ["📎", "paperclip attach"],
  ["📝", "memo write note"],
  ["📚", "books read"],
  ["🎓", "graduation cap"],
  ["🌟", "glowing star"],
  ["🐝", "bee"],
  ["🦋", "butterfly"],
  ["🍎", "apple"],
  ["🍌", "banana"],
  ["🍇", "grapes"],
  ["🥑", "avocado"],
  ["🥦", "broccoli"],
  ["🍿", "popcorn"],
  ["🧀", "cheese"],
  ["🍩", "donut"],
  ["🍪", "cookie"],
  ["🍷", "wine"],
  ["🥤", "soda drink"],
];
const QUICK_REACTIONS = EMOJI_CATALOG.slice(0, 8).map(([e]) => e);

type NotifyMode = "all" | "mentions" | "silent";

const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024; // matches the hub cap

interface User {
  public_key: string;
  display_name: string | null;
  avatar: string | null;
  online: boolean;
  group_role: string | null;
}

interface VoiceParticipant {
  public_key: string;
  display_name: string | null;
}

interface Hub {
  hub_id: string;
  hub_name: string;
  hub_url: string;
  hub_icon: string | null;
  is_active: boolean;
}

interface RoleInfo {
  id: string;
  name: string;
  permissions: string[];
  priority: number;
  display_separately?: boolean;
}

interface NamedProfile {
  id: string;
  label: string;
  display_name: string;
  avatar: string | null;
}

interface MeInfo {
  public_key: string;
  display_name: string | null;
  avatar: string | null;
  approval_status: "approved" | "pending";
  roles: RoleInfo[];
}

interface MemberAdminInfo {
  public_key: string;
  display_name: string | null;
  online: boolean;
  first_seen_at: number;
  last_seen_at: number;
  roles: RoleInfo[];
}

interface BanInfo {
  target_public_key: string;
  banned_by: string;
  reason: string | null;
  created_at: number;
}

interface VoiceMuteInfo {
  target_public_key: string;
  muted_by: string;
  reason: string | null;
  created_at: number;
}

interface InviteInfo {
  code: string;
  created_by: string;
  max_uses: number | null;
  uses: number;
  expires_at: number | null;
  created_at: number;
}

interface PendingUser {
  public_key: string;
  display_name: string | null;
  first_seen_at: number;
}

interface InstalledGame {
  id: string;
  name: string;
  description: string | null;
  version: string;
  entry_url: string;
  thumbnail_url: string | null;
  author: string | null;
  min_players: number;
  max_players: number;
  installed_by: string;
  installed_at: number;
  manifest_url: string;
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
  last_activity_at?: number;
}

interface DmMessage {
  sender: string;
  sender_name: string | null;
  content: string;
  timestamp: number;
  attachments?: Attachment[];
}

interface DmMessageFull {
  id: string;
  conversation_id: string;
  sender: string;
  sender_name: string | null;
  content: string;
  created_at: number;
  attachments?: Attachment[];
}

/** Hub icon wrapped in dnd-kit's useSortable so the user can drag-reorder
 * the hub sidebar. The drag handle is the whole icon -- there's no second
 * action you'd want to bind to the icon itself except click, and that
 * still works because dnd-kit only kicks in after a small drag distance. */
function SortableHubIcon({
  hubId,
  children,
}: {
  hubId: string;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: hubId });
  return (
    <div
      ref={setNodeRef}
      className={`hub-icon-wrap ${isDragging ? "dragging" : ""}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
    >
      {children}
    </div>
  );
}

function SortableChannelItem({
  channel,
  selected,
  unread,
  muted,
  voiceCount,
  onClick,
  onContextMenu,
}: {
  channel: Channel;
  selected: boolean;
  unread: boolean;
  muted: boolean;
  voiceCount: number;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: channel.id });

  return (
    <li
      ref={setNodeRef}
      className={`channel-item ${selected ? "selected" : ""} ${
        unread ? "unread" : ""
      } ${muted ? "muted" : ""} ${isDragging ? "dragging" : ""}`}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      onClick={onClick}
      onContextMenu={onContextMenu}
      {...attributes}
      {...listeners}
    >
      {unread && <span className="channel-unread-dot" />}
      # {channel.name}
      {muted && <span className="channel-muted-icon" title="Muted">🔕</span>}
      {voiceCount > 0 && (
        <span className="channel-voice-badge" title={`${voiceCount} in voice`}>
          🎙️ {voiceCount}
        </span>
      )}
    </li>
  );
}

function SortableCategoryItem({
  channel,
  children,
  collapsed,
  childCount,
  onToggleCollapsed,
  onContextMenu,
  onAddChannel,
}: {
  channel: Channel;
  children: React.ReactNode;
  collapsed: boolean;
  childCount: number;
  onToggleCollapsed: () => void;
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
        <button
          className="category-chevron"
          onClick={(e) => {
            e.stopPropagation();
            onToggleCollapsed();
          }}
          title={collapsed ? "Expand" : "Collapse"}
        >
          {collapsed ? "▸" : "▾"}
        </button>
        <span className="category-name">{channel.name.toUpperCase()}</span>
        {collapsed && childCount > 0 && (
          <span className="category-count">{childCount}</span>
        )}
        <button
          className="btn-icon-small"
          onClick={(e) => { e.stopPropagation(); onAddChannel(); }}
          title="Add channel"
        >
          +
        </button>
      </div>
      {!collapsed && children}
    </li>
  );
}

/** Format a public key for display: 12 hex chars in groups of 4, separated
 * by dashes, followed by the last 4 chars. Full key still copied/sent under
 * the hood — this is purely visual. */
function formatPubkey(key: string | null | undefined): string {
  if (!key) return "";
  if (key.length < 20) return key;
  const head = key.slice(0, 12).match(/.{1,4}/g)!.join("-");
  const tail = key.slice(-4);
  return `${head}…${tail}`;
}

type SettingsTab = "profile" | "account" | "appearance" | "voice" | "security" | "about";

interface SettingsPageProps {
  tab: SettingsTab;
  onTab: (t: SettingsTab) => void;
  onClose: () => void;
  // Profile system: multiple named profiles with one marked default.
  profiles: NamedProfile[];
  defaultProfileId: string | null;
  onCreateProfile: () => void;
  onUpdateProfile: (
    id: string,
    patch: Partial<Omit<NamedProfile, "id">>
  ) => void;
  onDeleteProfile: (id: string) => void;
  onSetDefaultProfile: (id: string) => void;
  onApplyProfileToHub: (id: string) => void;

  theme: "calm" | "classic" | "linear";
  onThemeChange: (t: "calm" | "classic" | "linear") => void;
  hasActiveHub: boolean;
  publicKey: string | null;
  copiedKey: boolean;
  onCopyKey: () => void;
  audioInputs: string[];
  audioOutputs: string[];
  voiceInputDevice: string;
  voiceOutputDevice: string;
  onInputDeviceChange: (v: string) => void;
  onOutputDeviceChange: (v: string) => void;
  vadThreshold: number;
  onVadChange: (v: number) => void;
  voiceMode: "vad" | "ptt";
  onVoiceModeChange: (m: "vad" | "ptt") => void;
  pttKey: string;
  onPttKeyChange: (k: string) => void;
  mentionPingEnabled: boolean;
  onMentionPingChange: (v: boolean) => void;
  micLevel: number;
  micTesting: boolean;
  onToggleMicTest: () => void;
  recoveryPhrase: string | null;
  onShowRecovery: () => void;
  onRecoverIdentity: (phrase: string) => Promise<void>;
}

/**
 * Profile tab — multiple named profiles. One is marked as default and gets
 * auto-applied to new hubs. The user can create as many as they like, edit
 * each, and apply any one of them to the currently active hub.
 *
 * Avatar sits to the LEFT of the display name in the editor, which reads
 * more like a profile card and matches conventions in apps the user knows.
 */
function ProfileTab({
  hasActiveHub,
  profiles,
  defaultProfileId,
  onCreateProfile,
  onUpdateProfile,
  onDeleteProfile,
  onSetDefaultProfile,
  onApplyProfileToHub,
}: {
  hasActiveHub: boolean;
  profiles: NamedProfile[];
  defaultProfileId: string | null;
  onCreateProfile: () => void;
  onUpdateProfile: (id: string, patch: Partial<Omit<NamedProfile, "id">>) => void;
  onDeleteProfile: (id: string) => void;
  onSetDefaultProfile: (id: string) => void;
  onApplyProfileToHub: (id: string) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(
    defaultProfileId ?? profiles[0]?.id ?? null
  );

  // Keep selection valid as profiles list changes.
  useEffect(() => {
    if (profiles.length === 0) {
      setSelectedId(null);
    } else if (!profiles.find((p) => p.id === selectedId)) {
      setSelectedId(defaultProfileId ?? profiles[0].id);
    }
  }, [profiles, defaultProfileId, selectedId]);

  const selected = profiles.find((p) => p.id === selectedId) ?? null;

  return (
    <section>
      <h1>Profile</h1>
      <p className="muted" style={{ marginBottom: "var(--space-4)" }}>
        Create as many profiles as you like — say, one for friends and one
        for work. The one marked Default is what new hubs use automatically.
        Use <strong>Apply to this hub</strong> to switch profiles on the
        hub you're currently viewing.
      </p>

      <div className="profile-cards">
        {profiles.map((p) => (
          <button
            key={p.id}
            className={`profile-card ${selectedId === p.id ? "active" : ""}`}
            onClick={() => setSelectedId(p.id)}
            type="button"
          >
            {defaultProfileId === p.id && (
              <span className="profile-card-default">Default</span>
            )}
            <Avatar
              src={p.avatar}
              name={p.display_name || p.label}
              size={48}
            />
            <div className="profile-card-text">
              <div className="profile-card-label">{p.label}</div>
              <div className="profile-card-name">
                {p.display_name || (
                  <span className="muted">no display name</span>
                )}
              </div>
            </div>
          </button>
        ))}
        <button
          className="profile-card profile-card-add"
          onClick={onCreateProfile}
          type="button"
        >
          <div className="profile-card-add-plus">+</div>
          <div className="profile-card-text">
            <div className="profile-card-label">New profile</div>
          </div>
        </button>
      </div>

      {selected && (
        <div className="settings-section profile-editor">
          <div className="profile-editor-row">
            <AvatarEditor
              value={selected.avatar ?? ""}
              onChange={(v) =>
                onUpdateProfile(selected.id, { avatar: v || null })
              }
              fallbackName={selected.display_name || selected.label}
            />
            <div className="profile-editor-fields">
              <label className="settings-label">Display name</label>
              <input
                type="text"
                value={selected.display_name}
                onChange={(e) =>
                  onUpdateProfile(selected.id, { display_name: e.target.value })
                }
                placeholder="e.g. Antonio"
              />
              <label className="settings-label" style={{ marginTop: "var(--space-3)" }}>
                Profile label
              </label>
              <input
                type="text"
                value={selected.label}
                onChange={(e) =>
                  onUpdateProfile(selected.id, { label: e.target.value })
                }
                placeholder="e.g. Friends, Work, Gaming"
              />
            </div>
          </div>

          <div className="profile-editor-actions">
            {defaultProfileId !== selected.id && (
              <button
                className="btn-secondary"
                onClick={() => onSetDefaultProfile(selected.id)}
              >
                ★ Set as default
              </button>
            )}
            <button
              onClick={() => onApplyProfileToHub(selected.id)}
              disabled={!hasActiveHub}
              title={hasActiveHub ? "" : "Join a hub first"}
            >
              Apply to this hub
            </button>
            <button
              className="btn-secondary"
              onClick={() => onDeleteProfile(selected.id)}
              disabled={profiles.length <= 1}
              title={
                profiles.length <= 1 ? "You need at least one profile" : ""
              }
            >
              Delete
            </button>
          </div>
        </div>
      )}

      {profiles.length === 0 && (
        <p className="muted">
          No profiles yet — click <strong>+ New profile</strong> above to
          create one.
        </p>
      )}
    </section>
  );
}

/**
 * Theme picker — three radio cards. Each shows the theme's name, its three
 * representative swatches (bg / surface / accent), and a "DEFAULT" tag on
 * Calm. Swatch colors are hardcoded here because they need to render the
 * theme's palette regardless of which theme is currently active.
 */
const THEMES: {
  id: "calm" | "classic" | "linear";
  name: string;
  tagline: string;
  swatches: [string, string, string];
}[] = [
  {
    id: "calm",
    name: "Calm",
    tagline: "Warm dark, dusty teal. Soft on the eyes — fits everyone.",
    swatches: ["#1c1a1f", "#2c2a31", "#88b8a8"],
  },
  {
    id: "classic",
    name: "Classic",
    tagline: "Deep navy + violet purple. Familiar and tech-forward.",
    swatches: ["#1a1a2e", "#1e2a47", "#7c3aed"],
  },
  {
    id: "linear",
    name: "Linear",
    tagline: "Near-black with a sharp violet-blue accent. Minimal.",
    swatches: ["#0c0d11", "#1a1c22", "#6571f0"],
  },
];

function ThemePicker({
  value,
  onChange,
}: {
  value: "calm" | "classic" | "linear";
  onChange: (t: "calm" | "classic" | "linear") => void;
}) {
  return (
    <div className="theme-cards">
      {THEMES.map((t) => (
        <button
          key={t.id}
          className={`theme-card ${value === t.id ? "active" : ""}`}
          onClick={() => onChange(t.id)}
          type="button"
        >
          {t.id === "calm" && <span className="theme-card-default">Default</span>}
          <div className="theme-card-name">{t.name}</div>
          <div className="theme-card-swatches">
            {t.swatches.map((color) => (
              <span
                key={color}
                className="theme-swatch"
                style={{ background: color }}
              />
            ))}
          </div>
          <p className="theme-card-tagline">{t.tagline}</p>
        </button>
      ))}
    </div>
  );
}

function Avatar({
  src,
  name,
  size = 24,
}: {
  src?: string | null;
  name: string | null | undefined;
  size?: number;
}) {
  if (src) {
    return (
      <img
        src={src}
        alt=""
        className="avatar-img"
        style={{ width: size, height: size }}
      />
    );
  }
  const initials = (name || "?").trim().slice(0, 2).toUpperCase();
  return (
    <span
      className="avatar-fallback"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.45) }}
    >
      {initials}
    </span>
  );
}

/**
 * Drop-zone + button file picker that base64-encodes the chosen image
 * and hands it back as a data URL. Shared between the avatar and hub-icon
 * editors so they look and behave the same. Hard 256 KB cap.
 */
/** Single-shot key capture for push-to-talk. Click → next key press wins. */
function PttKeyBinder({
  value,
  onChange,
}: {
  value: string;
  onChange: (k: string) => void;
}) {
  const [listening, setListening] = useState(false);

  useEffect(() => {
    if (!listening) return;
    function onKey(e: KeyboardEvent) {
      // Modifiers alone are useless as a PTT trigger -- you can't hold
      // Shift down without trapping every shifted key. Filter them out.
      if (
        e.code === "ShiftLeft" ||
        e.code === "ShiftRight" ||
        e.code === "ControlLeft" ||
        e.code === "ControlRight" ||
        e.code === "AltLeft" ||
        e.code === "AltRight" ||
        e.code === "MetaLeft" ||
        e.code === "MetaRight"
      ) {
        return;
      }
      e.preventDefault();
      onChange(e.code);
      setListening(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [listening, onChange]);

  return (
    <div className="settings-row" style={{ alignItems: "center" }}>
      <span className="muted">Bound key:</span>
      <code className="public-key">{value}</code>
      <button
        className="btn-secondary"
        onClick={() => setListening((v) => !v)}
      >
        {listening ? "Press a key…" : "Rebind"}
      </button>
    </div>
  );
}

function ImagePicker({
  onPick,
  onClear,
  hasValue,
  buttonLabel,
}: {
  onPick: (dataUrl: string) => void;
  onClear: () => void;
  hasValue: boolean;
  buttonLabel: string;
}) {
  const [dragOver, setDragOver] = useState(false);

  function handleFile(file: File) {
    if (file.size > 256 * 1024) {
      alert("Image too large (max 256 KB)");
      return;
    }
    if (!file.type.startsWith("image/")) {
      alert("Pick an image file");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") onPick(result);
    };
    reader.readAsDataURL(file);
  }

  return (
    <div
      className={`image-picker ${dragOver ? "drag-over" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        if (!dragOver) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f) handleFile(f);
      }}
    >
      <label className="btn-secondary image-picker-button">
        {buttonLabel}
        <input
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = "";
          }}
        />
      </label>
      <span className="muted image-picker-hint">or drop an image here</span>
      {hasValue && (
        <button onClick={onClear} className="btn-secondary">
          Clear
        </button>
      )}
    </div>
  );
}

function AvatarEditor({
  value,
  onChange,
  fallbackName,
}: {
  value: string;
  onChange: (v: string) => void;
  fallbackName: string;
}) {
  return (
    <div className="avatar-editor">
      <Avatar src={value} name={fallbackName} size={72} />
      <ImagePicker
        onPick={onChange}
        onClear={() => onChange("")}
        hasValue={!!value}
        buttonLabel="Pick image"
      />
    </div>
  );
}

function UserListGrouped({
  users,
  inVoice,
  onContextMenu,
}: {
  users: User[];
  inVoice?: Set<string>;
  onContextMenu?: (e: React.MouseEvent, user: User) => void;
}) {
  const [filter, setFilter] = useState("");
  // Filter on lowercased display_name OR pubkey prefix so users can find
  // someone they know by name even when their display_name is null.
  const q = filter.trim().toLowerCase();
  const matched = q
    ? users.filter((u) =>
        ((u.display_name ?? "") + " " + u.public_key).toLowerCase().includes(q),
      )
    : users;

  // Online first, then offline. Within each, bucket by group_role (the name of
  // the highest-priority role with display_separately=true), with null-role
  // members falling into a generic "Online" / "Offline" bucket.
  const online = matched.filter((u) => u.online);
  const offline = matched.filter((u) => !u.online);

  function bucket(group: User[], fallback: string): [string, User[]][] {
    const grouped = new Map<string, User[]>();
    const ungrouped: User[] = [];
    for (const u of group) {
      if (u.group_role) {
        if (!grouped.has(u.group_role)) grouped.set(u.group_role, []);
        grouped.get(u.group_role)!.push(u);
      } else {
        ungrouped.push(u);
      }
    }
    const out: [string, User[]][] = Array.from(grouped.entries());
    if (ungrouped.length > 0) out.push([fallback, ungrouped]);
    return out;
  }

  const onlineBuckets = bucket(online, "Online");
  const offlineBuckets = bucket(offline, "Offline");

  const onlineCount = users.filter((u) => u.online).length;
  return (
    <>
      <div className="user-list-header">
        <span className="user-list-total">
          {users.length} {users.length === 1 ? "member" : "members"}
        </span>
        <span className="user-list-online" title="Online">
          <span className="status-dot online" />
          {onlineCount}
        </span>
      </div>
      <div className="user-list-filter">
        <input
          type="text"
          placeholder="Filter members…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        {filter && matched.length === 0 && (
          <p className="muted user-list-empty">No matches</p>
        )}
      </div>
      {onlineBuckets.map(([title, list]) => (
        <div className="user-section" key={`on-${title}`}>
          <p className="user-section-title">
            {title} — {list.length}
          </p>
          <ul className="user-list">
            {list.map((u) => (
              <li
                key={u.public_key}
                className="user-list-item"
                onContextMenu={(e) => onContextMenu?.(e, u)}
              >
                <Avatar src={u.avatar} name={u.display_name || u.public_key} size={24} />
                <span className="status-dot online" />
                <span className="user-name">
                  {u.display_name || u.public_key.slice(0, 16)}
                </span>
                {inVoice?.has(u.public_key) && (
                  <span className="user-in-voice" title="In voice">
                    🎙️
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {offlineBuckets.map(([title, list]) => (
        <div className="user-section" key={`off-${title}`}>
          <p className="user-section-title">
            {title} — {list.length}
          </p>
          <ul className="user-list">
            {list.map((u) => (
              <li
                key={u.public_key}
                className="user-list-item offline"
                onContextMenu={(e) => onContextMenu?.(e, u)}
              >
                <Avatar src={u.avatar} name={u.display_name || u.public_key} size={24} />
                <span className="status-dot offline" />
                <span className="user-name">
                  {u.display_name || u.public_key.slice(0, 16)}
                </span>
                {inVoice?.has(u.public_key) && (
                  <span className="user-in-voice" title="In voice">
                    🎙️
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}

const MIC_METER_MAX = 0.2;

function MicLevelMeter({
  level,
  threshold,
  onChange,
}: {
  level: number;
  threshold: number;
  onChange: (v: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  function valueAt(clientX: number): number {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return threshold;
    const pct = (clientX - rect.left) / rect.width;
    const v = Math.max(0.001, Math.min(MIC_METER_MAX, pct * MIC_METER_MAX));
    return v;
  }

  function handleDown(e: React.MouseEvent) {
    dragging.current = true;
    onChange(valueAt(e.clientX));
  }

  useEffect(() => {
    function up() {
      dragging.current = false;
    }
    function move(e: MouseEvent) {
      if (!dragging.current) return;
      onChange(valueAt(e.clientX));
    }
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [onChange]);

  const fillPct = Math.min(100, (level / MIC_METER_MAX) * 100);
  const markerPct = Math.min(100, (threshold / MIC_METER_MAX) * 100);
  const triggered = level >= threshold;

  return (
    <div className="mic-meter" ref={ref} onMouseDown={handleDown}>
      <div
        className={`mic-meter-fill ${triggered ? "triggered" : ""}`}
        style={{ width: `${fillPct}%` }}
      />
      <div className="mic-meter-marker" style={{ left: `${markerPct}%` }} />
    </div>
  );
}

function RestoreIdentitySection({
  onRestore,
}: {
  onRestore: (phrase: string) => Promise<void>;
}) {
  const [phrase, setPhrase] = useState("");
  const [busy, setBusy] = useState(false);

  const wordCount = phrase.trim().split(/\s+/).filter(Boolean).length;
  const looksValid = wordCount === 24;

  async function handleRestore() {
    if (!looksValid) return;
    const ok = confirm(
      "Restore identity from this phrase?\n\nYour current keypair will be replaced and every saved hub will be removed. You'll re-add hubs under the restored identity."
    );
    if (!ok) return;
    setBusy(true);
    try {
      await onRestore(phrase.trim());
      setPhrase("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings-section">
      <label className="settings-label">Restore from recovery phrase</label>
      <p className="muted">
        Paste a 24-word phrase to replace this device's identity. Existing
        hubs and sessions will be cleared.
      </p>
      <textarea
        className="recovery-input"
        value={phrase}
        onChange={(e) => setPhrase(e.target.value)}
        placeholder="word1 word2 word3 …"
        rows={3}
        spellCheck={false}
        autoCapitalize="none"
        autoCorrect="off"
      />
      <div className="recovery-input-footer">
        <span className="muted">
          {wordCount}/24 words
        </span>
        <button
          className="btn-secondary"
          disabled={!looksValid || busy}
          onClick={handleRestore}
        >
          {busy ? "Restoring…" : "Restore identity"}
        </button>
      </div>
    </div>
  );
}

function SettingsPage(props: SettingsPageProps) {
  const tabs: { id: SettingsTab; label: string }[] = [
    { id: "profile", label: "Profile" },
    { id: "account", label: "Account" },
    { id: "appearance", label: "Appearance" },
    { id: "voice", label: "Voice & Video" },
    { id: "security", label: "Security" },
    { id: "about", label: "About" },
  ];

  return (
    <div className="settings-page">
      <aside className="settings-nav">
        <h2>Settings</h2>
        <ul>
          {tabs.map((t) => (
            <li key={t.id}>
              <button
                className={`settings-nav-item ${props.tab === t.id ? "active" : ""}`}
                onClick={() => props.onTab(t.id)}
              >
                {t.label}
              </button>
            </li>
          ))}
        </ul>
        <button className="settings-nav-close" onClick={props.onClose}>
          Close (ESC)
        </button>
      </aside>
      <main className="settings-content">
        <button className="settings-close-x" onClick={props.onClose} title="Close">
          ×
        </button>
        {props.tab === "profile" && (
          <ProfileTab
            hasActiveHub={props.hasActiveHub}
            profiles={props.profiles}
            defaultProfileId={props.defaultProfileId}
            onCreateProfile={props.onCreateProfile}
            onUpdateProfile={props.onUpdateProfile}
            onDeleteProfile={props.onDeleteProfile}
            onSetDefaultProfile={props.onSetDefaultProfile}
            onApplyProfileToHub={props.onApplyProfileToHub}
          />
        )}
        {props.tab === "account" && (
          <section>
            <h1>Account</h1>
            <div className="settings-section">
              <label className="settings-label">Your public key</label>
              <p className="muted">
                Your unique identity. Share this with someone to send you a
                friend request. Same key works on every hub.
              </p>
              <div className="settings-row">
                <code className="pubkey-display" title={props.publicKey ?? ""}>
                  {formatPubkey(props.publicKey)}
                </code>
                <button onClick={props.onCopyKey}>
                  {props.copiedKey ? "Copied" : "Copy full key"}
                </button>
              </div>
            </div>
          </section>
        )}
        {props.tab === "appearance" && (
          <section>
            <h1>Appearance</h1>
            <div className="settings-section">
              <label className="settings-label">Theme</label>
              <p className="muted">
                How Voxply looks. Pick whichever feels right — you can change
                it any time.
              </p>
              <ThemePicker value={props.theme} onChange={props.onThemeChange} />
            </div>
          </section>
        )}
        {props.tab === "voice" && (
          <section>
            <h1>Voice & Video</h1>
            <div className="settings-section">
              <label className="settings-label">Microphone</label>
              <select
                value={props.voiceInputDevice}
                onChange={(e) => props.onInputDeviceChange(e.target.value)}
              >
                <option value="">System default</option>
                {props.audioInputs.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
            <div className="settings-section">
              <label className="settings-label">Speaker</label>
              <select
                value={props.voiceOutputDevice}
                onChange={(e) => props.onOutputDeviceChange(e.target.value)}
              >
                <option value="">System default</option>
                {props.audioOutputs.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
            <div className="settings-section">
              <label className="settings-label">
                Mic sensitivity — threshold {props.vadThreshold.toFixed(3)}
              </label>
              <p className="muted">
                Drag the marker. Voice is detected when the green bar crosses
                it. Fill animates only while you're in voice or running a mic
                test. Changes apply on the next voice channel you join.
              </p>
              <MicLevelMeter
                level={props.micLevel}
                threshold={props.vadThreshold}
                onChange={props.onVadChange}
              />
            </div>
            <div className="settings-section">
              <label className="settings-label">Activation mode</label>
              <p className="muted">
                Voice activity (VAD) opens the mic when it detects speech.
                Push-to-talk keeps it muted until you hold the bound key.
              </p>
              <div className="settings-row">
                <label className="checkbox-label">
                  <input
                    type="radio"
                    name="voice-mode"
                    checked={props.voiceMode === "vad"}
                    onChange={() => props.onVoiceModeChange("vad")}
                  />
                  Voice activity (VAD)
                </label>
                <label className="checkbox-label">
                  <input
                    type="radio"
                    name="voice-mode"
                    checked={props.voiceMode === "ptt"}
                    onChange={() => props.onVoiceModeChange("ptt")}
                  />
                  Push-to-talk
                </label>
              </div>
              {props.voiceMode === "ptt" && (
                <PttKeyBinder
                  value={props.pttKey}
                  onChange={props.onPttKeyChange}
                />
              )}
            </div>
            <div className="settings-section">
              <label className="settings-label">Microphone test</label>
              <p className="muted">
                Plays your mic back through your speaker. Use headphones to avoid
                feedback.
              </p>
              <button onClick={props.onToggleMicTest} className="btn-secondary">
                {props.micTesting ? "Stop test" : "Start mic test"}
              </button>
            </div>
            <div className="settings-section">
              <label className="settings-label">Mention ping</label>
              <p className="muted">
                Plays a short two-tone sound when someone @-mentions you in
                a non-focused channel. OS notifications are independent.
              </p>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={props.mentionPingEnabled}
                  onChange={(e) => props.onMentionPingChange(e.target.checked)}
                />
                Play mention ping
              </label>
            </div>
          </section>
        )}
        {props.tab === "security" && (
          <section>
            <h1>Security</h1>
            <div className="settings-section">
              <label className="settings-label">Recovery phrase</label>
              <p className="muted">
                24 words you can use to restore your identity. Write them down
                and keep them safe — anyone with these words can impersonate you.
              </p>
              {props.recoveryPhrase ? (
                <div className="recovery-phrase">{props.recoveryPhrase}</div>
              ) : (
                <button onClick={props.onShowRecovery} className="btn-secondary">
                  Reveal recovery phrase
                </button>
              )}
            </div>
            <RestoreIdentitySection onRestore={props.onRecoverIdentity} />
          </section>
        )}
        {props.tab === "about" && (
          <section>
            <h1>About</h1>
            <p className="muted">Voxply — decentralized voice chat + community platform.</p>
          </section>
        )}
      </main>
    </div>
  );
}

type HubAdminTab = "overview" | "roles" | "members" | "bans" | "invites" | "alliances";

interface HubAdminPageProps {
  tab: HubAdminTab;
  onTab: (t: HubAdminTab) => void;
  onClose: () => void;
  hubName: string;
  onHubNameChange: (v: string) => void;
  hubDescription: string;
  onHubDescriptionChange: (v: string) => void;
  hubIcon: string;
  onHubIconChange: (v: string) => void;
  requireApproval: boolean;
  onRequireApprovalChange: (v: boolean) => void;
  onSave: () => void;
  pendingMembers: PendingUser[];
  onApproveMember: (publicKey: string) => void;
  roles: RoleInfo[];
  onCreateRole: (
    name: string,
    perms: string[],
    priority: number,
    displaySeparately: boolean
  ) => void;
  onUpdateRole: (
    id: string,
    updates: {
      name?: string;
      permissions?: string[];
      priority?: number;
      display_separately?: boolean;
    }
  ) => void;
  onDeleteRole: (id: string) => void;
  members: MemberAdminInfo[];
  onKickMember: (publicKey: string) => void;
  onBanMember: (publicKey: string) => void;
  onMuteMember: (publicKey: string) => void;
  onTimeoutMember: (publicKey: string) => void;
  onVoiceMuteMember: (publicKey: string) => void;
  onVoiceUnmuteMember: (publicKey: string) => void;
  voiceMutedKeys: Set<string>;
  onToggleRoleAssignment: (
    publicKey: string,
    roleId: string,
    hasRole: boolean
  ) => void;
  bans: BanInfo[];
  onUnban: (publicKey: string) => void;
  invites: InviteInfo[];
  activeHubUrl: string;
  onCreateInvite: (maxUses: number | null, expiresInSeconds: number | null) => void;
  onRevokeInvite: (code: string) => void;
  channels: Channel[];
}

const ALL_PERMISSIONS: { id: string; label: string }[] = [
  { id: "admin", label: "Administrator (grants everything)" },
  { id: "manage_channels", label: "Manage channels" },
  { id: "manage_roles", label: "Manage roles" },
  { id: "manage_messages", label: "Manage messages" },
  { id: "kick_members", label: "Kick members" },
  { id: "ban_members", label: "Ban members" },
  { id: "mute_members", label: "Mute members" },
  { id: "timeout_members", label: "Timeout members" },
  { id: "read_messages", label: "Read messages" },
  { id: "send_messages", label: "Send messages" },
];

const EXPIRY_OPTIONS: { label: string; seconds: number | null }[] = [
  { label: "Never", seconds: null },
  { label: "30 minutes", seconds: 30 * 60 },
  { label: "1 hour", seconds: 60 * 60 },
  { label: "6 hours", seconds: 6 * 60 * 60 },
  { label: "1 day", seconds: 24 * 60 * 60 },
  { label: "7 days", seconds: 7 * 24 * 60 * 60 },
];

function InvitesSection({
  invites,
  hubUrl,
  onCreate,
  onRevoke,
}: {
  invites: InviteInfo[];
  hubUrl: string;
  onCreate: (maxUses: number | null, expiresInSeconds: number | null) => void;
  onRevoke: (code: string) => void;
}) {
  const [maxUsesStr, setMaxUsesStr] = useState("");
  const [expiryIdx, setExpiryIdx] = useState(0);
  const [copied, setCopied] = useState<string | null>(null);

  function submit() {
    const parsed = maxUsesStr.trim() ? Number(maxUsesStr) : null;
    const maxUses =
      parsed !== null && Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    onCreate(maxUses, EXPIRY_OPTIONS[expiryIdx].seconds);
    setMaxUsesStr("");
    setExpiryIdx(0);
  }

  async function copyLink(code: string) {
    const link = `${hubUrl}#invite=${code}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(code);
      setTimeout(() => setCopied(null), 2000);
    } catch {}
  }

  return (
    <section>
      <h1>Invites — {invites.length}</h1>
      <div className="role-editor">
        <h3>Create invite</h3>
        <div className="settings-row">
          <input
            type="number"
            value={maxUsesStr}
            onChange={(e) => setMaxUsesStr(e.target.value)}
            placeholder="Max uses (blank = unlimited)"
            min={1}
          />
          <select
            value={expiryIdx}
            onChange={(e) => setExpiryIdx(Number(e.target.value))}
          >
            {EXPIRY_OPTIONS.map((o, i) => (
              <option key={o.label} value={i}>
                Expires: {o.label}
              </option>
            ))}
          </select>
          <button onClick={submit}>Create</button>
        </div>
      </div>

      {invites.length === 0 ? (
        <p className="muted">No invites yet.</p>
      ) : (
        <table className="members-table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Uses</th>
              <th>Expires</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {invites.map((i) => (
              <tr key={i.code}>
                <td>
                  <code className="invite-code">{i.code}</code>
                </td>
                <td>
                  {i.uses}
                  {i.max_uses !== null ? ` / ${i.max_uses}` : ""}
                </td>
                <td>
                  {i.expires_at
                    ? new Date(i.expires_at * 1000).toLocaleString()
                    : "Never"}
                </td>
                <td>{formatRelative(i.created_at)}</td>
                <td>
                  <button
                    className="btn-small"
                    onClick={() => copyLink(i.code)}
                  >
                    {copied === i.code ? "Copied" : "Copy link"}
                  </button>
                  <button
                    className="btn-small btn-secondary-small"
                    onClick={() => onRevoke(i.code)}
                  >
                    Revoke
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function TypingIndicator({ typers }: { typers: { name: string }[] }) {
  if (typers.length === 0) return null;
  let label: string;
  if (typers.length === 1) label = `${typers[0].name} is typing…`;
  else if (typers.length === 2)
    label = `${typers[0].name} and ${typers[1].name} are typing…`;
  else if (typers.length === 3)
    label = `${typers[0].name}, ${typers[1].name}, and ${typers[2].name} are typing…`;
  else label = "Several people are typing…";
  return <div className="typing-indicator">{label}</div>;
}

function MessageReactions({
  reactions,
  onToggle,
}: {
  reactions: Reaction[];
  onToggle: (emoji: string) => void;
}) {
  if (!reactions || reactions.length === 0) return null;
  return (
    <div className="message-reactions">
      {reactions.map((r) => (
        <button
          key={r.emoji}
          className={`reaction-chip ${r.me ? "mine" : ""}`}
          onClick={() => onToggle(r.emoji)}
          title={r.me ? "Remove your reaction" : "Add your reaction"}
        >
          <span className="reaction-emoji">{r.emoji}</span>
          <span className="reaction-count">{r.count}</span>
        </button>
      ))}
    </div>
  );
}

const RECENT_EMOJI_KEY = "voxply.recentEmojis";
const RECENT_EMOJI_MAX = 8;

function loadRecentEmojis(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_EMOJI_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, RECENT_EMOJI_MAX) : [];
  } catch {
    return [];
  }
}

function pushRecentEmoji(emoji: string) {
  try {
    const cur = loadRecentEmojis();
    const next = [emoji, ...cur.filter((e) => e !== emoji)].slice(
      0,
      RECENT_EMOJI_MAX,
    );
    localStorage.setItem(RECENT_EMOJI_KEY, JSON.stringify(next));
  } catch {
    // localStorage full / disabled → just no recents, no big deal
  }
}

function ReactionPicker({
  onPick,
}: {
  onPick: (emoji: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // Re-read recents whenever we open so picks made elsewhere show up.
  const [recents, setRecents] = useState<string[]>(() => loadRecentEmojis());

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return EMOJI_CATALOG;
    return EMOJI_CATALOG.filter(([_emoji, kw]) => kw.includes(q));
  }, [query]);

  function handleClose() {
    setOpen(false);
    setQuery("");
  }

  function handlePick(emoji: string) {
    pushRecentEmoji(emoji);
    setRecents(loadRecentEmojis());
    onPick(emoji);
    handleClose();
  }

  return (
    <div className="reaction-picker">
      <button
        className="reaction-add-btn"
        onClick={() => {
          if (!open) setRecents(loadRecentEmojis());
          setOpen((v) => !v);
        }}
        title="Add reaction"
      >
        🙂+
      </button>
      {open && (
        <div
          className="reaction-picker-popup"
          onClick={(e) => e.stopPropagation()}
        >
          <input
            autoFocus
            className="reaction-picker-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") handleClose();
              else if (e.key === "Enter" && filtered.length > 0) {
                handlePick(filtered[0][0]);
              }
            }}
            placeholder="Search emoji…"
          />
          {!query && recents.length > 0 && (
            <>
              <div className="reaction-picker-section-label">Recent</div>
              <div className="reaction-picker-grid reaction-picker-recents">
                {recents.map((emoji) => (
                  <button
                    key={`r-${emoji}`}
                    className="reaction-picker-emoji"
                    onClick={() => handlePick(emoji)}
                    title={emoji}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
              <div className="reaction-picker-divider" />
            </>
          )}
          <div className="reaction-picker-grid">
            {filtered.length === 0 ? (
              <span className="muted reaction-picker-empty">No matches</span>
            ) : (
              filtered.map(([emoji]) => (
                <button
                  key={emoji}
                  className="reaction-picker-emoji"
                  onClick={() => handlePick(emoji)}
                  title={emoji}
                >
                  {emoji}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function PendingAttachments({
  items,
  onRemove,
}: {
  items: Attachment[];
  onRemove: (i: number) => void;
}) {
  return (
    <div className="pending-attachments">
      {items.map((a, i) => (
        <div key={i} className="pending-attachment">
          {a.mime.startsWith("image/") ? (
            <img
              src={`data:${a.mime};base64,${a.data_b64}`}
              alt={a.name}
              className="pending-attachment-thumb"
            />
          ) : (
            <span className="pending-attachment-file">📄 {a.name}</span>
          )}
          <button
            className="pending-attachment-remove"
            onClick={() => onRemove(i)}
            title="Remove"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

function MessageAttachments({
  items,
  onImageClick,
}: {
  items: Attachment[];
  onImageClick?: (url: string, alt: string) => void;
}) {
  if (!items || items.length === 0) return null;
  return (
    <div className="message-attachments">
      {items.map((a, i) => {
        const url = `data:${a.mime};base64,${a.data_b64}`;
        if (a.mime.startsWith("image/")) {
          return (
            <button
              key={i}
              type="button"
              className="message-attachment-img-button"
              onClick={() => onImageClick?.(url, a.name)}
              title="Click to enlarge"
            >
              <img src={url} alt={a.name} className="message-attachment-img" />
            </button>
          );
        }
        return (
          <a
            key={i}
            href={url}
            download={a.name}
            className="message-attachment-file"
          >
            📄 {a.name}
          </a>
        );
      })}
    </div>
  );
}

function Lightbox({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt: string;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="lightbox" onClick={onClose}>
      <img
        src={src}
        alt={alt}
        className="lightbox-img"
        onClick={(e) => e.stopPropagation()}
      />
      <button
        className="lightbox-close"
        onClick={onClose}
        title="Close (Esc)"
      >
        ×
      </button>
    </div>
  );
}

/**
 * Pipeline-style markdown renderer. Each pass walks the current array of
 * (string | ReactNode) parts and replaces any matches in the *string*
 * parts with the rendered React node. Because we never feed user input
 * into innerHTML, this is XSS-safe by construction -- React escapes text
 * children automatically.
 *
 * Order matters: code blocks first (their content shouldn't be parsed
 * for any other rules), then inline code, then bold, italic, mentions,
 * URLs.
 */
type Part = string | React.ReactNode;

function splitOnPattern(
  parts: Part[],
  re: RegExp,
  render: (match: RegExpExecArray, key: string) => React.ReactNode
): Part[] {
  const out: Part[] = [];
  parts.forEach((p, i) => {
    if (typeof p !== "string") {
      out.push(p);
      return;
    }
    let lastIdx = 0;
    let m: RegExpExecArray | null;
    const rx = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    let n = 0;
    while ((m = rx.exec(p)) !== null) {
      if (m.index > lastIdx) out.push(p.slice(lastIdx, m.index));
      out.push(render(m, `${i}-${n++}`));
      lastIdx = m.index + m[0].length;
      // Guard against zero-width matches looping forever.
      if (m[0].length === 0) rx.lastIndex++;
    }
    if (lastIdx < p.length) out.push(p.slice(lastIdx));
  });
  return out;
}

function MessageContent({
  content,
  knownNames,
  myName,
}: {
  content: string;
  knownNames: Set<string>;
  myName: string | null;
}) {
  const myLower = myName?.toLowerCase() ?? null;
  let parts: Part[] = [content];

  // Fenced code blocks. Optionally accept a language hint on the same line
  // as the opening fence: ```rust\n...\n```. The hint becomes a small label
  // above the block; we don't actually highlight by language yet, but the
  // tag is preserved instead of leaking into the rendered code.
  parts = splitOnPattern(
    parts,
    /```([A-Za-z0-9_+-]*)\n?([\s\S]+?)```/,
    (m, key) => {
      const lang = m[1] || "";
      const body = m[2].replace(/^\n/, "").replace(/\n$/, "");
      return (
        <div key={key} className="md-codeblock-wrap">
          {lang && <div className="md-codeblock-lang">{lang}</div>}
          <pre className="md-codeblock">
            <code>{body}</code>
          </pre>
        </div>
      );
    }
  );

  // Inline code
  parts = splitOnPattern(parts, /`([^`\n]+)`/, (m, key) => (
    <code key={key} className="md-code">
      {m[1]}
    </code>
  ));

  // Bold (must run before italic since ** would otherwise match * twice)
  parts = splitOnPattern(parts, /\*\*([^*\n]+)\*\*/, (m, key) => (
    <strong key={key}>{m[1]}</strong>
  ));

  // Italic — single asterisk with no spaces flanking.
  parts = splitOnPattern(parts, /\*([^*\s][^*\n]*[^*\s]|[^*\s])\*/, (m, key) => (
    <em key={key}>{m[1]}</em>
  ));

  // Bare URLs → external links
  parts = splitOnPattern(parts, /https?:\/\/[^\s<]+/, (m, key) => (
    <a key={key} href={m[0]} target="_blank" rel="noreferrer">
      {m[0]}
    </a>
  ));

  // Mentions — last so they don't collide with URL/markdown chars
  parts = splitOnPattern(parts, /@([\w.\-]+)/, (m, key) => {
    const name = m[1].toLowerCase();
    if (!knownNames.has(name)) return m[0];
    const isSelf = myLower !== null && name === myLower;
    return (
      <span key={key} className={`mention ${isSelf ? "mention-self" : ""}`}>
        {m[0]}
      </span>
    );
  });

  return <>{parts.map((p, i) => (typeof p === "string" ? <span key={i}>{p}</span> : p))}</>;
}

/**
 * Plays a short two-tone "ping" via WebAudio. We synthesize it on demand
 * rather than bundle an audio file -- it's ~20 lines, has no licensing
 * concerns, and the user can tell what they're hearing without waiting
 * for a file fetch on first play.
 */
let cachedAudioCtx: AudioContext | null = null;
function playMentionPing() {
  try {
    const ctx =
      cachedAudioCtx ??
      (cachedAudioCtx = new (window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext)());
    const now = ctx.currentTime;
    const tone = (freq: number, start: number, dur: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.type = "sine";
      gain.gain.setValueAtTime(0, now + start);
      gain.gain.linearRampToValueAtTime(0.18, now + start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, now + start + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + start);
      osc.stop(now + start + dur);
    };
    tone(880, 0, 0.12);
    tone(1175, 0.08, 0.18);
  } catch {
    // Audio is best-effort; fail silently if the context can't start.
  }
}

/**
 * "/me does the thing" → render in third person. Only triggers when /me is
 * the very first 4 chars of the message and there's at least one trailing
 * char of action text. Keeps the expected IRC-style behavior without
 * accidentally swallowing messages that happen to mention "/me " mid-line.
 */
function meAction(content: string): string | null {
  if (content.startsWith("/me ") && content.length > 4) {
    return content.slice(4);
  }
  return null;
}

/** Returns true if `content` contains an @mention of `name` (case-insensitive). */
function mentionsName(content: string, name: string | null): boolean {
  if (!name) return false;
  const lower = name.toLowerCase();
  const re = /@([\w.\-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    if (m[1].toLowerCase() === lower) return true;
  }
  return false;
}

/**
 * Stable color for a public key. Hashes the pubkey to a hue and pins
 * saturation/lightness so the result is always legible against the dark
 * theme. Empty/missing keys fall back to the accent color.
 */
function colorForKey(pubkey: string | null | undefined): string {
  if (!pubkey) return "var(--accent)";
  // Tiny FNV-1a — plenty of entropy for hue distribution and cheap to run
  // on every render.
  let h = 2166136261;
  for (let i = 0; i < pubkey.length; i++) {
    h ^= pubkey.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const hue = ((h >>> 0) % 360);
  return `hsl(${hue}, 55%, 65%)`;
}

/** Local-day key (yyyy-mm-dd) used to detect day boundaries. */
function dayKey(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Friendly label for a day separator: Today / Yesterday / Mar 4 / Mar 4, 2024. */
function formatDayLabel(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  const today = new Date();
  const yest = new Date();
  yest.setDate(today.getDate() - 1);
  if (dayKey(unixSec) === dayKey(today.getTime() / 1000)) return "Today";
  if (dayKey(unixSec) === dayKey(yest.getTime() / 1000)) return "Yesterday";
  const sameYear = d.getFullYear() === today.getFullYear();
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
  });
}

/** Localized full timestamp suitable for a hover tooltip. */
function formatFullTimestamp(unixSec: number): string {
  if (!unixSec) return "";
  const d = new Date(unixSec * 1000);
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year:
      d.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatRelative(unixSec: number): string {
  if (!unixSec) return "—";
  const now = Math.floor(Date.now() / 1000);
  const diff = now - unixSec;
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function MemberRow({
  member,
  allRoles,
  voiceMuted,
  onKick,
  onBan,
  onMute,
  onTimeout,
  onVoiceMute,
  onVoiceUnmute,
  onToggleRole,
}: {
  member: MemberAdminInfo;
  allRoles: RoleInfo[];
  voiceMuted: boolean;
  onKick: () => void;
  onBan: () => void;
  onMute: () => void;
  onTimeout: () => void;
  onVoiceMute: () => void;
  onVoiceUnmute: () => void;
  onToggleRole: (roleId: string, hasRole: boolean) => void;
}) {
  const [showRoleMenu, setShowRoleMenu] = useState(false);
  const hasRoleId = new Set(member.roles.map((r) => r.id));

  return (
    <tr>
      <td>
        <div className="member-name">
          {member.display_name || formatPubkey(member.public_key)}
        </div>
        <div className="member-pk" title={member.public_key}>
          {formatPubkey(member.public_key)}
        </div>
      </td>
      <td>
        <span className={`status-dot ${member.online ? "online" : "offline"}`} />{" "}
        {member.online ? "Online" : "Offline"}
      </td>
      <td>
        <div className="member-roles">
          {member.roles.map((r) => (
            <span key={r.id} className="member-role-chip">
              {r.name}
            </span>
          ))}
          {member.roles.length === 0 && <span className="muted">none</span>}
        </div>
      </td>
      <td>{formatRelative(member.first_seen_at)}</td>
      <td>{formatRelative(member.last_seen_at)}</td>
      <td>
        <div className="member-actions">
          <button
            className="btn-small"
            onClick={() => setShowRoleMenu(!showRoleMenu)}
          >
            Roles ▾
          </button>
          <button className="btn-small" onClick={onTimeout}>
            Timeout
          </button>
          <button className="btn-small" onClick={onMute}>
            Mute
          </button>
          {voiceMuted ? (
            <button className="btn-small" onClick={onVoiceUnmute}>
              Unmute voice
            </button>
          ) : (
            <button className="btn-small" onClick={onVoiceMute}>
              Mute voice
            </button>
          )}
          <button className="btn-small" onClick={onKick}>
            Kick
          </button>
          <button className="btn-small btn-secondary-small" onClick={onBan}>
            Ban
          </button>
          {showRoleMenu && (
            <div className="member-role-menu">
              {allRoles.map((r) => {
                const has = hasRoleId.has(r.id);
                // Owner role can't be toggled here (protects server-side rule).
                if (r.id === "builtin-owner") return null;
                return (
                  <label key={r.id} className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={has}
                      onChange={() => onToggleRole(r.id, has)}
                    />
                    {r.name}
                  </label>
                );
              })}
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}

function RoleEditor({
  role,
  onUpdate,
  onDelete,
}: {
  role: RoleInfo;
  onUpdate: (updates: {
    name?: string;
    permissions?: string[];
    priority?: number;
    display_separately?: boolean;
  }) => void;
  onDelete: () => void;
}) {
  const isBuiltin = role.id.startsWith("builtin-");
  const isOwner = role.id === "builtin-owner";
  const [name, setName] = useState(role.name);
  const [priority, setPriority] = useState(role.priority);
  const [perms, setPerms] = useState<Set<string>>(new Set(role.permissions));
  const [displaySeparately, setDisplaySeparately] = useState(
    role.display_separately ?? false
  );

  // Sync local state when the role prop changes (e.g., after a refresh)
  useEffect(() => {
    setName(role.name);
    setPriority(role.priority);
    setPerms(new Set(role.permissions));
    setDisplaySeparately(role.display_separately ?? false);
  }, [role.id, role.name, role.priority, role.permissions.join(","), role.display_separately]);

  function togglePerm(p: string) {
    const next = new Set(perms);
    if (next.has(p)) next.delete(p);
    else next.add(p);
    setPerms(next);
  }

  function save() {
    onUpdate({
      name: isBuiltin ? undefined : name,
      priority: isBuiltin ? undefined : priority,
      permissions: isOwner ? undefined : Array.from(perms),
      display_separately: displaySeparately,
    });
  }

  return (
    <div className="role-editor">
      <div className="settings-row">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={isBuiltin}
        />
        <input
          type="number"
          value={priority}
          onChange={(e) => setPriority(Number(e.target.value))}
          disabled={isBuiltin}
          style={{ maxWidth: 90 }}
          title="Priority (higher = more powerful)"
        />
      </div>
      <div className="role-perms">
        {ALL_PERMISSIONS.map((p) => (
          <label key={p.id} className="checkbox-label">
            <input
              type="checkbox"
              checked={perms.has(p.id)}
              onChange={() => togglePerm(p.id)}
              disabled={isOwner}
            />
            {p.label}
          </label>
        ))}
      </div>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={displaySeparately}
          onChange={(e) => setDisplaySeparately(e.target.checked)}
        />
        Display members of this role separately in the user list
      </label>
      <div className="settings-row">
        <button onClick={save}>Save</button>
        {!isBuiltin && (
          <button onClick={onDelete} className="btn-secondary">
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

function RoleCreator({
  onCreate,
}: {
  onCreate: (
    name: string,
    perms: string[],
    priority: number,
    displaySeparately: boolean
  ) => void;
}) {
  const [name, setName] = useState("");
  const [priority, setPriority] = useState(10);
  const [perms, setPerms] = useState<Set<string>>(new Set());
  const [displaySeparately, setDisplaySeparately] = useState(false);

  function togglePerm(p: string) {
    const next = new Set(perms);
    if (next.has(p)) next.delete(p);
    else next.add(p);
    setPerms(next);
  }

  function create() {
    const trimmed = name.trim();
    if (!trimmed) return;
    onCreate(trimmed, Array.from(perms), priority, displaySeparately);
    setName("");
    setPriority(10);
    setPerms(new Set());
    setDisplaySeparately(false);
  }

  return (
    <div className="role-editor role-creator">
      <h3>Create role</h3>
      <div className="settings-row">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Role name"
        />
        <input
          type="number"
          value={priority}
          onChange={(e) => setPriority(Number(e.target.value))}
          style={{ maxWidth: 90 }}
          title="Priority"
        />
      </div>
      <div className="role-perms">
        {ALL_PERMISSIONS.map((p) => (
          <label key={p.id} className="checkbox-label">
            <input
              type="checkbox"
              checked={perms.has(p.id)}
              onChange={() => togglePerm(p.id)}
            />
            {p.label}
          </label>
        ))}
      </div>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={displaySeparately}
          onChange={(e) => setDisplaySeparately(e.target.checked)}
        />
        Display members of this role separately in the user list
      </label>
      <div className="settings-row">
        <button onClick={create}>Create role</button>
      </div>
    </div>
  );
}

function HubAdminPage(props: HubAdminPageProps) {
  const tabs: { id: HubAdminTab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "roles", label: "Roles" },
    { id: "members", label: "Members" },
    { id: "bans", label: "Bans" },
    { id: "invites", label: "Invites" },
    { id: "alliances", label: "Alliances" },
  ];


  return (
    <div className="settings-page">
      <aside className="settings-nav">
        <h2>Hub settings</h2>
        <ul>
          {tabs.map((t) => (
            <li key={t.id}>
              <button
                className={`settings-nav-item ${props.tab === t.id ? "active" : ""}`}
                onClick={() => props.onTab(t.id)}
              >
                {t.label}
              </button>
            </li>
          ))}
        </ul>
        <button className="settings-nav-close" onClick={props.onClose}>
          Close (ESC)
        </button>
      </aside>
      <main className="settings-content">
        <button className="settings-close-x" onClick={props.onClose} title="Close">
          ×
        </button>
        {props.tab === "overview" && (
          <section>
            <h1>Overview</h1>
            <div className="settings-section">
              <label className="settings-label">Hub name</label>
              <input
                type="text"
                value={props.hubName}
                onChange={(e) => props.onHubNameChange(e.target.value)}
                placeholder="My Hub"
              />
            </div>
            <div className="settings-section">
              <label className="settings-label">Description</label>
              <p className="muted">Shown to visitors before they join.</p>
              <textarea
                rows={3}
                value={props.hubDescription}
                onChange={(e) => props.onHubDescriptionChange(e.target.value)}
                placeholder="What's this hub for?"
              />
            </div>
            <div className="settings-section">
              <label className="settings-label">Icon</label>
              <p className="muted">
                PNG or JPG, max 256 KB. Stored inline on the hub.
              </p>
              <div className="hub-icon-editor">
                {props.hubIcon ? (
                  <img src={props.hubIcon} alt="Hub icon" className="hub-icon-preview" />
                ) : (
                  <div className="hub-icon-preview placeholder">No icon</div>
                )}
                <ImagePicker
                  onPick={props.onHubIconChange}
                  onClear={() => props.onHubIconChange("")}
                  hasValue={!!props.hubIcon}
                  buttonLabel="Pick image"
                />
              </div>
            </div>
            <div className="settings-section">
              <label className="settings-label">Membership</label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={props.requireApproval}
                  onChange={(e) => props.onRequireApprovalChange(e.target.checked)}
                />
                Require admin approval before new members can participate
              </label>
              <p className="muted">
                When on, anyone who authenticates is marked pending. They can
                see their own status but nothing else until an admin approves
                them on the Members tab.
              </p>
            </div>
            <div className="settings-section">
              <button onClick={props.onSave}>Save changes</button>
            </div>
          </section>
        )}
        {props.tab === "roles" && (
          <section>
            <h1>Roles</h1>
            <p className="muted">
              Built-in roles (@everyone, Owner) can't be renamed or deleted but
              @everyone permissions can be tuned.
            </p>
            {props.roles
              .slice()
              .sort((a, b) => b.priority - a.priority)
              .map((role) => (
                <RoleEditor
                  key={role.id}
                  role={role}
                  onUpdate={(updates) => props.onUpdateRole(role.id, updates)}
                  onDelete={() => props.onDeleteRole(role.id)}
                />
              ))}
            <RoleCreator onCreate={props.onCreateRole} />
          </section>
        )}
        {props.tab === "members" && (
          <section>
            {props.pendingMembers.length > 0 && (
              <div className="pending-section">
                <h2>Pending approval — {props.pendingMembers.length}</h2>
                <table className="members-table">
                  <thead>
                    <tr>
                      <th>User</th>
                      <th>Signed up</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {props.pendingMembers.map((p) => (
                      <tr key={p.public_key}>
                        <td>
                          <div className="member-name">
                            {p.display_name || "(no name)"}
                          </div>
                          <div className="member-pk" title={p.public_key}>
                            {formatPubkey(p.public_key)}
                          </div>
                        </td>
                        <td>{formatRelative(p.first_seen_at)}</td>
                        <td>
                          <button
                            className="btn-small"
                            onClick={() => props.onApproveMember(p.public_key)}
                          >
                            Approve
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <h1>Members — {props.members.length}</h1>
            <table className="members-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Status</th>
                  <th>Roles</th>
                  <th>Joined</th>
                  <th>Last seen</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {props.members.map((m) => (
                  <MemberRow
                    key={m.public_key}
                    member={m}
                    allRoles={props.roles}
                    voiceMuted={props.voiceMutedKeys.has(m.public_key)}
                    onKick={() => props.onKickMember(m.public_key)}
                    onBan={() => props.onBanMember(m.public_key)}
                    onMute={() => props.onMuteMember(m.public_key)}
                    onTimeout={() => props.onTimeoutMember(m.public_key)}
                    onVoiceMute={() => props.onVoiceMuteMember(m.public_key)}
                    onVoiceUnmute={() => props.onVoiceUnmuteMember(m.public_key)}
                    onToggleRole={(roleId, has) =>
                      props.onToggleRoleAssignment(m.public_key, roleId, has)
                    }
                  />
                ))}
              </tbody>
            </table>
            {props.members.length === 0 && (
              <p className="muted">No members yet.</p>
            )}
          </section>
        )}
        {props.tab === "bans" && (
          <section>
            <h1>Bans — {props.bans.length}</h1>
            {props.bans.length === 0 ? (
              <p className="muted">No active bans.</p>
            ) : (
              <table className="members-table">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Reason</th>
                    <th>Banned by</th>
                    <th>When</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {props.bans.map((b) => (
                    <tr key={b.target_public_key}>
                      <td>
                        <div className="member-pk" title={b.target_public_key}>
                          {formatPubkey(b.target_public_key)}
                        </div>
                      </td>
                      <td>{b.reason || <span className="muted">—</span>}</td>
                      <td>
                        <span className="member-pk" title={b.banned_by}>
                          {formatPubkey(b.banned_by)}
                        </span>
                      </td>
                      <td>{formatRelative(b.created_at)}</td>
                      <td>
                        <button
                          className="btn-small"
                          onClick={() => props.onUnban(b.target_public_key)}
                        >
                          Unban
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )}
        {props.tab === "invites" && (
          <InvitesSection
            invites={props.invites}
            hubUrl={props.activeHubUrl}
            onCreate={props.onCreateInvite}
            onRevoke={props.onRevokeInvite}
          />
        )}
        {props.tab === "alliances" && (
          <AlliancesSection
            channels={props.channels}
            ownHubUrl={props.activeHubUrl}
          />
        )}
      </main>
    </div>
  );
}

interface AllianceInfo {
  id: string;
  name: string;
  created_by: string;
  created_at: number;
}

interface AllianceMemberInfo {
  hub_public_key: string;
  hub_name: string;
  hub_url: string;
  joined_at: number;
}

interface AllianceDetail {
  id: string;
  name: string;
  created_by: string;
  created_at: number;
  members: AllianceMemberInfo[];
}

interface AllianceInvite {
  token: string;
  alliance_id: string;
  alliance_name: string;
  hub_url: string;
}

interface AllianceSharedChannel {
  channel_id: string;
  channel_name: string;
  hub_public_key: string;
  hub_name: string;
}

function AlliancesSection({
  channels,
  ownHubUrl,
}: {
  channels: Channel[];
  ownHubUrl: string;
}) {
  const [alliances, setAlliances] = useState<AllianceInfo[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AllianceDetail | null>(null);
  const [shared, setShared] = useState<AllianceSharedChannel[]>([]);
  const [invite, setInvite] = useState<AllianceInvite | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [newName, setNewName] = useState("");
  const [joinUrl, setJoinUrl] = useState("");
  const [joinAllianceId, setJoinAllianceId] = useState("");
  const [joinToken, setJoinToken] = useState("");

  async function refresh() {
    try {
      const list = await invoke<AllianceInfo[]>("list_alliances");
      setAlliances(list);
      if (selectedId && !list.find((a) => a.id === selectedId)) {
        setSelectedId(null);
        setDetail(null);
        setShared([]);
      }
    } catch (e) {
      setError(String(e));
    }
  }

  async function refreshDetail(id: string) {
    try {
      const d = await invoke<AllianceDetail>("get_alliance", { allianceId: id });
      const sh = await invoke<AllianceSharedChannel[]>(
        "list_alliance_shared_channels",
        { allianceId: id }
      );
      setDetail(d);
      setShared(sh);
    } catch (e) {
      setError(String(e));
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (selectedId) refreshDetail(selectedId);
  }, [selectedId]);

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    try {
      const created = await invoke<AllianceInfo>("create_alliance", { name });
      setNewName("");
      await refresh();
      setSelectedId(created.id);
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleGenerateInvite() {
    if (!selectedId) return;
    try {
      const inv = await invoke<AllianceInvite>("create_alliance_invite", {
        allianceId: selectedId,
      });
      setInvite(inv);
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleJoin() {
    const url = joinUrl.trim();
    const id = joinAllianceId.trim();
    const tok = joinToken.trim();
    if (!url || !id || !tok) return;
    try {
      await invoke("join_alliance", {
        inviterHubUrl: url,
        allianceId: id,
        inviteToken: tok,
        ownHubPublicUrl: ownHubUrl || url,
      });
      setJoinUrl("");
      setJoinAllianceId("");
      setJoinToken("");
      await refresh();
      setSelectedId(id);
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleLeave() {
    if (!selectedId) return;
    if (!confirm("Leave this alliance? Your hub stops sharing channels with it.")) return;
    try {
      await invoke("leave_alliance", { allianceId: selectedId });
      setSelectedId(null);
      setDetail(null);
      setShared([]);
      setInvite(null);
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleToggleShare(channelId: string, currentlyShared: boolean) {
    if (!selectedId) return;
    try {
      if (currentlyShared) {
        await invoke("unshare_channel_from_alliance", {
          allianceId: selectedId,
          channelId,
        });
      } else {
        await invoke("share_channel_with_alliance", {
          allianceId: selectedId,
          channelId,
        });
      }
      await refreshDetail(selectedId);
    } catch (e) {
      setError(String(e));
    }
  }

  const sharedChannelIds = new Set(shared.map((s) => s.channel_id));
  const localChannels = channels.filter((c) => !c.is_category);

  return (
    <section>
      <h1>Alliances</h1>
      <p className="muted">
        Group your hub with other hubs to share channels, voice, and games. A
        hub can be in multiple alliances.
      </p>

      {error && <div className="error-banner">{error}</div>}

      <div className="settings-section">
        <label className="settings-label">Your alliances</label>
        {alliances.length === 0 ? (
          <p className="muted">Not in any alliance yet.</p>
        ) : (
          <ul className="alliance-list">
            {alliances.map((a) => (
              <li
                key={a.id}
                className={`alliance-item ${selectedId === a.id ? "active" : ""}`}
                onClick={() => setSelectedId(a.id)}
              >
                {a.name}
              </li>
            ))}
          </ul>
        )}
      </div>

      {selectedId && detail && (
        <div className="alliance-detail">
          <div className="alliance-detail-header">
            <h2>{detail.name}</h2>
            <button className="btn-secondary-small" onClick={handleLeave}>
              Leave alliance
            </button>
          </div>

          <div className="settings-section">
            <label className="settings-label">Member hubs</label>
            <ul className="alliance-members">
              {detail.members.map((m) => (
                <li key={m.hub_public_key}>
                  <strong>{m.hub_name}</strong>
                  <span className="muted"> — {m.hub_url}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="settings-section">
            <label className="settings-label">Channels you share</label>
            <p className="muted">
              Toggle which of your local channels are visible to other members
              of this alliance.
            </p>
            {localChannels.length === 0 ? (
              <p className="muted">No channels to share yet.</p>
            ) : (
              <ul className="alliance-share-list">
                {localChannels.map((c) => {
                  const isShared = sharedChannelIds.has(c.id);
                  return (
                    <li key={c.id}>
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={isShared}
                          onChange={() => handleToggleShare(c.id, isShared)}
                        />
                        # {c.name}
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="settings-section">
            <label className="settings-label">Invite another hub</label>
            <p className="muted">
              Generate an invite token and share it (along with this hub's URL
              and the alliance ID) with the other hub's admin.
            </p>
            <button className="btn-secondary" onClick={handleGenerateInvite}>
              {invite ? "Regenerate invite token" : "Generate invite token"}
            </button>
            {invite && invite.alliance_id === selectedId && (
              <div className="alliance-invite-block">
                <div className="alliance-invite-row">
                  <span className="muted">Alliance ID</span>
                  <code>{invite.alliance_id}</code>
                </div>
                <div className="alliance-invite-row">
                  <span className="muted">Inviter hub URL</span>
                  <code>{ownHubUrl}</code>
                </div>
                <div className="alliance-invite-row">
                  <span className="muted">Token</span>
                  <code className="alliance-token">{invite.token}</code>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="settings-section">
        <label className="settings-label">Create a new alliance</label>
        <div className="settings-row">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Alliance name"
          />
          <button onClick={handleCreate} disabled={!newName.trim()}>
            Create
          </button>
        </div>
      </div>

      <div className="settings-section">
        <label className="settings-label">Join an alliance</label>
        <p className="muted">
          Paste the inviter hub's URL, the alliance ID, and the invite token
          you were given.
        </p>
        <div className="alliance-join-form">
          <input
            type="text"
            value={joinUrl}
            onChange={(e) => setJoinUrl(e.target.value)}
            placeholder="Inviter hub URL (https://...)"
          />
          <input
            type="text"
            value={joinAllianceId}
            onChange={(e) => setJoinAllianceId(e.target.value)}
            placeholder="Alliance ID"
          />
          <input
            type="text"
            value={joinToken}
            onChange={(e) => setJoinToken(e.target.value)}
            placeholder="Invite token"
          />
          <button
            onClick={handleJoin}
            disabled={
              !joinUrl.trim() || !joinAllianceId.trim() || !joinToken.trim()
            }
          >
            Join
          </button>
        </div>
      </div>
    </section>
  );
}

function App() {
  // Multi-hub state
  const [hubs, setHubs] = useState<Hub[]>([]);
  const [activeHubId, setActiveHubId] = useState<string | null>(null);
  const [showAddHub, setShowAddHub] = useState(false);
  const [hubUrl, setHubUrl] = useState("http://localhost:3000");
  // Per-channel unread tracking: hub_id -> { channel_id: true }. Persisted
  // across restarts via Tauri so dots survive the app being closed. Derived
  // counts (per hub, total) drive the badges and tray tooltip.
  const [unreadByChannel, setUnreadByChannel] = useState<
    Record<string, Record<string, boolean>>
  >({});

  // Notification mode per scope.
  // - "all": notify on every message (default; entries omitted from state)
  // - "mentions": only notify when the current user is @-mentioned
  // - "silent": no notifications at all
  // Channel-level overrides hub-level; hub-level overrides the "all" default.
  // Persisted shape keeps the old map keys (hubs, channels) for back-compat:
  // the old binary `true` is interpreted as "silent" on load.
  const [hubNotifyMode, setHubNotifyMode] = useState<Record<string, NotifyMode>>(
    {},
  );
  const [channelNotifyMode, setChannelNotifyMode] = useState<
    Record<string, Record<string, NotifyMode>>
  >({});

  // Pinned channels. Local-only per (hub, channel). Pinned channels render
  // in their own section above the regular Channels list and don't appear
  // in the normal list (no duplication).
  const [pinnedChannels, setPinnedChannels] = useState<
    Record<string, Record<string, boolean>>
  >({});

  // Voice channel populations: channel_id -> count. Polled while a hub is
  // active so the sidebar can show "🎙️ N" hints. Channels not in the map
  // have zero participants.
  const [voicePops, setVoicePops] = useState<Record<string, number>>({});
  // Public keys of users currently in any voice channel on the active hub.
  // Polled alongside voicePops; lets the member list show a 🎙️ chip.
  const [voiceActiveUsers, setVoiceActiveUsers] = useState<Set<string>>(
    new Set(),
  );

  // Collapsed categories: hub_id -> { category_id: true }. Persisted so a
  // folded category stays folded across restarts. Categories not in the
  // map render expanded by default.
  const [collapsedCategories, setCollapsedCategories] = useState<
    Record<string, Record<string, boolean>>
  >({});

  function toggleCategoryCollapsed(hubId: string, categoryId: string) {
    setCollapsedCategories((prev) => {
      const hubMap = { ...(prev[hubId] ?? {}) };
      if (hubMap[categoryId]) delete hubMap[categoryId];
      else hubMap[categoryId] = true;
      const next = { ...prev, [hubId]: hubMap };
      invoke("save_collapsed_categories", { state: next }).catch(() => {});
      return next;
    });
  }

  // WS connection status per hub. Missing key means connected (default
  // optimistic so the very first render doesn't flash a banner).
  const [hubConnected, setHubConnected] = useState<Record<string, boolean>>({});
  const [reconnectingHubs, setReconnectingHubs] = useState<Record<string, boolean>>({});

  function toggleChannelPin(hubId: string, channelId: string) {
    setPinnedChannels((prev) => {
      const hubMap = { ...(prev[hubId] ?? {}) };
      if (hubMap[channelId]) delete hubMap[channelId];
      else hubMap[channelId] = true;
      const next = { ...prev, [hubId]: hubMap };
      invoke("save_pinned_channels", { state: next }).catch(() => {});
      return next;
    });
  }

  function persistNotifyModes(
    hubs: typeof hubNotifyMode,
    channels: typeof channelNotifyMode,
  ) {
    invoke("save_notification_mutes", {
      state: { hubs, channels },
    }).catch(() => {});
  }

  function effectiveNotifyMode(hubId: string, channelId: string): NotifyMode {
    return (
      channelNotifyMode[hubId]?.[channelId] ??
      hubNotifyMode[hubId] ??
      "all"
    );
  }

  function setHubMode(hubId: string, mode: NotifyMode) {
    setHubNotifyMode((prev) => {
      const next = { ...prev };
      if (mode === "all") delete next[hubId];
      else next[hubId] = mode;
      persistNotifyModes(next, channelNotifyMode);
      return next;
    });
  }

  function setChannelMode(hubId: string, channelId: string, mode: NotifyMode) {
    setChannelNotifyMode((prev) => {
      const hubMap = { ...(prev[hubId] ?? {}) };
      if (mode === "all") delete hubMap[channelId];
      else hubMap[channelId] = mode;
      const next = { ...prev, [hubId]: hubMap };
      persistNotifyModes(hubNotifyMode, next);
      return next;
    });
  }

  function bumpUnread(hubId: string, channelId: string) {
    setUnreadByChannel((prev) => {
      const hubMap = prev[hubId] ?? {};
      if (hubMap[channelId]) return prev; // already marked
      const next = {
        ...prev,
        [hubId]: { ...hubMap, [channelId]: true as boolean },
      };
      invoke("save_unread_state", { state: next }).catch(() => {});
      return next;
    });
  }

  function clearUnread(hubId: string, channelId: string) {
    setUnreadByChannel((prev) => {
      const hubMap = prev[hubId];
      if (!hubMap || !hubMap[channelId]) return prev;
      const { [channelId]: _, ...rest } = hubMap;
      const next = { ...prev, [hubId]: rest };
      invoke("save_unread_state", { state: next }).catch(() => {});
      return next;
    });
  }

  function clearHubUnread(hubId: string) {
    setUnreadByChannel((prev) => {
      if (!prev[hubId] || Object.keys(prev[hubId]).length === 0) return prev;
      const next = { ...prev, [hubId]: {} };
      invoke("save_unread_state", { state: next }).catch(() => {});
      return next;
    });
  }

  const unreadByHub: Record<string, number> = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [hub, m] of Object.entries(unreadByChannel)) {
      out[hub] = Object.keys(m).length;
    }
    return out;
  }, [unreadByChannel]);

  // Push the aggregated unread count into the system tray tooltip AND the
  // window title whenever it changes. The title is what taskbars/docks show,
  // so the "(N) Voxply" prefix flags attention even when the window isn't
  // foregrounded.
  useEffect(() => {
    const total = Object.values(unreadByHub).reduce((n, v) => n + v, 0);
    invoke("set_tray_unread", { count: total }).catch(() => {});
    document.title = total > 0 ? `(${total > 99 ? "99+" : total}) Voxply` : "Voxply";
  }, [unreadByHub]);

  // Hydrate persisted unread state on launch.
  useEffect(() => {
    invoke<Record<string, Record<string, boolean>>>("load_unread_state")
      .then((s) => setUnreadByChannel(s ?? {}))
      .catch(() => {});
  }, []);

  // Hydrate persisted notification modes on launch. Old persisted shape
  // used `true` for muted; we normalize that to "silent" so older configs
  // still work.
  useEffect(() => {
    function normalizeMode(v: unknown): NotifyMode | undefined {
      if (v === true) return "silent";
      if (v === "silent" || v === "mentions" || v === "all") return v;
      return undefined;
    }
    invoke<{
      hubs?: Record<string, unknown>;
      channels?: Record<string, Record<string, unknown>>;
    }>("load_notification_mutes")
      .then((s) => {
        const hubMap: Record<string, NotifyMode> = {};
        for (const [k, v] of Object.entries(s?.hubs ?? {})) {
          const m = normalizeMode(v);
          if (m && m !== "all") hubMap[k] = m;
        }
        const chanMap: Record<string, Record<string, NotifyMode>> = {};
        for (const [hubId, inner] of Object.entries(s?.channels ?? {})) {
          const sub: Record<string, NotifyMode> = {};
          for (const [chId, v] of Object.entries(inner ?? {})) {
            const m = normalizeMode(v);
            if (m && m !== "all") sub[chId] = m;
          }
          if (Object.keys(sub).length > 0) chanMap[hubId] = sub;
        }
        setHubNotifyMode(hubMap);
        setChannelNotifyMode(chanMap);
      })
      .catch(() => {});
  }, []);

  // Hydrate pinned-channel state on launch.
  useEffect(() => {
    invoke<Record<string, Record<string, boolean>>>("load_pinned_channels")
      .then((s) => setPinnedChannels(s ?? {}))
      .catch(() => {});
  }, []);

  // Hydrate collapsed-category state on launch.
  useEffect(() => {
    invoke<Record<string, Record<string, boolean>>>("load_collapsed_categories")
      .then((s) => setCollapsedCategories(s ?? {}))
      .catch(() => {});
  }, []);

  // Poll voice channel populations + active-user set while a hub is active.
  // 5s feels live enough without spamming the endpoint; the moment someone
  // joins or leaves voice you'd see the count flip within that window.
  useEffect(() => {
    if (!activeHubId) {
      setVoicePops({});
      setVoiceActiveUsers(new Set());
      return;
    }
    let cancelled = false;
    async function tick() {
      try {
        const [pops, active] = await Promise.all([
          invoke<Record<string, number>>("voice_populations"),
          invoke<string[]>("voice_active_users"),
        ]);
        if (!cancelled) {
          setVoicePops(pops);
          setVoiceActiveUsers(new Set(active));
        }
      } catch {
        // Network blip while typing in chat is fine -- we'll catch up
        // on the next tick.
      }
    }
    tick();
    const handle = setInterval(tick, 5000);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [activeHubId]);

  // Global Ctrl+K (Cmd+K on macOS) opens the channel palette. We listen at
  // the window level so it works regardless of focus -- the palette itself
  // handles arrow nav + enter + escape internally.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const meta = e.ctrlKey || e.metaKey;
      if (meta && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);


  // Sweep typing entries older than 5s every second. Saves us from showing
  // a stale "X is typing..." if their typing:false event got lost.
  useEffect(() => {
    const handle = setInterval(() => {
      setTypingByKey((prev) => {
        const cutoff = Date.now() - 5000;
        let changed = false;
        const next: typeof prev = {};
        for (const [k, v] of Object.entries(prev)) {
          if (v.ts >= cutoff) next[k] = v;
          else changed = true;
        }
        return changed ? next : prev;
      });
    }, 1000);
    return () => clearInterval(handle);
  }, []);

  /**
   * Notify the hub the user is typing. We rate-limit to one "typing:true"
   * every 3s and a single trailing "typing:false" 4s after the last
   * keystroke -- enough cadence to keep the indicator alive but cheap on
   * the wire.
   */
  function pingTyping() {
    if (!selectedChannel) return;
    const now = Date.now();
    if (now - lastTypingSentRef.current > 3000) {
      lastTypingSentRef.current = now;
      invoke("set_typing", { channelId: selectedChannel.id, typing: true }).catch(
        () => {}
      );
    }
    if (typingDebounceRef.current) clearTimeout(typingDebounceRef.current);
    typingDebounceRef.current = setTimeout(() => {
      if (selectedChannel) {
        invoke("set_typing", {
          channelId: selectedChannel.id,
          typing: false,
        }).catch(() => {});
      }
      lastTypingSentRef.current = 0;
    }, 4000);
  }
  const [pingByHub, setPingByHub] = useState<Record<string, number | null>>({});

  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const activeHubIdRef = useRef<string | null>(null);
  useEffect(() => {
    activeHubIdRef.current = activeHubId;
  }, [activeHubId]);

  const publicKeyRef = useRef<string | null>(null);
  useEffect(() => {
    publicKeyRef.current = publicKey;
  }, [publicKey]);

  const hasActiveHub = hubs.length > 0 && activeHubId !== null;

  // Chat state
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  // Attachments staged for the next outgoing message. Cleared on send/cancel.
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([]);
  // Message we're currently replying to. Null means a top-level message.
  const [replyTarget, setReplyTarget] = useState<Message | null>(null);

  // Who's currently typing in the active channel: pubkey -> {name, timestamp}.
  // Entries auto-expire after 5s of no updates so a stuck "typing…" can't
  // hang around if the typer disconnects without sending typing:false.
  const [typingByKey, setTypingByKey] = useState<
    Record<string, { name: string; ts: number }>
  >({});
  const typingDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingSentRef = useRef<number>(0);

  // Per-channel search. When a query is active, the message list is
  // replaced by search results (newest-first) until the user clears it.
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Message[] | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);

  // Ctrl+K quick-switcher palette.
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Whether the right-side member list is collapsed. Local-only preference;
  // localStorage is fine since it's purely cosmetic + per-device.
  const [memberSidebarHidden, setMemberSidebarHiddenState] = useState<boolean>(
    () => {
      try {
        return localStorage.getItem("voxply.memberSidebarHidden") === "1";
      } catch {
        return false;
      }
    },
  );
  function setMemberSidebarHidden(v: boolean) {
    setMemberSidebarHiddenState(v);
    try {
      localStorage.setItem("voxply.memberSidebarHidden", v ? "1" : "0");
    } catch {}
  }

  // Lightbox: when set, renders a full-screen image overlay. Used by image
  // attachments so clicking opens a zoom view instead of a new browser tab.
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);
  const openImage = (src: string, alt: string) => setLightbox({ src, alt });

  // Right-click on a user: small popover with quick actions.
  const [userContextMenu, setUserContextMenu] = useState<{
    x: number;
    y: number;
    user: User;
  } | null>(null);

  async function handleHubReorder(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = hubs.findIndex((h) => h.hub_id === active.id);
    const newIndex = hubs.findIndex((h) => h.hub_id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const reordered = arrayMove(hubs, oldIndex, newIndex);
    setHubs(reordered);
    try {
      await invoke("reorder_hubs", {
        hubIds: reordered.map((h) => h.hub_id),
      });
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleReconnect() {
    if (!activeHubId) return;
    setReconnectingHubs((prev) => ({ ...prev, [activeHubId]: true }));
    try {
      await invoke("reconnect_hub", { hubId: activeHubId });
      // The hub-ws-status:true event will flip hubConnected and clear
      // the banner; if reconnect succeeded but the event hasn't arrived
      // yet, the banner still shows briefly -- that's fine.
    } catch (e) {
      setError(String(e));
      setReconnectingHubs((prev) => {
        const { [activeHubId]: _, ...rest } = prev;
        return rest;
      });
    }
  }

  async function handleUserDm(u: User) {
    setUserContextMenu(null);
    if (u.public_key === publicKey) return;
    try {
      const conv = await invoke<Conversation>("create_conversation", {
        members: [u.public_key],
        memberHubs: {},
      });
      const list = await invoke<Conversation[]>("list_conversations");
      setConversations(list);
      setView("dms");
      selectConversation(conv);
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleUserAddFriend(u: User) {
    setUserContextMenu(null);
    if (u.public_key === publicKey) return;
    try {
      await invoke("send_friend_request", { targetPublicKey: u.public_key });
      setToast(`Friend request sent to ${u.display_name || formatPubkey(u.public_key)}`);
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleCopyUserKey(u: User) {
    setUserContextMenu(null);
    try {
      await navigator.clipboard.writeText(u.public_key);
      setToast("Public key copied");
    } catch (e) {
      setError(String(e));
    }
  }

  // Alliance sidebar state. We surface every alliance the active hub belongs
  // to plus the channels each member shares with it. Selecting a remote one
  // routes message reads through /alliances/.../messages on our hub.
  const [userAlliances, setUserAlliances] = useState<AllianceInfo[]>([]);
  const [allianceChannels, setAllianceChannels] = useState<
    Record<string, AllianceSharedChannel[]>
  >({});
  const [selectedAllianceChannel, setSelectedAllianceChannel] = useState<{
    alliance_id: string;
    alliance_name: string;
    channel: AllianceSharedChannel;
  } | null>(null);
  const [allianceMessages, setAllianceMessages] = useState<Message[]>([]);

  // Create channel dialog
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [newChannelName, setNewChannelName] = useState("");
  const [newChannelDescription, setNewChannelDescription] = useState("");
  const [newChannelIsCategory, setNewChannelIsCategory] = useState(false);
  const [newChannelParentId, setNewChannelParentId] = useState<string | null>(null);

  // Edit description dialog
  const [editDescriptionChannel, setEditDescriptionChannel] = useState<Channel | null>(null);
  const [editDescriptionValue, setEditDescriptionValue] = useState("");

  // Channel-bans dialog. Stores the channel we're managing bans for so the
  // modal can fetch + mutate without round-tripping through context menu state.
  const [channelBansModal, setChannelBansModal] = useState<
    { channelId: string; channelName: string } | null
  >(null);

  // Hub admin panel
  const [hubDropdownOpen, setHubDropdownOpen] = useState(false);
  const [showHubAdmin, setShowHubAdmin] = useState(false);
  const [hubAdminTab, setHubAdminTab] = useState<HubAdminTab>("overview");
  const [myRoles, setMyRoles] = useState<RoleInfo[]>([]);
  // "pending" means the active hub requires admin approval and our user
  // record hasn't been approved yet. We render a landing page in that case
  // instead of the empty channel list, so the user knows what's going on.
  const [myApprovalStatus, setMyApprovalStatus] = useState<
    "approved" | "pending" | "unknown"
  >("unknown");
  const [adminHubName, setAdminHubName] = useState("");
  const [adminHubDescription, setAdminHubDescription] = useState("");
  const [adminHubIcon, setAdminHubIcon] = useState("");

  // Role editor
  const [adminRoles, setAdminRoles] = useState<RoleInfo[]>([]);

  // Member admin
  const [adminMembers, setAdminMembers] = useState<MemberAdminInfo[]>([]);

  // Ban admin
  const [adminBans, setAdminBans] = useState<BanInfo[]>([]);

  // Voice mute admin
  const [adminVoiceMutes, setAdminVoiceMutes] = useState<VoiceMuteInfo[]>([]);
  const voiceMutedKeys = useMemo(
    () => new Set(adminVoiceMutes.map((v) => v.target_public_key)),
    [adminVoiceMutes]
  );

  // Invite admin
  const [adminInvites, setAdminInvites] = useState<InviteInfo[]>([]);

  // Approval queue + hub-wide flags
  const [requireApproval, setRequireApproval] = useState(false);
  const [pendingMembers, setPendingMembers] = useState<PendingUser[]>([]);

  // Games
  const [installedGames, setInstalledGames] = useState<InstalledGame[]>([]);
  const [selectedGame, setSelectedGame] = useState<InstalledGame | null>(null);
  const [showInstallGame, setShowInstallGame] = useState(false);
  const [installManifestUrl, setInstallManifestUrl] = useState("");

  const isAdmin = myRoles.some((r) => r.permissions.includes("admin"));

  // Context menu
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; channel: Channel } | null>(null);

  // Message edit state — which message id is being edited and its draft
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState("");

  // Hub users
  const [users, setUsers] = useState<User[]>([]);

  // Indexes for mention rendering. knownDisplayNames is the lower-cased set
  // of all display names on this hub so MessageContent can decide which
  // @tokens are real mentions vs just text.
  const knownDisplayNames = useMemo(() => {
    const s = new Set<string>();
    for (const u of users) {
      if (u.display_name) s.add(u.display_name.toLowerCase());
    }
    return s;
  }, [users]);
  const myDisplayName = useMemo(
    () => users.find((u) => u.public_key === publicKey)?.display_name ?? null,
    [users, publicKey]
  );
  const myDisplayNameRef = useRef<string | null>(null);
  useEffect(() => {
    myDisplayNameRef.current = myDisplayName;
  }, [myDisplayName]);

  // Voice
  const [voiceChannelId, setVoiceChannelId] = useState<string | null>(null);
  const [voiceParticipants, setVoiceParticipants] = useState<VoiceParticipant[]>([]);
  const [speakingKeys, setSpeakingKeys] = useState<Set<string>>(new Set());
  // Local self-state for the voice bar. Reset on leave so the next channel
  // join starts unmuted/un-deafened (no surprise carryover).
  const [selfMuted, setSelfMuted] = useState(false);
  const [selfDeafened, setSelfDeafened] = useState(false);

  // Settings
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("profile");
  const [theme, setTheme] = useState<"calm" | "classic" | "linear">("calm");
  const [profiles, setProfiles] = useState<NamedProfile[]>([]);
  const [defaultProfileId, setDefaultProfileId] = useState<string | null>(null);
  const [recoveryPhrase, setRecoveryPhrase] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);

  // Voice settings
  const [audioInputs, setAudioInputs] = useState<string[]>([]);
  const [audioOutputs, setAudioOutputs] = useState<string[]>([]);
  const [voiceInputDevice, setVoiceInputDevice] = useState<string>("");
  const [voiceOutputDevice, setVoiceOutputDevice] = useState<string>("");
  const [vadThreshold, setVadThreshold] = useState<number>(0.02);
  const [voiceMode, setVoiceMode] = useState<"vad" | "ptt">("vad");
  // KeyboardEvent.code (layout-independent). Default Space; user can rebind.
  const [pttKey, setPttKey] = useState<string>("Space");
  // Whether to play the mention ping. Local-only preference; OS notifications
  // and unread badges are unaffected by this toggle.
  const [mentionPingEnabled, setMentionPingEnabledState] = useState<boolean>(
    () => {
      try {
        return localStorage.getItem("voxply.mentionPing") !== "0";
      } catch {
        return true;
      }
    },
  );
  function setMentionPingEnabled(v: boolean) {
    setMentionPingEnabledState(v);
    try {
      localStorage.setItem("voxply.mentionPing", v ? "1" : "0");
    } catch {}
  }
  const mentionPingRef = useRef(mentionPingEnabled);
  useEffect(() => {
    mentionPingRef.current = mentionPingEnabled;
  }, [mentionPingEnabled]);

  // Push-to-talk: when in PTT mode and connected to voice, the configured
  // key gates the mic. Pressing flips muted=false; releasing flips it back.
  // We ignore key events fired in form inputs so typing in chat doesn't
  // toggle the mic. Key.repeat is also skipped -- holding generates many
  // keydown events but we only care about the first.
  useEffect(() => {
    if (voiceMode !== "ptt" || voiceChannelId === null) return;

    function isInputTarget(t: EventTarget | null): boolean {
      if (!(t instanceof HTMLElement)) return false;
      const tag = t.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || t.isContentEditable;
    }

    function down(e: KeyboardEvent) {
      if (e.code !== pttKey || e.repeat || isInputTarget(e.target)) return;
      e.preventDefault();
      invoke("voice_set_muted", { muted: false }).catch(() => {});
      setSelfMuted(false);
    }
    function up(e: KeyboardEvent) {
      if (e.code !== pttKey || isInputTarget(e.target)) return;
      e.preventDefault();
      invoke("voice_set_muted", { muted: true }).catch(() => {});
      setSelfMuted(true);
    }

    // Start muted in PTT mode; the key press opens the gate.
    invoke("voice_set_muted", { muted: true }).catch(() => {});
    setSelfMuted(true);

    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [voiceMode, voiceChannelId, pttKey]);
  const [micTesting, setMicTesting] = useState(false);
  const [micLevel, setMicLevel] = useState<number>(0);

  // Friends
  const [showFriends, setShowFriends] = useState(false);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [pendingFriends, setPendingFriends] = useState<Friend[]>([]);
  const [friendRequestKey, setFriendRequestKey] = useState("");

  // DMs
  const [view, setView] = useState<"channels" | "dms" | "game">("channels");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [dmMessages, setDmMessages] = useState<Record<string, DmMessage[]>>({});
  const selectedConversationIdRef = useRef<string | null>(null);

  useEffect(() => {
    selectedConversationIdRef.current = selectedConversation?.id ?? null;
  }, [selectedConversation]);

  // Ref to the messages container for auto-scroll
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  // Ref to the channel-message input so we can auto-focus on channel switch
  // and after sending. Lets the user start typing immediately without
  // clicking back into the field.
  const messageInputRef = useRef<HTMLInputElement>(null);
  // Tracks whether the user is parked near the bottom of the message list.
  // We only auto-scroll on new messages while this is true; otherwise the
  // user is reading history and scrolling them is rude. The "↓ N new" pill
  // counts new messages they've missed so they can jump down explicitly.
  const [stickToBottom, setStickToBottom] = useState(true);
  const stickToBottomRef = useRef(true);
  useEffect(() => {
    stickToBottomRef.current = stickToBottom;
  }, [stickToBottom]);
  const [newWhileScrolledUp, setNewWhileScrolledUp] = useState(0);

  // Ref to the currently selected channel ID (for the event listener closure).
  // Why a ref? Because event listeners capture the state at time of setup — using
  // a ref ensures we always read the latest value without re-registering the listener.
  const selectedChannelIdRef = useRef<string | null>(null);

  // Auto-scroll only when the user is already near the bottom. Using a
  // 120px threshold matches the natural "I'm reading the latest" zone --
  // tighter than that and a slightly-up scroll would still re-anchor.
  useEffect(() => {
    if (stickToBottom) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      setNewWhileScrolledUp(0);
    } else {
      setNewWhileScrolledUp((n) => n + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);

  // Reset on channel switch -- user starts fresh at the bottom.
  useEffect(() => {
    setStickToBottom(true);
    setNewWhileScrolledUp(0);
    // Auto-focus the message input so the user can start typing immediately.
    // Small delay lets the new channel render first.
    if (selectedChannel) {
      setTimeout(() => messageInputRef.current?.focus(), 0);
    }
  }, [selectedChannel?.id]);

  function handleMessagesScroll() {
    const el = messagesContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distanceFromBottom < 120;
    if (atBottom !== stickToBottom) setStickToBottom(atBottom);
    if (atBottom && newWhileScrolledUp > 0) setNewWhileScrolledUp(0);
  }

  function jumpToBottom() {
    const el = messagesContainerRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    setStickToBottom(true);
    setNewWhileScrolledUp(0);
  }

  // Auto-dismiss toast after 5 seconds
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  // Game SDK bridge: reply to postMessage calls from game iframes.
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (!e.data || typeof e.data !== "object") return;
      if (e.data.type === "voxply:getUser") {
        const me = users.find((u) => u.public_key === publicKey);
        const reply = {
          type: "voxply:user",
          data: {
            public_key: publicKey,
            display_name: me?.display_name ?? null,
          },
        };
        (e.source as Window | null)?.postMessage(reply, "*");
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [users, publicKey]);

  // ESC closes the settings view (and stops the mic test if one is running)
  useEffect(() => {
    if (!showSettings) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeSettings();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showSettings, micTesting]);

  // ESC closes the hub admin view
  useEffect(() => {
    if (!showHubAdmin) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowHubAdmin(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showHubAdmin]);

  // Load data for whichever admin tab the user opens
  useEffect(() => {
    if (!showHubAdmin) return;
    if (hubAdminTab === "roles") {
      refreshRoles();
    } else if (hubAdminTab === "members") {
      refreshRoles(); // roles list used for the assign-role dropdown
      refreshMembers();
      refreshPending();
      refreshVoiceMutes();
    } else if (hubAdminTab === "bans") {
      refreshBans();
    } else if (hubAdminTab === "invites") {
      refreshInvites();
    }
  }, [showHubAdmin, hubAdminTab]);

  async function copyPublicKey() {
    if (!publicKey) return;
    try {
      await navigator.clipboard.writeText(publicKey);
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    } catch (e) {
      setError("Failed to copy: " + e);
    }
  }

  // Surface any error as a toast so the user actually sees it
  // (we removed the always-visible connect screen that used to render it).
  useEffect(() => {
    if (error) setToast(error);
  }, [error]);

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
            const myName = myDisplayNameRef.current;
            const isMention =
              !!myName &&
              message.sender !== publicKeyRef.current &&
              mentionsName(message.content, myName);

            const mode = effectiveNotifyMode(hub_id, channel_id);
            // Both "silent" and (non-mention messages in) "mentions" mode
            // suppress the bump + ping + OS notif.
            const allowBump =
              mode === "all" || (mode === "mentions" && isMention);

            if (isActiveChannel) {
              setMessages((prev) => {
                if (prev.some((m) => m.id === message.id)) return prev;
                return [...prev, message];
              });
            } else if (allowBump) {
              // Unread bump per channel. Mentions still bump even on the
              // active hub so the dot shows on a channel the user isn't
              // currently viewing.
              if (!isActiveHub || isMention) {
                bumpUnread(hub_id, channel_id);
              }
            }

            if (isMention && !isActiveChannel && allowBump) {
              if (mentionPingRef.current) playMentionPing();
              if (
                typeof Notification !== "undefined" &&
                Notification.permission === "granted"
              ) {
                const sender =
                  message.sender_name || formatPubkey(message.sender);
                try {
                  new Notification(`${sender} mentioned you`, {
                    body: message.content.slice(0, 140),
                  });
                } catch {}
              }
            }
          }
        )
      );

      unlistens.push(
        await listen<{ hub_id: string; channel_id: string; message: Message }>(
          "chat-message-edited",
          (event) => {
            if (event.payload.hub_id !== activeHubIdRef.current) return;
            if (event.payload.channel_id !== selectedChannelIdRef.current) return;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === event.payload.message.id ? event.payload.message : m
              )
            );
          }
        )
      );

      unlistens.push(
        await listen<{ hub_id: string; channel_id: string; message_id: string }>(
          "chat-message-deleted",
          (event) => {
            if (event.payload.hub_id !== activeHubIdRef.current) return;
            if (event.payload.channel_id !== selectedChannelIdRef.current) return;
            setMessages((prev) =>
              prev.filter((m) => m.id !== event.payload.message_id)
            );
          }
        )
      );

      unlistens.push(
        await listen<{ hub_id: string; connected: boolean }>(
          "hub-ws-status",
          (event) => {
            const { hub_id, connected } = event.payload;
            setHubConnected((prev) => {
              const was = prev[hub_id];
              const next = { ...prev, [hub_id]: connected };
              // Surface a transient toast when this hub flips back to
              // connected so the user knows the banner is gone for a reason.
              if (
                connected &&
                was === false &&
                hub_id === activeHubIdRef.current
              ) {
                setToast("Reconnected");
              }
              return next;
            });
            if (connected) {
              setReconnectingHubs((prev) => {
                if (!prev[hub_id]) return prev;
                const { [hub_id]: _, ...rest } = prev;
                return rest;
              });
            }
          }
        )
      );

      unlistens.push(
        await listen<{
          hub_id: string;
          channel_id: string;
          public_key: string;
          display_name: string | null;
          typing: boolean;
        }>("chat-typing", (event) => {
          if (event.payload.hub_id !== activeHubIdRef.current) return;
          if (event.payload.channel_id !== selectedChannelIdRef.current) return;
          if (event.payload.public_key === publicKeyRef.current) return;
          const name =
            event.payload.display_name ||
            formatPubkey(event.payload.public_key);
          if (event.payload.typing) {
            setTypingByKey((prev) => ({
              ...prev,
              [event.payload.public_key]: { name, ts: Date.now() },
            }));
          } else {
            setTypingByKey((prev) => {
              if (!prev[event.payload.public_key]) return prev;
              const { [event.payload.public_key]: _, ...rest } = prev;
              return rest;
            });
          }
        })
      );

      unlistens.push(
        await listen<{
          hub_id: string;
          channel_id: string;
          message_id: string;
          reactions: { emoji: string; count: number; me: boolean }[];
        }>("chat-reactions-updated", (event) => {
          if (event.payload.hub_id !== activeHubIdRef.current) return;
          if (event.payload.channel_id !== selectedChannelIdRef.current) return;
          // The server can't know per-recipient `me` for broadcasts, so it
          // sends `me: false`. We patch our own flag locally based on the
          // existing message reactions before the update.
          setMessages((prev) =>
            prev.map((m) => {
              if (m.id !== event.payload.message_id) return m;
              const myEmojis = new Set(
                (m.reactions ?? []).filter((r) => r.me).map((r) => r.emoji)
              );
              return {
                ...m,
                reactions: event.payload.reactions.map((r) => ({
                  ...r,
                  me: myEmojis.has(r.emoji),
                })),
              };
            })
          );
        })
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
        await listen<number>("mic-level", (event) => {
          setMicLevel(event.payload);
        })
      );

      unlistens.push(
        await listen<{ hub_id: string; context: string; message: string }>(
          "hub-error",
          async (event) => {
            if (event.payload.hub_id !== activeHubIdRef.current) return;
            setToast(event.payload.message);
            // If a voice join was rejected by the hub, the local pipeline is
            // still running — tear it down so the UI matches reality.
            if (event.payload.context === "voice_join") {
              try {
                await invoke("voice_leave");
              } catch {}
              setVoiceChannelId(null);
              setVoiceParticipants([]);
              setSpeakingKeys(new Set());
            }
          }
        )
      );

      unlistens.push(
        await listen<{ speaking: boolean }>("voice-self-speaking", (event) => {
          const myKey = publicKeyRef.current;
          if (!myKey) return;
          setSpeakingKeys((prev) => {
            const next = new Set(prev);
            if (event.payload.speaking) next.add(myKey);
            else next.delete(myKey);
            return next;
          });
        })
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
            setUnreadByChannel((prev) => {
              if (!prev[hub_id]) return prev;
              const { [hub_id]: _, ...rest } = prev;
              invoke("save_unread_state", { state: rest }).catch(() => {});
              return rest;
            });
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
      // Pull /me FIRST. If we're pending approval, the rest of the calls
      // would just 403 and bury the user under a wall of error toasts.
      let me: MeInfo | null = null;
      try {
        me = await invoke<MeInfo>("get_me");
        setMyRoles(me.roles);
        setMyApprovalStatus(me.approval_status);
      } catch {
        setMyRoles([]);
        setMyApprovalStatus("unknown");
      }

      if (me?.approval_status === "pending") {
        // Reset everything else; show the landing screen.
        setChannels([]);
        setUsers([]);
        setConversations([]);
        setSelectedChannel(null);
        setSelectedConversation(null);
        setSelectedAllianceChannel(null);
        setMessages([]);
        setUserAlliances([]);
        setAllianceChannels({});
        setInstalledGames([]);
        return;
      }

      const ch = await invoke<Channel[]>("list_channels");
      setChannels(ch);
      const u = await invoke<User[]>("list_users");
      setUsers(u);
      const c = await invoke<Conversation[]>("list_conversations");
      setConversations(c);
      // Reset selection when switching hub
      setSelectedChannel(null);
      setSelectedConversation(null);
      setSelectedAllianceChannel(null);
      setAllianceMessages([]);
      setMessages([]);
      // Pull alliances + their shared channels for the sidebar
      try {
        const al = await invoke<AllianceInfo[]>("list_alliances");
        setUserAlliances(al);
        const byId: Record<string, AllianceSharedChannel[]> = {};
        await Promise.all(
          al.map(async (a) => {
            try {
              byId[a.id] = await invoke<AllianceSharedChannel[]>(
                "list_alliance_shared_channels",
                { allianceId: a.id }
              );
            } catch {
              byId[a.id] = [];
            }
          })
        );
        setAllianceChannels(byId);
      } catch {
        setUserAlliances([]);
        setAllianceChannels({});
      }
      try {
        const games = await invoke<InstalledGame[]>("list_installed_games");
        setInstalledGames(games);
      } catch {
        setInstalledGames([]);
      }
    } catch (e) {
      setError(String(e));
    }
  }

  async function refreshGames() {
    try {
      const g = await invoke<InstalledGame[]>("list_installed_games");
      setInstalledGames(g);
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleInstallGameFromUrl() {
    const url = installManifestUrl.trim();
    if (!url) return;
    try {
      await invoke("install_game", { manifestUrl: url, manifest: null });
      setInstallManifestUrl("");
      setShowInstallGame(false);
      await refreshGames();
      setToast("Game installed");
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleInstallDemoGame() {
    // Bundled demo game — manifest is inline, entry_url points at the
    // static asset served by the client.
    const demoManifest = {
      id: "voxply-demo-dice",
      name: "Voxply Dice",
      description: "A tiny dice roller — included as a demo of the game SDK.",
      version: "1.0.0",
      entry_url: "/demo-games/dice.html",
      thumbnail_url: null,
      author: "Voxply",
      min_players: 1,
      max_players: 1,
    };
    try {
      await invoke("install_game", {
        manifestUrl: "builtin:voxply-demo-dice",
        manifest: demoManifest,
      });
      setShowInstallGame(false);
      await refreshGames();
      setToast("Demo game installed");
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleUninstallGame(gameId: string, name: string) {
    if (!confirm(`Uninstall "${name}"?`)) return;
    try {
      await invoke("uninstall_game", { gameId });
      await refreshGames();
      if (selectedGame?.id === gameId) {
        setSelectedGame(null);
        setView("channels");
      }
      setToast("Game uninstalled");
    } catch (e) {
      setError(String(e));
    }
  }

  function launchGame(game: InstalledGame) {
    setSelectedGame(game);
    setView("game");
  }

  async function openHubAdmin() {
    setHubDropdownOpen(false);
    setShowHubAdmin(true);
    setHubAdminTab("overview");
    try {
      const branding = await invoke<{
        name: string;
        description: string | null;
        icon: string | null;
      }>("get_hub_branding");
      setAdminHubName(branding.name);
      setAdminHubDescription(branding.description ?? "");
      setAdminHubIcon(branding.icon ?? "");

      const settings = await invoke<{
        require_approval: boolean;
        invite_only: boolean;
      }>("get_hub_settings");
      setRequireApproval(settings.require_approval);
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleSaveHubBranding() {
    try {
      await invoke("update_hub_branding", {
        name: adminHubName.trim() || null,
        description: adminHubDescription,
        icon: adminHubIcon,
        requireApproval: requireApproval,
      });
      // Refresh hub list so the new name flows into the hub-icon title
      const refreshed = await invoke<Hub[]>("list_hubs");
      setHubs(refreshed);
      setToast("Hub settings saved");
    } catch (e) {
      setError(String(e));
    }
  }

  async function refreshPending() {
    try {
      const p = await invoke<PendingUser[]>("list_pending_members");
      setPendingMembers(p);
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleApproveMember(publicKey: string) {
    try {
      await invoke("approve_member", { targetPublicKey: publicKey });
      setToast("Member approved");
      await refreshPending();
      await refreshMembers();
    } catch (e) {
      setError(String(e));
    }
  }

  async function refreshRoles() {
    try {
      const r = await invoke<RoleInfo[]>("list_roles");
      setAdminRoles(r);
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleCreateRole(
    name: string,
    permissions: string[],
    priority: number,
    displaySeparately: boolean
  ) {
    try {
      await invoke("create_role", {
        name,
        permissions,
        priority,
        displaySeparately,
      });
      await refreshRoles();
      setToast("Role created");
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleUpdateRole(
    roleId: string,
    updates: {
      name?: string;
      permissions?: string[];
      priority?: number;
      display_separately?: boolean;
    }
  ) {
    try {
      await invoke("update_role", {
        roleId,
        name: updates.name ?? null,
        permissions: updates.permissions ?? null,
        priority: updates.priority ?? null,
        displaySeparately: updates.display_separately ?? null,
      });
      await refreshRoles();
      setToast("Role updated");
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleDeleteRole(roleId: string) {
    if (!confirm("Delete this role? Users assigned to it will lose the role.")) return;
    try {
      await invoke("delete_role", { roleId });
      await refreshRoles();
      setToast("Role deleted");
    } catch (e) {
      setError(String(e));
    }
  }

  async function refreshMembers() {
    try {
      const m = await invoke<MemberAdminInfo[]>("list_hub_members");
      setAdminMembers(m);
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleKickMember(publicKey: string) {
    const reason = prompt("Reason for kick (optional)") ?? "";
    try {
      await invoke("kick_user_cmd", {
        targetPublicKey: publicKey,
        reason: reason.trim() || null,
      });
      setToast("Kicked");
      await refreshMembers();
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleBanMember(publicKey: string) {
    const reason = prompt("Reason for ban (optional)") ?? "";
    if (!confirm("Ban this user? They won't be able to rejoin.")) return;
    try {
      await invoke("ban_user_cmd", {
        targetPublicKey: publicKey,
        reason: reason.trim() || null,
      });
      setToast("Banned");
      await refreshMembers();
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleMuteMember(publicKey: string) {
    const reason = prompt("Reason for mute (optional)") ?? "";
    try {
      await invoke("mute_user_cmd", {
        targetPublicKey: publicKey,
        reason: reason.trim() || null,
      });
      setToast("Muted");
      await refreshMembers();
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleTimeoutMember(publicKey: string) {
    const durationStr = prompt(
      "Timeout duration in minutes (1-1440)",
      "10"
    );
    if (!durationStr) return;
    const minutes = Number(durationStr);
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 1440) {
      setError("Invalid duration");
      return;
    }
    const reason = prompt("Reason (optional)") ?? "";
    try {
      await invoke("timeout_user_cmd", {
        targetPublicKey: publicKey,
        durationSeconds: Math.floor(minutes * 60),
        reason: reason.trim() || null,
      });
      setToast(`Timed out for ${minutes}m`);
      await refreshMembers();
    } catch (e) {
      setError(String(e));
    }
  }

  async function refreshBans() {
    try {
      const b = await invoke<BanInfo[]>("list_bans");
      setAdminBans(b);
    } catch (e) {
      setError(String(e));
    }
  }

  async function refreshVoiceMutes() {
    try {
      const v = await invoke<VoiceMuteInfo[]>("list_voice_mutes");
      setAdminVoiceMutes(v);
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleVoiceMuteMember(publicKey: string) {
    const reason = prompt("Reason for voice mute (optional)") ?? "";
    try {
      await invoke("voice_mute_user_cmd", {
        targetPublicKey: publicKey,
        reason: reason.trim() || null,
      });
      setToast("Voice muted");
      await refreshVoiceMutes();
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleVoiceUnmuteMember(publicKey: string) {
    try {
      await invoke("voice_unmute_user_cmd", { targetPublicKey: publicKey });
      setToast("Voice unmuted");
      await refreshVoiceMutes();
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleSetTalkPower(channelId: string) {
    let current = 0;
    try {
      const tp = await invoke<{ min_talk_power: number }>("get_talk_power", {
        channelId,
      });
      current = tp.min_talk_power;
    } catch {
      // Falling back to 0 is fine — user just sees the default.
    }
    const value = prompt(
      "Minimum talk power (priority) to speak in this channel.\nUse 0 to allow anyone.",
      String(current)
    );
    if (value === null) return;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) {
      setError("Invalid talk power");
      return;
    }
    try {
      await invoke("set_talk_power_cmd", {
        channelId,
        minTalkPower: Math.floor(n),
      });
      setToast(n === 0 ? "Talk power cleared" : `Talk power set to ${Math.floor(n)}`);
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleUnban(publicKey: string) {
    if (!confirm("Unban this user? They'll be able to rejoin.")) return;
    try {
      await invoke("unban_user", { targetPublicKey: publicKey });
      setToast("Unbanned");
      await refreshBans();
    } catch (e) {
      setError(String(e));
    }
  }

  async function refreshInvites() {
    try {
      const i = await invoke<InviteInfo[]>("list_invites");
      setAdminInvites(i);
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleCreateInvite(
    maxUses: number | null,
    expiresInSeconds: number | null
  ) {
    try {
      await invoke<InviteInfo>("create_invite", {
        maxUses,
        expiresInSeconds,
      });
      await refreshInvites();
      setToast("Invite created");
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleRevokeInvite(code: string) {
    if (!confirm(`Revoke invite ${code}?`)) return;
    try {
      await invoke("revoke_invite", { code });
      await refreshInvites();
      setToast("Invite revoked");
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleToggleRoleAssignment(
    publicKey: string,
    roleId: string,
    hasRole: boolean
  ) {
    try {
      if (hasRole) {
        await invoke("unassign_role", {
          targetPublicKey: publicKey,
          roleId,
        });
      } else {
        await invoke("assign_role", {
          targetPublicKey: publicKey,
          roleId,
        });
      }
      await refreshMembers();
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
      // Leave per-channel unread alone -- it'll clear when the user
      // actually opens the relevant channel.
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
      clearHubUnread(hubId);
    } catch (e) {
      setError(String(e));
    }
  }

  // Auto-connect saved hubs on app start + load our own public key once
  useEffect(() => {
    (async () => {
      // Apply persisted theme as early as possible to avoid a flash of the
      // default palette.
      try {
        const profile = await invoke<{ theme?: string | null }>("get_profile");
        const t = (profile.theme ?? "calm") as "calm" | "classic" | "linear";
        const valid = t === "calm" || t === "classic" || t === "linear" ? t : "calm";
        setTheme(valid);
        document.documentElement.dataset.theme = valid;
      } catch {
        document.documentElement.dataset.theme = "calm";
      }
      try {
        const key = await invoke<string>("get_my_public_key");
        setPublicKey(key);
      } catch (e) {
        console.error("Failed to load identity:", e);
      }
      // Ask for notification permission once on launch. The browser
      // Notification API works inside Tauri 2 webviews; we silently fall
      // back to no notifications if the user denies.
      if (
        typeof Notification !== "undefined" &&
        Notification.permission === "default"
      ) {
        try {
          await Notification.requestPermission();
        } catch {}
      }
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
    } else {
      // No active hub — clear approval state so the next switch starts fresh.
      setMyApprovalStatus("unknown");
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

  // Ping every connected hub every 15s so the sidebar shows current latency
  useEffect(() => {
    if (hubs.length === 0) return;
    let cancelled = false;
    async function tick() {
      for (const h of hubs) {
        try {
          const ms = await invoke<number>("ping_hub", { hubId: h.hub_id });
          if (cancelled) return;
          setPingByHub((prev) => ({ ...prev, [h.hub_id]: ms }));
        } catch {
          if (cancelled) return;
          setPingByHub((prev) => ({ ...prev, [h.hub_id]: null }));
        }
      }
    }
    tick();
    const interval = setInterval(tick, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [hubs]);

  // Run search whenever the query or selected channel changes. Empty query
  // clears the results panel so the regular message list comes back.
  useEffect(() => {
    if (!selectedChannel) {
      setSearchResults(null);
      return;
    }
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults(null);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(async () => {
      try {
        const r = await invoke<Message[]>("search_messages", {
          channelId: selectedChannel.id,
          query: q,
        });
        if (!cancelled) setSearchResults(r);
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [searchQuery, selectedChannel]);

  function closeSearch() {
    setSearchOpen(false);
    setSearchQuery("");
    setSearchResults(null);
  }

  async function selectChannel(channel: Channel) {
    // Unsubscribe from previous channel's WS updates
    if (selectedChannel && selectedChannel.id !== channel.id) {
      await invoke("unsubscribe_channel", { channelId: selectedChannel.id });
    }

    // Leaving alliance-channel mode
    setSelectedAllianceChannel(null);
    setAllianceMessages([]);
    // Reset any in-flight search when switching channels.
    closeSearch();

    setSelectedChannel(channel);
    setMessages([]);
    setTypingByKey({});
    if (activeHubId) clearUnread(activeHubId, channel.id);
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

  async function handleSendAllianceMessage() {
    if (!selectedAllianceChannel) return;
    const content = inputText.trim();
    if (!content) return;
    try {
      await invoke("send_alliance_channel_message", {
        allianceId: selectedAllianceChannel.alliance_id,
        channelId: selectedAllianceChannel.channel.channel_id,
        content,
      });
      setInputText("");
      // Refetch since we don't subscribe to remote alliance channels yet --
      // there's no WS push for federated messages.
      try {
        const msgs = await invoke<Message[]>("get_alliance_channel_messages", {
          allianceId: selectedAllianceChannel.alliance_id,
          channelId: selectedAllianceChannel.channel.channel_id,
        });
        setAllianceMessages(msgs);
      } catch {}
    } catch (e) {
      setError(String(e));
    }
  }

  async function selectAllianceChannel(
    alliance: AllianceInfo,
    ch: AllianceSharedChannel
  ) {
    // If the alliance channel is one of OUR local channels, route through the
    // normal selectChannel flow so subscriptions and posting just work.
    const localMatch = channels.find((c) => c.id === ch.channel_id);
    if (localMatch) {
      await selectChannel(localMatch);
      return;
    }

    if (selectedChannel) {
      await invoke("unsubscribe_channel", { channelId: selectedChannel.id });
      setSelectedChannel(null);
    }

    setSelectedAllianceChannel({
      alliance_id: alliance.id,
      alliance_name: alliance.name,
      channel: ch,
    });
    setAllianceMessages([]);
    try {
      const msgs = await invoke<Message[]>("get_alliance_channel_messages", {
        allianceId: alliance.id,
        channelId: ch.channel_id,
      });
      setAllianceMessages(msgs);
    } catch (e) {
      setError(String(e));
    }
  }

  function startEditingMessage(m: Message) {
    setEditingMessageId(m.id);
    setEditingDraft(m.content);
  }

  function cancelEditingMessage() {
    setEditingMessageId(null);
    setEditingDraft("");
  }

  async function handleSaveEditedMessage() {
    if (!editingMessageId || !selectedChannel) return;
    const content = editingDraft.trim();
    if (!content) return;
    try {
      const updated = await invoke<Message>("edit_message", {
        channelId: selectedChannel.id,
        messageId: editingMessageId,
        content,
      });
      setMessages((prev) =>
        prev.map((m) => (m.id === updated.id ? updated : m))
      );
      cancelEditingMessage();
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleDeleteMessage(messageId: string) {
    if (!selectedChannel) return;
    if (!confirm("Delete this message?")) return;
    try {
      await invoke("delete_message", {
        channelId: selectedChannel.id,
        messageId,
      });
      setMessages((prev) => prev.filter((m) => m.id !== messageId));
    } catch (e) {
      setError(String(e));
    }
  }

  async function toggleReaction(messageId: string, emoji: string) {
    if (!selectedChannel) return;
    // Optimistic update so the click feels instant; the WS broadcast will
    // reconcile if there's drift.
    let optimisticMine = false;
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== messageId) return m;
        const reactions = m.reactions ? [...m.reactions] : [];
        const idx = reactions.findIndex((r) => r.emoji === emoji);
        if (idx === -1) {
          reactions.push({ emoji, count: 1, me: true });
          optimisticMine = true;
        } else {
          const r = reactions[idx];
          if (r.me) {
            const next = { ...r, count: r.count - 1, me: false };
            if (next.count <= 0) reactions.splice(idx, 1);
            else reactions[idx] = next;
          } else {
            reactions[idx] = { ...r, count: r.count + 1, me: true };
            optimisticMine = true;
          }
        }
        return { ...m, reactions };
      })
    );
    try {
      if (optimisticMine) {
        await invoke("add_reaction", {
          channelId: selectedChannel.id,
          messageId,
          emoji,
        });
      } else {
        await invoke("remove_reaction", {
          channelId: selectedChannel.id,
          messageId,
          emoji,
        });
      }
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleSend() {
    if (!selectedChannel) return;
    const content = inputText;
    const attachments = pendingAttachments;
    const reply = replyTarget;
    if (!content.trim() && attachments.length === 0) return;
    setInputText("");
    setPendingAttachments([]);
    setReplyTarget(null);
    try {
      const msg = await invoke<Message>("send_message", {
        channelId: selectedChannel.id,
        content,
        attachments,
        replyTo: reply?.id ?? null,
      });
      // Dedup: the WebSocket may have already added this message
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
    } catch (e) {
      setError(String(e));
      // Restore the user's draft on failure.
      setInputText(content);
      setPendingAttachments(attachments);
      setReplyTarget(reply);
    }
  }

  /** Scroll the message with the given id into view and briefly flash it. */
  function scrollToMessage(id: string) {
    const el = document.getElementById(`msg-${id}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("flash");
    setTimeout(() => el.classList.remove("flash"), 1200);
  }

  /** Read a File into a base64 string (no data: prefix). */
  function readFileAsB64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const s = reader.result;
        if (typeof s !== "string") return reject(new Error("read failed"));
        // FileReader returns a data: URL; strip the "data:<mime>;base64," prefix.
        const idx = s.indexOf(",");
        resolve(idx >= 0 ? s.slice(idx + 1) : s);
      };
      reader.onerror = () => reject(reader.error ?? new Error("read failed"));
      reader.readAsDataURL(file);
    });
  }

  async function attachFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const next: Attachment[] = [...pendingAttachments];
    let totalBytes = next.reduce((n, a) => n + a.data_b64.length, 0);
    for (const f of Array.from(files)) {
      try {
        const b64 = await readFileAsB64(f);
        if (totalBytes + b64.length > MAX_ATTACHMENT_BYTES) {
          setError(
            `Attachments would exceed 3MB cap (already at ${(totalBytes / 1_000_000).toFixed(1)}MB)`
          );
          break;
        }
        totalBytes += b64.length;
        next.push({
          name: f.name,
          mime: f.type || "application/octet-stream",
          data_b64: b64,
        });
      } catch (e) {
        setError(String(e));
      }
    }
    setPendingAttachments(next);
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

  /** Persist the full LocalProfile to disk. Pass the parts you want to change;
   *  current state is used for the rest. */
  async function persistProfileFile(overrides: {
    profiles?: NamedProfile[];
    defaultProfileId?: string | null;
    theme?: "calm" | "classic" | "linear";
  } = {}) {
    const next = {
      profiles: overrides.profiles ?? profiles,
      default_profile_id: overrides.defaultProfileId ?? defaultProfileId,
      theme: overrides.theme ?? theme,
    };
    try {
      await invoke("save_profile", { profile: next });
    } catch (e) {
      setError(String(e));
    }
  }

  function newProfileId(): string {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return `p_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  }

  async function handleCreateProfile() {
    const fresh: NamedProfile = {
      id: newProfileId(),
      label: `Profile ${profiles.length + 1}`,
      display_name: "",
      avatar: null,
    };
    const next = [...profiles, fresh];
    setProfiles(next);
    // First profile created becomes the default automatically.
    const nextDefault = profiles.length === 0 ? fresh.id : defaultProfileId;
    if (nextDefault !== defaultProfileId) setDefaultProfileId(nextDefault);
    await persistProfileFile({ profiles: next, defaultProfileId: nextDefault });
  }

  async function handleUpdateProfile(
    id: string,
    patch: Partial<Omit<NamedProfile, "id">>
  ) {
    const next = profiles.map((p) =>
      p.id === id ? { ...p, ...patch } : p
    );
    setProfiles(next);
    await persistProfileFile({ profiles: next });
  }

  async function handleDeleteProfile(id: string) {
    if (profiles.length <= 1) {
      setError("You need at least one profile.");
      return;
    }
    if (!confirm("Delete this profile?")) return;
    const next = profiles.filter((p) => p.id !== id);
    setProfiles(next);
    let nextDefault = defaultProfileId;
    if (defaultProfileId === id) {
      nextDefault = next[0]?.id ?? null;
      setDefaultProfileId(nextDefault);
    }
    await persistProfileFile({ profiles: next, defaultProfileId: nextDefault });
  }

  async function handleSetDefaultProfile(id: string) {
    setDefaultProfileId(id);
    await persistProfileFile({ defaultProfileId: id });
    setToast("Default profile updated");
  }

  async function handleApplyProfileToHub(id: string) {
    if (!hasActiveHub) return;
    const p = profiles.find((x) => x.id === id);
    if (!p) return;
    try {
      if (p.display_name.trim()) {
        await invoke("update_display_name", { displayName: p.display_name });
      }
      await invoke("update_avatar", { avatar: p.avatar ?? "" });
      const u = await invoke<User[]>("list_users");
      setUsers(u);
      setToast(`Applied "${p.label}" to this hub`);
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleSetTheme(t: "calm" | "classic" | "linear") {
    setTheme(t);
    document.documentElement.dataset.theme = t;
    await persistProfileFile({ theme: t });
  }

  async function handleShowRecovery() {
    try {
      const phrase = await invoke<string>("get_recovery_phrase");
      setRecoveryPhrase(phrase);
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleRecoverIdentity(phrase: string) {
    try {
      const newPubkey = await invoke<string>("recover_identity_from_phrase", {
        phrase,
      });
      // The backend already cleared hub sessions and the saved-hubs file.
      // Reloading is the cleanest way to reset every piece of in-memory
      // state (active hub, channels, messages, voice, friends, etc.) without
      // hand-resetting twenty pieces of React state.
      setRecoveryPhrase(null);
      setPublicKey(newPubkey);
      setToast("Identity restored — reloading…");
      setTimeout(() => window.location.reload(), 600);
    } catch (e) {
      setError(String(e));
      throw e;
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
          attachments: m.attachments,
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
    if (!selectedConversation) return;
    const content = inputText;
    const attachments = pendingAttachments;
    if (!content.trim() && attachments.length === 0) return;
    setInputText("");
    setPendingAttachments([]);
    try {
      await invoke("send_dm", {
        conversationId: selectedConversation.id,
        content,
        attachments,
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
              attachments,
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
    // Load profiles + theme
    try {
      const profile = await invoke<{
        profiles?: NamedProfile[];
        default_profile_id?: string | null;
        theme?: string | null;
      }>("get_profile");
      setProfiles(profile.profiles ?? []);
      setDefaultProfileId(profile.default_profile_id ?? null);
      const t = profile.theme;
      if (t === "calm" || t === "classic" || t === "linear") {
        setTheme(t);
      }
    } catch {}

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
        voice_mode?: string;
        ptt_key?: string;
      }>("get_voice_settings");
      setVoiceInputDevice(saved.input_device || "");
      setVoiceOutputDevice(saved.output_device || "");
      setVadThreshold(saved.vad_threshold ?? 0.02);
      setVoiceMode(saved.voice_mode === "ptt" ? "ptt" : "vad");
      setPttKey(saved.ptt_key || "Space");
    } catch (e) {
      console.error("Failed to load voice settings:", e);
    }
  }

  async function persistVoiceSettings(
    input: string,
    output: string,
    threshold: number,
    mode: "vad" | "ptt" = voiceMode,
    key: string = pttKey,
  ) {
    try {
      await invoke("save_voice_settings", {
        settings: {
          input_device: input || null,
          output_device: output || null,
          vad_threshold: threshold,
          voice_mode: mode,
          ptt_key: key,
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

  async function closeSettings() {
    if (micTesting) {
      try {
        await invoke("mic_test_stop");
      } catch {}
      setMicTesting(false);
    }
    setShowSettings(false);
  }

  async function toggleSelfMute() {
    const next = !selfMuted;
    setSelfMuted(next);
    try {
      await invoke("voice_set_muted", { muted: next });
    } catch (e) {
      setError(String(e));
      setSelfMuted(!next);
    }
  }

  async function toggleSelfDeafen() {
    const next = !selfDeafened;
    setSelfDeafened(next);
    // Deafen implies mute on the backend; mirror that here so the UI
    // matches what the audio thread actually does.
    if (next && !selfMuted) setSelfMuted(true);
    try {
      await invoke("voice_set_deafened", { deafened: next });
    } catch (e) {
      setError(String(e));
      setSelfDeafened(!next);
    }
  }

  async function handleVoiceLeave() {
    try {
      await invoke("voice_leave");
      setVoiceChannelId(null);
      setVoiceParticipants([]);
      setSpeakingKeys(new Set());
      setSelfMuted(false);
      setSelfDeafened(false);
    } catch (e) {
      setError(String(e));
    }
  }

  // Build a nested tree: categories contain their child channels.
  // Top-level = channels with no parent. Sorted by display_order.
  function buildChannelTree(): { node: Channel; children: Channel[] }[] {
    const pinSet = activeHubId ? pinnedChannels[activeHubId] ?? {} : {};
    // Pinned channels render in the dedicated section at the top, so they
    // get pulled out of the regular tree to avoid duplication.
    const sorted = [...channels]
      .sort((a, b) => a.display_order - b.display_order)
      .filter((c) => !pinSet[c.id]);
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
    const desc = newChannelDescription.trim();
    try {
      const channel = await invoke<Channel>("create_channel", {
        name,
        parentId: newChannelParentId,
        isCategory: newChannelIsCategory,
        description: desc ? desc : null,
      });
      setChannels((prev) => [...prev, channel]);
      setNewChannelName("");
      setNewChannelDescription("");
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

  function openEditDescription(channel: Channel) {
    setEditDescriptionChannel(channel);
    setEditDescriptionValue(channel.description ?? "");
    setContextMenu(null);
  }

  async function handleSaveDescription() {
    if (!editDescriptionChannel) return;
    const desc = editDescriptionValue.trim();
    try {
      await invoke("update_channel_description", {
        channelId: editDescriptionChannel.id,
        description: desc ? desc : null,
      });
      setChannels((prev) =>
        prev.map((c) =>
          c.id === editDescriptionChannel.id
            ? { ...c, description: desc ? desc : null }
            : c
        )
      );
      if (selectedChannel?.id === editDescriptionChannel.id) {
        setSelectedChannel({ ...selectedChannel, description: desc ? desc : null });
      }
      setEditDescriptionChannel(null);
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleMoveChannel(channelId: string, parentId: string | null) {
    try {
      await invoke("move_channel", { channelId, parentId });
      setChannels((prev) =>
        prev.map((c) =>
          c.id === channelId ? { ...c, parent_id: parentId } : c
        )
      );
      setContextMenu(null);
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
        {showHubAdmin ? (
          <HubAdminPage
            tab={hubAdminTab}
            onTab={setHubAdminTab}
            onClose={() => setShowHubAdmin(false)}
            hubName={adminHubName}
            onHubNameChange={setAdminHubName}
            hubDescription={adminHubDescription}
            onHubDescriptionChange={setAdminHubDescription}
            hubIcon={adminHubIcon}
            onHubIconChange={setAdminHubIcon}
            requireApproval={requireApproval}
            onRequireApprovalChange={setRequireApproval}
            onSave={handleSaveHubBranding}
            pendingMembers={pendingMembers}
            onApproveMember={handleApproveMember}
            roles={adminRoles}
            onCreateRole={handleCreateRole}
            onUpdateRole={handleUpdateRole}
            onDeleteRole={handleDeleteRole}
            members={adminMembers}
            onKickMember={handleKickMember}
            onBanMember={handleBanMember}
            onMuteMember={handleMuteMember}
            onTimeoutMember={handleTimeoutMember}
            onVoiceMuteMember={handleVoiceMuteMember}
            onVoiceUnmuteMember={handleVoiceUnmuteMember}
            voiceMutedKeys={voiceMutedKeys}
            onToggleRoleAssignment={handleToggleRoleAssignment}
            bans={adminBans}
            onUnban={handleUnban}
            invites={adminInvites}
            activeHubUrl={hubs.find((h) => h.hub_id === activeHubId)?.hub_url ?? ""}
            onCreateInvite={handleCreateInvite}
            onRevokeInvite={handleRevokeInvite}
            channels={channels}
          />
        ) : showSettings ? (
          <SettingsPage
            tab={settingsTab}
            onTab={setSettingsTab}
            onClose={closeSettings}
            profiles={profiles}
            defaultProfileId={defaultProfileId}
            onCreateProfile={handleCreateProfile}
            onUpdateProfile={handleUpdateProfile}
            onDeleteProfile={handleDeleteProfile}
            onSetDefaultProfile={handleSetDefaultProfile}
            onApplyProfileToHub={handleApplyProfileToHub}
            theme={theme}
            onThemeChange={handleSetTheme}
            hasActiveHub={hasActiveHub}
            publicKey={publicKey}
            copiedKey={copiedKey}
            onCopyKey={copyPublicKey}
            audioInputs={audioInputs}
            audioOutputs={audioOutputs}
            voiceInputDevice={voiceInputDevice}
            voiceOutputDevice={voiceOutputDevice}
            onInputDeviceChange={(v) => {
              setVoiceInputDevice(v);
              persistVoiceSettings(v, voiceOutputDevice, vadThreshold);
            }}
            onOutputDeviceChange={(v) => {
              setVoiceOutputDevice(v);
              persistVoiceSettings(voiceInputDevice, v, vadThreshold);
            }}
            vadThreshold={vadThreshold}
            onVadChange={(v) => {
              setVadThreshold(v);
              persistVoiceSettings(voiceInputDevice, voiceOutputDevice, v);
            }}
            voiceMode={voiceMode}
            onVoiceModeChange={(m) => {
              setVoiceMode(m);
              persistVoiceSettings(
                voiceInputDevice,
                voiceOutputDevice,
                vadThreshold,
                m,
                pttKey,
              );
            }}
            pttKey={pttKey}
            onPttKeyChange={(k) => {
              setPttKey(k);
              persistVoiceSettings(
                voiceInputDevice,
                voiceOutputDevice,
                vadThreshold,
                voiceMode,
                k,
              );
            }}
            mentionPingEnabled={mentionPingEnabled}
            onMentionPingChange={setMentionPingEnabled}
            micLevel={micLevel}
            micTesting={micTesting}
            onToggleMicTest={toggleMicTest}
            recoveryPhrase={recoveryPhrase}
            onShowRecovery={handleShowRecovery}
            onRecoverIdentity={handleRecoverIdentity}
          />
        ) : (
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
            <DndContext sensors={dndSensors} onDragEnd={handleHubReorder}>
              <SortableContext
                items={hubs.map((h) => h.hub_id)}
                strategy={verticalListSortingStrategy}
              >
                {hubs.map((h) => {
                  const unread = unreadByHub[h.hub_id] || 0;
                  const ping = pingByHub[h.hub_id];
                  const offline = ping === null;
                  const titleSuffix = offline
                    ? " — offline"
                    : ping === undefined
                    ? ""
                    : ` — ${ping}ms`;
                  return (
                    <SortableHubIcon key={h.hub_id} hubId={h.hub_id}>
                      <div className="hub-icon-box">
                        <button
                          className={`hub-icon ${
                            h.hub_id === activeHubId && view === "channels" ? "active" : ""
                          } ${offline ? "offline" : ""} ${
                            hubNotifyMode[h.hub_id] === "silent" ? "muted" : ""
                          }`}
                          onClick={() => {
                            handleSwitchHub(h.hub_id);
                            setView("channels");
                          }}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            handleRemoveHub(h.hub_id);
                          }}
                          title={`${h.hub_name} (${h.hub_url})${titleSuffix}${
                            hubNotifyMode[h.hub_id] === "silent"
                              ? " — silenced"
                              : hubNotifyMode[h.hub_id] === "mentions"
                              ? " — mentions only"
                              : ""
                          }`}
                        >
                          {h.hub_icon ? (
                            <img
                              src={h.hub_icon}
                              alt={h.hub_name}
                              className="hub-icon-image"
                            />
                          ) : (
                            h.hub_name.slice(0, 2).toUpperCase()
                          )}
                        </button>
                        {unread > 0 && hubNotifyMode[h.hub_id] !== "silent" && (
                          <span className="hub-unread-badge">
                            {unread > 99 ? "99+" : unread}
                          </span>
                        )}
                        {hubNotifyMode[h.hub_id] === "silent" && (
                          <span className="hub-muted-badge" title="Silenced">
                            🔕
                          </span>
                        )}
                        {hubNotifyMode[h.hub_id] === "mentions" && (
                          <span
                            className="hub-muted-badge"
                            title="Mentions only"
                          >
                            @
                          </span>
                        )}
                      </div>
                      {offline && <span className="hub-offline-label">offline</span>}
                    </SortableHubIcon>
                  );
                })}
              </SortableContext>
            </DndContext>
            <button
              className="hub-icon add"
              onClick={() => setShowAddHub(true)}
              title="Add hub"
            >
              +
            </button>
          </div>
          {!hasActiveHub ? (
            <div className="empty-state welcome">
              <h1>Voxply</h1>
              <p className="welcome-tagline">
                Decentralized voice chat + community platform
              </p>
              <ul className="welcome-points">
                <li>
                  <strong>Hubs</strong> are independently-run servers — like
                  Discord servers but federated. Add one with its URL to join.
                </li>
                <li>
                  <strong>Your identity</strong> is a keypair on this device,
                  not an account. The same identity works on every hub. Back
                  up your recovery phrase from Settings → Security.
                </li>
                <li>
                  <strong>Alliances</strong> let hubs share channels and voice
                  across topics — your messages travel with you.
                </li>
              </ul>
              <button className="primary" onClick={() => setShowAddHub(true)}>
                Add your first hub
              </button>
              <p className="welcome-hint muted">
                Don't have one? Ask a friend for a hub URL or invite link.
              </p>
            </div>
          ) : myApprovalStatus === "pending" ? (
            <div className="empty-state pending-approval">
              <div className="pending-approval-icon">⏳</div>
              <h1>Waiting for approval</h1>
              <p>
                <strong>
                  {hubs.find((h) => h.hub_id === activeHubId)?.hub_name ?? "This hub"}
                </strong>{" "}
                requires admin approval before new members can join in.
              </p>
              <p className="muted">
                You'll get access automatically once an admin approves your
                request — feel free to leave the app open or come back later.
              </p>
              <button
                onClick={loadHubData}
                className="primary"
              >
                Check again
              </button>
              {hubs.length > 1 && (
                <p className="muted" style={{ marginTop: "var(--space-4)" }}>
                  Switch to another hub from the sidebar if you'd like to keep
                  chatting elsewhere in the meantime.
                </p>
              )}
            </div>
          ) : (
            <>
          <div className="sidebar">
            {view === "channels" && (
              <div className="hub-header">
                <button
                  className="hub-header-button"
                  onClick={() => setHubDropdownOpen(!hubDropdownOpen)}
                >
                  <span className="hub-header-name">
                    {hubs.find((h) => h.hub_id === activeHubId)?.hub_name ?? "Hub"}
                  </span>
                  <span className="hub-header-chevron">
                    {hubDropdownOpen ? "▴" : "▾"}
                  </span>
                </button>
                {hubDropdownOpen && (
                  <div className="hub-dropdown">
                    {isAdmin && (
                      <button
                        className="hub-dropdown-item"
                        onClick={async () => {
                          await openHubAdmin();
                          setHubAdminTab("invites");
                        }}
                      >
                        Invite people
                      </button>
                    )}
                    {isAdmin && (
                      <button
                        className="hub-dropdown-item"
                        onClick={openHubAdmin}
                      >
                        Hub settings
                      </button>
                    )}
                    {activeHubId &&
                      (() => {
                        const cur = hubNotifyMode[activeHubId] ?? "all";
                        const items: { mode: NotifyMode; label: string }[] = [
                          { mode: "all", label: "Notify on all messages" },
                          { mode: "mentions", label: "Notify on @mentions only" },
                          { mode: "silent", label: "Silence this hub" },
                        ];
                        return items.map(({ mode, label }) => (
                          <button
                            key={mode}
                            className="hub-dropdown-item"
                            onClick={() => {
                              setHubDropdownOpen(false);
                              setHubMode(activeHubId, mode);
                            }}
                          >
                            {cur === mode ? "✓ " : ""}
                            {label}
                          </button>
                        ));
                      })()}
                    {activeHubId &&
                      Object.keys(unreadByChannel[activeHubId] ?? {}).length > 0 && (
                        <button
                          className="hub-dropdown-item"
                          onClick={() => {
                            setHubDropdownOpen(false);
                            clearHubUnread(activeHubId);
                          }}
                        >
                          Mark all as read
                        </button>
                      )}
                    <button
                      className="hub-dropdown-item danger"
                      onClick={() => {
                        setHubDropdownOpen(false);
                        if (activeHubId) handleRemoveHub(activeHubId);
                      }}
                    >
                      Leave hub
                    </button>
                  </div>
                )}
              </div>
            )}
            <div className="sidebar-scroll">
            {view !== "dms" ? (
              <>
            {(() => {
              const pinned = activeHubId
                ? channels.filter(
                    (c) =>
                      !c.is_category && pinnedChannels[activeHubId]?.[c.id]
                  )
                : [];
              if (pinned.length === 0) return null;
              return (
                <>
                  <div className="sidebar-header">
                    <h3>📌 Pinned</h3>
                  </div>
                  <ul className="channel-list">
                    {pinned.map((c) => (
                      <li
                        key={c.id}
                        className={`channel-item ${
                          selectedChannel?.id === c.id ? "selected" : ""
                        } ${
                          activeHubId &&
                          unreadByChannel[activeHubId]?.[c.id]
                            ? "unread"
                            : ""
                        }`}
                        onClick={() => selectChannel(c)}
                        onContextMenu={(e) => openContextMenu(e, c)}
                      >
                        # {c.name}
                      </li>
                    ))}
                  </ul>
                </>
              );
            })()}
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
                        collapsed={
                          !!activeHubId &&
                          !!collapsedCategories[activeHubId]?.[node.id]
                        }
                        childCount={children.length}
                        onToggleCollapsed={() => {
                          if (activeHubId)
                            toggleCategoryCollapsed(activeHubId, node.id);
                        }}
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
                                unread={
                                  !!activeHubId &&
                                  !!unreadByChannel[activeHubId]?.[c.id]
                                }
                                muted={
                                  !!activeHubId &&
                                  effectiveNotifyMode(activeHubId, c.id) ===
                                    "silent"
                                }
                                voiceCount={voicePops[c.id] ?? 0}
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
                        unread={
                          !!activeHubId &&
                          !!unreadByChannel[activeHubId]?.[node.id]
                        }
                        muted={
                          !!activeHubId &&
                          effectiveNotifyMode(activeHubId, node.id) ===
                            "silent"
                        }
                        voiceCount={voicePops[node.id] ?? 0}
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

            {userAlliances.length > 0 && (
              <div className="sidebar-alliances">
                {userAlliances.map((a) => {
                  const allChans = allianceChannels[a.id] ?? [];
                  // Hide local channels of this hub -- they already appear in
                  // the main Channels list above; surfacing them again would
                  // just duplicate.
                  const remoteOnly = allChans.filter(
                    (c) => !channels.find((local) => local.id === c.channel_id)
                  );
                  if (remoteOnly.length === 0) return null;
                  return (
                    <div key={a.id} className="sidebar-alliance-group">
                      <div className="sidebar-header sidebar-header-alliance">
                        <h3>🤝 {a.name}</h3>
                      </div>
                      <ul className="channel-list">
                        {remoteOnly.map((c) => {
                          const isSelected =
                            selectedAllianceChannel?.alliance_id === a.id &&
                            selectedAllianceChannel.channel.channel_id ===
                              c.channel_id;
                          return (
                            <li
                              key={c.channel_id}
                              className={`channel-item ${isSelected ? "selected" : ""}`}
                              onClick={() => selectAllianceChannel(a, c)}
                              title={`Hosted on ${c.hub_name}`}
                            >
                              # {c.channel_name}
                              <span className="alliance-channel-host">
                                {c.hub_name}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="sidebar-header sidebar-header-games">
              <h3>Games</h3>
              {isAdmin && (
                <button
                  className="btn-icon"
                  onClick={() => setShowInstallGame(true)}
                  title="Install game"
                >
                  +
                </button>
              )}
            </div>
            <ul className="channel-list">
              {installedGames.map((g) => (
                <li
                  key={g.id}
                  className={`channel-item ${
                    view === "game" && selectedGame?.id === g.id ? "selected" : ""
                  }`}
                  onClick={() => launchGame(g)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    if (isAdmin) handleUninstallGame(g.id, g.name);
                  }}
                  title={g.description ?? ""}
                >
                  🎮 {g.name}
                </li>
              ))}
            </ul>
            {installedGames.length === 0 && (
              <p className="muted">
                {isAdmin ? "No games yet — click + to install." : "No games yet."}
              </p>
            )}

              </>
            ) : (
              <>
                <div className="sidebar-header">
                  <h3>Direct Messages</h3>
                  <button
                    className="btn-icon"
                    onClick={openFriends}
                    title="Friends"
                  >
                    👥
                  </button>
                </div>
                <ul className="channel-list">
                  {[...conversations]
                    .sort(
                      (a, b) =>
                        (b.last_activity_at ?? b.created_at) -
                        (a.last_activity_at ?? a.created_at),
                    )
                    .map((c) => {
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
            </div>
            <div className="user-info">
              {voiceChannelId && (
                <div className="voice-status">
                  <span className="status-dot online" />
                  <span className="voice-status-label">
                    In voice: #{channels.find((c) => c.id === voiceChannelId)?.name}
                  </span>
                  {activeHubId && pingByHub[activeHubId] !== undefined && (
                    <span
                      className={`voice-ping ${
                        pingByHub[activeHubId] === null
                          ? "offline"
                          : (pingByHub[activeHubId] as number) < 150
                          ? "good"
                          : (pingByHub[activeHubId] as number) < 400
                          ? "okay"
                          : "bad"
                      }`}
                    >
                      {pingByHub[activeHubId] === null
                        ? "offline"
                        : `${pingByHub[activeHubId]}ms`}
                    </span>
                  )}
                  <button onClick={handleVoiceLeave} className="btn-small leave">
                    Leave
                  </button>
                </div>
              )}
              <div className="user-footer">
                <span
                  className="user-footer-name"
                  title={publicKey ?? undefined}
                >
                  {users.find((u) => u.public_key === publicKey)?.display_name
                    || publicKey?.slice(0, 12)
                    || "You"}
                </span>
                <button
                  onClick={openSettings}
                  className="btn-icon-gear"
                  title="Settings"
                >
                  ⚙
                </button>
              </div>
            </div>
          </div>

          <div className="content">
            {activeHubId && hubConnected[activeHubId] === false && (
              <div className="reconnect-banner">
                <span>
                  {reconnectingHubs[activeHubId]
                    ? "Reconnecting…"
                    : "Disconnected from hub."}
                </span>
                <button
                  className="btn-small"
                  onClick={handleReconnect}
                  disabled={!!reconnectingHubs[activeHubId]}
                >
                  {reconnectingHubs[activeHubId] ? "Working…" : "Reconnect"}
                </button>
              </div>
            )}
            {view === "game" && selectedGame ? (
              <>
                <div className="channel-header">
                  <div className="channel-header-info">
                    <h3>🎮 {selectedGame.name}</h3>
                    {selectedGame.description && (
                      <p className="channel-description">
                        {selectedGame.description}
                      </p>
                    )}
                  </div>
                  <button
                    className="btn-small"
                    onClick={() => {
                      setSelectedGame(null);
                      setView("channels");
                    }}
                  >
                    Close
                  </button>
                </div>
                <iframe
                  key={`${selectedGame.id}:${theme}`}
                  src={`${selectedGame.entry_url}${selectedGame.entry_url.includes("?") ? "&" : "?"}theme=${theme}`}
                  className="game-frame"
                  sandbox="allow-scripts"
                  title={selectedGame.name}
                />
              </>
            ) : view === "dms" ? (
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
                    {(dmMessages[selectedConversation.id] || []).map((m, i) => {
                      const senderLabel =
                        users.find((u) => u.public_key === m.sender)
                          ?.display_name ||
                        m.sender_name ||
                        formatPubkey(m.sender);
                      const actionText = meAction(m.content);
                      if (actionText !== null) {
                        return (
                          <div key={i} className="message message-action">
                            <span className="action-asterisk">*</span>
                            <span
                              className="message-sender"
                              style={{ color: colorForKey(m.sender) }}
                            >
                              {senderLabel}
                            </span>
                            <span className="action-text">
                              <MessageContent
                                content={actionText}
                                knownNames={knownDisplayNames}
                                myName={myDisplayName}
                              />
                            </span>
                            <span
                              className="message-time"
                              title={formatFullTimestamp(m.timestamp)}
                            >
                              {formatRelative(m.timestamp)}
                            </span>
                          </div>
                        );
                      }
                      return (
                        <div key={i} className="message">
                          <span
                            className="message-sender"
                            style={{ color: colorForKey(m.sender) }}
                          >
                            {senderLabel}
                          </span>
                          <span
                            className="message-time"
                            title={formatFullTimestamp(m.timestamp)}
                          >
                            {formatRelative(m.timestamp)}
                          </span>
                          <span className="message-content"><MessageContent content={m.content} knownNames={knownDisplayNames} myName={myDisplayName} /></span>
                          {m.attachments && m.attachments.length > 0 && (
                            <MessageAttachments items={m.attachments} onImageClick={openImage} />
                          )}
                        </div>
                      );
                    })}
                    <div ref={messagesEndRef} />
                  </div>
                  {pendingAttachments.length > 0 && (
                    <PendingAttachments
                      items={pendingAttachments}
                      onRemove={(i) =>
                        setPendingAttachments(
                          pendingAttachments.filter((_, idx) => idx !== i)
                        )
                      }
                    />
                  )}
                  <div
                    className="input-area"
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "copy";
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (e.dataTransfer.files.length > 0) {
                        attachFiles(e.dataTransfer.files);
                      }
                    }}
                  >
                    <label className="btn-attach" title="Attach file">
                      📎
                      <input
                        type="file"
                        multiple
                        style={{ display: "none" }}
                        onChange={(e) => {
                          attachFiles(e.target.files);
                          e.target.value = "";
                        }}
                      />
                    </label>
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
                  <div className="channel-header-info">
                    <h3># {selectedChannel.name}</h3>
                    {selectedChannel.description ? (
                      <p
                        className={`channel-description ${
                          isAdmin ? "editable" : ""
                        }`}
                        onClick={() => {
                          if (isAdmin) openEditDescription(selectedChannel);
                        }}
                        title={isAdmin ? "Click to edit" : undefined}
                      >
                        {selectedChannel.description}
                      </p>
                    ) : isAdmin ? (
                      <p
                        className="channel-description editable muted"
                        onClick={() => openEditDescription(selectedChannel)}
                        title="Click to add a description"
                      >
                        Add a description…
                      </p>
                    ) : null}
                  </div>
                  <button
                    onClick={() =>
                      searchOpen ? closeSearch() : setSearchOpen(true)
                    }
                    className="btn-icon-header"
                    title="Search messages"
                  >
                    🔍
                  </button>
                  <button
                    onClick={() => setMemberSidebarHidden(!memberSidebarHidden)}
                    className="btn-icon-header"
                    title={
                      memberSidebarHidden
                        ? "Show member list"
                        : "Hide member list"
                    }
                  >
                    {memberSidebarHidden ? "👥" : "👤"}
                  </button>
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
                {searchOpen && (
                  <div className="search-bar">
                    <input
                      type="text"
                      autoFocus
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") closeSearch();
                      }}
                      placeholder={`Search in #${selectedChannel.name}…`}
                    />
                    {searchResults !== null && (
                      <span className="muted search-count">
                        {searchResults.length} match
                        {searchResults.length === 1 ? "" : "es"}
                      </span>
                    )}
                    <button onClick={closeSearch} className="btn-small">
                      Close
                    </button>
                  </div>
                )}
                {voiceChannelId === selectedChannel.id && (
                  <div className="voice-bar">
                    <button
                      onClick={toggleSelfMute}
                      className={`voice-toggle ${selfMuted ? "active" : ""}`}
                      title={selfMuted ? "Unmute" : "Mute mic"}
                    >
                      {selfMuted ? "🚫🎙️" : "🎙️"}
                    </button>
                    <button
                      onClick={toggleSelfDeafen}
                      className={`voice-toggle ${selfDeafened ? "active" : ""}`}
                      title={selfDeafened ? "Undeafen" : "Deafen"}
                    >
                      {selfDeafened ? "🚫🔊" : "🔊"}
                    </button>
                    {voiceParticipants.length > 0 && (
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
                  </div>
                )}
                <div
                  className="messages"
                  ref={messagesContainerRef}
                  onScroll={handleMessagesScroll}
                >
                  {(searchResults ?? messages).length === 0 && (
                    <div className="channel-empty">
                      {searchResults !== null ? (
                        <p>No messages match your search.</p>
                      ) : (
                        <>
                          <div className="channel-empty-icon">👋</div>
                          <h2>Welcome to #{selectedChannel.name}</h2>
                          <p>
                            This is the start of the channel.
                            {selectedChannel.description
                              ? ` ${selectedChannel.description}`
                              : " Say hello!"}
                          </p>
                        </>
                      )}
                    </div>
                  )}
                  {(searchResults ?? messages).map((m, i, arr) => {
                    const showSeparator =
                      i === 0 ||
                      dayKey(m.created_at) !== dayKey(arr[i - 1].created_at);
                    const isMine = m.sender === publicKey;
                    const canDelete =
                      isMine ||
                      myRoles.some((r) =>
                        r.permissions.some(
                          (p) => p === "admin" || p === "manage_messages"
                        )
                      );
                    const isEditing = editingMessageId === m.id;
                    const senderUser = users.find(
                      (u) => u.public_key === m.sender
                    );
                    const senderLabel =
                      senderUser?.display_name ||
                      m.sender_name ||
                      formatPubkey(m.sender);
                    const isMentioned =
                      m.sender !== publicKey &&
                      mentionsName(m.content, myDisplayName);
                    const actionText = meAction(m.content);
                    if (actionText !== null) {
                      return (
                        <React.Fragment key={m.id}>
                          {showSeparator && (
                            <div className="day-separator">
                              <span className="day-separator-label">
                                {formatDayLabel(m.created_at)}
                              </span>
                            </div>
                          )}
                          <div
                            id={`msg-${m.id}`}
                            className={`message message-action ${
                              isMentioned ? "message-mentioned" : ""
                            }`}
                          >
                            <span className="action-asterisk">*</span>
                            <span
                              className="message-sender"
                              style={{ color: colorForKey(m.sender) }}
                            >
                              {senderLabel}
                            </span>
                            <span className="action-text">
                              <MessageContent
                                content={actionText}
                                knownNames={knownDisplayNames}
                                myName={myDisplayName}
                              />
                            </span>
                          </div>
                        </React.Fragment>
                      );
                    }
                    return (
                      <React.Fragment key={m.id}>
                        {showSeparator && (
                          <div className="day-separator">
                            <span className="day-separator-label">
                              {formatDayLabel(m.created_at)}
                            </span>
                          </div>
                        )}
                      <div
                        id={`msg-${m.id}`}
                        className={`message ${isMentioned ? "message-mentioned" : ""}`}
                      >
                        {m.reply_to && (
                          <div
                            className="message-reply-preview"
                            onClick={() =>
                              m.reply_to && scrollToMessage(m.reply_to.message_id)
                            }
                            title="Jump to original"
                          >
                            <span className="reply-arrow">↪</span>
                            <span className="reply-author">
                              {m.reply_to.sender_name ||
                                formatPubkey(m.reply_to.sender)}
                            </span>
                            <span className="reply-snippet">
                              {m.reply_to.content_preview}
                            </span>
                          </div>
                        )}
                        <Avatar
                          src={senderUser?.avatar}
                          name={senderLabel}
                          size={28}
                        />
                        <span
                          className="message-sender"
                          style={{ color: colorForKey(m.sender) }}
                        >
                          {senderLabel}
                        </span>
                        {isEditing ? (
                          <span className="message-edit">
                            <input
                              type="text"
                              value={editingDraft}
                              onChange={(e) => setEditingDraft(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") handleSaveEditedMessage();
                                if (e.key === "Escape") cancelEditingMessage();
                              }}
                              autoFocus
                            />
                            <button
                              onClick={handleSaveEditedMessage}
                              className="btn-small"
                            >
                              Save
                            </button>
                            <button
                              onClick={cancelEditingMessage}
                              className="btn-small btn-secondary-small"
                            >
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <>
                            <span
                              className="message-time"
                              title={formatFullTimestamp(m.created_at)}
                            >
                              {formatRelative(m.created_at)}
                            </span>
                            <span className="message-content"><MessageContent content={m.content} knownNames={knownDisplayNames} myName={myDisplayName} /></span>
                        {m.attachments && m.attachments.length > 0 && <MessageAttachments items={m.attachments} onImageClick={openImage} />}
                            {m.edited_at && (
                              <span
                                className="message-edited-tag"
                                title={`Edited ${formatFullTimestamp(m.edited_at)}`}
                              >
                                (edited)
                              </span>
                            )}
                            <span className="message-actions">
                              <ReactionPicker
                                onPick={(emoji) => toggleReaction(m.id, emoji)}
                              />
                              <button
                                className="message-action"
                                onClick={() => setReplyTarget(m)}
                                title="Reply"
                              >
                                ↩
                              </button>
                              {isMine && (
                                <button
                                  className="message-action"
                                  onClick={() => startEditingMessage(m)}
                                  title="Edit"
                                >
                                  ✎
                                </button>
                              )}
                              {canDelete && (
                                <button
                                  className="message-action danger"
                                  onClick={() => handleDeleteMessage(m.id)}
                                  title="Delete"
                                >
                                  ✕
                                </button>
                              )}
                            </span>
                            {m.reactions && m.reactions.length > 0 && (
                              <MessageReactions
                                reactions={m.reactions}
                                onToggle={(emoji) => toggleReaction(m.id, emoji)}
                              />
                            )}
                          </>
                        )}
                      </div>
                      </React.Fragment>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </div>
                {!stickToBottom && newWhileScrolledUp > 0 && (
                  <button className="jump-to-bottom" onClick={jumpToBottom}>
                    ↓ {newWhileScrolledUp} new
                  </button>
                )}
                <TypingIndicator typers={Object.values(typingByKey)} />
                {replyTarget && (
                  <div className="reply-banner">
                    <span className="muted">Replying to </span>
                    <strong>
                      {users.find((u) => u.public_key === replyTarget.sender)
                        ?.display_name ||
                        replyTarget.sender_name ||
                        formatPubkey(replyTarget.sender)}
                    </strong>
                    <span className="reply-snippet">
                      {replyTarget.content.slice(0, 80)}
                    </span>
                    <button
                      className="reply-banner-close"
                      onClick={() => setReplyTarget(null)}
                      title="Cancel reply"
                    >
                      ×
                    </button>
                  </div>
                )}
                {pendingAttachments.length > 0 && (
                  <PendingAttachments
                    items={pendingAttachments}
                    onRemove={(i) =>
                      setPendingAttachments(
                        pendingAttachments.filter((_, idx) => idx !== i)
                      )
                    }
                  />
                )}
                <div
                  className="input-area"
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "copy";
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (e.dataTransfer.files.length > 0) {
                      attachFiles(e.dataTransfer.files);
                    }
                  }}
                >
                  <label className="btn-attach" title="Attach file">
                    📎
                    <input
                      type="file"
                      multiple
                      style={{ display: "none" }}
                      onChange={(e) => {
                        attachFiles(e.target.files);
                        e.target.value = "";
                      }}
                    />
                  </label>
                  <input
                    ref={messageInputRef}
                    type="text"
                    value={inputText}
                    onChange={(e) => {
                      setInputText(e.target.value);
                      if (e.target.value.length > 0) pingTyping();
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Escape" && replyTarget) {
                        e.preventDefault();
                        setReplyTarget(null);
                        return;
                      }
                      handleKeyDown(e);
                    }}
                    placeholder={
                      replyTarget
                        ? `Reply to ${
                            users.find(
                              (u) => u.public_key === replyTarget.sender
                            )?.display_name ?? "user"
                          }`
                        : `Message #${selectedChannel.name}`
                    }
                  />
                  <button onClick={handleSend}>Send</button>
                </div>
              </>
            ) : selectedAllianceChannel ? (
              <>
                <div className="channel-header">
                  <div className="channel-header-info">
                    <h3># {selectedAllianceChannel.channel.channel_name}</h3>
                    <p className="channel-description">
                      🤝 {selectedAllianceChannel.alliance_name} · hosted on{" "}
                      {selectedAllianceChannel.channel.hub_name}
                    </p>
                  </div>
                </div>
                <div className="messages">
                  {allianceMessages.map((m) => {
                    const senderLabel =
                      m.sender_name || formatPubkey(m.sender);
                    return (
                      <div key={m.id} className="message">
                        <Avatar src={null} name={senderLabel} size={28} />
                        <span
                          className="message-sender"
                          style={{ color: colorForKey(m.sender) }}
                        >
                          {senderLabel}
                        </span>
                        <span className="message-content"><MessageContent content={m.content} knownNames={knownDisplayNames} myName={myDisplayName} /></span>
                        {m.attachments && m.attachments.length > 0 && <MessageAttachments items={m.attachments} onImageClick={openImage} />}
                        <span
                          className="message-time"
                          title={formatFullTimestamp(m.created_at)}
                        >
                          {formatRelative(m.created_at)}
                        </span>
                      </div>
                    );
                  })}
                  {allianceMessages.length === 0 && (
                    <p className="muted" style={{ padding: "1rem" }}>
                      No messages yet in this alliance channel.
                    </p>
                  )}
                </div>
                <div className="input-area">
                  <input
                    type="text"
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleSendAllianceMessage();
                      }
                    }}
                    placeholder={`Message ${selectedAllianceChannel.channel.hub_name} · #${selectedAllianceChannel.channel.channel_name}`}
                  />
                  <button onClick={handleSendAllianceMessage}>Send</button>
                </div>
              </>
            ) : (
              <div className="no-channel">
                <p>Select a channel to start chatting</p>
              </div>
            )}
          </div>

          {view === "channels" && !memberSidebarHidden && (
            <aside className="user-list-sidebar">
              <UserListGrouped
                users={users}
                inVoice={voiceActiveUsers}
                onContextMenu={(e, u) => {
                  e.preventDefault();
                  setUserContextMenu({ x: e.clientX, y: e.clientY, user: u });
                }}
              />
            </aside>
          )}

            </>
          )}
        </div>
        )}

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
              {!newChannelIsCategory && (
                <textarea
                  value={newChannelDescription}
                  onChange={(e) => setNewChannelDescription(e.target.value)}
                  placeholder="Channel description (optional) — shown in the channel header"
                  rows={3}
                />
              )}
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

        {showInstallGame && (
          <div className="modal-overlay" onClick={() => setShowInstallGame(false)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <h3>Install game</h3>
              <p className="muted">
                Paste a manifest URL (JSON). The game will be available to
                everyone on this hub.
              </p>
              <input
                type="text"
                value={installManifestUrl}
                onChange={(e) => setInstallManifestUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleInstallGameFromUrl();
                  if (e.key === "Escape") setShowInstallGame(false);
                }}
                placeholder="https://example.com/my-game/manifest.json"
                autoFocus
              />
              <div className="modal-actions">
                <button
                  onClick={handleInstallDemoGame}
                  className="btn-secondary"
                  title="Install a tiny bundled demo to verify the platform works"
                >
                  Install demo dice game
                </button>
                <button
                  onClick={() => setShowInstallGame(false)}
                  className="btn-secondary"
                >
                  Cancel
                </button>
                <button onClick={handleInstallGameFromUrl}>Install</button>
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
              {!contextMenu.channel.is_category && (
                <>
                  <button
                    className="context-menu-item"
                    onClick={async () => {
                      const ch = contextMenu.channel;
                      setContextMenu(null);
                      const next = prompt("Rename channel", ch.name);
                      if (!next) return;
                      const trimmed = next.trim();
                      if (!trimmed || trimmed === ch.name) return;
                      try {
                        await invoke("rename_channel", {
                          channelId: ch.id,
                          name: trimmed,
                        });
                        setChannels((prev) =>
                          prev.map((c) =>
                            c.id === ch.id ? { ...c, name: trimmed } : c,
                          ),
                        );
                        if (selectedChannel?.id === ch.id) {
                          setSelectedChannel({ ...selectedChannel, name: trimmed });
                        }
                      } catch (e) {
                        setError(String(e));
                      }
                    }}
                  >
                    Rename channel…
                  </button>
                  <button
                    className="context-menu-item"
                    onClick={() => openEditDescription(contextMenu.channel)}
                  >
                    Edit description
                  </button>
                  <button
                    className="context-menu-item"
                    onClick={() => {
                      const ch = contextMenu.channel;
                      setContextMenu(null);
                      handleSetTalkPower(ch.id);
                    }}
                  >
                    Set talk power…
                  </button>
                  <button
                    className="context-menu-item"
                    onClick={() => {
                      const ch = contextMenu.channel;
                      setContextMenu(null);
                      setChannelBansModal({ channelId: ch.id, channelName: ch.name });
                    }}
                  >
                    Manage channel bans…
                  </button>
                  {activeHubId &&
                    (() => {
                      const cur = effectiveNotifyMode(
                        activeHubId,
                        contextMenu.channel.id,
                      );
                      const items: { mode: NotifyMode; label: string }[] = [
                        { mode: "all", label: "All messages" },
                        { mode: "mentions", label: "Only @mentions" },
                        { mode: "silent", label: "Silent" },
                      ];
                      return items.map(({ mode, label }) => (
                        <button
                          key={mode}
                          className="context-menu-item"
                          onClick={() => {
                            const ch = contextMenu.channel;
                            setContextMenu(null);
                            setChannelMode(activeHubId, ch.id, mode);
                          }}
                        >
                          {cur === mode ? "✓ " : ""}
                          {label}
                        </button>
                      ));
                    })()}
                  {activeHubId && (
                    <button
                      className="context-menu-item"
                      onClick={() => {
                        const ch = contextMenu.channel;
                        setContextMenu(null);
                        toggleChannelPin(activeHubId, ch.id);
                      }}
                    >
                      {pinnedChannels[activeHubId]?.[contextMenu.channel.id]
                        ? "Unpin channel"
                        : "Pin channel"}
                    </button>
                  )}
                  {contextMenu.channel.parent_id && (
                    <button
                      className="context-menu-item"
                      onClick={() =>
                        handleMoveChannel(contextMenu.channel.id, null)
                      }
                    >
                      Move to top level
                    </button>
                  )}
                  {channels
                    .filter(
                      (c) =>
                        c.is_category && c.id !== contextMenu.channel.parent_id
                    )
                    .map((cat) => (
                      <button
                        key={cat.id}
                        className="context-menu-item"
                        onClick={() =>
                          handleMoveChannel(contextMenu.channel.id, cat.id)
                        }
                      >
                        Move to {cat.name}
                      </button>
                    ))}
                </>
              )}
              <button
                className="context-menu-item danger"
                onClick={() => handleDeleteChannel(contextMenu.channel.id)}
              >
                Delete {contextMenu.channel.is_category ? "category" : "channel"}
              </button>
            </div>
          </div>
        )}

        {editDescriptionChannel && (
          <div
            className="modal-overlay"
            onClick={() => setEditDescriptionChannel(null)}
          >
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <h3>Edit description — #{editDescriptionChannel.name}</h3>
              <textarea
                value={editDescriptionValue}
                onChange={(e) => setEditDescriptionValue(e.target.value)}
                placeholder="What's this channel for?"
                rows={4}
                autoFocus
              />
              <div className="modal-actions">
                <button
                  onClick={() => setEditDescriptionChannel(null)}
                  className="btn-secondary"
                >
                  Cancel
                </button>
                <button onClick={handleSaveDescription}>Save</button>
              </div>
            </div>
          </div>
        )}

        {channelBansModal && (
          <ChannelBansModal
            channelId={channelBansModal.channelId}
            channelName={channelBansModal.channelName}
            users={users}
            onClose={() => setChannelBansModal(null)}
            onError={setError}
          />
        )}

        {paletteOpen && (
          <ChannelPalette
            channels={channels.filter((c) => !c.is_category)}
            onClose={() => setPaletteOpen(false)}
            onSelect={(c) => {
              setPaletteOpen(false);
              selectChannel(c);
            }}
          />
        )}

        {lightbox && (
          <Lightbox
            src={lightbox.src}
            alt={lightbox.alt}
            onClose={() => setLightbox(null)}
          />
        )}

        {userContextMenu && (
          <div
            className="context-menu-overlay"
            onClick={() => setUserContextMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setUserContextMenu(null);
            }}
          >
            <div
              className="context-menu"
              style={{ top: userContextMenu.y, left: userContextMenu.x }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="context-menu-header">
                {userContextMenu.user.display_name ||
                  formatPubkey(userContextMenu.user.public_key)}
              </div>
              {userContextMenu.user.public_key !== publicKey && (
                <>
                  <button
                    className="context-menu-item"
                    onClick={() => handleUserDm(userContextMenu.user)}
                  >
                    Direct message
                  </button>
                  <button
                    className="context-menu-item"
                    onClick={() => handleUserAddFriend(userContextMenu.user)}
                  >
                    Add friend
                  </button>
                </>
              )}
              <button
                className="context-menu-item"
                onClick={() => handleCopyUserKey(userContextMenu.user)}
              >
                Copy public key
              </button>
            </div>
          </div>
        )}
      </>
    </div>
  );
}

function ChannelPalette({
  channels,
  onClose,
  onSelect,
}: {
  channels: Channel[];
  onClose: () => void;
  onSelect: (c: Channel) => void;
}) {
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? channels.filter((c) => c.name.toLowerCase().includes(q))
    : channels.slice(0, 20);

  // Clamp the highlighted index when results shrink so Enter never picks
  // a stale row.
  useEffect(() => {
    if (highlighted >= filtered.length) setHighlighted(0);
  }, [filtered.length, highlighted]);

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const c = filtered[highlighted];
      if (c) onSelect(c);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="palette"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          className="palette-input"
          placeholder="Jump to channel…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKey}
        />
        <ul className="palette-list">
          {filtered.length === 0 ? (
            <li className="palette-empty">No channels match.</li>
          ) : (
            filtered.map((c, i) => (
              <li
                key={c.id}
                className={`palette-item ${i === highlighted ? "active" : ""}`}
                onMouseEnter={() => setHighlighted(i)}
                onClick={() => onSelect(c)}
              >
                <span className="palette-hash">#</span>
                <span className="palette-name">{c.name}</span>
              </li>
            ))
          )}
        </ul>
        <div className="palette-hint muted">
          ↑↓ navigate · Enter select · Esc close
        </div>
      </div>
    </div>
  );
}

function ChannelBansModal({
  channelId,
  channelName,
  users,
  onClose,
  onError,
}: {
  channelId: string;
  channelName: string;
  users: User[];
  onClose: () => void;
  onError: (msg: string) => void;
}) {
  const [bans, setBans] = useState<
    {
      channel_id: string;
      target_public_key: string;
      banned_by: string;
      reason: string | null;
      created_at: number;
    }[]
  >([]);
  const [picking, setPicking] = useState<string>("");
  const [reason, setReason] = useState("");

  async function refresh() {
    try {
      const list = await invoke<typeof bans>("list_channel_bans", { channelId });
      setBans(list);
    } catch (e) {
      onError(String(e));
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId]);

  async function handleBan() {
    if (!picking) return;
    try {
      await invoke("channel_ban_user", {
        channelId,
        targetPublicKey: picking,
        reason: reason.trim() || null,
      });
      setPicking("");
      setReason("");
      await refresh();
    } catch (e) {
      onError(String(e));
    }
  }

  async function handleUnban(targetPk: string) {
    try {
      await invoke("channel_unban_user", {
        channelId,
        targetPublicKey: targetPk,
      });
      await refresh();
    } catch (e) {
      onError(String(e));
    }
  }

  // Hide already-banned users from the dropdown so admins don't try to
  // double-ban.
  const bannedSet = new Set(bans.map((b) => b.target_public_key));
  const candidates = users.filter((u) => !bannedSet.has(u.public_key));

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <h3>Channel bans — #{channelName}</h3>
        <p className="muted">
          A channel ban blocks the user from sending in this channel only.
          Hub-wide bans are managed from the admin panel.
        </p>

        <div className="settings-section">
          <label className="settings-label">Ban a user</label>
          <div className="settings-row" style={{ alignItems: "stretch" }}>
            <select
              value={picking}
              onChange={(e) => setPicking(e.target.value)}
              style={{ flex: 1 }}
            >
              <option value="">— pick a user —</option>
              {candidates.map((u) => (
                <option key={u.public_key} value={u.public_key}>
                  {u.display_name || formatPubkey(u.public_key)}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason (optional)"
              style={{ flex: 2 }}
            />
            <button onClick={handleBan} disabled={!picking}>
              Ban
            </button>
          </div>
        </div>

        <div className="settings-section">
          <label className="settings-label">
            Currently banned — {bans.length}
          </label>
          {bans.length === 0 ? (
            <p className="muted">No one is banned from this channel.</p>
          ) : (
            <ul className="alliance-members">
              {bans.map((b) => {
                const u = users.find((x) => x.public_key === b.target_public_key);
                return (
                  <li
                    key={b.target_public_key}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <span>
                      <strong>
                        {u?.display_name || formatPubkey(b.target_public_key)}
                      </strong>
                      {b.reason && (
                        <span className="muted"> — {b.reason}</span>
                      )}
                    </span>
                    <button
                      className="btn-small"
                      onClick={() => handleUnban(b.target_public_key)}
                    >
                      Unban
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="modal-actions">
          <button onClick={onClose} className="btn-secondary">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;
