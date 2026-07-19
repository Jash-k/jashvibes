import './globals.css';
import 'shaka-player/dist/controls.css';
import AuthGate from '@/components/AuthGate';

export const metadata = {
  title: 'JaSH ViBeS',
  description: 'Tamil-first personal streaming prototype using Next.js, TMDB metadata, and local embed provider modules.',
  referrer: 'no-referrer',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
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
        <AuthGate>{children}</AuthGate>
      </body>
    </html>
  );
}
