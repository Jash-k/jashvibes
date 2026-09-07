'use client';

/**
 * Player overlays: everything that sits on top of the picture but is not a
 * control. Copy lives here (one place) so the five surfaces say the same thing
 * when the same thing goes wrong.
 */

import { memo } from 'react';
import { Icon, PATHS } from './PlayerIcons';
import { fmtClock, fmtSize, fmtTime } from '@/lib/player/labels';

export const Spinner = memo(function Spinner({ label = 'Buffering stream…', tone = 'default' }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/35 backdrop-blur-[1px]">
      <div
        className={`h-12 w-12 animate-spin rounded-full border-[3.5px] border-white/20 drop-shadow-[0_0_20px_rgba(217,70,239,0.7)] ${
          tone === 'error' ? 'border-t-red-400' : 'border-t-fuchsia-400'
        }`}
      />
      {label ? <span className="rounded-full bg-black/60 px-3 py-1 text-[11px] font-semibold text-white/90 backdrop-blur">{label}</span> : null}
    </div>
  );
});

export const CenterPulse = memo(function CenterPulse({ pulse }) {
  if (!pulse) return null;
  if (pulse.kind === 'play' || pulse.kind === 'pause') {
    return (
      <div key={`c-${pulse.id}`} className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
        <div className="flex h-20 w-20 animate-[jvflash_0.6s_ease-out_forwards] items-center justify-center rounded-full bg-black/55 backdrop-blur-sm">
          <Icon d={pulse.kind === 'play' ? PATHS.play : PATHS.pause} className="h-9 w-9 text-white" />
        </div>
      </div>
    );
  }
  if (pulse.kind === 'fwd' || pulse.kind === 'back') {
    return (
      <div key={`s-${pulse.kind}-${pulse.id}`} className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
        <div className="flex animate-[jvflash_0.6s_ease-out_forwards] flex-col items-center gap-1 rounded-full bg-black/55 px-7 py-5 backdrop-blur-sm">
          <Icon d={pulse.kind === 'fwd' ? PATHS.fwd10 : PATHS.back10} className="h-9 w-9 text-fuchsia-300" />
          <span className="text-sm font-black text-white">{pulse.kind === 'fwd' ? '+' : '−'}{pulse.amount || 10}s</span>
        </div>
      </div>
    );
  }
  if (pulse.kind === 'badge') {
    return (
      <div key={`b-${pulse.id}`} className="pointer-events-none absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2">
        <div className="animate-[jvflash_0.9s_ease-out_forwards] rounded-full bg-black/70 px-4 py-2 text-center backdrop-blur">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-fuchsia-300/85">{pulse.label}</p>
          {pulse.value ? <p className="text-[15px] font-black tabular-nums text-white">{pulse.value}</p> : null}
        </div>
      </div>
    );
  }
  return null;
});

export const HoldBadge = memo(function HoldBadge({ rate }) {
  return (
    <div className="pointer-events-none absolute left-1/2 top-4 z-20 -translate-x-1/2 rounded-full border border-fuchsia-400/40 bg-black/70 px-3.5 py-1.5 text-xs font-black uppercase tracking-widest text-fuchsia-200 backdrop-blur">
      {rate}× speed
    </div>
  );
});

/**
 * Resume prompt. The engine computed the position; this only asks what to do.
 * `auto` prompts already seeked (so the buttons say "start over / keep going"),
 * non-auto prompts offer the seek. Both paths keep the player usable.
 */
