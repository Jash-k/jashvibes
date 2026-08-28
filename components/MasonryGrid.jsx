'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// ReactBits "Masonry" — zero-dep port of the official API.
// Measured absolute-positioned columns, staggered blur-to-focus entrance,
// signature 0.95 hover scale (see globals.css .jv-masonry-* rules).
export default function MasonryGrid({ children, gap = 14, minItemWidth = 160, className = '' }) {
  const containerRef = useRef(null);
  const itemRefs = useRef([]);
  const items = Array.isArray(children) ? children : [children];
  const [layout, setLayout] = useState({ positions: [], height: 0, columns: 2, colWidth: 0 });

  const measure = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const width = container.clientWidth;
    if (!width) return;
    const count = items.length;
    if (!count) { setLayout({ positions: [], height: 0, columns: 1, colWidth: width }); return; }
    const columns = Math.max(2, Math.min(6, count, Math.floor((width + gap) / (minItemWidth + gap))));
    const colWidth = (width - gap * (columns - 1)) / columns;
    const heights = new Array(columns).fill(0);
    const positions = [];
    for (let i = 0; i < count; i += 1) {
      const el = itemRefs.current[i];
      const h = el ? el.offsetHeight : colWidth * 1.6;
      let col = heights.indexOf(Math.min(...heights));
      positions.push({ x: col * (colWidth + gap), y: heights[col] });
      heights[col] += h + gap;
    }
    setLayout({ positions, height: Math.max(0, Math.max(...heights) - gap), columns, colWidth });
  }, [items.length, gap, minItemWidth]);

  useEffect(() => {
    measure();
    const ro = new ResizeObserver(() => measure());
    if (containerRef.current) ro.observe(containerRef.current);
    const t1 = setTimeout(measure, 300);   // posters settle
    const t2 = setTimeout(measure, 1200);
    const onLoad = () => measure();
    window.addEventListener('load', onLoad);
    return () => { ro.disconnect(); clearTimeout(t1); clearTimeout(t2); window.removeEventListener('load', onLoad); };
  }, [measure]);

  // Re-measure whenever any poster finishes loading inside the grid.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const handler = () => measure();
    container.addEventListener('load', handler, true);
    return () => container.removeEventListener('load', handler, true);
  }, [measure]);

  return (
    <div ref={containerRef} className={`jv-masonry relative ${className}`} style={{ height: layout.height || undefined }}>
      {items.map((child, index) => (
        <div
          key={index}
          ref={(el) => { itemRefs.current[index] = el; }}
          className="jv-masonry-item"
          style={{
            width: layout.colWidth || '100%',
            transform: `translate(${layout.positions[index]?.x || 0}px, ${layout.positions[index]?.y || 0}px)`,
            '--jv-masonry-delay': `${Math.min(index, 14) * 45}ms`,
          }}
        >
          {child}
        </div>
      ))}
    </div>
  );
}
