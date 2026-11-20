// Notification sound player supporting crystal bell "ting" sound effect
// Features instant Web Audio synthesis, user-interaction auto-unlock, and fallback audio file

let sharedAudioContext: AudioContext | null = null;
let lastPlayedTime = 0;
const lastPlayedIds = new Set<string>();
let pendingToneOnUnlock: { type: "default" | "reminder" | "warning"; id?: string } | null = null;

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

// Auto-unlock Web Audio on first user interaction in browser
if (typeof window !== "undefined") {
  const unlockAudio = () => {
    try {
      const ctx = getAudioContext();
      if (ctx) {
        ctx.resume().then(() => {
          if (pendingToneOnUnlock) {
            const tone = pendingToneOnUnlock;
            pendingToneOnUnlock = null;
            synthesizeTing(ctx, tone.type);
          }
        }).catch(() => {});
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
 * Synthesizes a bright, pristine crystal bell "ting" sound effect (C7 2093Hz + overtones)
 */
function synthesizeTing(ctx: AudioContext, type: "default" | "reminder" | "warning" = "default") {
  const now = ctx.currentTime;

  if (type === "warning") {
    // 2-tone bright rising alert ting (G6 1568Hz -> C7 2093Hz)
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(1567.98, now);
    osc.frequency.setValueAtTime(2093.0, now + 0.08);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.3, now + 0.02);
    gain.gain.setValueAtTime(0.25, now + 0.08);
    gain.gain.linearRampToValueAtTime(0.35, now + 0.1);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.6);
    return;
  }

  // Pure Crystal Bell "Ting" ✨
  // Master gain
  const master = ctx.createGain();
  master.gain.setValueAtTime(0.35, now);
  master.connect(ctx.destination);

  // 1. Fundamental Bell Body (C7 - 2093 Hz) - pure ringing crystal tone
  const osc1 = ctx.createOscillator();
  const gain1 = ctx.createGain();
  osc1.type = "sine";
  osc1.frequency.setValueAtTime(2093.0, now);

  gain1.gain.setValueAtTime(0.0001, now);
  gain1.gain.linearRampToValueAtTime(0.65, now + 0.003); // Instant 3ms strike attack
  gain1.gain.exponentialRampToValueAtTime(0.0001, now + 0.65); // Pure 650ms exponential decay

  osc1.connect(gain1);
  gain1.connect(master);
  osc1.start(now);
  osc1.stop(now + 0.65);

  // 2. Sparkling Fifth Chime (G7 - 3135.96 Hz) - adds harmonic resonance & sweetness
  const osc2 = ctx.createOscillator();
  const gain2 = ctx.createGain();
  osc2.type = "sine";
  osc2.frequency.setValueAtTime(3135.96, now);

  gain2.gain.setValueAtTime(0.0001, now);
  gain2.gain.linearRampToValueAtTime(0.35, now + 0.003);
  gain2.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);

  osc2.connect(gain2);
  gain2.connect(master);
  osc2.start(now);
  osc2.stop(now + 0.45);

  // 3. Shimmering High Strike Ping (C8 - 4186.01 Hz) - the crisp "t-" in "ting"
  const osc3 = ctx.createOscillator();
  const gain3 = ctx.createGain();
  osc3.type = "sine";
  osc3.frequency.setValueAtTime(4186.01, now);

  gain3.gain.setValueAtTime(0.0001, now);
  gain3.gain.linearRampToValueAtTime(0.35, now + 0.002);
  gain3.gain.exponentialRampToValueAtTime(0.0001, now + 0.15); // Fast 150ms shimmer decay

  osc3.connect(gain3);
  gain3.connect(master);
  osc3.start(now);
  osc3.stop(now + 0.15);

  // 4. Subtle High Glass Transient (5874 Hz) - tiny metallic glass ping
  const osc4 = ctx.createOscillator();
  const gain4 = ctx.createGain();
  osc4.type = "sine";
  osc4.frequency.setValueAtTime(5874, now);

  gain4.gain.setValueAtTime(0.0001, now);
  gain4.gain.linearRampToValueAtTime(0.2, now + 0.001);
  gain4.gain.exponentialRampToValueAtTime(0.0001, now + 0.04); // 40ms attack ping

  osc4.connect(gain4);
  gain4.connect(master);
  osc4.start(now);
  osc4.stop(now + 0.04);
}

let audioCache: HTMLAudioElement | null = null;

function fallbackAudioElement() {
  try {
    if (!audioCache) {
      audioCache = new Audio("/ting.wav");
      audioCache.preload = "auto";
    }
    audioCache.currentTime = 0;
    audioCache.volume = 0.5;
    const playPromise = audioCache.play();
    if (playPromise !== undefined) {
      playPromise.catch(() => {});
    }
  } catch {}
}

/**
 * Plays the notification "ting" sound effect with deduplication and autoplay safety.
 * @param type Sound type ('default', 'reminder', or 'warning')
 * @param notificationId Optional notification ID to prevent duplicate plays within 5s
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

  // Minimum throttle window of 350ms between consecutive plays
  if (now - lastPlayedTime < 350) {
    return;
  }
  lastPlayedTime = now;

  // Try Web Audio API Synthesis first (zero network lag, instant, pristine quality)
  try {
    const ctx = getAudioContext();
    if (ctx) {
      if (ctx.state === "suspended") {
        pendingToneOnUnlock = { type, id: notificationId };
        ctx
          .resume()
          .then(() => {
            if (pendingToneOnUnlock) {
              const tone = pendingToneOnUnlock;
              pendingToneOnUnlock = null;
              synthesizeTing(ctx, tone.type);
            }
          })
          .catch(() => fallbackAudioElement());
      } else {
        synthesizeTing(ctx, type);
      }
      return;
    }
  } catch {}

  // Fallback to HTMLAudioElement
  fallbackAudioElement();
}
