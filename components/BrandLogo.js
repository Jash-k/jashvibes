import Link from 'next/link';

export default function BrandLogo({ href = '/', size = 'hero', className = '' }) {
  const sizes = {
    hero: 'h-[5.25rem] w-[5.25rem] sm:h-[7.25rem] sm:w-[7.25rem] lg:h-[7.25rem] lg:w-[7.25rem]',
    compact: 'h-14 w-14 sm:h-16 sm:w-16 lg:h-20 lg:w-20',
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
