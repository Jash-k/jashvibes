# JaSH ViBeS — multi-stage production image
FROM node:22-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_OPTIONS=--max-old-space-size=384
COPY package.json package-lock.json* ./
RUN npm ci --include=dev
COPY . .
RUN KEEPALIVE=0 LIVE_SYNC_MINUTES=0 npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=7860
ENV NODE_OPTIONS=--max-old-space-size=384
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 7860
CMD ["sh", "-c", "node server.js"]