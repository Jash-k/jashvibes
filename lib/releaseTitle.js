/**
 * Release-string → human title, kept apart from the scraper so it can be tested without cheerio.
 *
 * 1tamilmv is a forum. A topic anchor is sometimes just "[1080p & 720p]" and the real words live in
 * the URL slug, which release uploaders write dot-separated and often camel-humped:
 *
 *     /topics/401234-ImmortalCombat.2025.[Tamil].1080p.WEB-DL/
 *
 * Splitting that only on '-' yields the single glued token `ImmortalCombat.2025.[Tamil]…`, which is
 * what users saw in the catalog. It also fails the TMDB lookup, because `normalizeMatchTitle()` can
 * remove punctuation but cannot invent a space — so the mangled string never got a poster or a clean
 * title back, and the row stayed wrong forever.
 */

/** Every separator a forum or a release namer uses, plus the camelCase hump between words. */
export function humaniseSlugText(value = '') {
  return String(value || '')
    .replace(/\.(?:jpe?g|png|webp|gif|mkv|mp[45]|avi|mov|m4v|ts)$/i, '')
    .replace(/[-_.+]+/g, ' ')
    // `ImmortalCombat` → `Immortal Combat`, but leave acronyms (`KGF`, `WEB-DL`) intact.
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Title-cased slug text. Years and quality tags survive: the parser strips them and reads the year. */
export function slugToTitle(slug = '') {
  return humaniseSlugText(slug)
    .split(' ')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Does this anchor text actually say something, or is it only quality noise?
 *
 * The rule that used to decide this was "visible text, if it contains a year" — which threw away a
 * perfectly good title like `Immortal (G.V. Prakash)` because nobody typed a year in the thread title.
 * What matters is whether any words remain once brackets and punctuation are gone.
 */
export function looksLikeHumanTitle(value = '') {
  const words = humaniseBracketedText(value)
    .split(' ')
    .filter((word) => /[A-Za-z]{2,}/.test(word));
  if (!words.length) return false;
  // Drop pure quality/language words: a title is more than "[1080p] [Tamil]".
  const meaningful = words.filter((word) => !/^(?:1080p|720p|2160p|4k|uhd|hd|fhd|tamil|telugu|hindi|malayalam|kannada|english|tam|tel|hin|mal|kan|eng|web|dl|bluray|blu|ray|x264|x265|hevc|h264|h265|aac|ac3|esub|org|hq|dvd|dvdr|rip|pre|dvd|mhd|xvid|mux|unrated|subs|sub|dual|audio|multi|true|force|10bit|8bit|amzn|nf|atvp|hulu|dds|dszp)$/i.test(word));
  return meaningful.length > 0;
}

function humaniseBracketedText(value = '') {
  return String(value || '')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\((?:19|20)\d{2}[^)]*\)/g, ' ') // a bare "(2025)" is metadata, not a title
    .replace(/\s+/g, ' ')
    .trim();
}
