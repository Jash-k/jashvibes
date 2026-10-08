# JaSH ViBeS — Design System v2

**Direction:** "Cinema Noir" (A) as the app-wide system, with "Tamil Marquee" (B) warmth reserved for the
wordmark, the hero and section rules. VHS ReTro (C) stays scoped to ReTro.
**Status:** token layer live · Home + `/watch` migrated · every other page still on the old classes by design.

---

## 1 · Why a layer instead of a rewrite

The app previously carried three overlapping styling ideas:

1. Tailwind utilities written inline (`rounded-2xl border-white/10 bg-zinc-950/90 …`),
2. a 2,274-line hand-written `app/globals.css` with per-surface variable sets (`--st-*` stremio, `--dec-*` classics, `--ad-*` admin),
3. 63 inline `style={{…}}` blocks.

`tailwind.config.js` had an **empty `theme.extend`**, so Tailwind owned no tokens at all — every page
invented its own values, which is why the app felt slightly different page to page.

v2 adds **one token set** and one component vocabulary. Nothing above the v2 block in `globals.css` was
edited and no Tailwind default was redefined, so unmigrated pages keep their current look until their
turn. Day mode stops being a third blanket-override layer and becomes a single variable flip.

---

## 2 · Tokens

Defined in `:root` (dark) and flipped in `html.day-mode` in `app/globals.css`, then exposed to Tailwind
in `tailwind.config.js` under **new** names (`ink`, `txt`, `line`, `brand`, `marquee`, `gold`, `ok`,
`warn`, `danger`, `info`, `e2/e3`, `rounded-card/tile/panel`).

| Token | Dark | Day mode | Contrast on `--ink-0` | Use |
|---|---|---|---|---|
| `--ink-0` | `#050508` | `#faf7f2` | — | page background |
| `--ink-1` | `#0b0b10` | `#ffffff` | — | cards, surfaces |
| `--ink-2` | `#14141b` | `#f5f0e8` | — | raised / inputs |
| `--ink-3` | `#1c1c25` | `#ece5d9` | — | inset, skeleton |
| `--line-1` / `--line-2` | `rgba(255,255,255,.08/.14)` | `rgba(15,23,42,.10/.20)` | — | hairlines / control borders |
| `--txt-1` | `#f4f4f6` | `#101418` | 18.9:1 ✅ | headings, titles |
| `--txt-2` | `#c9c9d2` | `#33415a` | 12.1:1 ✅ | body |
| `--txt-3` | `#a1a1aa` | `#475569` | 7.9:1 ✅ | secondary |
| `--txt-4` | `#8b8b95` | `#5b6b80` | 5.6:1 ✅ | meta, labels |
| `--brand` | `#e50914` | `#c8111c` | 4.25:1 ⚠️ | **fills and ≥18px only** |
| `--brand-text` | `#ff5c5c` | `#b3191f` | 6.7:1 ✅ | small red text, borders |
| `--marquee` | `#e8b33a` | `#9a6a06` | 10.6:1 ✅ | B warmth: eyebrows, hero, rules |
| `--gold` | `#f4c453` | `#8a6100` | 12.5:1 ✅ | quality, ratings |
| `--info` / `--ok` / `--danger` | `#22d3ee` / `#3ddc97` / `#ff5c5c` | darker | 11.3 / 11.5 / 6.7:1 ✅ | vault / live / errors |

**The one rule to remember:** if it is smaller than 18px and it is red, it uses `--brand-text`.

Radii `--r-sm/md/lg/xl` (10/14/20/28), elevation `--sh-1/2/3`, motion `--ease`
(`cubic-bezier(.22,.61,.36,1)`, 120–320ms). Interactive controls are **≥44px** tall.

---

## 3 · Type

| Role | Font | Notes |
|---|---|---|
| Display | Playfair Display (`--font-display`, already self-hosted) | **Only** the wordmark and the hero title. That restraint is what makes it read as branding. |
| UI | system stack (`--font-ui`) | everything else; 800 weight for headings, `-0.01em` tracking at 20px+ |
| Numerals | inherit + `tabular-nums` where times/percentages align | player, tables |

