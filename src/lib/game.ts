/**
 * The game's name: always written in small letters ("quicker"). Wherever a style could change its case, the element
 * carries `normal-case`, and lang="en" (an English word).
 */
export const QUICKER = {
  title: "quicker",
  lang: "en",
  description: "Solve the addition and subtraction questions fastest, pass your rivals and be first over the finish line.",
} as const;

/** The invite link's path of a lobby. */
export const lobbyPath = (code: string) => `/lobby/${code}`;
