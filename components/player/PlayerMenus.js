'use client';

/**
 * Player menus — one set of primitives, rendered as a hover panel on desktop
 * and a bottom sheet on touch (the `pointer: coarse` split from
 * docs/PLAYER.md §6). Presentational only: every list is built by JashPlayer
 * from engine state, so no menu here can drift from what the player can do.
 */

import { memo, useEffect, useRef } from 'react';
import { Icon, PATHS } from './PlayerIcons';
import { fmtTime } from '@/lib/player/labels';

export const Menu = memo(function Menu({ title, subtitle, onClose, children, wide = false, coarse = false, footer }) {
  const panelRef = useRef(null);

  useEffect(() => {
    const node = panelRef.current;
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose?.();
      }
    };
    node?.addEventListener?.('keydown', onKey);
    return () => node?.removeEventListener?.('keydown', onKey);
  }, [onClose]);

  const sheet = coarse
    ? 'absolute inset-x-0 bottom-0 z-50 max-h-[70%] overflow-hidden rounded-t-3xl border-t border-white/10 bg-zinc-950/97 pb-[max(env(safe-area-inset-bottom),16px)] shadow-[0_-18px_60px_rgba(0,0,0,.8)]'
    : `absolute bottom-full right-0 z-50 mb-2 overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/95 shadow-[0_18px_60px_rgba(0,0,0,0.7)] backdrop-blur ${wide ? 'w-[19rem]' : 'w-48'}`;

  return (
    <>
      <div data-dvp="menu-backdrop" className="fixed inset-0 z-40" onClick={onClose} onContextMenu={(event) => { event.preventDefault(); onClose?.(); }} />
      <div ref={panelRef} className={`${sheet} text-white`} role="dialog" aria-label={title}>
        <div className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-fuchsia-300/85">{title}</p>
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
        <div className="max-h-[52vh] overflow-y-auto overscroll-contain py-1">{children}</div>
        {footer ? <div className="border-t border-white/10 px-4 py-2.5 text-[11px] font-semibold text-white/55">{footer}</div> : null}
      </div>
    </>
  );
});