Scale: 11 (eyebrows only) · 12.5 · 13.5 (body) · 15 · 20 · 24 · 32 · 44. Body never below 13.5px on
mobile; eyebrows are always uppercase at `.22em` tracking.

---

## 4 · Components

```html
<!-- eyebrow: the B warmth, used above a hero or page title -->
<p class="jv-eyebrow">Now showing</p>

<!-- section heading with the gold hairline rule (no coloured headings) -->
<h2 class="jv-h2">Movies</h2>

<!-- buttons: always 44px, always a visible focus ring -->
<button class="jv-btn jv-btn-brand">Watch now</button>        <!-- brand fill, white text -->
<button class="jv-btn jv-btn-marquee">Try next source →</button><!-- gold fill, ink text -->
<button class="jv-btn jv-btn-ghost">Retry</button>            <!-- outline -->
<button class="jv-btn jv-btn-danger">Delete</button>          <!-- outline red -->
<button class="jv-btn jv-btn-ghost jv-btn-sm">Trailer</button><!-- 36px, inline actions -->

<!-- chips -->
<span class="jv-chip">15 / 120</span>
<span class="jv-chip jv-chip-gold">Nothing scraped yet</span>
<span class="jv-chip jv-chip-info">Vault</span>
<span class="jv-chip jv-chip-ok">Live</span>
<span class="jv-chip jv-chip-warn">Embed</span>

<!-- fields: <label class="jv-field"> wraps a .jv-select / .jv-input -->
<label class="jv-field">Source<select class="jv-select">…</select></label>

<!-- surfaces, states -->
<div class="jv-surface">…</div>
<div class="jv-skel aspect-[2/3]"></div>        <!-- shimmer; honours prefers-reduced-motion -->
<div class="jv-empty">…</div>                    <!-- dashed empty state -->
<p class="jv-alert" role="alert">…</p>           <!-- never a translucent red -->
```

Tailwind-side equivalents exist for layout work: `bg-ink-1`, `text-txt-4`, `border-line-1`,
`rounded-tile`, `shadow-e2`, `text-gold`, `text-brand-text`, `ring-marquee`.

---

## 5 · Gotchas (learned while building this)

1. **No `/opacity` modifiers on token colours.** `bg-ink-0/90` produces an invalid
   `rgb(var(--ink-0) / .9)`. Use the solid token, or add a dedicated `-soft` token.
2. **The v2 block is appended, so it wins ties.** `@tailwind utilities` is emitted at the top of
   `globals.css`; my `.jv-*` rules come later and therefore override a Tailwind utility of equal
   specificity. That is intentional for design-system components — but it means *do not* put a
   Tailwind colour class on the same element as a `.jv-chip`/`.jv-btn` and expect it to win. (This is
   why the poster-overlay chips stayed Tailwind-only: they need glass, not surface colours.)
3. **Day mode flips tokens, not components.** Anything theme-invariant must use literals — the hero is
   the only such surface: it is artwork under a dark scrim in both themes, and day mode's existing
   blanket overrides would otherwise repaint a light panel under a white title.
4. **Legacy names still exist.** `.jv-btn-ghost` and `.jv-btn-solid` were defined before v2; v2
   supersedes `-ghost` (and cancels its per-button `backdrop-filter`, which was a scroll-jank cost with
   no visual gain). `-solid` remains AuthGate's gradient unlock button.
5. **Check before naming.** Two collisions were caught this way: `.jv-vault-rail-*` (only the
   home-rail-exclusive classes were dead — `/vault` still uses `-label/-opt`) and `jv-btn` matching
   inside `jv-btn-solid`.
6. **The day-mode blanket is more specific than v2.** Rules like
   `html.day-mode [class*="text-zinc-300"]` (specificity 0,2,0) beat my `.jv-focus-eyebrow` (0,1,0), so
   any v2 class that must survive day mode needs its own `html.day-mode` value — that is why the hero
   eyebrow has one. Padding/color on a v2 class is otherwise silently lost in light theme.
