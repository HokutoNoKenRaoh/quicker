// A player's own name in a lobby: 3–24 characters, letters / digits / space / . _ -, no links, no long digit runs,
// nothing that looks official and a short list of insults (English and Turkish). Not unique across lobbies.

export const DISPLAY_NAME_MIN = 3;
export const DISPLAY_NAME_MAX = 24;

// Words (English and Turkish) that make a name look official, after normalising (lower case, no diacritics, no spaces / punctuation,
// leetspeak undone).
const RESERVED = ["admin", "yonetici", "destek", "support", "moderator", "yetkili", "resmi", "official", "sistem"];

const PROFANITY = [
  "amk", "aq", "amina", "amcik", "orospu", "orosbu", "pic", "pezevenk", "sik", "siktir", "yarrak", "yarak", "gotveren", "got", "kahpe", "ibne",
  "sikis", "fuck", "shit", "bitch", "cunt", "dick", "pussy", "nigger", "nigga", "whore", "slut", "asshole", "bastard",
];
// Short entries match only as a whole normalised name ("aq", "got", "pic", "sik" are parts of ordinary words).
const WHOLE_ONLY = new Set(["aq", "got", "pic", "sik"]);

const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s", "!": "i" };

/** Lower case (Turkish rules, so İ / I / ı fold correctly), diacritics removed, leetspeak undone, everything but letters dropped. */
function normaliseForCheck(value: string) {
  return value
    .toLocaleLowerCase("tr-TR")
    .replace(/[013457@$!]/g, (c) => LEET[c] ?? c)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ı/g, "i")
    .replace(/[^a-z]/g, "");
}

/** Whitespace collapsed and trimmed (what is stored). */
export function cleanDisplayName(value: string) {
  return value.normalize("NFC").replace(/\s+/g, " ").trim();
}

const ALLOWED = /^[\p{L}\p{N} ._-]+$/u;

/** The error message, or null when the name may be used. */
export function displayNameError(raw: string): string | null {
  const name = cleanDisplayName(raw);
  if (name.length < DISPLAY_NAME_MIN || name.length > DISPLAY_NAME_MAX) return `Your name must be ${DISPLAY_NAME_MIN}–${DISPLAY_NAME_MAX} characters long.`;
  if (!ALLOWED.test(name)) return "Use only letters, digits, spaces and . _ - in your name.";
  if (!/\p{L}/u.test(name)) return "Your name needs at least one letter.";
  if (/\d{7,}/.test(name.replace(/[\s._-]/g, ""))) return "Your name can't contain long runs of digits like a phone number.";
  const lower = name.toLocaleLowerCase("en-US");
  if (/(https?|www)|\.(com|net|org|tr|io|gg|me|xyz|shop|store)\b/.test(lower)) return "Your name can't contain a link or a domain name.";
  const norm = normaliseForCheck(name);
  if (RESERVED.some((w) => norm.includes(w))) return "This name can't be used (it looks like an official or staff account).";
  if (PROFANITY.some((w) => (WHOLE_ONLY.has(w) ? norm === w : norm.includes(w)))) return "This name can't be used.";
  return null;
}
