export function summarizeVault(payload) {
  return {
    ...payload,
    view: 'summary',
    movies: payload.movies.map(({ embeds, pageUrl, ...movie }) => ({
      ...movie,
      qualities: [...new Set((embeds || []).map(e => String(e.quality || '').toLowerCase()).filter(Boolean))],
    })),
  };
}
export function hasVaultQuality(movie, quality) {
  const wanted = String(quality).toLowerCase();
  return Array.isArray(movie.qualities)
    ? movie.qualities.includes(wanted)
    : (movie.embeds || []).some(e => String(e.quality).toLowerCase() === wanted);
}
