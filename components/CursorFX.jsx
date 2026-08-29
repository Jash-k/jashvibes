'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

// CursorFX — zero-dep ports of ReactBits "Target Cursor" + "Glow Cursor"
// (official visual APIs: spinning corner brackets that lock onto interactive
// elements with parallax, plus a luminous tapered glow trail). Desktop only
// (pointer:fine) and fully disabled under prefers-reduced-motion.
export default function CursorFX() {
  const pathname = usePathname() || '/';
  useEffect(() => {
    if (!pathname.startsWith('/music')) return undefined;
    if (typeof window === 'undefined') return undefined;
    const fine = window.matchMedia('(pointer: fine)').matches;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!fine || reduced) return undefined;

    const root = document.documentElement;
    root.classList.add('jv-cursor-fx');

    // ---- Target reticle ----
    const reticle = document.createElement('div');
    reticle.className = 'jv-reticle';
    reticle.setAttribute('aria-hidden', 'true');
    reticle.innerHTML =
      '<span class="jv-reticle-dot"></span>' +
      '<span class="jv-reticle-c tl"></span><span class="jv-reticle-c tr"></span>' +
      '<span class="jv-reticle-c bl"></span><span class="jv-reticle-c br"></span>';
    document.body.appendChild(reticle);
    const dot = reticle.querySelector('.jv-reticle-dot');
    const corners = {
      tl: reticle.querySelector('.tl'),
      tr: reticle.querySelector('.tr'),
      bl: reticle.querySelector('.bl'),
      br: reticle.querySelector('.br'),
    };

    // ---- Glow trail canvas ----
    const canvas = document.createElement('canvas');
    canvas.className = 'jv-glowcursor';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    const DPR = Math.min(window.devicePixelRatio || 1, 1.5);
    const resize = () => {
      canvas.width = Math.floor(window.innerWidth * DPR);
      canvas.height = Math.floor(window.innerHeight * DPR);
    };
    resize();

    const HEAD = [245, 158, 11];   // amber
    const TAIL = [168, 85, 247];   // purple
    const MAX = 32;
    const IDLE_MS = 700;
    const FADE_MS = 900;
    const TARGET_SEL = '.cursor-target, a, button, [role="button"], select, input[type="range"]';

    const points = [];
    let px = window.innerWidth / 2;
    let py = window.innerHeight / 2;
    let lastMove = performance.now();
    let glow = 0;
    let raf = 0;
    let target = null;

    const mix = (a, b, t) => [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t));
    const setPos = (el, x, y) => { el.style.transform = `translate(${x}px, ${y}px)`; };

    const lockCorners = (rect, cx, cy) => {
      const pad = 7;
      const par = 0.07;
      const ox = (cx - (rect.left + rect.width / 2)) * par;
      const oy = (cy - (rect.top + rect.height / 2)) * par;
      setPos(corners.tl, rect.left - pad + ox, rect.top - pad + oy);
      setPos(corners.tr, rect.right + pad - 8 + ox, rect.top - pad + oy);
      setPos(corners.bl, rect.left - pad + ox, rect.bottom + pad - 8 + oy);
      setPos(corners.br, rect.right + pad - 8 + ox, rect.bottom + pad - 8 + oy);
    };

    const onMove = (event) => {
      px = event.clientX;
      py = event.clientY;
      lastMove = performance.now();
      const el = event.target && event.target.closest ? event.target.closest(TARGET_SEL) : null;
      if (el !== target) {
        target = el;
        reticle.classList.toggle('is-target', Boolean(target));
      }
      if (target) lockCorners(target.getBoundingClientRect(), px, py);
      dot.style.transform = `translate(${px - 3}px, ${py - 3}px)`;
    };

    const loop = (now) => {
      raf = requestAnimationFrame(loop);

      // idle orbit (2s per revolution — spinDuration feel)
      if (!target) {
        const base = (now / 2000) * Math.PI * 2;
        const offs = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
        const keys = ['tl', 'tr', 'br', 'bl'];
        keys.forEach((k, i) => {
          const a = base + offs[i];
          setPos(corners[k], px + Math.cos(a) * 15 - 4, py + Math.sin(a) * 15 - 4);
        });
      }

      // glow trail physics
      const idle = now - lastMove;
      const want = idle < IDLE_MS ? 1 : Math.max(0, 1 - (idle - IDLE_MS) / FADE_MS);
      glow += (want - glow) * 0.12;
      if (glow < 0.02) {
        if (points.length) points.length = 0;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        return;
      }
      if (!points.length) points.push({ x: px, y: py });
      const follow = 0.16;
      points[0].x += (px - points[0].x) * follow;
      points[0].y += (py - points[0].y) * follow;
      for (let i = 1; i < points.length; i += 1) {
        points[i].x += (points[i - 1].x - points[i].x) * 0.42;
        points[i].y += (points[i - 1].y - points[i].y) * 0.42;
      }
      while (points.length < MAX) {
        const last = points[points.length - 1];
        points.push({ x: last.x, y: last.y });
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.scale(DPR, DPR);
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      for (let i = points.length - 2; i >= 0; i -= 1) {
        const t = 1 - i / points.length;
        const col = mix(HEAD, TAIL, 1 - t);
        ctx.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},${(0.5 * Math.pow(t, 1.35) * glow).toFixed(3)})`;
        ctx.lineWidth = 9 * Math.pow(t, 1.15) + 1.2;
        ctx.beginPath();
        ctx.moveTo(points[i].x, points[i].y);
        ctx.lineTo(points[i + 1].x, points[i + 1].y);
        ctx.stroke();
      }
      const pulse = 0.26 + 0.1 * Math.sin(now / 260);
      const halo = ctx.createRadialGradient(points[0].x, points[0].y, 0, points[0].x, points[0].y, 92);
      halo.addColorStop(0, `rgba(245,158,11,${(pulse * glow).toFixed(3)})`);
      halo.addColorStop(0.45, `rgba(217,70,239,${(0.12 * glow).toFixed(3)})`);
      halo.addColorStop(1, 'rgba(168,85,247,0)');
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(points[0].x, points[0].y, 92, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('resize', resize);
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('resize', resize);
      reticle.remove();
      canvas.remove();
      root.classList.remove('jv-cursor-fx');
    };
  }, [pathname]);

  return null;
}
