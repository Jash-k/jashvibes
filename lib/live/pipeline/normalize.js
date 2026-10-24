/**
 * lib/live/pipeline/normalize.js — v12 Tamil mainstream filter
 * User wants: Popular Tamil + Tamil-dubbed sports (mainstream only)
 */

const MAINSTREAM_TAMIL_KEYWORDS = [
  'sun tv', 'sun hd', 'sun music', 'sun news', 'ktv', 'sun life', 'adithya', 'chutti tv', 'sun tv hd',
  'vijay', 'star vijay', 'vijay super', 'vijay takkar',
  'zee tamil', 'zee tamil hd', 'zee thirai',
  'kalaignar', 'kalaingar', 'kalaignar tv',
  'jaya tv', 'jaya plus', 'jaya max', 'jaya movies',
  'colors tamil', 'colors tamil hd', 'raj tv', 'raj musix', 'raj digital',
  'polimer', 'polymer', 'puthiya thalaimurai', 'puthuyugam', 'thanthi', 'news7', 'tamilan',
  'vendhar', 'captain tv', 'makkal tv', 'mega tv', 'tamil vision', 'isaiaruvi',
  'sirippoli', 'adithya tv', 'chithiram', 'pogo tamil', 'nick tamil', 'discovery kids tamil',
  'cartoon network tamil', 'sonic tamil', 'hungama tamil',
  'star sports tamil', 'sony ten tamil', 'sony sports tamil', 'star sports 1 tamil', 'dd podhigai', 'dd tamil',
  'aathavan', 'athavan', 'vasanth', 'murasu', 'tamilan tv', 'win tv', 'lotus tv',
  'anandha', 'aaseervatham', 'aasta tamil', 'angel tamil', 'bhagyam', 'blessing tv tamil',
];

// Known Tamil mainstream channel exact names (lowercased, normalized)
const WHITELIST_EXACT = new Set([
  'sun tv', 'sun tv hd', 'sun music', 'sun music hd', 'ktv', 'ktv hd', 'adithya tv', 'chutti tv',
  'star vijay', 'star vijay hd', 'vijay super', 'vijay takkar',
  'zee tamil', 'zee tamil hd',
  'kalaignar tv', 'kalaingar tv',
  'jaya tv', 'jaya tv hd', 'jaya plus', 'jaya max',
  'colors tamil', 'colors tamil hd', 'raj tv', 'raj musix',
  'polimer news', 'polimer tv', 'puthiya thalaimurai', 'puthuyugam tv', 'thanthi tv', 'news7 tamil', 'lotus tv',
  'captain tv', 'makkal tv', 'mega tv', 'vendhar tv', 'isaiaruvi', 'sirippoli',
  'dd podhigai', 'dd tamil', 'star sports tamil', 'star sports 1 tamil', 'sony ten 1', 'sony ten tamil',
  'pogo tamil', 'nick tamil', 'sonic tamil', 'hungama tamil', 'discovery kids tamil', 'chithiram',
  'aathavan tv', 'vasanth tv', 'murasu tv', 'anandham tv', 'aaseervatham tv', 'bhagyam tv',
]);

export function isMainstreamTamilChannel(ch = {}) {
  const nameNorm = String(ch.name || ch.displayName || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const catNorm = String(ch.category || '').toLowerCase();
  const langNorm = String(ch.language || '').toLowerCase();

  // 1. Language tag explicit Tamil
  if (langNorm.includes('tamil')) return true;

  // 2. Category contains Tamil (most reliable: "Tamil - Entertainment")
  if (catNorm.includes('tamil')) return true;

  // 3. Exact whitelist match
  if (WHITELIST_EXACT.has(nameNorm)) return true;

  // 4. Keyword substring match for mainstream
  for (const kw of MAINSTREAM_TAMIL_KEYWORDS) {
    if (nameNorm.includes(kw)) return true;
  }

  // Exclude non-Tamil mainstream by default
  return false;
}

// Backward compat
export function isTamilChannel(ch = {}) {
  return isMainstreamTamilChannel(ch);
}

export function normalizeTamilFilter(channels = [], { tamilOnly = false } = {}) {
  if (!tamilOnly) return channels;
  return channels.filter(isMainstreamTamilChannel);
}

export function normalizeCategory(ch = {}) {
  const raw = String(ch.category || ch.group || ch.groupTitle || '').trim() || 'Entertainment';
  const map = {
    entertainment: 'Entertainment', movies: 'Movies', sports: 'Sports', news: 'News',
    kids: 'Kids', music: 'Music', devotional: 'Devotional', english: 'English',
    lifestyle: 'Lifestyle', infotainment: 'Infotainment',
  };
  const key = raw.toLowerCase().replace(/[^a-z]+/g,'');
  return map[key] || raw;
}
