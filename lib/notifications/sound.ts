// Notification sound player supporting custom audio and Web Audio fallback

let audioCache: HTMLAudioElement | null = null;

export function playNotificationTone(type: "default" | "reminder" | "warning" = "default") {
  if (typeof window === "undefined") return;

  // 1. Try playing custom audio tone file (/notification.mp3)
  try {
    if (!audioCache) {
      audioCache = new Audio("/notification.mp3");
      audioCache.preload = "auto";
    }

    audioCache.currentTime = 0;
    const playPromise = audioCache.play();
    if (playPromise !== undefined) {
      playPromise.catch((err) => {
        // Fallback to Web Audio synthesized chime if browser blocks audio tag
        playSynthesizedTone(type);
      });
      return;
    }
  } catch {
    playSynthesizedTone(type);
  }
}

function playSynthesizedTone(type: "default" | "reminder" | "warning" = "default") {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;

    const ctx = new AudioContextClass();
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }

    const now = ctx.currentTime;

    if (type === "warning") {
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = "sine";
      osc1.frequency.setValueAtTime(587.33, now); // D5
      osc1.frequency.setValueAtTime(880, now + 0.12); // A5

      gain1.gain.setValueAtTime(0.001, now);
      gain1.gain.exponentialRampToValueAtTime(0.2, now + 0.04);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

      osc1.connect(gain1);
      gain1.connect(ctx.destination);

      osc1.start(now);
      osc1.stop(now + 0.35);
    } else {
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();

      osc1.type = "sine";
      osc2.type = "sine";

      osc1.frequency.setValueAtTime(698.46, now); // F5
      osc2.frequency.setValueAtTime(1046.50, now + 0.08); // C6

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.1, now + 0.08);
      gain.gain.exponentialRampToValueAtTime(0.18, now + 0.10);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);

      osc1.start(now);
      osc1.stop(now + 0.12);

      osc2.start(now + 0.08);
      osc2.stop(now + 0.45);
    }
  } catch (err) {
    console.debug("[NotificationTone] Audio playback bypassed:", err);
  }
}
