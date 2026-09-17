# JaSH ViBeS — multi-stage production image (Hugging Face Spaces / Koyeb; Render uses the Node path).
#
# The runtime stage carries only the standalone server output + static assets,
# no devDependencies and no node_modules: roughly half the image size of the
# old single-stage build, which is cold-start time on a free tier.
#
# Spaces route public traffic to port 7860 by default.
FROM node:20-bookworm-slim AS builder

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1
# Keep V8 heap inside typical free-tier 512 MB containers while avoiding the default ~256 MB heap OOM.
ENV NODE_OPTIONS=--max-old-space-size=384

# npm ci = reproducible install straight from package-lock.json (also faster
# than `npm install` because it skips resolution).
# IMPORTANT: do not set NODE_ENV=production before install — the build needs
# devDependencies (tailwindcss, postcss, autoprefixer).
COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
RUN npm run build

# ── runtime ──────────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ENV PORT=7860
ENV HOSTNAME=0.0.0.0
ENV NODE_OPTIONS=--max-old-space-size=384

# standalone: server.js + minimal node_modules tree
COPY --from=builder /app/.next/standalone ./
# Static assets are not traced into standalone and must sit beside server.js.
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 7860

# server.js honors PORT and HOSTNAME.
CMD ["sh", "-c", "node server.js"]
