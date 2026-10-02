// A single audio-focus owner across video, live and the persistent music player.
// Cross-origin iframe playback cannot be observed: claim focus when it opens.
export const MEDIA_FOCUS_EVENT = 'jash:media-focus';
export function claimMediaFocus(owner) {
  if (typeof window !== 'undefined') { window.__jashMediaFocusOwner = owner; window.dispatchEvent(new CustomEvent(MEDIA_FOCUS_EVENT, { detail: { owner } })); }
}

export function hasMediaFocus(owner) { return typeof window !== 'undefined' && window.__jashMediaFocusOwner === owner; }
