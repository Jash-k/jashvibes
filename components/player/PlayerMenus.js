'use client';

/**
 * Player menus — one set of primitives, rendered as a hover panel on desktop
 * and a bottom sheet on touch (the `pointer: coarse` split from
 * docs/PLAYER.md §6). Presentational only: every list is built by JashPlayer
 * from engine state, so no menu here can drift from what the player can do.
 *
 * The bar carries four one-tap controls — Quality, Aspect, CC, PiP — and each
 * opens its own list here. The old all-in-one settings sheet (speed, audio
 * tracks, subtitle options, mirrors, shortcuts) is deleted outright; those
 * features live on as keyboard commands and context-menu actions, not as
 * hidden UI.
 */

import { memo, useEffect, useRef } from 'react';
import { Icon, PATHS } from './PlayerIcons';
import { fmtSize, fmtTime } from '@/lib/player/labels';
import { ASPECT_MODES, aspectLabel } from '@/lib/player/aspect';

export const Menu = memo(function Menu({ title, subtitle, onClose, children, wide = false, coarse = false, footer }) {
  const panelRef = useRef(null);
  // JashPlayer passes an inline onClose, so without this ref the effect below
  // re-runs — and re-steals focus — on every player render while open.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const node = panelRef.current;
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        closeRef.current?.();
      }
    };
    node?.addEventListener?.('keydown', onKey);
    // Focus the dialog: a sheet you cannot reach with the keyboard is a sheet you cannot leave with it.
    node?.focus?.({ preventScroll: true });
    return () => node?.removeEventListener?.('keydown', onKey);
    // Mount-only on purpose — closeRef always points at the latest onClose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sheet = coarse
    ? 'jvp-sheet absolute inset-x-0 bottom-0 z-50 max-h-[min(70%,calc(100%-3rem))] overflow-hidden rounded-t-3xl pb-[max(env(safe-area-inset-bottom),16px)]'
    // Anchored inside the player box rather than floating above it: the sheets are
    // siblings of the control bar, so an outside-above anchor put the whole menu
    // outside the frame, where `overflow-hidden` clipped it. That is why clicking a
    // control on desktop looked like "nothing happened".
    : `jvp-sheet absolute bottom-28 right-2 z-50 max-h-[min(70%,calc(100%-8rem))] overflow-hidden rounded-[18px] backdrop-blur-xl ${wide ? 'w-[19rem]' : 'w-48'}`;

  return (
    <>
            {/* The dismissal layer belongs to the player frame, not to the site. A `fixed inset-0` version
          made the whole page unclickable while a sheet was open — invisible, because nothing dims it —
          so a sheet that failed to render (or was clipped by the frame) looked exactly like a frozen
          page, with no Escape and no close button in sight. */}
      <div
        data-dvp="controls"
        className="absolute inset-0 z-40 bg-black/35"
        style={{ touchAction: 'manipulation', cursor: 'pointer' }}
        onPointerDown={() => closeRef.current?.()}
        onClick={() => closeRef.current?.()}
        onContextMenu={(event) => { event.preventDefault(); closeRef.current?.(); }}
      />
      <div
        ref={panelRef}
        data-dvp="controls"
        tabIndex={-1}
        className={`${sheet} text-white outline-none`}
        role="dialog"
        aria-label={title}
      >
        <div className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-[#a893ff]/85">{title}</p>
            {subtitle ? <p className="mt-0.5 truncate text-[11px] font-semibold text-white/50">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="-mr-1 -mt-1 grid h-9 w-9 shrink-0 place-items-center rounded-full text-white/70 transition hover:bg-white/10 hover:text-white"
          >
            <Icon d={PATHS.close} className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[min(52vh,calc(100%-6rem))] overflow-y-auto overscroll-contain py-1">{children}</div>
        {footer ? <div className="border-t border-white/10 px-4 py-2.5 text-[11px] font-semibold text-white/55">{footer}</div> : null}
      </div>
    </>
  );
});

/**
 * One row of a quick menu. 44 px tall so a thumb can trust it; on a 1600 px+
 * TV the `jv-menu-row` rule in globals.css raises that to 52 px for the
 * 10-foot interface.
 */
