// VitalVR: v22 asks for each settings section on its own, v21 keeps them all
// in one SettingsResponse / ChangeSettingsRequest. These functions cut the v21
// settings into the v22 sections and back.
import * as N from 'solarxr-protocol';
import * as O from '@/v21-protocol/all_generated';
import { bodyPartToNew, bodyPartToOld } from './ids';
import { make } from './feed';

type Settings = O.SettingsResponseT;

// The v21 server sets every toggle from each request, a missing one reads as
// off. v22 has no switch for these: always send them on (v21 defaults).
export const HIDDEN_TOGGLES: Partial<O.ModelTogglesT> = {
  extendedSpine: true,
  extendedPelvis: true,
  extendedKnee: true,
  forceArmsFromHmd: true,
  correctConstraints: true,
};

// --- v21 -> v22 -------------------------------------------------------------

export function skeletonToNew(s: Settings): N.SkeletonSettingsResponseT {
  const t = s.modelSettings?.toggles;
  const r = s.modelSettings?.ratios;
  const f = s.filtering;
  return make(N.SkeletonSettingsResponseT, {
    toggles: make(N.SkeletonTogglesT, {
      floorClip: t?.floorClip ?? false,
      skatingCorrection: t?.skatingCorrection ?? false,
      toeSnap: t?.toeSnap ?? false,
      footPlant: t?.footPlant ?? false,
      mocapMode: t?.selfLocalization ?? false,
      useTrackerPositions: t?.usePosition ?? false,
      enforceConstraints: t?.enforceConstraints ?? false,
    }),
    ratios: make(N.SkeletonRatiosT, {
      // v21 has one filter: smoothing or prediction
      smoothingStrength: f?.type === O.FilteringType.SMOOTHING ? (f?.amount ?? 0) : 0,
      predictionStrength: f?.type === O.FilteringType.PREDICTION ? (f?.amount ?? 0) : 0,
      spineCurvature: 0,
      imputeSpineFromUpperToLower: r?.imputeWaistFromChestHip ?? 0,
      interpolateUpperLegsTwistWithLowerLegs: r?.interpKneeTrackerAnkle ?? 0,
      skatingCorrectionStrength: s.modelSettings?.legTweaks?.correctionStrength ?? 0,
    }),
  });
}

export function userHeightToNew(s: Settings): N.UserHeightResponseT {
  const h = s.modelSettings?.skeletonHeight;
  return make(N.UserHeightResponseT, {
    headHeight: h?.hmdHeight ?? null,
    floorHeight: h?.floorHeight ?? null,
  });
}

export function driverToNew(s: Settings): N.DriverSettingsResponseT {
  return make(N.DriverSettingsResponseT, {
    enabled: true,
    sendVelocity: s.velocitySettings?.sendDerivedVelocity ?? false,
  });
}

export function resetsToNew(s: Settings): N.ResetsSettingsResponseT {
  const r = s.resetsSettings;
  return make(N.ResetsSettingsResponseT, {
    resetMountingFeet: r?.resetMountingFeet ?? false,
    armsMountingResetMode: armsModeToNew(r?.armsMountingResetMode),
    yawResetSmoothTime: r?.yawResetSmoothTime ?? 0,
    saveMountingReset: r?.saveMountingReset ?? false,
    resetHmdAttitude: r?.resetHmdPitch ?? false,
    mountingMethod: loadMountingMethod(),
  });
}

// v21 does not keep the chosen mounting method: the interface does
const MOUNTING_METHOD_KEY = 'vitalvr-mounting-method';

export function saveMountingMethod(method: N.MountingMethod) {
  try {
    localStorage.setItem(MOUNTING_METHOD_KEY, String(method));
  } catch {
    // ignore
  }
}

function loadMountingMethod(): N.MountingMethod {
  try {
    return Number(localStorage.getItem(MOUNTING_METHOD_KEY)) === N.MountingMethod.MANUAL
      ? N.MountingMethod.MANUAL
      : N.MountingMethod.POSE;
  } catch {
    return N.MountingMethod.POSE;
  }
}

function armsModeToNew(mode: O.ArmsMountingResetMode | undefined) {
  if (mode === O.ArmsMountingResetMode.FORWARD) return N.ArmsMountingResetMode.FORWARD;
  if (
    mode === O.ArmsMountingResetMode.TPOSE_UP ||
    mode === O.ArmsMountingResetMode.TPOSE_DOWN
  )
    return N.ArmsMountingResetMode.SIDE;
  return N.ArmsMountingResetMode.BACK;
}

