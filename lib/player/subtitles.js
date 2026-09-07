/**
 * Subtitle import for the unified player — the `.srt`/`.vtt` upload that died
 * with components/VideoPlayer.jsx in v8.1.0.
 *
 * Shaka only accepts WebVTT for external text (and `addTextTrackAsync` refuses
 * on src= elements — Shaka 2012), so SRT is converted and served as a blob URL
 * for the native path, or handed to the engine as a WebVTT blob for Shaka.
 */

export const SUPPORTED_SUBTITLE_EXT = /\.(srt|vtt|ass|ssa|sub)$/i;

export function looksLikeSubtitleFile(name = '') {
  return SUPPORTED_SUBTITLE_EXT.test(String(name || ''));
}

/** "Movie.en.forced.srt" → { label: 'en forced', lang: 'en' } */
export function inferSubtitleMeta(name = '') {
  const clean = String(name || '').replace(/\.[a-z]{3,4}$/i, '');
  const parts = clean.split(/[._\-\s]+/).filter(Boolean);
  const lang = parts.find((part) => /^[a-z]{2}(-[a-z]{2,4})?$/i.test(part) && part.length <= 6);
  const labelParts = parts.filter((part) => part !== lang && !/^(subs?|subtitle|captions|cc|forced|full)$/i.test(part));
  const label = labelParts.join(' ').trim() || (lang ? lang.toUpperCase() : 'Imported subtitles');
  return { label, lang: lang ? lang.toLowerCase() : 'en' };
}

function parseTimestamp(value = '') {
  const match = String(value || '')
    .trim()
    .match(/(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/);
  if (!match) return null;
  const [, h, m, s, ms] = match;
  return { h: Number(h), m: Number(m), s: Number(s), ms: Number(ms.toString().padEnd(3, '0')) };
}

function formatTimestamp({ h, m, s, ms }) {
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

/**
 * SRT → WebVTT. Strips styling tags and ASS override blocks.
 *
 * Blocks are found by SCANNING for timing lines rather than splitting on blank
 * lines, because real-world subtitle files mix both styles (Telegram packs ship
 * SRT with no blank line between cues; glued "1 00:00:01,000 --> …" headers
 * exist too). Cue text therefore never bleeds into the next cue.
 */
export function srtToVtt(source = '') {
  const text = String(source || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  if (!text) return 'WEBVTT\n\n';
  if (/^WEBVTT/i.test(text)) return text.startsWith('WEBVTT') ? text : `WEBVTT\n\n${text}`;

  const lines = text.split('\n');
  const cues = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.includes('-->')) continue;

    const [rawStart, rawEnd] = line.split('-->').map((part) => part.trim());
    const start = parseTimestamp(rawStart);
    const end = parseTimestamp(String(rawEnd || '').split(/\s+/)[0]);
    if (!start || !end) continue;

    const payloadLines = [];
    for (index += 1; index < lines.length; index += 1) {
      if (lines[index].includes('-->')) {
        index -= 1;
        break;
      }
      const candidate = lines[index].trim();
      // A lone integer directly above a timing line is the next cue's index.
      if (/^\d+$/.test(candidate) && lines[index + 1]?.includes('-->')) break;
      if (candidate) payloadLines.push(candidate);
    }

    const payload = payloadLines
      .join('\n')
      .replace(/<\/?(?:i|b|u|font|font color[^>]*)>/gi, '')
      .replace(/\{[^}]*\}/g, '')
      .trim();
    if (!payload) continue;

    cues.push(`${formatTimestamp(start)} --> ${formatTimestamp(end)}\n${payload}`);
  }

  return `WEBVTT\n\n${cues.join('\n\n')}\n`;
}

/** Convert any supported payload to a WebVTT string. */
export function toWebVttText(fileName = '', contents = '') {
  if (/\.vtt$/i.test(fileName)) return srtToVtt(contents);
  return srtToVtt(contents); // SRT + (best-effort) ASS/SSA/SUB share the cue parse
}

/** Parse `00:01:02.500` or `01:02.5` (SRT commas tolerated) into seconds. */
function cueTimeToSeconds(raw = '') {
  const match = String(raw)
    .trim()
    .match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?$/);
  if (!match) return null;
  const [, h, m, s, ms] = match;
  return (Number(h || 0) * 3600 + Number(m) * 60 + Number(s)) + Number((ms || '0').padEnd(3, '0')) / 1000;
}

function secondsToCueTime(total = 0) {
  const safe = Math.max(0, Number(total) || 0);
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = Math.floor(safe % 60);
  const ms = Math.round((safe - Math.floor(safe)) * 1000);
  const carried = ms === 1000 ? { s: s + 1, ms: 0 } : { s, ms };
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(carried.s % 60).padStart(2, '0')}.${String(carried.ms).padStart(3, '0')}`;
}

/**
 * Shift every cue of a WebVTT payload by `deltaMs` (positive = appear later).
 *
 * This is how subtitle delay is implemented: re-emitting the cue timings is the
 * only method that works identically for native `<track>` elements and Shaka,
 * without replacing the player's text displayer. Cues never go negative.
 */
export function shiftVttCues(vtt = '', deltaMs = 0) {
  const shift = Number(deltaMs) || 0;
  const lines = String(vtt || '').split('\n');
  if (!shift || !lines.length) return String(vtt || '');
  const CUE_TIME = /\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?/g;

  return lines
    .map((line) => {
      if (!line.includes('-->')) return line;
      return line.replace(CUE_TIME, (match) => {
        const seconds = cueTimeToSeconds(match);
        if (seconds === null) return match;
        return secondsToCueTime(seconds + shift / 1000);
      });
    })
    .join('\n');
}

/**
 * Build the artifact the chrome hands to the player.
 * Returns null (with a reason) rather than throwing, so a bad file never kills
 * playback — a subtitle is a luxury.
 */
export function createSubtitleTrack(fileLike, text) {
  const name = fileLike?.name || 'subtitles.vtt';
  const { label, lang } = inferSubtitleMeta(name);
  const vtt = toWebVttText(name, text ?? '');
  if (!/-->/.test(vtt)) {
    return { ok: false, reason: `No usable subtitle cues found in “${name}”.` };
  }
  const url = typeof URL !== 'undefined' && URL.createObjectURL
    ? URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }))
    : '';
  return { ok: true, id: `sub-${Date.now()}`, label, lang, url, vtt, sourceName: name };
}

export function releaseSubtitleTrack(track) {
  try {
    if (track?.url?.startsWith?.('blob:')) URL.revokeObjectURL(track.url);
  } catch {}
}

/** Apply the user's subtitle style to every visible cue box. */
export function subtitleStyleToCss({ scale = 1, y = 0, background = 0.0, outline = true } = {}) {
  const size = `${Math.round(100 * Number(scale || 1))}%`;
  const line = `::cue { font-size: ${size}; line-height: 1.35; }`;
  const box = background > 0 ? `::cue { background: rgba(0,0,0,${Number(background).toFixed(2)}); }` : '';
  const shift = Number(y) ? `::cue { transform: translateY(${Number(y)}vh); }` : '';
  const stroke = outline ? '::cue { text-shadow: 0 0 3px rgba(0,0,0,.95), 0 0 6px rgba(0,0,0,.75); }' : '';
  return [line, box, shift, stroke].filter(Boolean).join('\n');
}
