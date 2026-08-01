import Link from 'next/link';

export default function BrandLogo({ href = '/', size = 'hero', className = '' }) {
  const sizes = {
    hero: 'h-24 w-24 sm:h-32 sm:w-32 lg:h-36 lg:w-36',
    compact: 'h-16 w-16 sm:h-20 sm:w-20',
  };

  return (
    <Link
      href={href}
      className={`inline-flex shrink-0 items-center justify-center rounded-full outline-none transition hover:scale-[1.02] focus:ring-2 focus:ring-fuchsia-300/50 ${className}`}
      aria-label="JaSH ViBeS home"
      title="JaSH ViBeS"
    >
      <img
        src="/brand/logo.png"
        alt="JaSH ViBeS logo"
        className={`${sizes[size] || sizes.hero} rounded-full object-contain drop-shadow-[0_0_28px_rgba(217,70,239,0.42)]`}
        loading="eager"
        decoding="async"
      />
    </Link>
  );
}