export const MenuItem = memo(function MenuItem({ active, onClick, children, hint, icon, disabled, role }) {
  return (
    <button
      type="button"
      role={role}
      disabled={disabled}
      onClick={onClick}
      className={`flex min-h-[44px] w-full items-center gap-2.5 px-4 py-2.5 text-left text-[13px] font-semibold transition ${
        disabled
          ? 'cursor-not-allowed text-white/30'
          : active
            ? 'bg-fuchsia-500/15 text-fuchsia-100'
            : 'text-white/85 hover:bg-white/5 hover:text-white'
      }`}
    >
      {icon ? <Icon d={icon} className="h-4 w-4 shrink-0 opacity-80" /> : null}
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${active ? 'bg-gradient-to-r from-fuchsia-400 to-amber-300 shadow-[0_0_8px_rgba(217,70,239,0.9)]' : 'bg-zinc-700'}`} />
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint ? <span className="shrink-0 text-[11px] font-bold tabular-nums text-white/45">{hint}</span> : null}
    </button>
  );
});

export const MenuSection = memo(function MenuSection({ label, children, note }) {
  return (
    <div className="border-t border-white/[0.07] px-4 py-2.5 first:border-t-0">
      <p className="mb-1.5 text-[10px] font-black uppercase tracking-[0.2em] text-white/40">{label}</p>
      <div className="space-y-1.5">{children}</div>
      {note ? <p className="mt-1.5 text-[11px] font-medium leading-snug text-amber-200/75">{note}</p> : null}
    </div>
  );
});

export const MenuSlider = memo(function MenuSlider({ label, value, min = 0, max = 1, step = 0.05, display, onChange, onCommit }) {
  return (
    <label className="block py-1.5">
      <span className="mb-1 flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-white/55">
        {label}
        <span className="tabular-nums text-white/80">{display}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange?.(Number(event.target.value))}
        onPointerUp={(event) => onCommit?.(Number(event.target.value))}
        onKeyUp={(event) => onCommit?.(Number(event.currentTarget.value))}
        className="h-8 w-full cursor-pointer accent-fuchsia-400"
      />
    </label>
  );
});

export const MenuToggle = memo(function MenuToggle({ label, checked, onChange, hint }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={Boolean(checked)}
      onClick={() => onChange?.(!checked)}
      className="flex min-h-[44px] w-full items-center gap-3 py-1.5 text-left"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-bold text-white/90">{label}</span>
        {hint ? <span className="block text-[11px] font-medium text-white/45">{hint}</span> : null}
      </span>
      <span className={`relative h-6 w-11 shrink-0 rounded-full transition ${checked ? 'bg-fuchsia-500/80' : 'bg-white/15'}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${checked ? 'left-[1.4rem]' : 'left-0.5'}`} />
      </span>
    </button>
  );
});

/** Speed list, shared by the settings sheet and the compact pill. */
export const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 3, 4];

export const SpeedMenu = memo(function SpeedMenu({ rate, onPick, ...menu }) {
  return (
    <Menu title="Playback speed" {...menu}>
      {SPEED_OPTIONS.map((option) => (
        <MenuItem key={option} active={Math.abs(Number(rate) - option) < 0.001} onClick={() => onPick?.(option)}>
          {option === 1 ? 'Normal' : `${option}×`}
        </MenuItem>
      ))}
    </Menu>
  );
});

/**
 * Quality list from `getVariantTracks()`. A live manifest reports heights, not
 * bitrates, so the label is built from height + bandwidth when available.
 */
export const QualityMenu = memo(function QualityMenu({ variants = [], activeHeight, auto, onPick, onAuto, ...menu }) {
  const heights = new Map();
  for (const variant of variants) {
    const height = Number(variant.height) || 0;
    if (!height) continue;
    const bandwidth = Number(variant.bandwidth) || 0;
    const current = heights.get(height);
    if (!current || bandwidth > current.bandwidth) heights.set(height, { height, bandwidth, label: variant.label || '' });
  }
  const sorted = [...heights.values()].sort((a, b) => b.height - a.height);

  return (
    <Menu title="Quality" subtitle={auto ? 'Auto (adaptive)' : `${activeHeight}p locked`} {...menu}>
      <MenuItem active={auto} onClick={() => onAuto?.()}>
        Auto
      </MenuItem>
      {sorted.length ? null : (
        <p className="px-4 py-2 text-[11px] font-semibold text-white/45">
          This source exposes one rendition, so there is nothing to switch.
        </p>
      )}
      {sorted.map((entry) => (
        <MenuItem
          key={entry.height}
          active={!auto && entry.height === Number(activeHeight)}
          onClick={() => onPick?.(entry.height)}
          hint={entry.bandwidth ? `${Math.round(entry.bandwidth / 1000)} kbps` : ''}
        >
          {entry.height >= 2160 ? '4K' : `${entry.height}p`}
          {entry.label ? <span className="ml-1 text-white/45">{entry.label}</span> : null}
        </MenuItem>
      ))}
    </Menu>
  );
});

export const AudioMenu = memo(function AudioMenu({ audio = [], language, onPick, ...menu }) {
  return (
    <Menu title="Audio track" subtitle={audio.length ? `${audio.length} available` : undefined} {...menu}>
      {audio.length ? null : <p className="px-4 py-2 text-[11px] font-semibold text-white/45">This stream carries a single audio track.</p>}
      {audio.map((track, index) => (
        <MenuItem
          key={`${track.id ?? track.language}-${index}`}
          active={track.active || (Boolean(language) && String(track.language) === String(language))}
          onClick={() => onPick?.(track.language || '')}
          hint={track.channelsCount ? `${track.channelsCount}ch` : ''}
        >
          {track.label || track.language || `Track ${index + 1}`}
          {track.roles?.includes?.('commentary') ? <span className="ml-1 text-white/45">· commentary</span> : null}
        </MenuItem>
      ))}
    </Menu>
  );
});

export const SubtitlesMenu = memo(function SubtitlesMenu({
  text = [],
  external,
  canStyleExternal,
  onPick,
  onFile,
  onRemove,
  delayMs,
  onDelay,
  scale,
  onScale,
  background,
  onBackground,
  ...menu
}) {
  const inputRef = useRef(null);
  return (
    <Menu
      title="Subtitles"
      subtitle={external ? `${external.label} imported` : text.length ? `${text.length} embedded` : 'none in this stream'}
      {...menu}
      footer={
        canStyleExternal ? (
          <span className="block">
            Delay only shifts files you imported. Embedded manifest tracks are decoded inside the player, so they cannot be re-timed.
          </span>
        ) : null
      }
    >
      <MenuItem active={!text.some((track) => track.active) && !external} onClick={() => onPick?.(-1)}>
        Off
      </MenuItem>
      {text.map((track, index) => (
        <MenuItem key={`${track.id ?? track.language}-${index}`} active={track.active} onClick={() => onPick?.(track.id ?? index)} hint={track.language || ''}>
          {track.label || track.language || `Track ${index + 1}`}
        </MenuItem>
      ))}
      {external ? (
        <MenuItem active onClick={() => onRemove?.()} hint="remove">
          {external.label} (imported)
        </MenuItem>
      ) : null}

      <MenuSection label="Import">
        <input
          ref={inputRef}
          type="file"
          accept=".vtt,.srt,.ass,.ssa,.sub,text/vtt,application/x-subrip"
          className="hidden"
          onChange={(event) => {
            const file = event.target?.files?.[0];
            event.target.value = '';
            onFile?.(file);
          }}
        />
        <MenuItem icon={PATHS.upload} onClick={() => inputRef.current?.click?.()}>
          Choose a .srt / .vtt file
        </MenuItem>
        <p className="px-1 text-[11px] font-medium text-white/45">…or drop the file anywhere on the player.</p>
      </MenuSection>

      {canStyleExternal ? (
        <MenuSection label="Timing & style">
          <div className="flex items-center gap-2 py-1">
            <button type="button" onClick={() => onDelay?.(-250)} className="min-h-[44px] flex-1 rounded-xl border border-white/15 px-2 text-[12px] font-black text-white transition hover:border-fuchsia-400/50">
              −250 ms
            </button>
            <span className="min-w-[4.5rem] text-center text-[12px] font-black tabular-nums text-white">{Math.round(Number(delayMs) || 0)} ms</span>
            <button type="button" onClick={() => onDelay?.(250)} className="min-h-[44px] flex-1 rounded-xl border border-white/15 px-2 text-[12px] font-black text-white transition hover:border-fuchsia-400/50">
              +250 ms
            </button>
          </div>
          <MenuSlider label="Text size" value={scale} min={0.6} max={2.4} step={0.05} display={`${Math.round((Number(scale) || 1) * 100)}%`} onChange={onScale} />
          <MenuSlider label="Background" value={background} min={0} max={0.85} step={0.05} display={`${Math.round((Number(background) || 0) * 100)}%`} onChange={onBackground} />
        </MenuSection>
      ) : null}
    </Menu>
  );
});

export const SourcesMenu = memo(function SourcesMenu({ sources = [], activeIndex, note, onPick, ...menu }) {
  return (
    <Menu title="Stream source" subtitle={note} {...menu}>
      {sources.map((source, index) => (
        <MenuItem key={`${source.url || index}`} active={index === Number(activeIndex)} onClick={() => onPick?.(index)} hint={source.quality || ''}>
          {source.label || `Source ${index + 1}`}
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

export const ShortcutList = memo(function ShortcutList({ commands = [], onClose, ...menu }) {
  return (
    <Menu title="Keyboard" subtitle={`${commands.length} commands`} {...menu} wide>
      <div className="divide-y divide-white/[0.06]">
        {commands.map((command) => (
          <div key={command.name} className="flex items-center gap-3 px-4 py-2">
            <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-white/85">{command.label}</span>
            <span className="flex shrink-0 flex-wrap justify-end gap-1">
              {command.keys.map((key) => (
                <kbd key={key} className="rounded-md border border-white/15 bg-white/[0.07] px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide text-white/75">
                  {key === ' ' ? 'space' : key}
                </kbd>
              ))}
              {command.desktopOnly ? <span className="text-[9px] font-black uppercase tracking-wider text-white/30">PC</span> : null}
              {command.gesture ? <span className="text-[9px] font-black uppercase tracking-wider text-fuchsia-300/50">{command.gesture}</span> : null}
            </span>
          </div>
        ))}
      </div>
    </Menu>
  );
});

export const TimeBubble = memo(function TimeBubble({ label, seconds, delta }) {
  return (
    <div className="pointer-events-none absolute left-1/2 top-1/2 z-30 -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/10 bg-black/75 px-4 py-3 text-center backdrop-blur">
      <p className="text-[11px] font-black uppercase tracking-[0.2em] text-fuchsia-300/80">{label}</p>
      {Number.isFinite(seconds) ? <p className="mt-0.5 text-[15px] font-black tabular-nums text-white">{fmtTime(seconds)}</p> : null}
      {delta ? <p className="text-[11px] font-bold text-white/60">{delta}</p> : null}
    </div>
  );
});

export default Menu;
