/**
 * Aspect-ratio modes for the picture itself.
 *
 * `display.aspect` (a caller prop) sizes the *player box*; this is the viewer's choice about the
 * *image inside it*. They are deliberately separate: /live and the sports surfaces ask for a box that
 * fills a 16:9 shell, while a person watching a squeezed cam-rip wants the picture stretched or
 * letterboxed differently, on their device, remembered across sessions.
 *
 * The implementation is inline style on the `<video>` so it beats the class-level `object-contain`
 * without touching layout, and the forced-ratio modes use the absolute-inset + `margin:auto` trick:
 * the element centres itself in the frame and the box it draws is the requested ratio.
 */

export const ASPECT_MODES = [
  { id: 'auto', label: 'Auto', hint: 'letterbox' },
  { id: 'fill', label: 'Fill', hint: 'crop bars' },
  { id: '16:9', label: '16:9', hint: 'widescreen' },
  { id: '4:3', label: '4:3', hint: 'full / TV' },
  { id: '2.39:1', label: '2.39:1', hint: 'scope' },
  { id: '9:16', label: '9:16', hint: 'vertical' },
  { id: 'stretch', label: 'Stretch', hint: 'ignore ratio' },
];

const RATIOS = {
  '16:9': '16 / 9',
  '4:3': '4 / 3',
  '2.39:1': '2.39 / 1',
  '9:16': '9 / 16',
};

export function isAspectMode(value = '') {
  return ASPECT_MODES.some((mode) => mode.id === value);
}

/** Style object for the `<video>` element. `auto` returns nothing: the class default is already correct. */
export function pictureStyle(mode = 'auto') {
  if (mode === 'fill') return { objectFit: 'cover' };
  if (mode === 'stretch') return { objectFit: 'fill' };
  const ratio = RATIOS[mode];
  if (!ratio) return {};
  return {
    objectFit: 'contain',
    aspectRatio: ratio,
    width: 'auto',
    height: 'auto',
    maxWidth: '100%',
    maxHeight: '100%',
    margin: 'auto',
  };
}

export function nextAspectMode(mode = 'auto') {
  const index = ASPECT_MODES.findIndex((entry) => entry.id === mode);
  return ASPECT_MODES[(index + 1 + ASPECT_MODES.length) % ASPECT_MODES.length].id;
}

export function aspectLabel(mode = 'auto') {
  return ASPECT_MODES.find((entry) => entry.id === mode)?.label || 'Auto';
}
