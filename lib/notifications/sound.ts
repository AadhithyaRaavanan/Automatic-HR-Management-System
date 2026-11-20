// Notification sound player using the user's custom chime tone played twice
// Features instant Web Audio buffer playback, HTML5 Audio element, cache-busting, and user-interaction auto-unlock

let sharedAudioContext: AudioContext | null = null;
let lastPlayedTime = 0;
const lastPlayedIds = new Set<string>();
let pendingPlayOnUnlock = false;
let decodedBuffer: AudioBuffer | null = null;
let isFetchingBuffer = false;

// Cache-busting URL so browsers never play stale audio from previous turns
const AUDIO_URL = "/notification.mp3?v=3";

/**
 * Lazily retrieves or instantiates a shared Web Audio context
 */
function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    const AudioContextClass =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return null;

    if (!sharedAudioContext) {
      sharedAudioContext = new AudioContextClass();
    }
    if (sharedAudioContext.state === "suspended") {
      sharedAudioContext.resume().catch(() => {});
    }
    return sharedAudioContext;
  } catch {
    return null;
  }
}

/**
 * Pre-fetches and decodes the audio track into an AudioBuffer for zero-latency playback
 */
async function preloadAudioBuffer(ctx: AudioContext): Promise<AudioBuffer | null> {
  if (decodedBuffer) return decodedBuffer;
  if (isFetchingBuffer) return null;
  isFetchingBuffer = true;
  try {
    const res = await fetch(AUDIO_URL);
    if (!res.ok) return null;
    const arrayBuffer = await res.arrayBuffer();
    decodedBuffer = await ctx.decodeAudioData(arrayBuffer);
    return decodedBuffer;
  } catch {
    return null;
  } finally {
    isFetchingBuffer = false;
  }
}

// Auto-unlock Web Audio on first user interaction in browser
if (typeof window !== "undefined") {
  const unlockAudio = () => {
    try {
      const ctx = getAudioContext();
      if (ctx) {
        ctx
          .resume()
          .then(() => {
            preloadAudioBuffer(ctx).catch(() => {});
            if (pendingPlayOnUnlock) {
              pendingPlayOnUnlock = false;
              playDirect(ctx);
            }
          })
          .catch(() => {});
      }
    } catch {}
    window.removeEventListener("pointerdown", unlockAudio);
    window.removeEventListener("keydown", unlockAudio);
    window.removeEventListener("touchstart", unlockAudio);
  };

  window.addEventListener("pointerdown", unlockAudio, { passive: true, once: true });
  window.addEventListener("keydown", unlockAudio, { passive: true, once: true });
  window.addEventListener("touchstart", unlockAudio, { passive: true, once: true });
}

/**
 * Plays via Web Audio API BufferSource
 */
function playBuffer(ctx: AudioContext, buffer: AudioBuffer) {
  const src = ctx.createBufferSource();
  const gain = ctx.createGain();
  gain.gain.value = 0.95;
  src.buffer = buffer;
  src.connect(gain);
  gain.connect(ctx.destination);
  src.start(ctx.currentTime);
}

/**
 * Plays via standard HTMLAudioElement
 */
function playHtmlAudio() {
  try {
    const audio = new Audio(AUDIO_URL);
    audio.volume = 0.95;
    const p = audio.play();
    if (p !== undefined) {
      p.catch(() => {});
    }
  } catch {}
}

/**
 * Plays the audio through the best available channel
 */
function playDirect(ctx?: AudioContext | null) {
  if (ctx && ctx.state === "running") {
    if (decodedBuffer) {
      playBuffer(ctx, decodedBuffer);
      return;
    }
    preloadAudioBuffer(ctx)
      .then((buf) => {
        if (buf) {
          playBuffer(ctx, buf);
        } else {
          playHtmlAudio();
        }
      })
      .catch(() => {
        playHtmlAudio();
      });
    return;
  }
  playHtmlAudio();
}

/**
 * Plays the notification sound (which contains the double chime) whenever a user gets a notification
 * or logs in to active unread notifications.
 * @param type Sound type ('default', 'reminder', or 'warning')
 * @param notificationId Optional notification ID for deduplication
 */
export function playNotificationTone(
  type: "default" | "reminder" | "warning" = "default",
  notificationId?: string
) {
  if (typeof window === "undefined") return;

  const now = Date.now();

  // Deduplication guard by notificationId
  if (notificationId) {
    if (lastPlayedIds.has(notificationId)) return;
    lastPlayedIds.add(notificationId);
    if (lastPlayedIds.size > 100) {
      const first = lastPlayedIds.values().next().value;
      if (first) lastPlayedIds.delete(first);
    }
  }

  // Throttle minimum interval (avoid overlapping triggers within 1.2s)
  if (now - lastPlayedTime < 1200) {
    return;
  }
  lastPlayedTime = now;

  // 1. Try Web Audio Context
  try {
    const ctx = getAudioContext();
    if (ctx) {
      if (ctx.state === "suspended") {
        pendingPlayOnUnlock = true;
        ctx
          .resume()
          .then(() => {
            pendingPlayOnUnlock = false;
            playDirect(ctx);
          })
          .catch(() => {
            playHtmlAudio();
          });
      } else {
        playDirect(ctx);
      }
      return;
    }
  } catch {}

  // 2. Fallback to HTMLAudioElement
  playHtmlAudio();
}