export const ResumeToast = memo(function ResumeToast({ prompt, onAccept, onDismiss, onStartOver, onNever }) {
  if (!prompt) return null;
  return (
    <div
      data-dvp="controls"
      className="absolute left-1/2 top-4 z-30 flex max-w-[92%] -translate-x-1/2 flex-wrap items-center justify-center gap-2 rounded-2xl border border-fuchsia-400/30 bg-black/85 px-4 py-2.5 shadow-[0_12px_44px_rgba(0,0,0,0.6)] backdrop-blur sm:gap-3"
    >
      <p className="text-xs font-bold text-white sm:text-sm">
        {prompt.auto ? 'Resumed from ' : 'You stopped at '}
        <span className="font-black text-fuchsia-300">{fmtTime(prompt.seconds)}</span>
      </p>
      {prompt.auto ? (
        <button type="button" onClick={onStartOver} className="min-h-[44px] rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-black uppercase tracking-wider text-white transition hover:border-fuchsia-400/50 hover:text-fuchsia-200">
          Start over
        </button>
      ) : (
        <>
          <button type="button" onClick={onAccept} className="min-h-[44px] rounded-full border border-fuchsia-400/50 bg-fuchsia-500/20 px-3 py-1 text-[11px] font-black uppercase tracking-wider text-fuchsia-100 transition hover:bg-fuchsia-500/30">
            Resume
          </button>
          <button type="button" onClick={onDismiss} className="min-h-[44px] rounded-full border border-white/15 px-3 py-1 text-[11px] font-black uppercase tracking-wider text-white/75 transition hover:text-white">
            From the start
          </button>
        </>
      )}
      {onNever ? (
        <button
          type="button"
          onClick={onNever}
          title="Stop asking for this title. Progress keeps saving, playback just starts from 0."
          className="min-h-[44px] rounded-full px-2 py-1 text-[10px] font-black uppercase tracking-wider text-white/50 transition hover:text-white"
        >
          Never for this title
        </button>
      ) : null}
    </div>
  );
});

const ACTION_COPY = {
  retry: 'Try again',
  'rotate-source': 'Next source',
  'drop-drm': 'Play without keys',
  'refresh-token': 'Refresh token',
  proxy: 'Use secure route',
  external: 'Open in new tab',
  'copy-url': 'Copy URL',
};

