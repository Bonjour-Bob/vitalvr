// VitalVR: profiles. The v22 server keeps profiles itself, the v21 server does
// not, so they live in the interface: a settings profile is a copy of the
// tracking settings, a user profile a copy of the body proportions.
import * as N from 'solarxr-protocol';
import * as O from '@/v21-protocol/all_generated';
import { make, plain } from './feed';
import { HIDDEN_TOGGLES } from './settings';

type Json = Record<string, unknown>;
export type SettingsSnapshot = {
  filtering?: Json;
  driftCompensation?: Json;
  toggles?: Json;
  ratios?: Json;
  legTweaks?: Json;
  resets?: Json;
};
export type UserSnapshot = { parts: [O.SkeletonBone, number][]; height: number | null };

type Kind<T> = { active: string; list: Record<string, T> };
type Store = {
  version: 1;
  // The starting profile was applied to the server
  applied: boolean;
  // Built-in profiles already offered (a deleted one does not come back)
  presets?: string[];
  settings: Kind<SettingsSnapshot>;
  user: Kind<UserSnapshot>;
};

const STORE_KEY = 'vitalvr-profiles';
const NAME = /^[\p{L}\p{N} _-]{1,64}$/u;

// Built-in settings profiles, made for the v21 skeleton
export const NORMAL = 'Normal';
export const PRESETS: Record<string, SettingsSnapshot> = {
  // Everyday use: standing, sitting, lying, walking
  [NORMAL]: {
    filtering: { type: O.FilteringType.PREDICTION, amount: 0.15 },
    toggles: {
      extendedSpine: true,
      extendedPelvis: true,
      extendedKnee: true,
      floorClip: true,
      skatingCorrection: true,
      footPlant: true,
      toeSnap: false,
      usePosition: true,
      enforceConstraints: true,
    },
    // Feet slide less when walking
    legTweaks: { correctionStrength: 0.5 },
  },
  // Standing dance: less delay, feet free to slide and spin
  Danse: {
    filtering: { type: O.FilteringType.PREDICTION, amount: 0.3 },
    toggles: {
      extendedSpine: true,
      extendedPelvis: true,
      extendedKnee: true,
      floorClip: true,
      skatingCorrection: false,
      footPlant: true,
      toeSnap: false,
      usePosition: true,
      enforceConstraints: true,
    },
    legTweaks: { correctionStrength: 0.3 },
  },
  // Floor work, sitting then standing, knees on the floor, deep arches:
  // no joint limits, feet free (pointed toes, heels), floor kept
  'Lap dance': {
    filtering: { type: O.FilteringType.PREDICTION, amount: 0.15 },
    toggles: {
      extendedSpine: true,
      extendedPelvis: true,
      extendedKnee: true,
      floorClip: true,
      skatingCorrection: false,
      footPlant: false,
      toeSnap: false,
      usePosition: true,
      enforceConstraints: false,
    },
    legTweaks: { correctionStrength: 0.3 },
  },
  // Lying in bed, chilling: calm and smooth, no floor or foot locking (the
  // bed is not the floor)
  'Lit chill': {
    filtering: { type: O.FilteringType.SMOOTHING, amount: 0.5 },
    toggles: {
      extendedSpine: true,
      extendedPelvis: true,
      extendedKnee: true,
      floorClip: false,
      skatingCorrection: false,
      footPlant: false,
      toeSnap: false,
      usePosition: true,
      enforceConstraints: true,
    },
  },
  // SlimeVR v21 as it comes
  'Origine SlimeVR': {
    filtering: { type: O.FilteringType.PREDICTION, amount: 0.2 },
    toggles: {
      extendedSpine: true,
      extendedPelvis: true,
      extendedKnee: true,
      floorClip: true,
      skatingCorrection: true,
      footPlant: true,
      toeSnap: false,
      usePosition: true,
      enforceConstraints: true,
    },
    legTweaks: { correctionStrength: 0.3 },
  },
};
const USER_DEFAULT = 'Moi';

function load(): Store | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as Store) : null;
  } catch {
    return null;
  }
}

function save(store: Store) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    // ignore
  }
}

export function snapshotSettings(s: O.SettingsResponseT): SettingsSnapshot {
  return plain({
    filtering: s.filtering,
    driftCompensation: s.driftCompensation,
    toggles: s.modelSettings?.toggles,
    ratios: s.modelSettings?.ratios,
    legTweaks: s.modelSettings?.legTweaks,
    resets: s.resetsSettings,
  });
}