7. **Contrast audit is now enforced, not remembered.** On the development branch (`audit-fixes`) a check fails if a migrated
   surface reintroduces `text-zinc-600/700/800` (4.1:1 / 2.7:1 / 2.0:1 on ink → use `--txt-4` at 5.6:1),
   if the vault loses its day-mode token re-pin, or if the player chrome picks up a theme-flipping token.

---

## 6 · Migration status

| Surface | State | Notes |
|---|---|---|
| `/` Home (rows, cards, dialog, skeletons, empty states) | ✅ migrated | gold rule on row headers, marquee hero, AA meta text |
| `/watch/[type]/[tmdbId]` | ✅ migrated | picture first, 44px control bar below the frame, `fullscreen:hidden` bar, real empty + actionable error states |
| Hero (`RailFocus`) | ✅ migrated | Playfair title, marquee eyebrow + CTA; keeps the gold in day mode |
| `/my-list` | ✅ migrated | token surfaces, skeleton grid, mobile header, empty state, AA footer |
| `/vault` | ✅ migrated (AA + theme) | 12 contrast fixes in the JSX, vault muted greys onto tokens, **day-mode dark lock + token re-pin** (it was unreadable in light theme) |
| `/classics` (ReTro) | ✅ already coherent — left alone | See §6.1: own `--dec-*` set, *deliberately* dark-locked. Converting it would be churn with no visual change. |
| `/live` | ✅ verified — no migration needed | It genuinely **flips** in day mode (cybergrape palette paints a lavender wash, not a lock). One fix: the tile placeholder needed a value per theme. |
| `/stremio` (shelf) | ✅ AA fixed | Fifth dark-locked surface. Both faint steps were below AA on the panel (4.42 and 3.32 → 5.36 and 4.74). |
| `/admin` | ✅ AA fixed | Zero Tailwind colour classes and a correct day flip of its own; only `--ad-faint` failed (3.66 dark / 3.09 day → 5.34 / 4.98). |
| `/music` | ⏳ pending | The most isolated surface; it has its own lyric panels and blanket overrides |
| Player chrome (`JashPlayer*`, `PlayerMenus`, `PlayerOverlays`) | ✅ chrome migrated, **engine untouched** | Own `--jvp-*` palette (literal, dark-locked — see §6.3). Was the last surface on the v10 fuchsia accent. |
| `/music` | ⏳ pending — **deliberately no reveal** | Its page never scrolls (panels scroll internally), so viewport-based reveals would be wasted work and a hide-content risk. |

### 6.1 Theme locks — the five-surface rule

Some surfaces are deliberately dark in *both* themes because they are artwork with a dark scrim or a
control room, not content chrome. They are:

| Surface | Rule in `globals.css` | How its children stay legible |
|---|---|---|
| Hero | `html.day-mode .jv-focus { background: #06060a }` | literal light colours (theme-invariant) |
| ReTro archive | `html.day-mode .jv-dec-page { /* the archive stays a dark room */ }` | its own `--dec-*` variables |
| **Vault** | **added in v2**: `html.day-mode .jv-vault-page` | **re-pins the design tokens** (`--ink-*`, `--txt-*`) inside the subtree |
| Stremio shelf | `html.day-mode .jv-st-page { background: var(--st-bg); color: var(--st-ink); }` | own `--st-*` set, declared on its own classes so the blanket never reaches the text |
| Player chrome | `html.day-mode [data-dvp="root"] …` | literal colours; flipping tokens are forbidden by test |

**`/live` is the counter-example, and it is correct as it stands.** It does *not* lock:
`html.day-mode .palette-cybergrape` paints a light lavender wash, and the blanket then repaints its
Tailwind `bg-zinc-950` panels light and its `text-zinc-300/400` text dark — a coherent light theme, not
a washed-out dark one. The catch is that a *plain CSS* colour on that surface cannot flip, which is why
`.jv-lv-tune-none` carries one value per theme. **Before adding a lock, check whether the surface
already flips:** `/live` looks like the Vault in the CSS and behaves nothing like it.