export const ErrorCard = memo(function ErrorCard({ info, url, onRetry, onRotate, onRefreshToken, onDropDrm, onExternal, onReport, online = true }) {
  if (!info) return null;
  const actions = [];
  if (info.retriable) actions.push({ id: 'retry', label: 'Try again', onClick: onRetry });
  if (info.action === 'rotate-source' || info.retriable) actions.push({ id: 'rotate', label: 'Next source', onClick: onRotate });
  if (info.action === 'refresh-token') actions.push({ id: 'token', label: 'Refresh token', onClick: onRefreshToken });
  if (info.action === 'drop-drm') actions.push({ id: 'drop-drm', label: 'Play without keys', onClick: onDropDrm });
  if (url && /^https?:/i.test(url)) actions.push({ id: 'external', label: 'Open in new tab', onClick: () => onExternal?.(url) });

  return (
    <div data-dvp="controls" className="absolute inset-0 z-30 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-zinc-950/95 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.75)]">
        <div className="flex items-center gap-2 text-amber-300">
          <Icon d={online ? PATHS.warning : PATHS.dataSaver} className="h-5 w-5" />
          <p className="text-[10px] font-black uppercase tracking-[0.22em]">{online ? (info.kind || 'Playback error') : 'Offline'}</p>
          {info.code ? <p className="ml-auto text-[10px] font-black uppercase tracking-wider text-white/35">{typeof info.code === 'number' ? `code ${info.code}` : info.code}</p> : null}
        </div>
        <p className="mt-2.5 text-[15px] font-bold leading-snug text-white">{info.message || 'This source could not be played.'}</p>
        {info.hint ? <p className="mt-2 text-[12.5px] font-medium leading-relaxed text-white/60">{info.hint}</p> : null}
        {info.label ? <p className="mt-2 text-[11px] font-bold uppercase tracking-wider text-white/30">{info.label}</p> : null}
        <div className="mt-4 flex flex-wrap gap-2">
          {actions.map((action) => (
            <button
              key={action.id}
              type="button"
              onClick={action.onClick}
              className="min-h-[44px] rounded-full border border-white/15 bg-white/[0.07] px-4 py-2 text-[11px] font-black uppercase tracking-wider text-white transition hover:border-fuchsia-400/60 hover:bg-fuchsia-500/15 hover:text-fuchsia-100"
            >
              {action.label || ACTION_COPY[action.id] || 'Retry'}
            </button>
          ))}
          {onReport ? (
            <button type="button" onClick={onReport} className="min-h-[44px] rounded-full border border-white/10 px-3 py-2 text-[11px] font-black uppercase tracking-wider text-white/55 transition hover:text-red-300">
              Report dead
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
});

/** `I` key debug overlay — the thing that made the old pages fixable at all. */
export const StatsPanel = memo(function StatsPanel({ stats, model, source, status }) {
  if (!stats) return null;
  const rows = [
    ['engine', stats.engine],
    ['status', status],
    ['resolution', stats.size],
    ['buffer ahead', `${(stats.bufferedLead || 0).toFixed(1)}s`],
    ['readyState', `${stats.readyState} / net ${stats.networkState}`],
    ['bitrate', stats.bandwidthKbps ? `${stats.bandwidthKbps} kbps` : '—'],
    ['frames', `${stats.decoded ?? '—'} dec / ${stats.dropped ?? 0} drop`],
    ['quality switches', stats.switchCount ?? 0],
    ['player state', stats.state || '—'],
    ['dropped (element)', stats.quality ? `${stats.quality.dropped}/${stats.quality.total}` : '—'],
    ['clock', fmtClock(stats.currentTime)],
    ['window', model?.window ? `${fmtTime(model.window.start)} → ${fmtTime(model.window.end)}` : '—'],
    ['live', model?.live ? (model.canSeek ? `DVR ${Math.round((model.dvrSeconds || 0) / 60)} min` : 'edge only') : 'VOD'],
  ];
  if (source) rows.push(['url', String(source).slice(0, 78)]);
  return (
    <div className="pointer-events-none absolute left-3 top-14 z-30 hidden max-h-[70%] w-[22rem] overflow-hidden rounded-2xl border border-white/10 bg-black/80 p-3 font-mono text-[10.5px] leading-relaxed text-emerald-200/90 backdrop-blur sm:block">
      <p className="mb-1 font-sans text-[10px] font-black uppercase tracking-[0.22em] text-fuchsia-300/80">Player stats</p>
      <dl className="space-y-0.5">
        {rows.map(([label, value]) => (
          <div key={label} className="flex gap-2">
            <dt className="w-32 shrink-0 text-white/40">{label}</dt>
            <dd className="min-w-0 flex-1 truncate">{String(value ?? '—')}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
});

export const TopBar = memo(function TopBar({ title, subtitle, live, liveLabel = 'LIVE', canSeek, dvrMinutes, visible, badges = [], onPrev, onNext, children }) {
  return (
    <div
      data-dvp="controls"
      className={`pointer-events-none absolute inset-x-0 top-0 z-20 bg-gradient-to-b from-black/85 via-black/45 to-transparent px-3 pb-10 pt-2 transition-opacity duration-300 sm:px-4 sm:pt-3 ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <div className="flex items-start gap-2">
        {onPrev ? (
          <button type="button" onClick={onPrev} aria-label="Previous" className="pointer-events-auto -ml-1 grid h-11 w-11 shrink-0 place-items-center rounded-full text-white transition hover:bg-white/10 active:scale-95">
            <Icon d={PATHS.prev} className="h-5 w-5" />
          </button>
        ) : null}
        <div className="min-w-0 flex-1 pt-0.5">
          <p className="flex max-w-full items-center gap-2 truncate text-[13px] font-bold text-white drop-shadow sm:text-sm">
            <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-gradient-to-r from-fuchsia-400 to-amber-300 shadow-[0_0_10px_rgba(217,70,239,0.9)]" />
            <span className="truncate">{title || 'Now Playing'}</span>
          </p>
          {subtitle ? <p className="mt-0.5 truncate pl-3.5 text-[11px] font-semibold text-white/55">{subtitle}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">{badges}</div>
        {onNext ? (
          <button type="button" onClick={onNext} aria-label="Next" className="pointer-events-auto -mr-1 grid h-11 w-11 shrink-0 place-items-center rounded-full text-white transition hover:bg-white/10 active:scale-95">
            <Icon d={PATHS.next} className="h-5 w-5" />
          </button>
        ) : null}
      </div>
      {live && !canSeek ? (
        <p className="mt-1 flex items-center gap-2 pl-1">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
          </span>
          <span className="text-[10px] font-black uppercase tracking-[0.22em] text-red-300">{liveLabel}</span>
        </p>
      ) : null}
      {children}
    </div>
  );
});

export const LiveBadge = memo(function LiveBadge({ label = 'LIVE', dvrMinutes, onCatchUp }) {
  return (
    <div className="flex items-center gap-2 py-1">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
      </span>
      <span className="text-[11px] font-black uppercase tracking-[0.22em] text-red-300">{label}</span>
      {dvrMinutes >= 2 ? <span className="text-[10px] font-bold uppercase tracking-wider text-white/45">timeshift {Math.round(dvrMinutes)} min</span> : null}
      {onCatchUp ? (
        <button type="button" onClick={onCatchUp} className="ml-auto min-h-[40px] rounded-full border border-white/15 px-3 text-[10px] font-black uppercase tracking-wider text-white/80 transition hover:border-red-400/50 hover:text-red-200">
          Go live
        </button>
      ) : null}
    </div>
  );
});

export const SkipButton = memo(function SkipButton({ label, onClick, side = 'right' }) {
  return (
    <button
      data-dvp="controls"
      type="button"
      onClick={onClick}
      className={`absolute bottom-24 z-30 flex items-center gap-2 rounded-xl border border-white/25 bg-black/75 px-4 py-2.5 text-xs font-black uppercase tracking-wider text-white shadow-[0_0_28px_rgba(0,0,0,0.5)] backdrop-blur transition hover:scale-[1.02] hover:border-fuchsia-300/70 sm:bottom-28 ${
        side === 'right' ? 'right-3 sm:right-4' : 'left-3 sm:left-4'
      }`}
    >
      <Icon d={PATHS.skip} className="h-4 w-4 text-amber-300" />
      {label}
    </button>
  );
});

export const NextEpisodePill = memo(function NextEpisodePill({ label, secondsLeft, onPlay, onCancel }) {
  return (
    <div data-dvp="controls" className="absolute bottom-24 right-3 z-30 flex items-center gap-2 rounded-2xl border border-fuchsia-400/40 bg-black/85 px-3 py-2 shadow-[0_0_28px_rgba(217,70,239,0.35)] backdrop-blur sm:bottom-28 sm:right-4">
      <div className="text-center">
        <p className="text-[9px] font-black uppercase tracking-[0.18em] text-white/45">Up next</p>
        <p className="max-w-[10rem] truncate text-xs font-black text-white sm:text-sm">{label}</p>
      </div>
      {Number.isFinite(secondsLeft) ? (
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border-2 border-fuchsia-400/60 text-[12px] font-black tabular-nums text-fuchsia-200">
          {Math.max(0, Math.round(secondsLeft))}
        </span>
      ) : null}
      <button type="button" onClick={onPlay} className="min-h-[44px] rounded-full bg-gradient-to-r from-fuchsia-500 to-amber-400 px-3.5 py-1 text-[11px] font-black uppercase tracking-wider text-black transition hover:brightness-110">
        Play
      </button>
      {onCancel ? (
        <button type="button" onClick={onCancel} aria-label="Cancel auto-play" className="grid h-9 w-9 place-items-center rounded-full text-white/60 transition hover:text-white">
          <Icon d={PATHS.close} className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
});

export const NoticeBar = memo(function NoticeBar({ tone = 'info', children, action }) {
  if (!children) return null;
  const tones = {
    info: 'border-white/12 bg-black/70 text-white/85',
    warn: 'border-amber-400/35 bg-amber-950/70 text-amber-100',
    error: 'border-red-400/40 bg-red-950/70 text-red-100',
    live: 'border-fuchsia-400/35 bg-black/75 text-fuchsia-100',
  };
  return (
    <div data-dvp="controls" className={`absolute inset-x-3 bottom-24 z-30 flex items-center gap-2 rounded-2xl border px-3 py-2 text-[11.5px] font-semibold backdrop-blur sm:bottom-28 ${tones[tone] || tones.info}`}>
      <span className="min-w-0 flex-1">{children}</span>
      {action ? <button type="button" onClick={action.onClick} className="shrink-0 rounded-full border border-white/20 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider transition hover:border-fuchsia-300/60">{action.label}</button> : null}
    </div>
  );
});

/**
 * Hover poster strip: the desktop scrub preview without a sprite server — the
 * backdrop image clipped to the pointer position, which is what the old page
 * had as a time tooltip only.
 */
export const ScrubPreview = memo(function ScrubPreview({ preview, poster, seconds, width = 168 }) {
  if (!preview || !seconds) return null;
  return (
    <div
      className="pointer-events-none absolute bottom-8 z-40 -translate-x-1/2 overflow-hidden rounded-xl border border-white/15 bg-black/85 shadow-[0_16px_50px_rgba(0,0,0,.7)]"
      style={{ left: preview.x, width }}
    >
      {poster ? (
        <div className="relative aspect-video w-full overflow-hidden bg-zinc-900">
          <img src={poster} alt="" className="h-full w-full object-cover opacity-90" loading="lazy" decoding="async" />
        </div>
      ) : null}
      <p className="px-2 py-1 text-center text-[11px] font-black tabular-nums text-white">{fmtTime(seconds.time ?? 0)}</p>
      {seconds.label ? <p className="px-2 pb-1 text-center text-[9px] font-bold uppercase tracking-wider text-white/45">{seconds.label}</p> : null}
    </div>
  );
});

export const DataSaverChip = memo(function DataSaverChip({ effectiveType, bytes, onSave, onDismiss }) {
  return (
    <div data-dvp="controls" className="absolute inset-x-3 bottom-24 z-30 flex items-center gap-2 rounded-2xl border border-amber-300/30 bg-amber-950/70 px-3 py-2 text-[11.5px] font-semibold text-amber-100 backdrop-blur sm:bottom-28">
      <Icon d={PATHS.dataSaver} className="h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1">
        {effectiveType ? `Network is ${effectiveType.toUpperCase()}` : 'Metered connection'}
        {bytes ? ` · this file is ${fmtSize(bytes)}` : ''}. Lower quality avoids re-buffering.
      </span>
      <button type="button" onClick={onSave} className="shrink-0 rounded-full bg-amber-300 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-black">
        Data saver
      </button>
      <button type="button" onClick={onDismiss} aria-label="Dismiss" className="shrink-0 text-amber-100/60 hover:text-amber-50">
        <Icon d={PATHS.close} className="h-4 w-4" />
      </button>
    </div>
  );
});

export const LockedOverlay = memo(function LockedOverlay({ onUnlock }) {
  return (
    <div data-dvp="controls" className="absolute inset-0 z-40 flex items-center justify-center bg-black/45" onClick={onUnlock}>
      <div className="flex items-center gap-2 rounded-full border border-white/15 bg-black/70 px-4 py-2 text-[11px] font-black uppercase tracking-[0.2em] text-white/80 backdrop-blur">
        <Icon d={PATHS.lock} className="h-4 w-4" />
        Controls locked
      </div>
    </div>
  );
});

export const CastHint = memo(function CastHint({ visible }) {
  if (!visible) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center pb-2">
      <span className="rounded-full bg-black/70 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-white/60">Tap the screen to show controls</span>
    </div>
  );
});

export default Spinner;
