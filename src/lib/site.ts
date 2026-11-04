/** Where people can reach Keeper. Change it here and it changes everywhere on the site. */
export const SUPPORT_EMAIL = "rc@ryancramer.la";

/**
 * Keeper works with one Instagram account for now. Several accounts (separate
 * libraries, copying between them) stay built but hidden, to come back later,
 * e.g. as part of Pro. Turned on for tests with localStorage "keeper:multi-account".
 */
export function multiAccount(): boolean {
  try {
    return typeof window !== "undefined" && localStorage.getItem("keeper:multi-account") === "1";
  } catch {
    return false;
  }
}
