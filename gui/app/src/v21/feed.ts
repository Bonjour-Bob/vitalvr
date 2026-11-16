// VitalVR: data feed (devices, trackers, skeleton) from the v21 server to the
// v22 shapes the interface reads.
import * as N from 'solarxr-protocol';
import * as O from '@/v21-protocol/all_generated';
import { bodyPartToNew, trackerIdToNew } from './ids';

export function make<T extends object>(Ctor: new () => T, props: Partial<T>): T {
  return Object.assign(new Ctor(), props);
}

// Deep copy of a v21 object: the interface only reads fields, and most
// tables kept their field names between v21 and v22
export function plain<T = unknown>(value: unknown): T {
  if (Array.isArray(value)) return value.map((v) => plain(v)) as T;
  if (value && typeof value === 'object' && !(value instanceof Uint8Array)) {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) out[key] = plain(v);
    return out as T;
  }
  return value as T;
}

export function feedConfigToOld(config: N.DataFeedConfigT): O.DataFeedConfigT {
  const mask = config.dataMask?.trackerData;
  const trackerMask = mask
    ? make(O.TrackerDataMaskT, {
        info: mask.info,
        status: mask.status,
        rotation: mask.rotation,
        position: mask.position,
        rawAcceleration: mask.rawAcceleration,
        temp: mask.temp,
        linearAcceleration: mask.linearAcceleration,
        rotationReferenceAdjusted: mask.rotationReferenceAdjusted,
        rotationIdentityAdjusted: mask.rotationIdentityAdjusted,
        tps: mask.tps,
        rawMagneticVector: mask.rawMagneticVector,
        stayAligned: mask.stayAligned,
      })
    : null;
  return make(O.DataFeedConfigT, {
    minimumTimeSinceLast: config.minimumTimeSinceLast,
    dataMask: config.dataMask
      ? make(O.DeviceDataMaskT, {
          trackerData: trackerMask,
          deviceData: config.dataMask.deviceData,
        })
      : null,
    boneMask: !!config.boneMask,
    serverGuardsMask: config.serverGuardsMask,
  });
}

// v21 does not send where a device comes from: guess it from what it sends
function deviceOrigin(device: O.DeviceDataT): N.DeviceOrigin {
  const info = device.hardwareInfo;
  if (info?.ipAddress) return N.DeviceOrigin.UDP;
  const maker = info?.manufacturer?.toString() ?? '';
  if (maker === 'VMC') return N.DeviceOrigin.VMC;
  if (maker === 'VRChat' || maker === 'OSC Trackers') return N.DeviceOrigin.VRC;
  if (info?.mcuId || info?.officialBoardType) return N.DeviceOrigin.HID;
  return N.DeviceOrigin.DRIVER;
}

function hardwareInfo(info: O.HardwareInfoT | null): N.HardwareInfoT | null {
  if (!info) return null;
  return make(N.HardwareInfoT, {
    ...plain<Partial<N.HardwareInfoT>>(info),
    ipAddress: info.ipAddress?.addr ?? 0,
  });
}

function hardwareStatus(status: O.HardwareStatusT | null): N.HardwareStatusT | null {
  if (!status) return null;
  return make(N.HardwareStatusT, plain<Partial<N.HardwareStatusT>>(status));
}

function trackerInfo(info: O.TrackerInfoT | null): N.TrackerInfoT | null {
  if (!info) return null;
  const bodyPart = bodyPartToNew(info.bodyPart);
  return make(N.TrackerInfoT, {
    isImu: info.isImu,
    imuType: info.imuType as unknown as N.ImuType,
    bodyPart,
    intendedBodyPart: bodyPart,
    mountingOrientation: plain(info.mountingOrientation),
    mountingResetOrientation: plain(info.mountingResetOrientation),
    displayName: info.displayName,
    customName: info.customName,
    lastMountingMethod: info.mountingResetOrientation
      ? N.MountingMethod.POSE
      : N.MountingMethod.UNKNOWN,
    magnetometer: info.magnetometer as unknown as N.MagnetometerStatus,
    dataType: info.dataSupport as unknown as N.TrackerDataType,
  });
}

function trackerData(
  tracker: O.TrackerDataT,
  deviceId: number,
  origin: N.DeviceOrigin
): N.TrackerDataT {
  return make(N.TrackerDataT, {
    deviceId,
    trackerId: trackerIdToNew(tracker.trackerId),
    info: trackerInfo(tracker.info),
    status: tracker.status as unknown as N.TrackerStatus,
    rotation: plain(tracker.rotation),
    position: plain(tracker.position),
    rawAcceleration: plain(tracker.rawAcceleration),
    temp: tracker.temp?.temp ?? null,
    linearAcceleration: plain(tracker.linearAcceleration),
    rotationReferenceAdjusted: plain(tracker.rotationReferenceAdjusted),
    rotationIdentityAdjusted: plain(tracker.rotationIdentityAdjusted),
    tps: tracker.tps,
    rawMagneticVector: plain(tracker.rawMagneticVector),
    stayAligned: tracker.stayAligned
      ? make(N.StayAlignedTrackerT, {
          yawCorrectionInDeg: tracker.stayAligned.yawCorrectionInDeg,
          locked: tracker.stayAligned.locked,
        })
      : null,
    origin,
  });
}

function bone(b: O.BoneT): N.BoneT {
  return make(N.BoneT, {
    bodyPart: bodyPartToNew(b.bodyPart),
    boneLength: b.boneLength,
    // v21 sends the rotation in world space, which v22 calls orientation
    rotation: plain(b.rotationG),
    orientation: plain(b.rotationG),
    headPosition: plain(b.headPositionG),
  });
}

function serverGuards(g: O.ServerGuardsT | null): N.ServerGuardsT | null {
  if (!g) return null;
  return make(N.ServerGuardsT, {
    yawReset: g.canDoYawReset
      ? N.ResetAvailability.AVAILABLE
      : N.ResetAvailability.NEEDS_FULL_RESET,
    mountingReset: g.canDoMounting
      ? N.ResetAvailability.AVAILABLE
      : N.ResetAvailability.NEEDS_FULL_RESET,
    canDoUserHeightCalibration: g.canDoUserHeightCalibration,
  });
}

export function feedUpdateToNew(update: O.DataFeedUpdateT): N.DataFeedUpdateT {
  return make(N.DataFeedUpdateT, {
    devices: update.devices.map((device) => {
      const id = device.id?.id ?? 0;
      const origin = deviceOrigin(device);
      return make(N.DeviceDataT, {
        id,
        customName: device.customName,
        hardwareInfo: hardwareInfo(device.hardwareInfo),
        hardwareStatus: hardwareStatus(device.hardwareStatus),
        trackers: device.trackers.map((t) => trackerData(t, id, origin)),
        origin,
      });
    }),
    bones: update.bones
      .map(bone)
      // Hip width bones have no v22 body part
      .filter((b) => b.bodyPart !== N.BodyPart.NONE),
    index: update.index,
    serverGuards: serverGuards(update.serverGuards),
    dongles: [],
  });
}
