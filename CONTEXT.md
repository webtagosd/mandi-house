# Mandi House — Build Context

Premium exemplar rebuild of **mandihouse.co.nz** — a Yemeni / South-Asian
restaurant at **573 Sandringham Road, Sandringham, Auckland 1025** (09 845 1144).
Open 7 nights, late on weekends.

Built with the `premium-exemplar-builder` skill.

## Stack
- Astro 6 (static) + Tailwind v4 (`@theme` tokens in `src/styles/global.css`)
- Lenis (smooth scroll) + GSAP/ScrollTrigger (signature dome scrub)
- Fonts: Playfair Display (display/headings), Newsreader (body), DM Mono (kickers) — Google Fonts
- Run: `npm run dev` (port 4330) · Build: `npm run build`

## Concept
**Thesis:** a Yemeni fire-feast dropped into a late Auckland night — slow smoke,
saffron rice, a platter built to share by hand. Tension = ancient fire ritual ×
buzzing modern Sandringham nightlife.

**Palette — nocturnal & smoky:** warm near-black charcoal, saffron-gold accent,
ember red (sparing), warm cream text.

**Platter image:** `public/images/mandi-platter.webp` is a Higgsfield illustration of a
whole-lamb mandi platter, watermark painted out and **background-removed** (rembg) so the
plate sits on transparency with no rectangle. Source kept in `assets/`.

**Signature moment:** the **dome reveal** (`src/components/DomeReveal.astro`) — a
copper serving dome lifts on scroll and the real mandi platter image
(`public/images/mandi-platter.webp`, a Higgsfield illustration, watermark removed +
optimised) is revealed beneath, steam and all. Scroll-scrubbed via GSAP ScrollTrigger
pin. Image edges feathered (mask + warm halo + top fade) to blend into the section.

## Pages (single-page site + separate Menu)
- `/` — single scrolling page: Hero · Dome reveal · Story strip · **Our Story (#story)** ·
  Ritual · Dishes (bento, links to /menu) · Reviews · **Visit (#visit)** · Booking · Footer.
  Nav links are anchor jumps (`/#story`, `/#visit`) handled by Lenis smooth-scroll in Base.astro.
- `/menu` — separate page. Left **sticky category sidebar** (Mandi / Biryani / Grill / Curries /
  Starters / Drinks) that jump-scrolls to each section, with scrollspy active-highlighting
  (IntersectionObserver). All items always visible. Sidebar scrollspy script lives in menu.astro.
- (The old standalone /our-story and /visit pages were removed and folded into `/`.)

## ⚠️ PLACEHOLDERS TO FILL BEFORE PITCH / LAUNCH
Search the codebase for `PLACEHOLDER`. Specifically:
1. **Prices & menu items** (`src/components/Dishes.astro`, `src/pages/menu.astro`) —
   drawn from the old site's menu mentions. **Confirm real items + pricing.**
2. **Reviews** (`src/components/Reviews.astro`) — currently `[PLACEHOLDER_REVIEW_*]`.
   Replace with **real Google reviews** (text + reviewer name).
3. **Founding story** (`src/pages/our-story.astro`) — `[PLACEHOLDER_STORY]` blocks.
   Get the real origin: family, where the recipes come from, why Sandringham.
4. **Email / socials** — not on current site; add to Footer/Visit if they exist.

## Imagery — currently CSS/SVG placeholders
The dome, platter, dish tiles and hero glow are deliberate CSS/SVG stand-ins so the
site reads complete without photography. Replace with a cohesive shoot (treat as
ONE photoshoot, warm/nocturnal, charcoal + saffron):
- **Hero loop video** — DONE: candle-lit lamb mandi loop at `public/videos/hero.mp4`
  (optimised to ~772KB/1600px from a 10MB source) with `hero-poster.jpg`. Swap the
  files to change it.
- **Dome reveal** — ideally a top-down photo of a real whole-lamb platter behind the
  SVG dome, or keep the SVG (it works).
- **Dish tiles** (`Dishes.astro`) — 6 top-down dish photos into the `.dish-img` blocks.
- **Story portrait** (`our-story.astro`) — founder / kitchen portrait into the hero block.
See `higgsfield-prompts/` in the skill for prompt templates.

## Logo
Real Mandi House logo (white "Mandi House" / Arabic / "Mediterranean Cuisine") sits
top-left in the nav. Source `mandihouse.co.nz/images/logo.jpg` (white-on-black) was
converted to a transparent-white PNG (luminance → alpha, via Pillow) so it sits
seamlessly on the dark nav with no box. Files: `public/images/logo.png` (used);
original kept at `assets/logo-original.jpg` (not served).

## Map
Visit section (`VisitSection.astro`) shows a **real Leaflet map** — free CARTO `dark_all`
tiles (no API key), warm-tinted via a CSS filter on `.leaflet-tile-pane` to match the
charcoal + saffron palette, with a custom gold `divIcon` pin at 573 Sandringham Road
(-36.8923349, 174.7361633). scrollWheelZoom/zoomControl off, dragging on. Leaflet loaded
from unpkg CDN via an inline script (dynamic-injects JS, re-inits on `astro:page-load`).
"Open in Google Maps" button overlays bottom-left. (No key needed; upgrade to Mapbox with
a custom style later if a more branded look is wanted.)

## Notes
- Copy follows Deep's "no em dashes" rule (commas / colons / periods / `·` only).
- **Deployed.** GitHub: `webtagosd/mandi-house` (PUBLIC). Vercel project on the **`webtagosd`
  team** (`webtagosd/mandi-house`, id `prj_ohmVbegOusEdKeWl38dyGeDPE3Mu`) — moved here 2026-07-06
  from the old `webtag` team, which does NOT own the `webtag.co.nz` domain routing (that lives on
  `webtagosd`, which is why the custom domain only verified once the project was on this team).
  GitHub connected → push-to-deploy live. Live URL: https://mandi-house.webtag.co.nz
  (old `webtag`-team project `prj_HIDD0nqCAD3kUEDs1dzIyVSI16B2` / `mandi-house-peach.vercel.app`
  is now redundant — delete it to avoid double-deploys).
- **Dashboard import fields:** Production URL `https://mandi-house.webtag.co.nz`,
  Repo `https://github.com/webtagosd/mandi-house`, Vercel project id `prj_ohmVbegOusEdKeWl38dyGeDPE3Mu`,
  Deploy hook `https://api.vercel.com/v1/integrations/deploy/prj_ohmVbegOusEdKeWl38dyGeDPE3Mu/6f3cRxaCRo`,
  upload `content/content.json` + `content/content.schema.json`.