export const MenuItem = memo(function MenuItem({ active, onClick, children, hint, icon, disabled, role, command }) {
  return (
    <button
      type="button"
      role={role}
      data-jash-command={command}
      disabled={disabled}
      onClick={onClick}
      aria-checked={role === 'menuitemradio' ? Boolean(active) : undefined}
      className={`jv-menu-row flex min-h-[44px] w-full items-center gap-2.5 px-4 py-2.5 text-left text-[13px] font-semibold transition ${
        disabled
          ? 'cursor-not-allowed text-white/30'
          : active
            ? 'bg-[#a893ff]/15 text-[#cfc4ff]'
            : 'text-white/85 hover:bg-white/5 hover:text-white'
      }`}
    >
      {icon ? <Icon d={icon} className="h-4 w-4 shrink-0 opacity-80" /> : null}
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${active ? 'bg-gradient-to-r from-[#a893ff] to-[#cfc4ff] shadow-[0_0_10px_rgba(232,179,58,0.8)]' : 'bg-zinc-700'}`} />
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint ? <span className="shrink-0 text-[11px] font-bold tabular-nums text-white/45">{hint}</span> : null}
    </button>
  );
});

/**
 * Quality — the stream list, not a bitrate ladder, when the page discovered
 * labeled streams (Stremio files, mirrors): every stream with its resolution
 * and size, the playing one checked, and a tap switches the engine and
 * re-syncs the page. A plain file without labeled streams falls back to the
 * Auto + height rows from the manifest renditions.
 */
export const QualityMenu = memo(function QualityMenu({
  streams = [],
  activeIndex = 0,
  onPickStream,
  heights = [],
  auto = true,
  activeHeight = 0,
  onPickHeight,
  onAuto,
  note,
  coarse = false,
  onClose,
}) {
  const hasStreams = streams.length > 0;
  // One panel, two questions. Before this, quality and source were separate
  // dropdowns in the deck and a third pair of <select>s on the page — the same
  // decision spread over four controls. The heading counts what is actually in
  // here, so it is never a promise the panel cannot keep.
  const parts = [];
  if (heights.length) parts.push(`${heights.length + 1} qualities`);
  if (hasStreams) parts.push(`${streams.length} source${streams.length === 1 ? '' : 's'}`);
  const subtitle = parts.length ? parts.join(' · ') : 'Auto (adaptive)';

  return (
    <Menu title="Playback" subtitle={subtitle} note={note} coarse={coarse} onClose={onClose}>
      {/* Quality first: it is the question viewers actually ask. */}
      <div className="flex flex-wrap gap-1.5 px-4 pb-3 pt-3">
        <button
          type="button"
          className="jvp-pill"
          aria-pressed={auto}
          onClick={() => onAuto?.()}
        >
          Auto
        </button>
        {heights.map((height) => (
          <button
            key={height}
            type="button"
            className="jvp-pill"
            aria-pressed={!auto && Number(activeHeight) === height}
            onClick={() => onPickHeight?.(height)}
          >
            {height >= 2160 ? '4K' : `${height}p`}
          </button>
        ))}
      </div>

      {hasStreams ? (
        <>
          <p className="px-4 pb-1 pt-1 text-[10px] font-black uppercase tracking-[0.18em] text-white/40">
            Source
          </p>
          {streams.map((source, index) => {
          const sizeHint = Number(source.sizeBytes) > 0 ? fmtSize(Number(source.sizeBytes)) : String(source.size || '');
          return (
            <MenuItem
              key={`${source.url || index}`}
              role="menuitemradio"
              active={index === Number(activeIndex)}
              onClick={() => onPickStream?.(index)}
              hint={sizeHint}
            >
              {source.label || `Stream ${index + 1}`}
            </MenuItem>
          );
        })}
        </>
      ) : (
        <p className="px-4 pb-2 text-[11px] font-semibold text-white/45">
          {heights.length
            ? 'One source for this title — the quality pills above switch the rendition it serves.'
            : 'This source exposes one rendition, so there is nothing to switch — the server decides the quality.'}
        </p>
      )}
    </Menu>
  );
});

/**
 * Aspect — the viewer's choice about the picture inside the frame: all seven
 * modes with their hints, the active one checked, remembered on the device
 * through the prefs hook (the player applies `pictureStyle` to the <video>).
 */
export const AspectMenu = memo(function AspectMenu({ aspect = 'auto', onPick, coarse = false, onClose }) {
  return (
    <Menu
      title="Aspect ratio"
      subtitle={aspectLabel(aspect)}
      footer="Fill crops the black bars; the fixed ratios letterbox the frame. Remembered on this device."
      coarse={coarse}
      onClose={onClose}
    >
      {ASPECT_MODES.map((mode) => (
        <MenuItem
          key={mode.id}
          role="menuitemradio"
          active={aspect === mode.id}
          onClick={() => onPick?.(mode.id)}
          hint={mode.hint}
        >
          {mode.label}
        </MenuItem>
      ))}
    </Menu>
  );
});

/** Right-click menu (desktop) — the escape hatch when a stream misbehaves. */
export const ContextMenu = memo(function ContextMenu({ x, y, onClose, items }) {
  const flipX = typeof window !== 'undefined' && x > window.innerWidth - 250;
  const flipY = typeof window !== 'undefined' && y > window.innerHeight - 300;
  return (
    <>
      <div data-dvp="menu-backdrop" className="fixed inset-0 z-[70]" onClick={onClose} onContextMenu={(event) => { event.preventDefault(); onClose?.(); }} />
      <div
        className={`fixed z-[75] w-56 overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/97 py-1 shadow-[0_18px_60px_rgba(0,0,0,.75)] backdrop-blur ${
          flipX ? '-translate-x-full' : ''
        } ${flipY ? '-translate-y-full' : ''}`}
        style={{ left: x, top: y }}
        role="menu"
      >
        {items.map((item) =>
          item === '---' ? (
            <div key={`sep-${item}`} className="my-1 border-t border-white/10" />
          ) : (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              onClick={() => {
                item.onSelect?.();
                onClose?.();
              }}
              className="flex min-h-[40px] w-full items-center gap-2.5 px-3.5 py-2 text-left text-[12.5px] font-semibold text-white/85 transition hover:bg-white/5 hover:text-white"
            >
              {item.icon ? <Icon d={item.icon} className="h-4 w-4 opacity-75" /> : null}
              <span className="truncate">{item.label}</span>
              {item.hint ? <span className="ml-auto text-[10px] font-bold uppercase tracking-wider text-white/35">{item.hint}</span> : null}
            </button>
          ),
        )}
      </div>
    </>
  );
});

export const TimeBubble = memo(function TimeBubble({ label, seconds, delta }) {
  return (
    <div className="pointer-events-none absolute left-1/2 top-1/2 z-30 -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/10 bg-black/75 px-4 py-3 text-center backdrop-blur">
      <p className="text-[11px] font-black uppercase tracking-[0.2em] text-[#a893ff]/80">{label}</p>
      {Number.isFinite(seconds) ? <p className="mt-0.5 text-[15px] font-black tabular-nums text-white">{fmtTime(seconds)}</p> : null}
      {delta ? <p className="text-[11px] font-bold text-white/60">{delta}</p> : null}
    </div>
  );
});

export default Menu;
