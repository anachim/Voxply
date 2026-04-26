// App.tsx — Root component
//
// React concepts for Blazor devs:
// - useState(initial) returns [value, setter] — private field + setter
// - useEffect(fn, [deps]) runs fn when deps change — like OnParametersSet
// - useRef(initial) persists a value across renders — like a field that doesn't trigger re-render
// - Event handlers use camelCase: onClick, onChange, onSubmit

import { useState, useEffect, useRef, useMemo } from "react";
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

interface Message {
  id: string;
  channel_id: string;
  sender: string;
  sender_name: string | null;
  content: string;
  created_at: number;
  edited_at: number | null;
}

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

function AvatarEditor({
  value,
  onChange,
  fallbackName,
}: {
  value: string;
  onChange: (v: string) => void;
  fallbackName: string;
}) {
  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 256 * 1024) {
      alert("Image too large (max 256 KB)");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") onChange(result);
    };
    reader.readAsDataURL(file);
  }

  return (
    <div className="avatar-editor">
      <Avatar src={value} name={fallbackName} size={72} />
      <div className="settings-row">
        <input type="file" accept="image/*" onChange={handleFile} />
        {value && (
          <button onClick={() => onChange("")} className="btn-secondary">
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

function UserListGrouped({ users }: { users: User[] }) {
  // Online first, then offline. Within each, bucket by group_role (the name of
  // the highest-priority role with display_separately=true), with null-role
  // members falling into a generic "Online" / "Offline" bucket.
  const online = users.filter((u) => u.online);
  const offline = users.filter((u) => !u.online);

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

  return (
    <>
      {onlineBuckets.map(([title, list]) => (
        <div className="user-section" key={`on-${title}`}>
          <p className="user-section-title">
            {title} — {list.length}
          </p>
          <ul className="user-list">
            {list.map((u) => (
              <li key={u.public_key} className="user-list-item">
                <Avatar src={u.avatar} name={u.display_name || u.public_key} size={24} />
                <span className="status-dot online" />
                <span className="user-name">
                  {u.display_name || u.public_key.slice(0, 16)}
                </span>
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
              <li key={u.public_key} className="user-list-item offline">
                <Avatar src={u.avatar} name={u.display_name || u.public_key} size={24} />
                <span className="status-dot offline" />
                <span className="user-name">
                  {u.display_name || u.public_key.slice(0, 16)}
                </span>
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
              <label className="settings-label">Microphone test</label>
              <p className="muted">
                Plays your mic back through your speaker. Use headphones to avoid
                feedback.
              </p>
              <button onClick={props.onToggleMicTest} className="btn-secondary">
                {props.micTesting ? "Stop test" : "Start mic test"}
              </button>
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

  function handleIconFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 256 * 1024) {
      alert("Image too large (max 256 KB)");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") props.onHubIconChange(result);
    };
    reader.readAsDataURL(file);
  }

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
                <div className="settings-row">
                  <input type="file" accept="image/*" onChange={handleIconFile} />
                  {props.hubIcon && (
                    <button
                      className="btn-secondary"
                      onClick={() => props.onHubIconChange("")}
                    >
                      Remove
                    </button>
                  )}
                </div>
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
  const [unreadByHub, setUnreadByHub] = useState<Record<string, number>>({});
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

  // Hub admin panel
  const [hubDropdownOpen, setHubDropdownOpen] = useState(false);
  const [showHubAdmin, setShowHubAdmin] = useState(false);
  const [hubAdminTab, setHubAdminTab] = useState<HubAdminTab>("overview");
  const [myRoles, setMyRoles] = useState<RoleInfo[]>([]);
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

  // Voice
  const [voiceChannelId, setVoiceChannelId] = useState<string | null>(null);
  const [voiceParticipants, setVoiceParticipants] = useState<VoiceParticipant[]>([]);
  const [speakingKeys, setSpeakingKeys] = useState<Set<string>>(new Set());

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
            setUnreadByHub((prev) => {
              if (!prev[hub_id]) return prev;
              const next = { ...prev };
              delete next[hub_id];
              return next;
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
      // Refresh our own roles on this hub so admin-gated UI can show/hide
      try {
        const me = await invoke<MeInfo>("get_me");
        setMyRoles(me.roles);
      } catch {
        setMyRoles([]);
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

  async function selectChannel(channel: Channel) {
    // Unsubscribe from previous channel's WS updates
    if (selectedChannel && selectedChannel.id !== channel.id) {
      await invoke("unsubscribe_channel", { channelId: selectedChannel.id });
    }

    // Leaving alliance-channel mode
    setSelectedAllianceChannel(null);
    setAllianceMessages([]);

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

  async function closeSettings() {
    if (micTesting) {
      try {
        await invoke("mic_test_stop");
      } catch {}
      setMicTesting(false);
    }
    setShowSettings(false);
  }

  async function handleVoiceLeave() {
    try {
      await invoke("voice_leave");
      setVoiceChannelId(null);
      setVoiceParticipants([]);
      setSpeakingKeys(new Set());
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
                <div key={h.hub_id} className="hub-icon-wrap">
                  <div className="hub-icon-box">
                    <button
                      className={`hub-icon ${
                        h.hub_id === activeHubId && view === "channels" ? "active" : ""
                      } ${offline ? "offline" : ""}`}
                      onClick={() => {
                        handleSwitchHub(h.hub_id);
                        setView("channels");
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        handleRemoveHub(h.hub_id);
                      }}
                      title={`${h.hub_name} (${h.hub_url})${titleSuffix}`}
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
                    {unread > 0 && (
                      <span className="hub-unread-badge">
                        {unread > 99 ? "99+" : unread}
                      </span>
                    )}
                  </div>
                  {offline && <span className="hub-offline-label">offline</span>}
                </div>
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
                    {(dmMessages[selectedConversation.id] || []).map((m, i) => (
                      <div key={i} className="message">
                        <span className="message-sender">
                          {users.find((u) => u.public_key === m.sender)
                            ?.display_name ||
                            m.sender_name ||
                            formatPubkey(m.sender)}
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
                  <div className="channel-header-info">
                    <h3># {selectedChannel.name}</h3>
                    {selectedChannel.description && (
                      <p className="channel-description">
                        {selectedChannel.description}
                      </p>
                    )}
                  </div>
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
                  {messages.map((m) => {
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
                    return (
                      <div key={m.id} className="message">
                        <Avatar
                          src={senderUser?.avatar}
                          name={senderLabel}
                          size={28}
                        />
                        <span className="message-sender">{senderLabel}</span>
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
                            <span className="message-content">{m.content}</span>
                            {m.edited_at && (
                              <span className="message-edited-tag">
                                (edited)
                              </span>
                            )}
                            <span className="message-actions">
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
                          </>
                        )}
                      </div>
                    );
                  })}
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
                        <span className="message-sender">{senderLabel}</span>
                        <span className="message-content">{m.content}</span>
                        <span className="message-time">
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
                <div className="message-input alliance-readonly">
                  <p className="muted">
                    Sending across alliances isn't wired yet — read-only for
                    now. Open a member account on{" "}
                    <strong>{selectedAllianceChannel.channel.hub_name}</strong>{" "}
                    to post.
                  </p>
                </div>
              </>
            ) : (
              <div className="no-channel">
                <p>Select a channel to start chatting</p>
              </div>
            )}
          </div>

          {view === "channels" && (
            <aside className="user-list-sidebar">
              <UserListGrouped users={users} />
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
      </>
    </div>
  );
}

export default App;
