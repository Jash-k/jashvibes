/** Shared slugifier (v10.6.0) — lowercase, alphanumerics and dashes only. */
export function slugify(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
