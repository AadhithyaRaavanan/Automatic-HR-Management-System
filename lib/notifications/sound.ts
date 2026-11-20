// Notification sound player using /notification.mp3 played twice
// Supports Web Audio API decoded buffer, HTMLAudioElement, auto-unlock on user interaction, and synthesizer fallback

let sharedAudioContext: AudioContext | null = null;
let lastPlayedTime = 0;
const lastPlayedIds = new Set<string>();
let pendingPlayOnUnlock = false;
let decodedNotificationBuffer: AudioBuffer | null = null;
let isFetchingBuffer = false;

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
 * Pre-fetches and decodes /notification.mp3 into an AudioBuffer for zero-latency playback
 */
async function preloadNotificationBuffer(ctx: AudioContext): Promise<AudioBuffer | null> {
  if (decodedNotificationBuffer) return decodedNotificationBuffer;
  if (isFetchingBuffer) return null;
  isFetchingBuffer = true;
  try {
    const res = await fetch("/notification.mp3");
    if (!res.ok) return null;
    const arrayBuffer = await res.arrayBuffer();
    decodedNotificationBuffer = await ctx.decodeAudioData(arrayBuffer);
    return decodedNotificationBuffer;
  } catch {
    return null;
  } finally {
    isFetchingBuffer = false;
  }
}

// Preload buffer on window load
if (typeof window !== "undefined") {
  const tryPreload = () => {
    const ctx = getAudioContext();
    if (ctx) {
      preloadNotificationBuffer(ctx).catch(() => {});
    }
  };
  if (document.readyState === "complete") {
    tryPreload();
  } else {
    window.addEventListener("load", tryPreload, { once: true });
  }
}

/**
 * Auto-unlock Web Audio on first user interaction in browser
 */
if (typeof window !== "undefined") {
  const unlockAudio = () => {
    try {
      const ctx = getAudioContext();
      if (ctx) {
        ctx
          .resume()
          .then(() => {
            preloadNotificationBuffer(ctx).catch(() => {});
            if (pendingPlayOnUnlock) {
              pendingPlayOnUnlock = false;
              playTwiceInternal(ctx);
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
 * Plays decoded AudioBuffer twice with precise timing
 */
function playBufferTwice(ctx: AudioContext, buffer: AudioBuffer) {
  const now = ctx.currentTime;

  // Detect where the audible portion ends so the second chime starts naturally
  let audibleDuration = 0.75;
  try {
    const data = buffer.getChannelData(0);
    let lastAudible = data.length - 1;
    for (let i = data.length - 1; i >= 0; i--) {
      if (Math.abs(data[i]) > 0.015) {
        lastAudible = i;
        break;
      }
    }
    audibleDuration = Math.max(0.35, Math.min(1.0, lastAudible / buffer.sampleRate + 0.08));
  } catch {
    audibleDuration = Math.min(0.85, buffer.duration);
  }

  // 1st play
  const src1 = ctx.createBufferSource();
  const gain1 = ctx.createGain();
  gain1.gain.value = 0.9;
  src1.buffer = buffer;
  src1.connect(gain1);
  gain1.connect(ctx.destination);
  src1.start(now);

  // 2nd play
  const src2 = ctx.createBufferSource();
  const gain2 = ctx.createGain();
  gain2.gain.value = 0.9;
  src2.buffer = buffer;
  src2.connect(gain2);
  gain2.connect(ctx.destination);
  src2.start(now + audibleDuration);
}

/**
 * Synthesizes a crystal ting sound at given offset (fallback)
 */
function synthesizeTingAt(ctx: AudioContext, offsetSeconds: number = 0) {
  const startTime = ctx.currentTime + offsetSeconds;
  const master = ctx.createGain();
  master.gain.setValueAtTime(0.35, startTime);
  master.connect(ctx.destination);

  // Fundamental (C7 - 2093 Hz)
  const osc1 = ctx.createOscillator();
  const gain1 = ctx.createGain();
  osc1.type = "sine";
  osc1.frequency.setValueAtTime(2093.0, startTime);
  gain1.gain.setValueAtTime(0.0001, startTime);
  gain1.gain.linearRampToValueAtTime(0.65, startTime + 0.003);
  gain1.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.55);
  osc1.connect(gain1);
  gain1.connect(master);
  osc1.start(startTime);
  osc1.stop(startTime + 0.55);

  // Shimmer (C8 - 4186 Hz)
  const osc2 = ctx.createOscillator();
  const gain2 = ctx.createGain();
  osc2.type = "sine";
  osc2.frequency.setValueAtTime(4186.0, startTime);
  gain2.gain.setValueAtTime(0.0001, startTime);
  gain2.gain.linearRampToValueAtTime(0.3, startTime + 0.002);
  gain2.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.15);
  osc2.connect(gain2);
  gain2.connect(master);
  osc2.start(startTime);
  osc2.stop(startTime + 0.15);
}

function playSynthesizedTwice(ctx: AudioContext) {
  synthesizeTingAt(ctx, 0);
  synthesizeTingAt(ctx, 0.45); // 2nd chime after 450ms
}

/**
 * Fallback to HTMLAudioElement playing /notification.mp3 twice
 */
function playHtmlAudioTwice() {
  try {
    const audio1 = new Audio("/notification.mp3");
    audio1.volume = 0.85;

    let secondPlayed = false;
    const playSecond = () => {
      if (secondPlayed) return;
      secondPlayed = true;
      try {
        const audio2 = new Audio("/notification.mp3");
        audio2.volume = 0.85;
        audio2.play().catch(() => {});
      } catch {}
    };

    audio1.addEventListener("ended", playSecond, { once: true });
    // Guard timer in case 'ended' is delayed by trailing silence
    const timer = setTimeout(playSecond, 850);

    const p = audio1.play();
    if (p !== undefined) {
      p.catch(() => {
        clearTimeout(timer);
      });
    }
  } catch {}
}

/**
 * Internal player: tries decoded buffer in Web Audio API, falls back to HTMLAudioElement
 */
function playTwiceInternal(ctx: AudioContext) {
  if (decodedNotificationBuffer) {
    playBufferTwice(ctx, decodedNotificationBuffer);
  } else {
    preloadNotificationBuffer(ctx)
      .then((buf) => {
        if (buf) {
          playBufferTwice(ctx, buf);
        } else {
          playHtmlAudioTwice();
        }
      })
      .catch(() => {
        playHtmlAudioTwice();
      });
  }
}

/**
 * Plays the user's notification sound (/notification.mp3) TWICE whenever a user gets a notification
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

  // Throttle minimum interval (avoid overlapping triggers within 600ms)
  if (now - lastPlayedTime < 600) {
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
            playTwiceInternal(ctx);
          })
          .catch(() => {
            playHtmlAudioTwice();
          });
      } else {
        playTwiceInternal(ctx);
      }
      return;
    }
  } catch {}

  // 2. Fallback to HTMLAudioElement
  playHtmlAudioTwice();
}
