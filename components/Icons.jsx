// Ultra-light inline SVG icon set (stroke-based, inherits currentColor).
// One consistent 24px grid for the whole app — replaces glyph emojis (✕ ⚙ ▶ ♫ 🏏).

const SHAPES = {
  play:    [{ fill: 'M8 5.2v13.6a.8.8 0 0 0 1.22.68l10.8-6.8a.8.8 0 0 0 0-1.36L9.22 4.52A.8.8 0 0 0 8 5.2z' }],
  plus:    [{ d: 'M12 5v14M5 12h14' }],
  check:   [{ d: 'M5 12.5l4.5 4.5L19 7' }],
  close:   [{ d: 'M6 6l12 12M18 6L6 18' }],
  search:  [{ circle: { cx: 11, cy: 11, r: 7 } }, { d: 'M20.5 20.5L16 16' }],
  home:    [{ d: 'M3 10.5L12 3l9 7.5M5 9.8V21h14V9.8' }, { d: 'M9 21v-6.5h6V21' }],
  tv:      [{ rect: { x: 3, y: 6.5, width: 18, height: 13, rx: 2 } }, { d: 'M8 2l4 4 4-4' }],
  live:    [{ d: 'M12 8v5l3 2' }, { circle: { cx: 12, cy: 12, r: 9 } }],
  music:   [{ d: 'M9 18.5V6l11-2.2V16a2.6 2.6 0 1 1-2.6-2.6M9 18.5a2.6 2.6 0 1 1-2.6-2.6' }],
  trophy:  [{ d: 'M7 4h10v5.5a5 5 0 0 1-10 0V4zM7 6H4.5a2 2 0 0 0 2 4H7M17 6h2.5a2 2 0 0 1-2 4H17' }, { d: 'M12 15v3M8.5 21h7M10 18h4' }],
  heart:   [{ d: 'M12 20.5C7.2 16.2 4 13.2 2.8 10.4A5.4 5.4 0 0 1 12 5.6a5.4 5.4 0 0 1 9.2 4.8C20 13.2 16.8 16.2 12 20.5z' }],
  chevL:   [{ d: 'M15 5l-7 7 7 7' }],
  chevR:   [{ d: 'M9 5l7 7-7 7' }],
  chevD:   [{ d: 'M6 9l6 6 6-6' }],
  back:    [{ d: 'M10 5l-7 7 7 7M3 12h18' }],
  gear:    [{ circle: { cx: 12, cy: 12, r: 3.4 } }, { d: 'M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a7 7 0 0 0-2-1.2L14.2 3h-4l-.4 2.7a7 7 0 0 0-2 1.2l-2.3-1-2 3.4 2 1.5A7 7 0 0 0 5 12a7 7 0 0 0 .1 1.2l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 2 1.2l.4 2.7h4l.4-2.7a7 7 0 0 0 2-1.2l2.3 1 2-3.4-2-1.5A7 7 0 0 0 19 12z' }],
  sparkle: [{ d: 'M12 3.5l1.8 4.7L18.5 10l-4.7 1.8L12 16.5l-1.8-4.7L5.5 10l4.7-1.8z' }, { d: 'M18.5 16.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z' }],
  list:    [{ d: 'M8.5 6H21M8.5 12H21M8.5 18H21' }, { d: 'M3.5 6h.01M3.5 12h.01M3.5 18h.01' }],
  refresh: [{ d: 'M20.5 12A8.5 8.5 0 1 0 12 20.5' }, { d: 'M20.5 4v5.5h-5.5' }],
  film:    [{ rect: { x: 3, y: 4, width: 18, height: 16, rx: 2 } }, { d: 'M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4' }],
  fullscreen: [{ d: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5' }],
  target:  [{ circle: { cx: 12, cy: 12, r: 8 } }, { circle: { cx: 12, cy: 12, r: 3 } }],
  arrow:   [{ d: 'M5 12h14M13 6l6 6-6 6' }],
};

export default function Icon({ name, className = 'h-4 w-4', strokeWidth = 2 }) {
  const shapes = SHAPES[name];
  if (!shapes) return null;
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {shapes.map((shape, i) => {
        if (shape.fill) return <path key={i} d={shape.fill} fill="currentColor" stroke="none" />;
        if (shape.circle) return <circle key={i} {...shape.circle} />;
        if (shape.rect) return <rect key={i} {...shape.rect} />;
        return <path key={i} d={shape.d} />;
      })}
    </svg>
  );
}
