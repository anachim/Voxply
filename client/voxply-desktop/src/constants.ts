// Shared constants for the Voxply desktop client.
//
// Pure values with no React or runtime dependencies. Anything that
// needs hooks or a render context belongs in a component file.

/**
 * Curated emoji catalog for the picker. Each entry is [emoji, keywords].
 * Keywords are matched as substrings against the user's query so "thumb"
 * finds 👍 and "fire" finds 🔥. The first 8 also serve as the always-visible
 * frequent set when the search is empty.
 */
export const EMOJI_CATALOG: [string, string][] = [
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

export const QUICK_REACTIONS = EMOJI_CATALOG.slice(0, 8).map(([e]) => e);

export const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024; // matches the hub cap

export const RECENT_EMOJI_KEY = "voxply.recentEmojis";
export const RECENT_EMOJI_MAX = 8;

export const MIC_METER_MAX = 0.2;

export const RECOVERY_ACK_KEY = "voxply.recoveryAcknowledged";

export const ALL_PERMISSIONS: { id: string; label: string }[] = [
  { id: "admin", label: "Administrator (grants everything)" },
  { id: "manage_channels", label: "Manage channels" },
  { id: "manage_roles", label: "Manage roles" },
  { id: "manage_messages", label: "Manage messages" },
  { id: "kick_members", label: "Kick members" },
  { id: "ban_members", label: "Ban members" },
  { id: "mute_members", label: "Mute members" },
  { id: "timeout_members", label: "Timeout members" },
  { id: "manage_games", label: "Install / uninstall games" },
  { id: "read_messages", label: "Read messages" },
  { id: "send_messages", label: "Send messages" },
];

export const EXPIRY_OPTIONS: { label: string; seconds: number | null }[] = [
  { label: "Never", seconds: null },
  { label: "30 minutes", seconds: 30 * 60 },
  { label: "1 hour", seconds: 60 * 60 },
  { label: "6 hours", seconds: 6 * 60 * 60 },
  { label: "1 day", seconds: 24 * 60 * 60 },
  { label: "7 days", seconds: 7 * 24 * 60 * 60 },
];

export const THEMES: {
  id: "calm" | "classic" | "linear" | "light";
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
  {
    id: "light",
    name: "Light",
    tagline: "Off-white with a dusty teal accent. Reads well in daylight.",
    swatches: ["#fafaf7", "#f5f4ef", "#4a8d7a"],
  },
];
