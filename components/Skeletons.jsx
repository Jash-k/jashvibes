/**
 * Section skeletons — placeholders whose geometry matches the section they stand
 * in for, so content arriving causes no layout shift.
 *
 * This is the whole point of the file: the old fallback drew a grid of 2:3 posters
 * for every route, so Live TV (a channel list), Music (a shelf + canvas) and Extras
 * (16:9 cards) each flashed the wrong shape before the real layout replaced it —
 * which reads as a glitch. Each variant below reuses the real grid's columns,
 * aspect ratio and padding.
 */

const range = (count) => Array.from({ length: count }, (_, index) => index);

function Posters({ count = 18, className = '' }) {
  return (
    <div className={`jv-skl-grid jv-skl-posters ${className}`} aria-hidden="true">
      {range(count).map((index) => (
        <div key={index} className="jv-skl jv-skl-poster" style={{ '--jv-skl-delay': `${(index % 6) * 60}ms` }} />
      ))}
    </div>
  );
}

function Channels({ count = 12 }) {
  return (
    <div className="jv-skl-channels" aria-hidden="true">
      {range(count).map((index) => (
        <div key={index} className="jv-skl-row" style={{ '--jv-skl-delay': `${(index % 6) * 60}ms` }}>
          <span className="jv-skl jv-skl-chip" />
          <span className="jv-skl jv-skl-line" />
          <span className="jv-skl jv-skl-line is-short" />
        </div>
      ))}
    </div>
  );
}

function Cards({ count = 8 }) {
  return (
    <div className="jv-skl-grid jv-skl-cards" aria-hidden="true">
      {range(count).map((index) => (
        <div key={index} className="jv-skl jv-skl-card" style={{ '--jv-skl-delay': `${(index % 6) * 60}ms` }} />
      ))}
    </div>
  );
}

function Shelf({ rows = 3, items = 7 }) {
  return (
    <div className="jv-skl-shelf" aria-hidden="true">
      {range(rows).map((row) => (
        <div key={row}>
          <span className="jv-skl jv-skl-heading" />
          <div className="jv-skl-rail">
            {range(items).map((index) => (
              <span key={index} className="jv-skl jv-skl-poster is-rail" style={{ '--jv-skl-delay': `${index * 50}ms` }} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function Player() {
  return (
    <div className="jv-skl-player" aria-hidden="true">
      <div className="jv-skl jv-skl-frame" />
      <span className="jv-skl jv-skl-line" />
      <span className="jv-skl jv-skl-line is-short" />
    </div>
  );
}

const VARIANTS = { posters: Posters, channels: Channels, cards: Cards, shelf: Shelf, player: Player };

export default function SectionSkeleton({ variant = 'posters', count, rows, items, className = '' }) {
  const Variant = VARIANTS[variant] || Posters;
  return <Variant count={count} rows={rows} items={items} className={className} />;
}