function armsModeToOld(mode: N.ArmsMountingResetMode) {
  if (mode === N.ArmsMountingResetMode.FORWARD) return O.ArmsMountingResetMode.FORWARD;
  if (mode === N.ArmsMountingResetMode.SIDE) return O.ArmsMountingResetMode.TPOSE_DOWN;
  return O.ArmsMountingResetMode.BACK;
}

export function tapToNew(s: Settings): N.TapDetectionSettingsResponseT {
  const t = s.tapDetectionSettings;
  return make(N.TapDetectionSettingsResponseT, {
    fullResetDelay: t?.fullResetDelay ?? null,
    fullResetEnabled: t?.fullResetEnabled ?? null,
    fullResetTaps: t?.fullResetTaps ?? null,
    yawResetDelay: t?.yawResetDelay ?? null,
    yawResetEnabled: t?.yawResetEnabled ?? null,
    yawResetTaps: t?.yawResetTaps ?? null,
    mountingResetDelay: t?.mountingResetDelay ?? null,
    mountingResetEnabled: t?.mountingResetEnabled ?? null,
    mountingResetTaps: t?.mountingResetTaps ?? null,
    numberTrackersOverThreshold: t?.numberTrackersOverThreshold ?? null,
    yawResetTracker: optionalPartToNew(t?.yawResetTracker),
    fullResetTracker: optionalPartToNew(t?.fullResetTracker),
    mountingResetTracker: optionalPartToNew(t?.mountingResetTracker),
  });
}

function optionalPartToNew(part: O.BodyPart | null | undefined) {
  return part === null || part === undefined ? null : bodyPartToNew(part);
}

function optionalPartToOld(part: N.BodyPart | null | undefined) {
  return part === null || part === undefined ? null : bodyPartToOld(part);
}

export function stayAlignedToNew(s: Settings): N.StayAlignedSettingsResponseT {
  const a = s.stayAligned;
  const pose = (
    kind: N.StayAlignedRelaxedPose,
    enabled: boolean,
    upper: number,
    lower: number,
    foot: number
  ) =>
    make(N.StayAlignedPoseT, {
      pose: kind,
      // v21 marks a pose enabled once it was recorded
      recorded: enabled,
      hasDefault: false,
      enabled,
      upperLegAngle: upper,
      lowerLegAngle: lower,
      footAngle: foot,
    });
  return make(N.StayAlignedSettingsResponseT, {
    enabled: a?.enabled ?? false,
    poses: a
      ? [
          pose(
            N.StayAlignedRelaxedPose.STANDING,
            a.standingEnabled,
            a.standingUpperLegAngle,
            a.standingLowerLegAngle,
            a.standingFootAngle
          ),
          pose(
            N.StayAlignedRelaxedPose.SITTING,
            a.sittingEnabled,
            a.sittingUpperLegAngle,
            a.sittingLowerLegAngle,
            a.sittingFootAngle
          ),
          pose(
            N.StayAlignedRelaxedPose.FLAT,
            a.flatEnabled,
            a.flatUpperLegAngle,
            a.flatLowerLegAngle,
            a.flatFootAngle
          ),
        ]
      : [],
  });
}

export function vrcOscToNew(s: Settings): N.VRCOSCSettingsResponseT {
  const o = s.vrcOsc?.oscSettings;
  return make(N.VRCOSCSettingsResponseT, {
    enabled: o?.enabled ?? false,
    useManualNetwork: !(s.vrcOsc?.oscqueryEnabled ?? true),
    portIn: o?.portIn ?? 9001,
    portOut: o?.portOut ?? 9000,
    address: o?.address ?? '127.0.0.1',
  });
}

export function vmcToNew(s: Settings): N.VMCOSCSettingsResponseT {
  const o = s.vmcOsc?.oscSettings;
  return make(N.VMCOSCSettingsResponseT, {
    enabled: o?.enabled ?? false,
    portIn: o?.portIn ?? 39540,
    portOut: o?.portOut ?? 39539,
    address: o?.address ?? '127.0.0.1',
    anchorHip: s.vmcOsc?.anchorHip ?? true,
    mirrorTracking: s.vmcOsc?.mirrorTracking ?? false,
  });
}

