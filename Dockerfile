# Hugging Face Spaces Docker deployment for the JaSH THEATRE Next.js app.
# Spaces route public traffic to port 7860 by default.
FROM node:20-bookworm-slim

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=7860

# Copy package files first for better Docker layer caching.
COPY package.json package-lock.json* ./

# IMPORTANT:
# Do not set NODE_ENV=production before npm install.
# Next.js needs devDependencies such as tailwindcss, postcss, and autoprefixer
# during `npm run build`.
RUN npm install

# Copy application source and build it.
COPY . .
RUN npm run build

# Now switch to production mode for runtime.
ENV NODE_ENV=production

EXPOSE 7860

# Next.js must listen on 0.0.0.0 inside the container for Hugging Face Spaces.
CMD ["sh", "-c", "npm run start"]