export function settingsRequest(
  snap: SettingsSnapshot
): Partial<O.ChangeSettingsRequestT> {
  const out: Partial<O.ChangeSettingsRequestT> = {};
  if (snap.filtering) out.filtering = make(O.FilteringSettingsT, snap.filtering);
  if (snap.driftCompensation)
    out.driftCompensation = make(O.DriftCompensationSettingsT, snap.driftCompensation);
  if (snap.resets) out.resetsSettings = make(O.ResetsSettingsT, snap.resets);
  out.modelSettings = make(O.ModelSettingsT, {
    // Also repairs profiles saved while these were wrongly off
    toggles: snap.toggles
      ? make(O.ModelTogglesT, { ...snap.toggles, ...HIDDEN_TOGGLES })
      : null,
    ratios: snap.ratios ? make(O.ModelRatiosT, snap.ratios) : null,
    legTweaks: snap.legTweaks ? make(O.LegTweaksSettingsT, snap.legTweaks) : null,
  });
  return out;
}

export function snapshotUser(
  parts: O.SkeletonPartT[],
  height: number | null
): UserSnapshot {
  return { parts: parts.map((p) => [p.bone, p.value]), height };
}

export class ProfileStore {
  private store: Store;

  constructor() {
    const stored = load();
    this.store = stored ?? {
      version: 1,
      applied: false,
      settings: { active: NORMAL, list: { ...PRESETS } },
      user: { active: USER_DEFAULT, list: {} },
    };
    // Built-in profiles added by a newer VitalVR
    const offered = this.store.presets ?? Object.keys(this.store.settings.list);
    for (const [name, preset] of Object.entries(PRESETS)) {
      if (!offered.includes(name) && !(name in this.store.settings.list))
        this.store.settings.list[name] = preset;
    }
    this.store.presets = Object.keys(PRESETS);
    save(this.store);
  }

  get applied() {
    return this.store.applied;
  }

  markApplied() {
    this.store.applied = true;
    save(this.store);
  }

  response(): N.ProfilesResponseT {
    const list = (kind: Kind<unknown>) =>
      make(N.ProfileListT, { active: kind.active, names: Object.keys(kind.list) });
    const user = this.store.user;
    // The default user profile exists even before its first save
    const userNames = Object.keys(user.list).length
      ? user
      : { ...user, list: { [user.active]: {} } };
    return make(N.ProfilesResponseT, {
      settings: list(this.store.settings),
      user: list(userNames),
    });
  }

  private kind(kind: N.ProfileKind): Kind<SettingsSnapshot | UserSnapshot> | null {
    if (kind === N.ProfileKind.SETTINGS) return this.store.settings;
    if (kind === N.ProfileKind.USER) return this.store.user;
    return null;
  }

  activeName(kind: N.ProfileKind) {
    return this.kind(kind)?.active ?? '';
  }

  get(kind: N.ProfileKind, name: string) {
    return this.kind(kind)?.list[name] ?? null;
  }

  /** Keeps the current values in the active profile before leaving it. */
  remember(kind: N.ProfileKind, snapshot: SettingsSnapshot | UserSnapshot) {
    const k = this.kind(kind);
    if (!k) return;
    k.list[k.active] = snapshot;
    save(this.store);
  }

  switchTo(kind: N.ProfileKind, name: string): N.ProfileOperationStatus {
    const k = this.kind(kind);
    if (!k) return N.ProfileOperationStatus.INVALID_KIND;
    if (!(name in k.list) && !(kind === N.ProfileKind.USER && name === k.active))
      return N.ProfileOperationStatus.NOT_FOUND;
    k.active = name;
    save(this.store);
    return N.ProfileOperationStatus.OK;
  }

  create(
    kind: N.ProfileKind,
    name: string,
    copy: SettingsSnapshot | UserSnapshot
  ): N.ProfileOperationStatus {
    const k = this.kind(kind);
    if (!k) return N.ProfileOperationStatus.INVALID_KIND;
    if (!NAME.test(name)) return N.ProfileOperationStatus.INVALID_NAME;
    if (name in k.list) return N.ProfileOperationStatus.ALREADY_EXISTS;
    k.list[name] = copy;
    save(this.store);
    return N.ProfileOperationStatus.OK;
  }

  rename(kind: N.ProfileKind, name: string, newName: string): N.ProfileOperationStatus {
    const k = this.kind(kind);
    if (!k) return N.ProfileOperationStatus.INVALID_KIND;
    if (!(name in k.list)) return N.ProfileOperationStatus.NOT_FOUND;
    if (!NAME.test(newName)) return N.ProfileOperationStatus.INVALID_NAME;
    if (newName in k.list) return N.ProfileOperationStatus.ALREADY_EXISTS;
    k.list[newName] = k.list[name];
    delete k.list[name];
    if (k.active === name) k.active = newName;
    save(this.store);
    return N.ProfileOperationStatus.OK;
  }

  remove(kind: N.ProfileKind, name: string): N.ProfileOperationStatus {
    const k = this.kind(kind);
    if (!k) return N.ProfileOperationStatus.INVALID_KIND;
    if (!(name in k.list)) return N.ProfileOperationStatus.NOT_FOUND;
    if (k.active === name) return N.ProfileOperationStatus.IS_ACTIVE;
    delete k.list[name];
    save(this.store);
    return N.ProfileOperationStatus.OK;
  }
}