**If you add another dark-locked surface, copy the Vault pattern**: lock the background *and* re-pin the
tokens inside it. Locking the background alone is exactly the bug that made the Vault unreadable in day
mode — the page stayed black while the blanket layer repainted its text to dark ink.

### 6.2 Art sizing — never use the raw `posterUrl` blindly

The server builds every TMDB URL at one fixed size (`/t/p/w500`), backdrops included. Rendering that
URL as-is means a 44 px thumbnail and a full-bleed banner download the same file. Use the helpers in
`lib/tmdbPoster.js` instead — they derive a `srcset` from the URL the client already has, so there is no
proxy and no image optimizer to pay for:

| Surface | Helper call |
|---|---|
| Poster grids and rows | `tmdbImageSrcSet(url)` + `POSTER_SIZES_ATTR` |
| Fixed 128–160 px library rails | `tmdbImageSrcSet(url, ['w185', 'w342'])` + `POSTER_ROW_SIZES_ATTR` |
| Hero banner | `tmdbImageSrcSet(url, HERO_SRCSET_SIZES)` + `sizes="100vw"`, plus `fetchPriority="high"` |
| Small thumbs (palette, logos) | `tmdbImageSrcSet(url, ['w92', 'w185'])` with an explicit `sizes` in px |

Non-TMDB URLs (Saavn covers, IPTV logos, addon art) pass through untouched, so the helpers are safe to
call unconditionally — and the `sizes` attribute should be spread only when a `srcset` actually exists.

**Why not `next/image`:** the Node image optimizer would need RAM and disk on a 512 MB free instance,
and TMDB already serves every size. `HERO_SRCSET_SIZES` stops at `w1280` on purpose — `original`
backdrops run to 3840 px.

**Player CSS placement:** `shaka-player/dist/controls.css` belongs in `components/player/JashPlayer.js`,
never in `app/layout.js`. In the root it put 21 KB of render-blocking video-UI CSS on all 11 static
routes. A test enforces this.

### 6.3 The player chrome — a literal palette, and why

The player is dark in both themes, so it cannot use the shared colour tokens: `--txt-1` flips to dark ink in
day mode and would put dark text on a dark frame. It therefore carries its own palette, declared once on
the player root:

```css
[data-dvp="root"] {
  --jvp-accent: #e8b33a;        /* marquee gold — the app's warmth */
  --jvp-accent-soft: #f4c453;
  --jvp-accent-deep: #c81e3c;   /* the progress fill's other end */
  --jvp-surface: rgba(9, 9, 14, 0.82);
  --jvp-line: rgba(255, 255, 255, 0.16);
  --jvp-ease: cubic-bezier(0.22, 0.61, 0.36, 1);
}
```

Same reasoning as `--dec-*` for ReTro. **Add player colours to this block, never to the JSX as a new hex.**

**Motion in the chrome** is deliberately one effect used once: the bar lifts 8px as it fades in, on a single
260ms curve, `transform` + `opacity` only (compositor-friendly — no layout, no paint). Under
`prefers-reduced-motion: reduce` the transform is dropped and the fade shortens to 160ms linear.

**The cinema shell** (`.jv-cinema` + `.jv-cinema-halo`) paints a blurred still of the title art behind the
watch frame. It is a still, not a live frame grab, and that is a deliberate limit: reading pixels from a
cross-origin `<video>` taints the canvas (or needs CORS on every source host), and sampling frames at
24fps would spend real CPU on a 512 MB instance for an effect nobody would notice at 26% opacity.

### 6.4 Motion contract (subtle tier)

Every animation added under the design system follows these, and new surfaces should copy them:

- **Transform and opacity only.** Never animate `top`/`left`/`width`/`height`/`margin`, which force layout.
- **120–320ms**, on `--ease` (`cubic-bezier(.22,.61,.36,1)`). Nothing longer than ~700ms except ambient halos.
- **`prefers-reduced-motion: reduce` turns motion off**, not merely down — see the `.jvp-chrome`,
  `.jv-cinema-halo` and `.jv-skel` branches.
- **No scroll-jacking and no scroll-linked effects on the main thread.** Parallax, where it appears, is
  bounded to hero and poster art and runs off a cached rect with `transform` writes only.
