// VitalVR: automatic modes. Watches the body (height of the head, tilt of the
// hips, how fast the body moves) and switches the settings profile when the
// player dances, does lap dance (floor work), lies in bed, or is back to
// normal use.
import { useSyncExternalStore } from 'react';
import * as N from 'solarxr-protocol';

export type Activity = 'normal' | 'dance' | 'lapdance' | 'bed';
export const ACTIVITIES: Activity[] = ['normal', 'dance', 'lapdance', 'bed'];

export interface AutoModesSettings {
  enabled: boolean;
  /** Settings profile used for each activity ('' = do not switch) */
  profiles: Record<Activity, string>;
  /** 0.5 = needs big moves, 2 = reacts to small moves */
  sensitivity: number;
  /** Multiplies the waiting times before a switch */
  delay: number;
  /** After a profile is picked by hand, automatic switching waits this long */
  manualPauseMinutes: number;
}

export const AUTO_MODES_DEFAULTS: AutoModesSettings = {
  enabled: true,
  profiles: {
    normal: 'Normal',
    dance: 'Danse',
    lapdance: 'Lap dance',
    bed: 'Lit chill',
  },
  sensitivity: 1,
  delay: 1,
  manualPauseMinutes: 5,
};

export interface AutoModesState {
  settings: AutoModesSettings;
  /** Activity the profile follows */
  activity: Activity;
  /** What the body looks like right now, before the waiting times */
  seen: Activity;
  /** Average turning speed of the body, degrees per second */
  motion: number;
  /** Head height compared to standing, 1 = standing */
  height: number;
  lying: boolean;
  pausedUntil: number;
}

const STORE_KEY = 'vitalvr-auto-modes';

function loadSettings(): AutoModesSettings {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return AUTO_MODES_DEFAULTS;
    const saved = JSON.parse(raw) as Partial<AutoModesSettings>;
    return {
      ...AUTO_MODES_DEFAULTS,
      ...saved,
      profiles: { ...AUTO_MODES_DEFAULTS.profiles, ...saved.profiles },
    };
  } catch {
    return AUTO_MODES_DEFAULTS;
  }
}

let state: AutoModesState = {
  settings: loadSettings(),
  activity: 'normal',
  seen: 'normal',
  motion: 0,
  height: 1,
  lying: false,
  pausedUntil: 0,
};
const listeners = new Set<() => void>();

function setState(next: Partial<AutoModesState>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

export const autoModes = {
  get: () => state,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  setSettings(settings: Partial<AutoModesSettings>) {
    const merged = { ...state.settings, ...settings };
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(merged));
    } catch {
      // ignore
    }
    // Turning it on again starts without pause
    setState({
      settings: merged,
      pausedUntil: settings.enabled ? 0 : state.pausedUntil,
    });
  },
  /** A profile was picked by hand: let the player have it for a while */
  pauseForManualChoice(now = Date.now()) {
    setState({ pausedUntil: now + state.settings.manualPauseMinutes * 60_000 });
  },
  resume() {
    setState({ pausedUntil: 0 });
  },
};

export function useAutoModes() {
  return useSyncExternalStore(autoModes.subscribe, autoModes.get);
}

// --- detection ------------------------------------------------------------

// Parts whose turning speed tells how much the body moves
const MOTION_PARTS = [
  N.BodyPart.UPPER_CHEST,
  N.BodyPart.LOWER_CHEST,
  N.BodyPart.HIP,
  N.BodyPart.LEFT_UPPER_LEG,
  N.BodyPart.RIGHT_UPPER_LEG,
  N.BodyPart.LEFT_LOWER_LEG,
  N.BodyPart.RIGHT_LOWER_LEG,
];

// Degrees per second, at sensitivity 1
const MOVING = 45;
const DANCING = 90;
// Head lower than this (part of standing height): kneeling, sitting, floor
const LOW = 0.68;
// Hips tilted more than this from upright, head lower than this: lying
const LYING_DEG = 60;
const LYING_HEIGHT = 0.5;
// Seconds the motion is averaged over
const MOTION_SECONDS = 1.5;

/** Seconds a new activity must last before switching to it */
export function holdSeconds(from: Activity, to: Activity): number {
  if (to === 'lapdance') return 3;
  if (to === 'dance') return from === 'lapdance' ? 15 : 4;
  if (to === 'bed') return 10;
  // Back to normal: active modes have pauses, keep them a while
  if (from === 'bed') return 5;
  return from === 'lapdance' ? 20 : 12;
}

/** What the body looks like, from its motion, head height and hip tilt. */
export function classify(
  motion: number,
  height: number,
  lying: boolean,
  current: Activity,
  sensitivity: number
): Activity {
  const moving = MOVING / sensitivity;
  if (lying) return motion > moving ? 'lapdance' : 'bed';
  if (height < LOW) {
    // Calm and low: sitting, or a pause in floor work
    if (motion > moving) return 'lapdance';
    return current === 'lapdance' ? 'lapdance' : 'normal';
  }
  return motion > DANCING / sensitivity ? 'dance' : 'normal';
}

type Quat = { x: number; y: number; z: number; w: number };

function angleBetween(a: Quat, b: Quat) {
  const dot = Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w);
  return (2 * Math.acos(Math.min(1, dot)) * 180) / Math.PI;
}

// Angle between the bone's direction and straight down
function tiltDeg(q: Quat) {
  // y of the rotated (0,-1,0)
  const downY = -(1 - 2 * (q.x * q.x + q.z * q.z));
  return (Math.acos(Math.max(-1, Math.min(1, -downY))) * 180) / Math.PI;
}

export class ActivityDetector {
  private last = new Map<N.BodyPart, Quat>();
  private lastTime = 0;
  private motion = 0;
  private candidate: Activity = 'normal';
  private candidateSince = 0;
  private current: Activity = 'normal';

  /** Returns the new activity when it changes, else null. */
  update(bones: N.BoneT[], standingHeight: number, now = Date.now()): Activity | null {
    const dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    const byPart = new Map(bones.map((b) => [b.bodyPart, b]));

    if (dt > 0 && dt < 1) {
      let sum = 0;
      let count = 0;
      for (const part of MOTION_PARTS) {
        const q = byPart.get(part)?.orientation;
        const before = this.last.get(part);
        if (q && before) {
          sum += angleBetween(before, q) / dt;
          count++;
        }
      }
      if (count)
        this.motion +=
          (sum / count - this.motion) * (1 - Math.exp(-dt / MOTION_SECONDS));
    }
    for (const part of MOTION_PARTS) {
      const q = byPart.get(part)?.orientation;
      if (q) this.last.set(part, { x: q.x, y: q.y, z: q.z, w: q.w });
    }

    const head = byPart.get(N.BodyPart.HEAD)?.headPosition;
    const hip = byPart.get(N.BodyPart.HIP)?.orientation;
    if (!head || !hip || standingHeight <= 0) return null;
    const height = head.y / standingHeight;
    // Hips flat and head low: bending over while standing is not lying
    const lying = tiltDeg(hip) > LYING_DEG && height < LYING_HEIGHT;

    const { settings } = state;
    const seen = classify(
      this.motion,
      height,
      lying,
      this.current,
      settings.sensitivity
    );
    setState({ seen, motion: this.motion, height, lying });

    if (seen === this.current) {
      this.candidate = seen;
      return null;
    }
    if (seen !== this.candidate) {
      this.candidate = seen;
      this.candidateSince = now;
    }
    if (
      now - this.candidateSince <
      holdSeconds(this.current, seen) * settings.delay * 1000
    )
      return null;
    this.current = seen;
    setState({ activity: seen });
    return seen;
  }
}
