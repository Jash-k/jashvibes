/**
 * v10.5.0 — Locked source priority for every player that shows a source list.
 *
 *   1st  Stremio            (Telegram-Stremio addon direct files)
 *   2nd  Direct MP4         (VOD: moviesda.json and other direct files)
 *   3rd  Onestream iframe   (VOD embeds.json / stream/page pages)
 *   4th  Global Mirchi      (nxsha embed)
 *   5th  everything else    (Aha/DRM, VidLink, Videasy, …) in stable order
 *
 * Check order matters: a Mirchi MP4 still ranks in the Mirchi bucket (4th),
 * an onestream-style iframe always ranks in the embed tier, and Aha/DRM
 * streams land in "everything else" — never above the tiers above.
 */
export function sourceRank(stream = {}) {
  const src = String(stream.source || stream.provider || '');
  const url = String(stream.url || stream.streamUrl || '');
  const type = String(stream.type || '').toLowerCase();
  const format = String(stream.format || '').toLowerCase();

  if (/stremio/i.test(src)) return 0;
  if (type === 'iframe' || format === 'embed' || /onestream|stream\/page/i.test(url)) return 2;
  if (/mirchi/i.test(src) || /nxsha\.space/i.test(url)) return 3;
  if (format === 'video' || format === 'direct' || /\.mp4($|\?)/i.test(url)) return 1;
  return 4;
}

/** Stable sort: same-rank streams keep their incoming order. */
export function orderBySourcePriority(streams = []) {
  return (streams || [])
    .map((stream, index) => ({ stream, index }))
    .sort((a, b) => sourceRank(a.stream) - sourceRank(b.stream) || a.index - b.index)
    .map((entry) => entry.stream);
}
