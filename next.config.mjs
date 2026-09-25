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
 * Sections that were removed outright (`/sports`, `/match-center`, `/anime`, …). The URLs live in
 * people's bookmarks and in a service worker's cache, so they redirect to the homepage instead of
 * 404ing. Not permanent on purpose: a 301 gets pinned by the browser for months and cannot be
 * walked back.
 */
const REMOVED_SECTION_REDIRECTS = [
  { source: '/sports/:path*', destination: '/', permanent: false },
  { source: '/sports', destination: '/', permanent: false },
  { source: '/match-center/:path*', destination: '/', permanent: false },
  { source: '/match/:path*', destination: '/', permanent: false },
  { source: '/anime/:path*', destination: '/', permanent: false },
  { source: '/anime', destination: '/', permanent: false },
];

const nextConfig = {
  reactStrictMode: true,
  // Emit .next/standalone so a container image would need no node_modules.
  // `next start` (the Render Node deploy) works normally with this option set.
  output: 'standalone',
  // Do not advertise the framework in response headers.
  poweredByHeader: false,
  async redirects() {
    return [...REMOVED_SECTION_REDIRECTS];
  },
  async headers() {
    return [
      {
        // Every API response is unframmable.
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
