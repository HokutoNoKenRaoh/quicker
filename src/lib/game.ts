/**
 * The game's name: always written in small letters ("quicker"). Wherever a style could change its case, the element
 * carries `normal-case`, and lang="en" (an English word).
 */
export const QUICKER = {
  title: "quicker",
  lang: "en",
  description: "Toplama çıkarma sorularını en hızlı sen çöz, rakiplerini geç, bitiş çizgisine ilk sen ulaş.",
} as const;

/** The invite link's path of a lobby. */
export const lobbyPath = (code: string) => `/lobi/${code}`;