- **Hover lift is a transform, not a size change**, so grids do not reflow when a pointer moves.

**The parallax layer** (`lib/useParallax.js`) drifts one element as the page scrolls past it, by
writing `--jv-parallax-y` for CSS to compose into a transform:

```jsx
const artRef = useParallax({ strength: 0.07, max: 22 });
<img ref={artRef} className="jv-focus-art" … />
```

```css
.jv-focus-art.jv-parallax-on { transform: translate3d(0, var(--jv-parallax-y, 0px), 0) scale(1.14); }
```

Four properties keep it from making a phone feel cheap, and they are the reason it is a hook and not a
scroll handler in the component: travel is clamped so art can never expose an edge; scroll and resize
listeners attach **only while the element is within 25% of the viewport**; a rAF guard collapses a burst of
scroll events into one `getBoundingClientRect`; and under `prefers-reduced-motion` the hook adds no class
at all, so the art is not even scaled up. The `1.14` scale exists purely to give the art travel room — 7%
of slack per edge against a ±22px clamp.

**The reveal layer** (`lib/useReveal.js` + the `[data-reveal]` rules in `globals.css`) is how a surface opts
into scroll motion. Mark a list container with the hook's ref and each item with `data-reveal` +
`revealStyle(index)` for stagger:

```jsx
const revealRef = useReveal(items.length);   // the key re-arms the observer as the list grows
<section ref={revealRef}>
  {items.map((item, i) => <Row key={item.id} item={item} index={i} />)}   // row: data-reveal style={revealStyle(i)}
</section>
```

Two invariants are enforced by tests, and both exist because of real failure modes: the hidden state lives
under `[data-reveal-ready]` (set only once JS runs, so no bundle = no hidden content), and every call site
passes the item count (the observer only sees what existed when it ran — without the key, rows appended by
"Keep loading" or paging would stay at `opacity: 0` forever).

### 6.5 Purges: the shared-name trap

Removing the retired v7 "JvReactBits" feature set (masonry, reticle cursor, shimmer kicker) deleted 21
rules — and with them `@keyframes jv-shimmer`. The name was **shared**: the dead `.jv-shimmer-text` and the
live `.jv-skel` both animated with it, so every skeleton in the app silently stopped shimmering. A
class-name purge cannot see that, because the class that owns the keyframes is dead while the name is not.

The development branch asserts that every `animation:` name in `globals.css` has a matching
`@keyframes`, which catches the whole class of breakage in one line. Before deleting any animation,
grep the *keyframes name*, not just the class.

The same pass turned up the mirror-image bug in the reveal wiring: keying `useReveal` on a list's **length**
is not enough, because a decade or catalog switch can swap a 40-item list for a different 40-item list —
same count, every node replaced, and the replacements are never observed. They would sit at `opacity: 0`
forever. Every call site keys on what *identifies* the list (filter state + count), and a test enforces it.

### 6.6 Motion coverage — where the layers are wired

| Surface | Reveal | Notes |
|---|---|---|
| `/` Home | ✅ | one observer wraps both rows; keyed on both counts ("Show more" appends) |
| `/my-list` | ✅ | grid observer; removal-safe (revealed nodes keep their state) |
| `/vault` | ✅ | keyed on filters **and** the page window — two filter combos can render the same tile count |
| `/classics` | ✅ | keyed on decade + sort + count |
| `/stremio` | ✅ | keyed on catalog + count |
| `/live` | ✅ | channel wall; keyed on category + favourites + query + count |
| Hero | ✅ parallax | `useParallax`; clamped ±22px, 1.14 slack scale |
| Watch shell | ✅ | halo entrance + 19s drift on `translate` (composes with the entrance's `transform`) |
| `/music` | None | Fixed viewport; only library and lyrics panels scroll internally. Scoped `mc-*` CSS replaces retired `mu-*` / `mu2-*` UI styling; `.mu-global-mini` is preserved. |

Six list surfaces, one hook, one rule each for reduced motion and key identity. If you add a seventh, copy an
existing call site and **key on what identifies the list**, not just its length.
