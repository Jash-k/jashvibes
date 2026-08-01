import Link from 'next/link';

export default function BrandLogo({ href = '/', showText = false, className = '' }) {
  return (
    <Link
      href={href}
      className={`inline-flex shrink-0 items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-2.5 py-2 text-zinc-100 shadow-lg shadow-black/20 backdrop-blur transition hover:border-fuchsia-300/40 hover:bg-white/[0.07] ${className}`}
      aria-label="JaSH ViBeS home"
      title="JaSH ViBeS"
    >
      <img
        src="/brand/logo.png"
        alt=""
        className="h-8 w-8 rounded-xl object-contain drop-shadow-[0_0_12px_rgba(217,70,239,0.35)] sm:h-9 sm:w-9"
        loading="eager"
        decoding="async"
      />
      {showText ? <span className="hidden text-sm font-black tracking-tight text-white sm:inline">JaSH ViBeS</span> : null}
    </Link>
  );
}
