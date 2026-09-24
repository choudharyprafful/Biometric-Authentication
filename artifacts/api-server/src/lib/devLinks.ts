/**
 * Deliberately an allow-list ("is this exactly local development") rather
 * than a block-list ("is this simply not exactly 'production'"): an
 * environment with NODE_ENV unset, misspelled, or set to some third value
 * would otherwise leak a security-sensitive link (password reset, parental
 * consent) to any API caller instead of only the intended recipient.
 */
export function devAuthLinksEnabled(): boolean {
  return process.env["NODE_ENV"] === "development";
}