export function vrmToNew(s: Settings): N.VRMSettingsResponseT {
  return make(N.VRMSettingsResponseT, { vrmJson: s.vrm?.vrmJson ?? null });
}

export function hidToNew(s: Settings): N.HIDSettingsResponseT {
  return make(N.HIDSettingsResponseT, {
    trackersOverHid: s.hidSettings?.trackersOverHid ?? false,
  });
}

export function timeoutToNew(s: Settings): N.TimeoutSettingsResponseT {
  return make(N.TimeoutSettingsResponseT, { delay: s.timeout?.duration ?? 0 });
}

// Which bones go to SteamVR (v21: steamVrTrackers) and to VRChat OSC (v21:
// vrcOsc.trackers). v21 names a few groups, v22 single bones.
type Group = {
  parts: N.BodyPart[];
  driver?: keyof O.SteamVRTrackersSettingT;
  osc?: keyof O.OSCTrackersSettingT;
};
const ROUTING_GROUPS: Group[] = [
  { parts: [N.BodyPart.HEAD], osc: 'head' },
  {
    parts: [N.BodyPart.UPPER_CHEST, N.BodyPart.LOWER_CHEST],
    driver: 'chest',
    osc: 'chest',
  },
  { parts: [N.BodyPart.HIP], driver: 'waist', osc: 'waist' },
  { parts: [N.BodyPart.LEFT_LOWER_LEG], driver: 'leftKnee', osc: 'knees' },
  { parts: [N.BodyPart.RIGHT_LOWER_LEG], driver: 'rightKnee', osc: 'knees' },
  { parts: [N.BodyPart.LEFT_FOOT], driver: 'leftFoot', osc: 'feet' },
  { parts: [N.BodyPart.RIGHT_FOOT], driver: 'rightFoot', osc: 'feet' },
  { parts: [N.BodyPart.LEFT_LOWER_ARM], driver: 'leftElbow', osc: 'elbows' },
  { parts: [N.BodyPart.RIGHT_LOWER_ARM], driver: 'rightElbow', osc: 'elbows' },
  { parts: [N.BodyPart.LEFT_HAND], driver: 'leftHand', osc: 'hands' },
  { parts: [N.BodyPart.RIGHT_HAND], driver: 'rightHand', osc: 'hands' },
];

export function routingToNew(s: Settings): N.BoneRoutingSettingsResponseT {
  const driver = s.steamVrTrackers;
  const osc = s.vrcOsc?.trackers;
  const routes: N.BoneRouteT[] = [];
  for (const group of ROUTING_GROUPS) {
    for (const bone of group.parts) {
      const outputs: N.RoutingOutput[] = [];
      if (group.driver && driver?.[group.driver]) outputs.push(N.RoutingOutput.DRIVER);
      if (group.osc && osc?.[group.osc]) outputs.push(N.RoutingOutput.VRC_OSC);
      routes.push(make(N.BoneRouteT, { bone, outputs }));
    }
  }
  const status = (output: N.RoutingOutput, groups: Group[], enabled: boolean) =>
    make(N.RoutingOutputStatusT, {
      output,
      accepts: groups.flatMap((g) => g.parts),
      requires: [],
      conflicts: [],
      state: enabled ? N.RoutingOutputState.ENABLED : N.RoutingOutputState.INACTIVE,
      overridable: [],
    });
  return make(N.BoneRoutingSettingsResponseT, {
    automatic: driver?.automaticTrackerToggle ?? true,
    routes,
    outputs: [
      status(
        N.RoutingOutput.DRIVER,
        ROUTING_GROUPS.filter((g) => g.driver),
        true
      ),
      status(
        N.RoutingOutput.VRC_OSC,
        ROUTING_GROUPS.filter((g) => g.osc),
        s.vrcOsc?.oscSettings?.enabled ?? false
      ),
    ],
  });
}

// --- v22 -> v21: each returns the ChangeSettingsRequest part to send -----------

