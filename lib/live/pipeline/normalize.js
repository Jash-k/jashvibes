/**
 * lib/live/pipeline/normalize.js — v12 normalize tamil filter + categories
 */

const TAMIL_HINT = /tamil|chennai|kollywood|sun tv|vijay|zee tamil|kalaignar|jaya|tamilan|tamilnadu/i;

export function isTamilChannel(ch = {}) {
  const hay = `${ch.name||''} ${ch.category||ch.groupTitle||''} ${ch.language||''}`.toLowerCase();
  if (hay.includes('tamil')) return true;
  // Jash base-name already tamil-heavy; trustTamil flag handles
  return TAMIL_HINT.test(hay);
}

export function normalizeTamilFilter(channels = [], { tamilOnly = false, trustTamil = false } = {}) {
  if (tamilOnly && !trustTamil) {
    return channels.filter(isTamilChannel);
  }
  return channels;
}

export function normalizeCategory(ch = {}) {
  const raw = String(ch.category || ch.group || ch.groupTitle || '').trim() || 'Entertainment';
  // Map Jio categories to canonical
  const map = {
    entertainment: 'Entertainment', movies: 'Movies', sports: 'Sports', news: 'News',
    kids: 'Kids', music: 'Music', devotional: 'Devotional', english: 'English',
    lifestyle: 'Lifestyle', infotainment: 'Infotainment',
  };
  const key = raw.toLowerCase().replace(/[^a-z]+/g,'');
  return map[key] || raw;
}
