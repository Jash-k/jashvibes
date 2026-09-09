/** @type {import('next').NextConfig} */
const securityHeaders = [
  // Stop MIME-type sniffing of responses (prevents script/JSON confusion attacks).
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Don't leak our URL to third-party embed/media servers.
  { key: 'Referrer-Policy', value: 'no-referrer' },
  // Basic browser feature lockdown. Note: no X-Frame-Options because the app
  // is intentionally embedded (Hugging Face Spaces iframe / smart-TV wrappers).
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=()' },
  // Clickjacking protection for API responses (routes are not meant to be framed).
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
];

const apiSecurityHeaders = securityHeaders.filter((h) => h.key !== 'X-Robots-Tag');

/*
 * The sports board used to be three surfaces (/match-center, /match/live and a standalone /sports/player).
 * The Single Feed design replaced all three with one rail tab at /sports, and the old pages are deleted —
 * these redirect the URLs people have bookmarked or that are still inside a service worker's cache.
 * Not permanent on purpose: a 301 gets pinned by the browser for months and cannot be walked back.
 */
const SPORTS_REDIRECTS = [
  { source: '/match-center/:path*', destination: '/sports', permanent: false },
  { source: '/match/live', destination: '/sports', permanent: false },
  { source: '/match/:path*', destination: '/sports', permanent: false },
  { source: '/sports/player/:path*', destination: '/sports', permanent: false },
];

const nextConfig = {
  reactStrictMode: true,
  // Do not advertise the framework in response headers.
  poweredByHeader: false,
  async redirects() {
    return SPORTS_REDIRECTS;
  },
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: apiSecurityHeaders,
      },
      {
        source: '/((?!api/).*)',
        headers: [
          ...securityHeaders.filter((h) => h.key !== 'X-Frame-Options'),
          // Pages served with no Cache-Control were being heuristically cached by
          // mobile Chrome (10% of response age = days), pinning users to OLD app
          // bundles even after deploys. Revalidate every navigation (304 = cheap).
          { key: 'Cache-Control', value: 'no-cache' },
        ],
      },
    ];
  },
};

export default nextConfig;