export function skeletonToOld(
  req: N.ChangeSkeletonSettingsRequestT,
  s: Settings
): Partial<O.ChangeSettingsRequestT> {
  const t = req.toggles;
  const r = req.ratios;
  const out: Partial<O.ChangeSettingsRequestT> = {};
  const model = make(O.ModelSettingsT, {});
  if (t) {
    model.toggles = make(O.ModelTogglesT, {
      ...HIDDEN_TOGGLES,
      floorClip: t.floorClip,
      skatingCorrection: t.skatingCorrection,
      toeSnap: t.toeSnap,
      footPlant: t.footPlant,
      selfLocalization: t.mocapMode,
      usePosition: t.useTrackerPositions,
      enforceConstraints: t.enforceConstraints,
    });
  }
  if (r) {
    model.ratios = make(O.ModelRatiosT, {
      imputeWaistFromChestHip: r.imputeSpineFromUpperToLower,
      interpKneeTrackerAnkle: r.interpolateUpperLegsTwistWithLowerLegs,
    });
    if (r.skatingCorrectionStrength !== null)
      model.legTweaks = make(O.LegTweaksSettingsT, {
        correctionStrength: r.skatingCorrectionStrength,
      });
    if (r.smoothingStrength !== null || r.predictionStrength !== null) {
      const prediction = r.predictionStrength ?? 0;
      const smoothing = r.smoothingStrength ?? 0;
      // Prediction wins when both are set: it is the one with less delay
      out.filtering =
        prediction > 0
          ? make(O.FilteringSettingsT, {
              type: O.FilteringType.PREDICTION,
              amount: prediction,
            })
          : smoothing > 0
            ? make(O.FilteringSettingsT, {
                type: O.FilteringType.SMOOTHING,
                amount: smoothing,
              })
            : make(O.FilteringSettingsT, {
                type: O.FilteringType.NONE,
                amount: s.filtering?.amount ?? 0,
              });
    }
  }
  out.modelSettings = model;
  return out;
}

export function userHeightToOld(
  req: N.ChangeUserHeightRequestT
): Partial<O.ChangeSettingsRequestT> {
  return {
    modelSettings: make(O.ModelSettingsT, {
      skeletonHeight: make(O.SkeletonHeightT, {
        hmdHeight: req.headHeight,
        floorHeight: req.floorHeight,
      }),
    }),
  };
}

export function driverToOld(
  req: N.ChangeDriverSettingsRequestT
): Partial<O.ChangeSettingsRequestT> {
  return {
    velocitySettings: make(O.VelocitySettingsT, {
      sendDerivedVelocity: req.sendVelocity,
    }),
  };
}

export function resetsToOld(
  req: N.ChangeResetsSettingsRequestT
): Partial<O.ChangeSettingsRequestT> {
  return {
    resetsSettings: make(O.ResetsSettingsT, {
      resetMountingFeet: req.resetMountingFeet,
      armsMountingResetMode: armsModeToOld(req.armsMountingResetMode),
      yawResetSmoothTime: req.yawResetSmoothTime,
      saveMountingReset: req.saveMountingReset,
      resetHmdPitch: req.resetHmdAttitude,
    }),
  };
}

export function tapToOld(
  req: N.ChangeTapDetectionSettingsRequestT | N.TapDetectionSetupModeRequestT
): Partial<O.ChangeSettingsRequestT> {
  if (req instanceof N.TapDetectionSetupModeRequestT || 'setupMode' in req) {
    return {
      tapDetectionSettings: make(O.TapDetectionSettingsT, {
        setupMode: (req as N.TapDetectionSetupModeRequestT).setupMode,
      }),
    };
  }
  return {
    tapDetectionSettings: make(O.TapDetectionSettingsT, {
      fullResetDelay: req.fullResetDelay,
      fullResetEnabled: req.fullResetEnabled,
      fullResetTaps: req.fullResetTaps,
      yawResetDelay: req.yawResetDelay,
      yawResetEnabled: req.yawResetEnabled,
      yawResetTaps: req.yawResetTaps,
      mountingResetDelay: req.mountingResetDelay,
      mountingResetEnabled: req.mountingResetEnabled,
      mountingResetTaps: req.mountingResetTaps,
      numberTrackersOverThreshold: req.numberTrackersOverThreshold,
      yawResetTracker: optionalPartToOld(req.yawResetTracker),
      fullResetTracker: optionalPartToOld(req.fullResetTracker),
      mountingResetTracker: optionalPartToOld(req.mountingResetTracker),
    }),
  };
}

