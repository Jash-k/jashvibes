import SectionSkeleton from '@/components/Skeletons';

/**
 * The route-level fallback (what `app/**\/loading.js` renders).
 *
 * Two rules from the loading redesign live here:
 *
 *  1. **No shell.** The rail and dock belong to the app shell now, so a fallback
 *     must not render a second one — a duplicate rail was half of the flicker.
 *  2. **The 200 ms rule.** The stage is invisible for the first ~180 ms and only
 *     then fades in, so a warm section (session cache or a prefetched route) shows
 *     no loader at all. The delay lives in CSS (`.jv-skeleton-stage`), not in JS,
 *     so it costs nothing and cannot be skipped by a fast render.
 */
export default function SectionLoading({ title = '', variant = 'posters', count, rows, items, note = '' }) {
  const label = title || 'this section';
  return (
    <main className="jv-section-loading" aria-busy="true" aria-label={`Loading ${label}`}>
      <div className="jv-skeleton-stage">
        <p className="jv-section-note" role="status">{note || `Opening ${label}…`}</p>
        <SectionSkeleton variant={variant} count={count} rows={rows} items={items} />
      </div>
    </main>
  );
}
