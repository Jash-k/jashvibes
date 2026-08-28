import './globals.css';
import 'shaka-player/dist/controls.css';
import { Playfair_Display } from 'next/font/google';
import AuthGate from '@/components/AuthGate';
import PWARegister from '@/components/PWARegister';
import FullscreenOrientationLock from '@/components/FullscreenOrientationLock';

const playfairDisplay = Playfair_Display({
  subsets: ['latin'],
  weight: ['700', '900'],
  variable: '--font-display',
  display: 'swap',
});

export const metadata = {
  title: 'JaSH ViBeS',
  applicationName: 'JaSH ViBeS',
  description: 'Tamil-first personal streaming prototype using Next.js, TMDB metadata, and local embed provider modules.',
  referrer: 'no-referrer',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  appleWebApp: {
    capable: true,
    title: 'JaSH ViBeS',
    statusBarStyle: 'black-translucent',
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#050012',
  colorScheme: 'dark',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={playfairDisplay.variable}>
      <head>
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="JaSH ViBeS" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var originalFetch = window.fetch;
                  Object.defineProperty(window, 'fetch', {
                    get: function() { return originalFetch; },
                    set: function(v) { console.warn('Attempt to overwrite fetch blocked.'); },
                    configurable: true,
                    enumerable: true
                  });
                } catch (e) {}
              })();
            `,
          }}
        />
      </head>
      <body>
        <PWARegister />
        <FullscreenOrientationLock />
        <AuthGate>{children}</AuthGate>
      </body>
    </html>
  );
}
