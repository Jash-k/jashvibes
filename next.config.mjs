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

const nextConfig = {
  reactStrictMode: true,
  // Do not advertise the framework in response headers.
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: apiSecurityHeaders,
      },
      {
        source: '/((?!api/).*)',
        headers: securityHeaders.filter((h) => h.key !== 'X-Frame-Options'),
      },
    ];
  },
};

export default nextConfig;
