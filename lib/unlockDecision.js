/**
 * Front-door unlock classification.
 *
 * Two independent realms share one password input:
 *   - PASS       protects the whole theatre (edge middleware session)
 *   - ADMIN_PASS additionally grants owner controls (the jash_admin realm,
 *     e.g. the /live quick-hide button)
 *
 * Entering the admin password at the normal unlock screen opens BOTH realms
 * in one step, so an owner never has to visit /admin first. A normal-pass
 * unlock never receives the admin cookie. Pure and side-effect free — the
 * route owns cookie issuance and rate limiting.
 *
 * @param {string} password   what was typed at the unlock screen
 * @param {{pass?: string, adminPass?: string, compare?: (a: string, b: string) => boolean}} configured
 *        compare defaults to strict equality; routes pass a constant-time check.
 * @returns {{ok: boolean, theatre: boolean, admin: boolean}}
 */
export function classifyUnlock(password, { pass = '', adminPass = '', compare = (a, b) => a === b } = {}) {
  const value = String(password || '');
  const theatre = Boolean(pass) && compare(value, String(pass));
  const admin = Boolean(adminPass) && compare(value, String(adminPass));
  return { ok: theatre || admin, theatre, admin };
}