export function stayAlignedToOld(
  req: N.ChangeStayAlignedSettingsRequestT,
  s: Settings
): Partial<O.ChangeSettingsRequestT> {
  const a = make(O.StayAlignedSettingsT, { ...(s.stayAligned ?? {}) });
  a.enabled = req.enabled;
  for (const toggle of req.poseToggles) {
    if (toggle.pose === N.StayAlignedRelaxedPose.STANDING)
      a.standingEnabled = toggle.enabled;
    if (toggle.pose === N.StayAlignedRelaxedPose.SITTING)
      a.sittingEnabled = toggle.enabled;
    if (toggle.pose === N.StayAlignedRelaxedPose.FLAT) a.flatEnabled = toggle.enabled;
  }
  return { stayAligned: a };
}

function oscSettings(
  current: O.OSCSettingsT | null | undefined,
  req: {
    enabled: boolean;
    portIn: number;
    portOut: number;
    address: string | Uint8Array | null;
  }
) {
  return make(O.OSCSettingsT, {
    enabled: req.enabled,
    portIn: req.portIn || current?.portIn || 0,
    portOut: req.portOut || current?.portOut || 0,
    address: req.address ?? current?.address ?? '127.0.0.1',
  });
}

export function vrcOscToOld(
  req: N.ChangeVRCOSCSettingsRequestT,
  s: Settings
): Partial<O.ChangeSettingsRequestT> {
  return {
    vrcOsc: make(O.VRCOSCSettingsT, {
      oscSettings: oscSettings(s.vrcOsc?.oscSettings, req),
      trackers: s.vrcOsc?.trackers ?? make(O.OSCTrackersSettingT, {}),
      oscqueryEnabled: !req.useManualNetwork,
    }),
  };
}

export function vmcToOld(
  req: N.ChangeVMCOSCSettingsRequestT,
  s: Settings
): Partial<O.ChangeSettingsRequestT> {
  return {
    vmcOsc: make(O.VMCOSCSettingsT, {
      oscSettings: oscSettings(s.vmcOsc?.oscSettings, req),
      anchorHip: req.anchorHip,
      mirrorTracking: req.mirrorTracking,
    }),
  };
}

export function vrmToOld(
  req: N.ChangeVRMSettingsRequestT
): Partial<O.ChangeSettingsRequestT> {
  return { vrm: make(O.VRMSettingsT, { vrmJson: req.vrmJson }) };
}

export function hidToOld(
  req: N.ChangeHIDSettingsRequestT
): Partial<O.ChangeSettingsRequestT> {
  return {
    hidSettings: make(O.HIDSettingsT, { trackersOverHid: req.trackersOverHid }),
  };
}

export function timeoutToOld(
  req: N.ChangeTimeoutSettingsRequestT
): Partial<O.ChangeSettingsRequestT> {
  return { timeout: make(O.TimeoutSettingsT, { duration: req.delay }) };
}

export function routingToOld(
  req: N.ChangeBoneRoutingSettingsRequestT,
  s: Settings
): Partial<O.ChangeSettingsRequestT> {
  const driver = make(O.SteamVRTrackersSettingT, { ...(s.steamVrTrackers ?? {}) });
  const osc = make(O.OSCTrackersSettingT, { ...(s.vrcOsc?.trackers ?? {}) });
  driver.automaticTrackerToggle = req.automatic;
  const routed = (bone: N.BodyPart, output: N.RoutingOutput) =>
    req.routes.some((r) => r.bone === bone && r.outputs.includes(output));
  for (const group of ROUTING_GROUPS) {
    if (group.driver)
      (driver[group.driver] as boolean) = group.parts.some((p) =>
        routed(p, N.RoutingOutput.DRIVER)
      );
    if (group.osc) {
      // knees, feet, elbows and hands are one switch for both sides in v21
      const sameSwitch = ROUTING_GROUPS.filter((g) => g.osc === group.osc);
      (osc[group.osc] as boolean) = sameSwitch.some((g) =>
        g.parts.some((p) => routed(p, N.RoutingOutput.VRC_OSC))
      );
    }
  }
  return {
    steamVrTrackers: driver,
    vrcOsc: make(O.VRCOSCSettingsT, {
      oscSettings: s.vrcOsc?.oscSettings ?? null,
      trackers: osc,
      oscqueryEnabled: s.vrcOsc?.oscqueryEnabled ?? true,
    }),
  };
}
