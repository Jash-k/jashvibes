'use client';
import { createContext, useContext } from 'react';
export const MusicContext = createContext(null);
export function useMusic() {
  const music = useContext(MusicContext);
  if (!music) throw new Error('MusicProvider is required');
  return music;
}
