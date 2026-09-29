/**
 * Locked source priority for every player that shows a source list.
 *
 *   1st  Stremio            (Telegram-Stremio addon direct files)
 *   2nd  Direct MP4         (VOD: moviesda.json and other direct files)
 *   3rd  Global Mirchi      (nxsha embed — only remaining embed tier)
 *
 * Onestream / moviesda iframe / VidLink / VidEasy / VidZee / VidRock are
 * removed from the watch-page chain. Vault still plays its own embeds on
 * /vault (separate surface).
 */
export function sourceRank(stream = {}) {
  const src = String(stream.source || stream.provider || '');
  const url = String(stream.url || stream.streamUrl || '');
  const type = String(stream.type || '').toLowerCase();
  const format = String(stream.format || '').toLowerCase();

  if (/stremio/i.test(src)) return 0;
  // Rejected embed hosts rank last so they never auto-pick if they slip in
  if (type === 'iframe' || format === 'embed' || /onestream|stream\/page/i.test(url)) return 9;
  if (/mirchi/i.test(src) || /nxsha\.space/i.test(url)) return 2;
  if (format === 'video' || format === 'direct' || /\.mp4($|\?)/i.test(url)) return 1;
  return 3;
}

/** Stable sort: same-rank streams keep their incoming order. */
export function orderBySourcePriority(streams = []) {
  return (streams || [])
    .map((stream, index) => ({ stream, index }))
    .sort((a, b) => sourceRank(a.stream) - sourceRank(b.stream) || a.index - b.index)
    .map((entry) => entry.stream);
}
