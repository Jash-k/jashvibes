/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,jsx}',
    './components/**/*.{js,jsx}',
    './lib/**/*.{js,jsx}',
    './models/**/*.{js,jsx}'
  ],
  theme: {
    extend: {
      /*
       * Design-system tokens (A+B hybrid). Every value is a CSS variable defined
       * in app/globals.css so day mode flips them in one place instead of a
       * third blanket-override layer.
       *
       * NOTE: these are plain `var()` colours — Tailwind's `/opacity` modifier
       * (`bg-brand/50`) does NOT work on them. Use the dedicated `-soft` tokens
       * instead (brand-soft, marquee-soft).
       *
       * Added under new names on purpose: nothing here redefines a default
       * Tailwind key, so every existing `bg-zinc-950` / `text-zinc-500` /
       * `rounded-2xl` in the rest of the app keeps its current value.
       */
      colors: {
        ink: {
          0: 'var(--ink-0)',
          1: 'var(--ink-1)',
          2: 'var(--ink-2)',
          3: 'var(--ink-3)',
        },
        txt: {
          1: 'var(--txt-1)',
          2: 'var(--txt-2)',
          3: 'var(--txt-3)',
          4: 'var(--txt-4)',
        },
        line: {
          1: 'var(--line-1)',
          2: 'var(--line-2)',
        },
        brand: {
          DEFAULT: 'var(--brand)',
          text: 'var(--brand-text)',
          soft: 'var(--brand-soft)',
        },
        // Direction B's warmth: used for the wordmark, hero and section rules.
        marquee: {
          DEFAULT: 'var(--marquee)',
          deep: 'var(--marquee-deep)',
          soft: 'var(--marquee-soft)',
        },
        gold: 'var(--gold)',
        ok: 'var(--ok)',
        warn: 'var(--warn)',
        danger: 'var(--danger)',
        info: 'var(--info)',
      },
      fontFamily: {
        display: ['var(--font-display)', 'Georgia', 'Times New Roman', 'serif'],
        ui: ['var(--font-ui)'],
      },
      boxShadow: {
        e1: 'var(--sh-1)',
        e2: 'var(--sh-2)',
        e3: 'var(--sh-3)',
      },
      borderRadius: {
        // Deliberately not named sm/md/lg/xl — those already mean something here.
        chip: 'var(--r-sm)',
        card: 'var(--r-md)',
        tile: 'var(--r-lg)',
        panel: 'var(--r-xl)',
      },
      transitionTimingFunction: {
        jv: 'var(--ease)',
      },
    },
  },
  plugins: [],
}
