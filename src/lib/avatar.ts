// A racer's avatar: a letter in a circle (people and bots alike).
export type AvatarView = { kind: "letter"; char: string; color: string | null };

export const letterAvatar = (name: string): AvatarView => ({ kind: "letter", char: name.trim().charAt(0).toLocaleUpperCase("en-US") || "?", color: null });
