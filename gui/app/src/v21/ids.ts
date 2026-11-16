// VitalVR: the interface speaks the SlimeVR v22 protocol, the server is
// SlimeVR v21. These tables translate the ids that changed between the two.
import * as N from 'solarxr-protocol';
import * as O from '@/v21-protocol/all_generated';

// Body parts: same names except the spine, which v22 split in more parts.
// v21 WAIST is the first tracker above the hip, v22 calls it LOWER_WAIST.
const OLD_TO_NEW_NAME: Record<string, string> = {
  CHEST: 'LOWER_CHEST',
  WAIST: 'LOWER_WAIST',
};
const NEW_TO_OLD_NAME: Record<string, string> = {
  LOWER_CHEST: 'CHEST',
  LOWER_WAIST: 'WAIST',
  UPPER_WAIST: 'WAIST',
};

export function bodyPartToNew(part: O.BodyPart | null | undefined): N.BodyPart {
  if (part === null || part === undefined) return N.BodyPart.NONE;
  const name = O.BodyPart[part];
  const mapped = N.BodyPart[(OLD_TO_NEW_NAME[name] ?? name) as keyof typeof N.BodyPart];
  return mapped ?? N.BodyPart.NONE;
}

export function bodyPartToOld(part: N.BodyPart | null | undefined): O.BodyPart {
  if (part === null || part === undefined) return O.BodyPart.NONE;
  const name = N.BodyPart[part];
  const mapped = O.BodyPart[(NEW_TO_OLD_NAME[name] ?? name) as keyof typeof O.BodyPart];
  return mapped ?? O.BodyPart.NONE;
}

// Trackers: v21 names a tracker by (device id, tracker number), v22 by one
// number. Device ids are 8 bits in v21, so the pair fits in 16 bits. Trackers
// without a device (computed by the server) use device 0, which v21 never
// gives to a real device.
export function trackerIdToNew(id: O.TrackerIdT | null | undefined): number {
  if (!id) return 0;
  return ((id.deviceId?.id ?? 0) << 8) | id.trackerNum;
}

export function trackerIdToOld(id: number): O.TrackerIdT {
  const device = id >> 8;
  return new O.TrackerIdT(device ? new O.DeviceIdT(device) : null, id & 0xff);
}

export function deviceIdToNew(id: O.DeviceIdT | null | undefined): number {
  return id?.id ?? 0;
}
