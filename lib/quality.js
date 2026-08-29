// Release-quality detection from scraped release titles (TamilMV-style
// forum strings like "Thalaivii (2025) Tamil PreDVD x264 1080p").
// Ordering rule agreed with the user: a FORMAT tag wins over a bare
// resolution mention ("PreDVD 1080p" → PreDVD, not HD).

const FORMAT_RULES = [
  { tier: 'uhd',    label: 'UHD',    patterns: [/\buhd\b/i, /\b2160p\b/i, /\b4k\b/i] },
  { tier: 'bluray', label: 'BluRay', patterns: [/blu[-\s]?ray/i, /\bbd[-\s]?rip/i, /\bbr[-\s]?rip/i] },
  { tier: 'webdl',  label: 'WEB-DL', patterns: [/web[-\s]?dl/i] },
  { tier: 'predvd', label: 'PreDVD', patterns: [/pre[-\s]?dvd/i, /dvd[-\s]?scr/i, /\bscr\b/i] },
  { tier: 'hdtc',   label: 'HDTC',   patterns: [/\bhdtc\b/i, /\bhd[-\s]?ts\b/i, /\bhq[-\s]?ts\b/i] },
  { tier: 'camrip', label: 'CAMRip', patterns: [/cam[-\s]?rip/i, /\bhd[-\s]?cam\b/i, /\bhdcam\b/i, /\bcam\b/i] },
  { tier: 'hd',     label: 'HD',     patterns: [/\bhd[-\s]?rip\b/i, /\bhd\b/i, /\b(1080p|720p|1080 i)\b/i] },
];

// Auto-priority routing groups (per user spec):
// - low/theatrical releases live only on Mirchi → try Mirchi first
// - clean digital releases are best on Stremio → try Stremio first, then Mirchi
export const MIRCHI_FIRST_TIERS = ['camrip', 'predvd', 'hdtc'];
export const STREMIO_FIRST_TIERS = ['uhd', 'bluray', 'webdl', 'hd'];

const CHIP_CLASSES = {
  uhd:    'border-fuchsia-400/50 bg-fuchsia-600/30 text-fuchsia-100',
  bluray: 'border-violet-400/50 bg-violet-600/30 text-violet-100',
  webdl:  'border-sky-400/50 bg-sky-600/30 text-sky-100',
  hd:     'border-amber-400/50 bg-amber-600/30 text-amber-100',
  predvd: 'border-orange-400/50 bg-orange-600/30 text-orange-100',
  hdtc:   'border-yellow-400/50 bg-yellow-600/30 text-yellow-100',
  camrip: 'border-zinc-400/40 bg-zinc-700/40 text-zinc-200',
};

const EMPTY = { tier: '', label: '', cls: '' };

export function parseReleaseQuality(text = '') {
  const source = String(text || '');
  for (const rule of FORMAT_RULES) {
    if (rule.patterns.some((rx) => rx.test(source))) return { tier: rule.tier, label: rule.label };
  }
  return { tier: '', label: '' };
}

// Presentation helper for cards: label + tailwind chip classes (or '').
export function releaseQualityChip(text = '') {
  const parsed = parseReleaseQuality(text);
  if (!parsed.tier) return EMPTY;
  return { ...parsed, cls: CHIP_CLASSES[parsed.tier] || '' };
}

export function chipClassForTier(tier = '') {
  return CHIP_CLASSES[tier] || '';
}

const LABELS = FORMAT_RULES.reduce((acc, rule) => ({ ...acc, [rule.tier]: rule.label }), {});
export function labelForTier(tier = '') {
  return LABELS[tier] || '';
}
