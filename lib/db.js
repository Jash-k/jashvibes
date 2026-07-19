import mongoose from 'mongoose';

/**
 * Cached MongoDB connection helper for Next.js App Router.
 *
 * Important for Docker/Hugging Face deployment:
 * Do NOT throw for missing MONGODB_URI at module import time. Next.js imports
 * this file during build, and deployment secrets may only be available at
 * runtime. Instead, validate MONGODB_URI inside dbConnect().
 */
let cached = globalThis.mongoose;

if (!cached) {
  cached = globalThis.mongoose = {
    conn: null,
    promise: null,
  };
}

export default async function dbConnect() {
  const MONGODB_URI = process.env.DB || process.env.DB_URI || process.env.MONGODB_URI;

  if (!MONGODB_URI) {
    throw new Error(
      'Missing MongoDB connection. Add MONGODB_URI, DB_URI, or DB to .env.local locally or Hugging Face Space Secrets in deployment.'
    );
  }

  if (cached.conn) {
    return cached.conn;
  }

  if (!cached.promise) {
    cached.promise = mongoose
      .connect(MONGODB_URI, {
        bufferCommands: false,
      })
      .then((mongooseInstance) => mongooseInstance);
  }

  try {
    cached.conn = await cached.promise;
    return cached.conn;
  } catch (error) {
    cached.promise = null;
    throw error;
  }
}
