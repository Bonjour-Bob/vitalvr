// VitalVR: lets the SlimeVR v22 interface run on the SlimeVR v21 server.
// Every message goes through here: v21 messages from the server become the v22
// messages the interface listens to, and v22 requests become v21 requests.
// Messages whose binary layout did not change are re-read as is (transcode),
// the others are translated field by field, and the few v22 features the v21
// server does not have are answered here or ignored.
import { Builder, ByteBuffer } from 'flatbuffers';
import * as N from 'solarxr-protocol';
import * as O from '@/v21-protocol/all_generated';
import { bodyPartToNew, bodyPartToOld, trackerIdToNew, trackerIdToOld } from './ids';
import { feedConfigToOld, feedUpdateToNew, make, plain } from './feed';
import * as S from './settings';
import * as P from './profiles';

type Packable = { pack(builder: Builder): number };
type Table<T> = new () => { __init(i: number, bb: ByteBuffer): { unpack(): T } };

// Same binary layout in v21 and v22 (checked against both schemas)
const SAME_LAYOUT = [
  'AddUnknownDeviceRequest',
  'AutoBoneApplyRequest',
  'AutoBoneProcessRequest',
  'CancelUserHeightCalibration',
  'CloseSerialRequest',
  'EnableSteamVRDriverRequest',
  'FirmwareUpdateStopQueuesRequest',
  'ForgetDeviceRequest',
  'IgnoreTrackingChecklistStepRequest',
  'InstalledInfoRequest',
  'InstalledInfoResponse',
  'LegTweaksTmpChange',
  'LegTweaksTmpClear',
  'RecordBVHRequest',
  'RecordBVHStatus',
  'RecordBVHStatusRequest',
  'SerialDevicesRequest',
  'SerialDevicesResponse',
  'SerialTrackerCustomCommandRequest',
  'SerialTrackerFactoryResetRequest',
  'SerialTrackerGetInfoRequest',
  'SerialTrackerGetWifiScanRequest',
  'SerialTrackerRebootRequest',
  'ServerInfosRequest',
  'ServerInfosResponse',
  'SetPauseTrackingRequest',
  'SettingsResetRequest',
  'StartUserHeightCalibration',
  'StartWifiProvisioningRequest',
  'StopWifiProvisioningRequest',
  'TrackingChecklistRequest',
  'TrackingChecklistResponse',
  'TrackingPauseStateRequest',
  'TrackingPauseStateResponse',
  'UserHeightRecordingStatusResponse',
  'VRCConfigSettingToggleMute',
  'VRCConfigStateRequest',
  'AutoBoneStopRecordingRequest',
  'AutoBoneCancelRecordingRequest',
  'OverlayDisplayModeRequest',
  'OverlayDisplayModeChangeRequest',
  'OverlayDisplayModeResponse',
  'ClearMountingResetRequest',
  'HeartbeatRequest',
  'HeartbeatResponse',
] as const;

function transcode<T>(message: Packable, Target: Table<T>): T {
  const builder = new Builder(256);
  builder.finish(message.pack(builder));
  const bb = new ByteBuffer(builder.asUint8Array());
  const table = new Target();
  return table.__init(bb.readInt32(bb.position()) + bb.position(), bb).unpack();
}

// v21 SkeletonBone <-> v22 SkeletonBone. v21 has one waist length where v22
// has two: v22 shows half of it in each.
const SKELETON_BONE_PAIRS: [O.SkeletonBone, N.SkeletonBone][] = [
  [O.SkeletonBone.NECK, N.SkeletonBone.NECK],
  [O.SkeletonBone.UPPER_CHEST, N.SkeletonBone.UPPER_CHEST],
  [O.SkeletonBone.CHEST, N.SkeletonBone.LOWER_CHEST],
  [O.SkeletonBone.HIP, N.SkeletonBone.HIP],
  [O.SkeletonBone.HIPS_WIDTH, N.SkeletonBone.HIPS_WIDTH],
  [O.SkeletonBone.UPPER_LEG, N.SkeletonBone.UPPER_LEG],
  [O.SkeletonBone.LOWER_LEG, N.SkeletonBone.LOWER_LEG],
  [O.SkeletonBone.FOOT_LENGTH, N.SkeletonBone.FOOT_LENGTH],
  [O.SkeletonBone.FOOT_SHIFT, N.SkeletonBone.FOOT_SHIFT],
  [O.SkeletonBone.SHOULDERS_DISTANCE, N.SkeletonBone.SHOULDERS_DISTANCE],
  [O.SkeletonBone.SHOULDERS_WIDTH, N.SkeletonBone.SHOULDERS_WIDTH],
  [O.SkeletonBone.UPPER_ARM, N.SkeletonBone.UPPER_ARM],
  [O.SkeletonBone.LOWER_ARM, N.SkeletonBone.LOWER_ARM],
  [O.SkeletonBone.HAND_Y, N.SkeletonBone.HAND],
];

function skeletonPartsToNew(
  parts: O.SkeletonPartT[],
  waist?: [number, number]
): N.SkeletonPartT[] {
  const part = (bone: N.SkeletonBone, value: number) =>
    make(N.SkeletonPartT, { bone, value, minValue: -1, maxValue: 2 });
  const out: N.SkeletonPartT[] = [];
  for (const p of parts) {
    if (p.bone === O.SkeletonBone.WAIST) {
      out.push(part(N.SkeletonBone.UPPER_WAIST, waist?.[0] ?? p.value / 2));
      out.push(part(N.SkeletonBone.LOWER_WAIST, waist?.[1] ?? p.value / 2));
      continue;
    }
    const pair = SKELETON_BONE_PAIRS.find(([old]) => old === p.bone);
    if (pair) out.push(part(pair[1], p.value));
  }
  return out;
}

const KEYBIND_SHIFT = 1; // v22 added NONE = 0 in front of the v21 keybind ids

export type BridgeEmit = (kind: 'rpc' | 'feed', type: number, data: unknown) => void;

export class V21Bridge {
  private settings: O.SettingsResponseT | null = null;
  private skeletonParts: O.SkeletonPartT[] = [];
  private waistHalves: [number, number] = [0, 0];
  private lastFeed: O.DataFeedUpdateT | null = null;
  private unknownDevices = new Map<string, N.UnknownDeviceT>();
  private poseRecording: ReturnType<typeof setInterval> | null = null;
  private driverConnected: boolean | null = null;
  private profiles = new P.ProfileStore();

  constructor(
    private readonly send: (bundle: O.MessageBundleT) => void,
    private readonly emit: BridgeEmit
  ) {}

  // --- sending to the v21 server ---------------------------------------------

  private rpc(type: O.RpcMessage, message: O.RpcMessageHeaderT['message']) {
    const header = new O.RpcMessageHeaderT();
    header.messageType = type;
    header.message = message;
    const bundle = new O.MessageBundleT();
    bundle.rpcMsgs = [header];
    this.send(bundle);
  }

  private changeSettings(part: Partial<O.ChangeSettingsRequestT>) {
    this.rpc(O.RpcMessage.ChangeSettingsRequest, make(O.ChangeSettingsRequestT, part));
    this.rpc(O.RpcMessage.SettingsRequest, new O.SettingsRequestT());
  }

  private reply(type: N.RpcMessage, data: unknown) {
    // Answers made here arrive after the request, like a server answer would
    queueMicrotask(() => this.emit('rpc', type, data));
  }

  onConnected() {
    this.settings = null;
    this.driverConnected = null;
    this.unknownDevices.clear();
    this.stopPoseRecording();
  }

  private stopPoseRecording() {
    if (this.poseRecording) clearInterval(this.poseRecording);
    this.poseRecording = null;
  }

  // --- interface -> server ---------------------------------------------------

  outgoingFeed(type: N.DataFeedMessage, data: unknown) {
    if (type !== N.DataFeedMessage.StartDataFeed) return;
    const start = data as N.StartDataFeedT;
    const header = new O.DataFeedMessageHeaderT();
    header.messageType = O.DataFeedMessage.StartDataFeed;
    header.message = make(O.StartDataFeedT, {
      dataFeeds: start.dataFeeds.map(feedConfigToOld),
    });
    const bundle = new O.MessageBundleT();
    bundle.dataFeedMsgs = [header];
    this.send(bundle);
  }

  outgoingRpc(type: N.RpcMessage, data: unknown) {
    const name = N.RpcMessage[type];
    if ((SAME_LAYOUT as readonly string[]).includes(name)) {
      const oldType = O.RpcMessage[name as keyof typeof O.RpcMessage];
      const Target = (O as unknown as Record<string, Table<unknown>>)[name];
      this.rpc(
        oldType,
        transcode(data as Packable, Target) as O.RpcMessageHeaderT['message']
      );
      return;
    }
    const handler = this.requests[name];
    if (handler) handler(data as never);
  }

  private settingsRequest() {
    if (this.settings) this.emitSettings(this.settings);
    this.rpc(O.RpcMessage.SettingsRequest, new O.SettingsRequestT());
  }

  private requests: Record<string, (data: never) => void> = {
    // Settings: one v21 request answers all the v22 sections
    SkeletonSettingsRequest: () => this.settingsRequest(),
    DriverSettingsRequest: () => this.settingsRequest(),
    ResetsSettingsRequest: () => this.settingsRequest(),
    TapDetectionSettingsRequest: () => this.settingsRequest(),
    StayAlignedSettingsRequest: () => this.settingsRequest(),
    VRCOSCSettingsRequest: () => this.settingsRequest(),
    VMCOSCSettingsRequest: () => this.settingsRequest(),
    VRMSettingsRequest: () => this.settingsRequest(),
    HIDSettingsRequest: () => this.settingsRequest(),
    TimeoutSettingsRequest: () => this.settingsRequest(),
    UserHeightRequest: () => this.settingsRequest(),
    BoneRoutingSettingsRequest: () => this.settingsRequest(),
    ChangeSkeletonSettingsRequest: (r: N.ChangeSkeletonSettingsRequestT) =>
      this.changeSettings(
        S.skeletonToOld(r, this.settings ?? new O.SettingsResponseT())
      ),
    ChangeUserHeightRequest: (r: N.ChangeUserHeightRequestT) =>
      this.changeSettings(S.userHeightToOld(r)),
    ChangeDriverSettingsRequest: (r: N.ChangeDriverSettingsRequestT) =>
      this.changeSettings(S.driverToOld(r)),
    ChangeResetsSettingsRequest: (r: N.ChangeResetsSettingsRequestT) => {
      S.saveMountingMethod(r.mountingMethod);
      this.changeSettings(S.resetsToOld(r));
    },
    ChangeTapDetectionSettingsRequest: (r: N.ChangeTapDetectionSettingsRequestT) =>
      this.changeSettings(S.tapToOld(r)),
    TapDetectionSetupModeRequest: (r: N.TapDetectionSetupModeRequestT) =>
      this.changeSettings(S.tapToOld(r)),
    ChangeStayAlignedSettingsRequest: (r: N.ChangeStayAlignedSettingsRequestT) =>
      this.changeSettings(
        S.stayAlignedToOld(r, this.settings ?? new O.SettingsResponseT())
      ),
    ChangeVRCOSCSettingsRequest: (r: N.ChangeVRCOSCSettingsRequestT) =>
      this.changeSettings(S.vrcOscToOld(r, this.settings ?? new O.SettingsResponseT())),
    ChangeVMCOSCSettingsRequest: (r: N.ChangeVMCOSCSettingsRequestT) =>
      this.changeSettings(S.vmcToOld(r, this.settings ?? new O.SettingsResponseT())),
    ChangeVRMSettingsRequest: (r: N.ChangeVRMSettingsRequestT) =>
      this.changeSettings(S.vrmToOld(r)),
    ChangeHIDSettingsRequest: (r: N.ChangeHIDSettingsRequestT) =>
      this.changeSettings(S.hidToOld(r)),
    ChangeTimeoutSettingsRequest: (r: N.ChangeTimeoutSettingsRequestT) =>
      this.changeSettings(S.timeoutToOld(r)),
    ChangeBoneRoutingSettingsRequest: (r: N.ChangeBoneRoutingSettingsRequestT) =>
      this.changeSettings(
        S.routingToOld(r, this.settings ?? new O.SettingsResponseT())
      ),

    // Resets
    ResetRequest: (r: N.ResetRequestT) =>
      this.rpc(
        O.RpcMessage.ResetRequest,
        make(O.ResetRequestT, {
          resetType: r.resetType as unknown as O.ResetType,
          bodyParts: r.bodyParts.map(bodyPartToOld),
          delay: r.delay,
        })
      ),

    // Trackers
    UpdateTrackerRequest: (r: N.UpdateTrackerRequestT) =>
      this.rpc(
        O.RpcMessage.AssignTrackerRequest,
        make(O.AssignTrackerRequestT, {
          trackerId: trackerIdToOld(r.trackerId),
          bodyPosition: bodyPartToOld(r.bodyPosition),
          mountingOrientation: r.mountingOrientation
            ? make(O.QuatT, { ...r.mountingOrientation })
            : null,
          displayName: r.displayName,
          allowDriftCompensation: false,
        })
      ),
    ResetTrackerAssignments: () => {
      // v21 has no "unassign all": unassign the trackers one by one
      for (const device of this.lastFeed?.devices ?? []) {
        for (const tracker of device.trackers) {
          if (!tracker.info?.bodyPart) continue;
          this.rpc(
            O.RpcMessage.AssignTrackerRequest,
            make(O.AssignTrackerRequestT, {
              trackerId: tracker.trackerId,
              bodyPosition: O.BodyPart.NONE,
              mountingOrientation: tracker.info.mountingOrientation,
              displayName: tracker.info.customName,
              allowDriftCompensation: tracker.info.allowDriftCompensation,
            })
          );
        }
      }
    },
    MagToggleRequest: (r: N.MagToggleRequestT) =>
      this.rpc(
        O.RpcMessage.MagToggleRequest,
        make(O.MagToggleRequestT, {
          trackerId: r.trackerId ? trackerIdToOld(r.trackerId) : null,
        })
      ),
    ChangeMagToggleRequest: (r: N.ChangeMagToggleRequestT) =>
      this.rpc(
        O.RpcMessage.ChangeMagToggleRequest,
        make(O.ChangeMagToggleRequestT, {
          trackerId: r.trackerId ? trackerIdToOld(r.trackerId) : null,
          enable: r.enable,
        })
      ),

    // Proportions
    SkeletonProportionsRequest: () =>
      this.rpc(O.RpcMessage.SkeletonConfigRequest, new O.SkeletonConfigRequestT()),
    SkeletonProportionsResetAllRequest: () => {
      this.rpc(O.RpcMessage.SkeletonResetAllRequest, new O.SkeletonResetAllRequestT());
      this.rpc(O.RpcMessage.SkeletonConfigRequest, new O.SkeletonConfigRequestT());
    },
    ChangeSkeletonProportionsRequest: (r: N.ChangeSkeletonProportionsRequestT) => {
      let bone: O.SkeletonBone | undefined;
      let value = r.value;
      if (
        r.bone === N.SkeletonBone.UPPER_WAIST ||
        r.bone === N.SkeletonBone.LOWER_WAIST
      ) {
        // Both halves make the v21 waist; kept here so two changes in a row
        // (grouped proportions) add up before the server answers
        this.waistHalves[r.bone === N.SkeletonBone.UPPER_WAIST ? 0 : 1] = r.value;
        bone = O.SkeletonBone.WAIST;
        value = this.waistHalves[0] + this.waistHalves[1];
      } else {
        bone = SKELETON_BONE_PAIRS.find(([, b]) => b === r.bone)?.[0];
      }
      if (bone === undefined) return;
      this.rpc(
        O.RpcMessage.ChangeSkeletonConfigRequest,
        make(O.ChangeSkeletonConfigRequestT, { bone, value })
      );
      this.rpc(O.RpcMessage.SkeletonConfigRequest, new O.SkeletonConfigRequestT());
    },

    // Serial and Wi-Fi
    OpenSerialRequest: (r: N.OpenSerialRequestT) =>
      this.rpc(
        O.RpcMessage.OpenSerialRequest,
        make(O.OpenSerialRequestT, { auto: !r.port, port: r.port })
      ),

    // Keybinds: v22 added NONE in front of the ids
    KeybindRequest: () =>
      this.rpc(O.RpcMessage.KeybindRequest, new O.KeybindRequestT()),
    ChangeKeybindRequest: (r: N.ChangeKeybindRequestT) =>
      this.rpc(
        O.RpcMessage.ChangeKeybindRequest,
        make(O.ChangeKeybindRequestT, {
          keybind: r.keybind
            ? make(O.KeybindT, {
                ...plain<Partial<O.KeybindT>>(r.keybind),
                keybindId: (r.keybind.keybindId - KEYBIND_SHIFT) as O.KeybindId,
              })
            : null,
        })
      ),

    // Unknown devices: v21 only tells when one says hello
    IgnoreUnknownDeviceRequest: (r: N.IgnoreUnknownDeviceRequestT) => {
      this.unknownDevices.delete(r.hardwareId?.toString() ?? '');
      this.emitUnknownDevices();
    },

    // Stay Aligned
    ResetStayAlignedRelaxedPoseRequest: (r: N.ResetStayAlignedRelaxedPoseRequestT) => {
      const pose = stayAlignedPoseToOld(r.pose);
      if (pose === null) return;
      this.rpc(
        O.RpcMessage.ResetStayAlignedRelaxedPoseRequest,
        make(O.ResetStayAlignedRelaxedPoseRequestT, { pose })
      );
      this.rpc(O.RpcMessage.SettingsRequest, new O.SettingsRequestT());
    },

    // v22 features the v21 server does not have: answered here
    SettingsDefaultsRequest: () =>
      this.reply(N.RpcMessage.SettingsDefaultsResponse, settingsDefaults()),
    ErrorReportingSettingsRequest: () =>
      this.reply(N.RpcMessage.ErrorReportingSettingsResponse, noErrorReporting()),
    ChangeErrorReportingSettingsRequest: () =>
      this.reply(N.RpcMessage.ErrorReportingSettingsResponse, noErrorReporting()),
    BodyPartPrerequisitesRequest: () =>
      this.reply(
        N.RpcMessage.BodyPartPrerequisitesResponse,
        make(N.BodyPartPrerequisitesResponseT, { parts: [] })
      ),
    DriverStatusRequest: () => this.emitDriverStatus(),
    VRCOSCStatusRequest: () => {
      const on = this.settings?.vrcOsc?.oscSettings?.enabled ?? false;
      this.reply(
        N.RpcMessage.VRCOSCStatusChangeResponse,
        make(N.VRCOSCStatusChangeResponseT, {
          inputState: on ? N.VRCOSCInputState.LISTENING : N.VRCOSCInputState.IDLE,
          outputState: on ? N.VRCOSCOutputState.READY : N.VRCOSCOutputState.IDLE,
        })
      );
    },
    VMCOSCStatusRequest: () => {
      const on = this.settings?.vmcOsc?.oscSettings?.enabled ?? false;
      this.reply(
        N.RpcMessage.VMCOSCStatusChangeResponse,
        make(N.VMCOSCStatusChangeResponseT, {
          inputState: on ? N.VMCOSCInputState.LISTENING : N.VMCOSCInputState.IDLE,
          outputState: on ? N.VMCOSCOutputState.READY : N.VMCOSCOutputState.IDLE,
        })
      );
    },
    StartStayAlignedStatusRequest: () =>
      this.reply(
        N.RpcMessage.StayAlignedStatusResponse,
        make(N.StayAlignedStatusResponseT, {
          enabled: this.settings?.stayAligned?.enabled ?? false,
        })
      ),
    StartWifiScanRequest: () =>
      this.reply(
        N.RpcMessage.WifiScanStatusResponse,
        make(N.WifiScanStatusResponseT, { status: N.WifiScanStatus.UNSUPPORTED })
      ),
    FirmwareUpdatesRequest: () =>
      this.reply(
        N.RpcMessage.FirmwareUpdatesResponse,
        make(N.FirmwareUpdatesResponseT, { devices: [] })
      ),
    // v21 records a relaxed pose at once: count down here first, like v22
    StartStayAlignedPoseRecordingRequest: (
      r: N.StartStayAlignedPoseRecordingRequestT
    ) => {
      const pose = stayAlignedPoseToOld(r.pose);
      if (pose === null) return;
      this.stopPoseRecording();
      const duration = 3; // seconds, like the v22 server
      const started = Date.now();
      let shown = 0;
      const status = (
        lifecycle: N.StayAlignedPoseRecordingLifecycle,
        progress: number
      ) =>
        this.emit(
          'rpc',
          N.RpcMessage.StayAlignedPoseRecordingStatusResponse,
          make(N.StayAlignedPoseRecordingStatusResponseT, {
            pose: r.pose,
            lifecycle,
            detailType: N.StayAlignedPoseRecordingDetail.StayAlignedPoseCountdown,
            detail: make(N.StayAlignedPoseCountdownT, { progress, duration }),
          })
        );
      status(N.StayAlignedPoseRecordingLifecycle.RUNNING, 0);
      this.poseRecording = setInterval(() => {
        const progress = Math.floor((Date.now() - started) / 1000);
        if (progress < duration) {
          if (progress !== shown)
            status(N.StayAlignedPoseRecordingLifecycle.RUNNING, progress);
          shown = progress;
          return;
        }
        this.stopPoseRecording();
        this.rpc(
          O.RpcMessage.DetectStayAlignedRelaxedPoseRequest,
          make(O.DetectStayAlignedRelaxedPoseRequestT, { pose })
        );
        this.rpc(O.RpcMessage.SettingsRequest, new O.SettingsRequestT());
        status(N.StayAlignedPoseRecordingLifecycle.DONE, duration);
      }, 100);
    },
    CancelStayAlignedPoseRecordingRequest: () => {
      if (!this.poseRecording) return;
      this.stopPoseRecording();
      this.reply(
        N.RpcMessage.StayAlignedPoseRecordingStatusResponse,
        make(N.StayAlignedPoseRecordingStatusResponseT, {
          lifecycle: N.StayAlignedPoseRecordingLifecycle.CANCELED,
        })
      );
    },

    // Profiles (kept by the interface, see profiles.ts)
    ProfilesRequest: () =>
      this.reply(N.RpcMessage.ProfilesResponse, this.profiles.response()),
    SwitchProfileRequest: (r: N.SwitchProfileRequestT) => {
      const name = r.name?.toString() ?? '';
      this.rememberProfile(r.kind);
      const status = this.profiles.switchTo(r.kind, name);
      if (status === N.ProfileOperationStatus.OK) this.applyProfile(r.kind);
      this.profileDone(status);
    },
    CreateProfileRequest: (r: N.CreateProfileRequestT) => {
      const from = r.copyFrom?.toString() ?? '';
      let copy: P.SettingsSnapshot | P.UserSnapshot | null;
      if (from && from === this.profiles.activeName(r.kind))
        copy = this.currentSnapshot(r.kind);
      else if (from) copy = this.profiles.get(r.kind, from);
      else
        copy =
          r.kind === N.ProfileKind.USER
            ? { parts: [], height: null }
            : P.PRESETS['Origine SlimeVR'];
      this.profileDone(
        copy
          ? this.profiles.create(r.kind, r.name?.toString() ?? '', copy)
          : N.ProfileOperationStatus.NOT_FOUND
      );
    },
    RenameProfileRequest: (r: N.RenameProfileRequestT) =>
      this.profileDone(
        this.profiles.rename(
          r.kind,
          r.name?.toString() ?? '',
          r.newName?.toString() ?? ''
        )
      ),
    DeleteProfileRequest: (r: N.DeleteProfileRequestT) =>
      this.profileDone(this.profiles.remove(r.kind, r.name?.toString() ?? '')),

    // Firmware updates over Wi-Fi or USB
    FirmwareUpdateRequest: (r: N.FirmwareUpdateRequestT) => {
      const method = r.method;
      let oldMethod: O.OTAFirmwareUpdateT | O.SerialFirmwareUpdateT | null = null;
      if (method instanceof N.OTAFirmwareUpdateT) {
        oldMethod = make(O.OTAFirmwareUpdateT, {
          deviceId: new O.DeviceIdT(method.deviceId),
          firmwarePart: method.firmwarePart
            ? make(O.FirmwarePartT, plain(method.firmwarePart))
            : null,
        });
      } else if (method instanceof N.SerialFirmwareUpdateT) {
        oldMethod = make(O.SerialFirmwareUpdateT, {
          deviceId: method.deviceId
            ? make(O.SerialDevicePortT, plain(method.deviceId))
            : null,
          needManualReboot: method.needManualReboot,
          ssid: method.ssid,
          password: method.password,
          firmwarePart: method.firmwarePart.map((p) => make(O.FirmwarePartT, plain(p))),
        });
      }
      if (!oldMethod) return;
      this.rpc(
        O.RpcMessage.FirmwareUpdateRequest,
        make(O.FirmwareUpdateRequestT, {
          methodType:
            oldMethod instanceof O.OTAFirmwareUpdateT
              ? O.FirmwareUpdateMethod.OTAFirmwareUpdate
              : O.FirmwareUpdateMethod.SerialFirmwareUpdate,
          method: oldMethod,
        })
      );
    },
  };

  // --- server -> interface ---------------------------------------------------

  incoming(bundle: O.MessageBundleT) {
    for (const header of bundle.dataFeedMsgs) {
      if (header.messageType !== O.DataFeedMessage.DataFeedUpdate) continue;
      const update = header.message as O.DataFeedUpdateT;
      if (update.index === 0) {
        this.lastFeed = update;
        const connected = this.isDriverConnected();
        if (connected !== this.driverConnected) {
          this.driverConnected = connected;
          this.emitDriverStatus();
        }
      }
      this.emit('feed', N.DataFeedMessage.DataFeedUpdate, feedUpdateToNew(update));
    }
    for (const header of bundle.rpcMsgs) {
      const name = O.RpcMessage[header.messageType];
      const message = header.message;
      if (!message) continue;
      if ((SAME_LAYOUT as readonly string[]).includes(name)) {
        const Target = (N as unknown as Record<string, Table<unknown>>)[name];
        this.emit(
          'rpc',
          N.RpcMessage[name as keyof typeof N.RpcMessage],
          transcode(message as Packable, Target)
        );
        continue;
      }
      const handler = this.responses[name];
      if (handler) handler(message as never);
    }
  }

  private emitSettings(s: O.SettingsResponseT) {
    const out: [N.RpcMessage, unknown][] = [
      [N.RpcMessage.SkeletonSettingsResponse, S.skeletonToNew(s)],
      [N.RpcMessage.UserHeightResponse, S.userHeightToNew(s)],
      [N.RpcMessage.DriverSettingsResponse, S.driverToNew(s)],
      [N.RpcMessage.ResetsSettingsResponse, S.resetsToNew(s)],
      [N.RpcMessage.TapDetectionSettingsResponse, S.tapToNew(s)],
      [N.RpcMessage.StayAlignedSettingsResponse, S.stayAlignedToNew(s)],
      [N.RpcMessage.VRCOSCSettingsResponse, S.vrcOscToNew(s)],
      [N.RpcMessage.VMCOSCSettingsResponse, S.vmcToNew(s)],
      [N.RpcMessage.VRMSettingsResponse, S.vrmToNew(s)],
      [N.RpcMessage.HIDSettingsResponse, S.hidToNew(s)],
      [N.RpcMessage.TimeoutSettingsResponse, S.timeoutToNew(s)],
      [N.RpcMessage.BoneRoutingSettingsResponse, S.routingToNew(s)],
      [
        N.RpcMessage.StayAlignedStatusResponse,
        make(N.StayAlignedStatusResponseT, {
          enabled: s.stayAligned?.enabled ?? false,
        }),
      ],
    ];
    for (const [type, data] of out) this.reply(type, data);
  }

  private currentSnapshot(
    kind: N.ProfileKind
  ): P.SettingsSnapshot | P.UserSnapshot | null {
    if (kind === N.ProfileKind.SETTINGS)
      return this.settings ? P.snapshotSettings(this.settings) : null;
    if (kind === N.ProfileKind.USER && this.skeletonParts.length)
      return P.snapshotUser(
        this.skeletonParts,
        this.settings?.modelSettings?.skeletonHeight?.hmdHeight ?? null
      );
    return null;
  }

  private rememberProfile(kind: N.ProfileKind) {
    const snapshot = this.currentSnapshot(kind);
    if (snapshot) this.profiles.remember(kind, snapshot);
  }

  private applyProfile(kind: N.ProfileKind) {
    const snapshot = this.profiles.get(kind, this.profiles.activeName(kind));
    if (!snapshot) return;
    if (kind === N.ProfileKind.SETTINGS) {
      this.changeSettings(P.settingsRequest(snapshot as P.SettingsSnapshot));
      return;
    }
    const user = snapshot as P.UserSnapshot;
    if (!user.parts.length)
      this.rpc(O.RpcMessage.SkeletonResetAllRequest, new O.SkeletonResetAllRequestT());
    for (const [bone, value] of user.parts)
      this.rpc(
        O.RpcMessage.ChangeSkeletonConfigRequest,
        make(O.ChangeSkeletonConfigRequestT, { bone, value })
      );
    if (user.height !== null)
      this.changeSettings({
        modelSettings: make(O.ModelSettingsT, {
          skeletonHeight: make(O.SkeletonHeightT, {
            hmdHeight: user.height,
            floorHeight: this.settings?.modelSettings?.skeletonHeight?.floorHeight ?? 0,
          }),
        }),
      });
    this.rpc(O.RpcMessage.SkeletonConfigRequest, new O.SkeletonConfigRequestT());
  }

  private profileDone(status: N.ProfileOperationStatus) {
    this.reply(
      N.RpcMessage.ProfileOperationResponse,
      make(N.ProfileOperationResponseT, { status })
    );
    this.reply(N.RpcMessage.ProfilesResponse, this.profiles.response());
  }

  // v21 does not report the driver: an HMD seen by the server comes from it
  private isDriverConnected() {
    return (
      this.lastFeed?.devices.some(
        (d) => !d.hardwareInfo?.ipAddress && d.trackers.some((t) => t.info?.isHmd)
      ) ?? false
    );
  }

  private emitDriverStatus() {
    this.reply(
      N.RpcMessage.DriverStatusChangeResponse,
      make(N.DriverStatusChangeResponseT, {
        state: this.isDriverConnected()
          ? N.DriverConnectionState.CONNECTED
          : N.DriverConnectionState.WAITING,
      })
    );
  }

  private emitUnknownDevices() {
    this.reply(
      N.RpcMessage.UnknownDevicesResponse,
      make(N.UnknownDevicesResponseT, { devices: [...this.unknownDevices.values()] })
    );
  }

  private responses: Record<string, (message: never) => void> = {
    SettingsResponse: (s: O.SettingsResponseT) => {
      // v21 also sends partial settings (only SteamVR) when trackers change
      const merged = this.settings ?? new O.SettingsResponseT();
      for (const [key, value] of Object.entries(s)) {
        if (value !== null) (merged as unknown as Record<string, unknown>)[key] = value;
      }
      this.settings = merged;
      // First start: the server has the SlimeVR defaults, use the VitalVR
      // starting profile instead
      if (!this.profiles.applied && merged.modelSettings) {
        this.profiles.markApplied();
        this.applyProfile(N.ProfileKind.SETTINGS);
      }
      this.emitSettings(merged);
    },
    ResetResponse: (r: O.ResetResponseT) =>
      this.emit(
        'rpc',
        N.RpcMessage.ResetStatusResponse,
        make(N.ResetStatusResponseT, {
          resetType: r.resetType as unknown as N.ResetType,
          lifecycle:
            r.status === O.ResetStatus.FINISHED
              ? N.ResetLifecycle.DONE
              : N.ResetLifecycle.RUNNING,
          bodyParts: r.bodyParts.map(bodyPartToNew),
          detailType: N.ResetDetail.CountdownDetail,
          detail: make(N.CountdownDetailT, {
            progress: r.progress,
            duration: r.duration,
          }),
        })
      ),
    SkeletonConfigResponse: (r: O.SkeletonConfigResponseT) => {
      this.skeletonParts = r.skeletonParts;
      const waist =
        r.skeletonParts.find((p) => p.bone === O.SkeletonBone.WAIST)?.value ?? 0;
      if (Math.abs(this.waistHalves[0] + this.waistHalves[1] - waist) > 1e-4)
        this.waistHalves = [waist / 2, waist / 2];
      this.emit(
        'rpc',
        N.RpcMessage.SkeletonProportionsResponse,
        make(N.SkeletonProportionsResponseT, {
          skeletonParts: skeletonPartsToNew(r.skeletonParts, this.waistHalves),
          skeletonHeight: r.userHeight,
        })
      );
    },
    AutoBoneEpochResponse: (r: O.AutoBoneEpochResponseT) =>
      this.emit(
        'rpc',
        N.RpcMessage.AutoBoneEpochResponse,
        make(N.AutoBoneEpochResponseT, {
          currentEpoch: r.currentEpoch,
          totalEpochs: r.totalEpochs,
          epochError: r.epochError,
          adjustedSkeletonParts: skeletonPartsToNew(r.adjustedSkeletonParts),
        })
      ),
    AutoBoneProcessStatusResponse: (r: O.AutoBoneProcessStatusResponseT) =>
      this.emit(
        'rpc',
        N.RpcMessage.AutoBoneProcessStatusResponse,
        make(N.AutoBoneProcessStatusResponseT, {
          processType: r.processType as unknown as N.AutoBoneProcessType,
          current: r.current,
          total: r.total,
          completed: r.completed,
          success: r.success,
          eta: r.eta,
        })
      ),
    MagToggleResponse: (r: O.MagToggleResponseT) =>
      this.emit(
        'rpc',
        N.RpcMessage.MagToggleResponse,
        make(N.MagToggleResponseT, {
          trackerId: trackerIdToNew(r.trackerId),
          enable: r.enable,
        })
      ),
    TapDetectionSetupNotification: (r: O.TapDetectionSetupNotificationT) =>
      this.emit(
        'rpc',
        N.RpcMessage.TapDetectionSetupNotification,
        make(N.TapDetectionSetupNotificationT, {
          trackerId: trackerIdToNew(r.trackerId),
        })
      ),
    KeybindResponse: (r: O.KeybindResponseT) => {
      const keybind = (k: O.KeybindT) =>
        make(N.KeybindT, {
          ...plain<Partial<N.KeybindT>>(k),
          keybindId: (k.keybindId + KEYBIND_SHIFT) as N.KeybindId,
        });
      this.emit(
        'rpc',
        N.RpcMessage.KeybindResponse,
        make(N.KeybindResponseT, {
          keybind: r.keybind.map(keybind),
          defaultKeybinds: r.defaultKeybinds.map(keybind),
          support: N.KeybindSupport.APP_MANAGED,
        })
      );
    },
    VRCConfigStateChangeResponse: (r: O.VRCConfigStateChangeResponseT) =>
      this.emit('rpc', N.RpcMessage.VRCConfigStateChangeResponse, plain(r)),
    SerialUpdateResponse: (r: O.SerialUpdateResponseT) =>
      this.emit(
        'rpc',
        N.RpcMessage.SerialUpdateResponse,
        make(N.SerialUpdateResponseT, {
          status: r.closed ? N.SerialConsoleStatus.WAITING : N.SerialConsoleStatus.OPEN,
          device: r.device ? make(N.SerialDeviceT, plain(r.device)) : null,
          log: r.log,
        })
      ),
    WifiProvisioningStatusResponse: (r: O.WifiProvisioningStatusResponseT) => {
      const status = WIFI_STATUS[r.status];
      this.emit(
        'rpc',
        N.RpcMessage.WifiProvisioningStatusResponse,
        make(N.WifiProvisioningStatusResponseT, {
          trackers:
            status === undefined
              ? []
              : [
                  make(N.TrackerProvisioningStateT, {
                    port: null,
                    macAddress: null,
                    status,
                  }),
                ],
        })
      );
    },
    UnknownDeviceHandshakeNotification: (r: O.UnknownDeviceHandshakeNotificationT) => {
      const id = r.macAddress?.toString() ?? '';
      if (!id || this.unknownDevices.has(id)) return;
      this.unknownDevices.set(id, make(N.UnknownDeviceT, { hardwareId: id }));
      this.emitUnknownDevices();
    },
    FirmwareUpdateStatusResponse: (r: O.FirmwareUpdateStatusResponseT) => {
      const id = r.deviceId;
      this.emit(
        'rpc',
        N.RpcMessage.FirmwareUpdateStatusResponse,
        make(N.FirmwareUpdateStatusResponseT, {
          deviceIdType:
            id instanceof O.SerialDevicePortT
              ? N.FirmwareUpdateDeviceId.SerialDevicePort
              : N.FirmwareUpdateDeviceId.FirmwareDeviceIdTable,
          deviceId:
            id instanceof O.SerialDevicePortT
              ? make(N.SerialDevicePortT, plain(id))
              : make(N.FirmwareDeviceIdTableT, {
                  id: (id as O.DeviceIdTableT | null)?.id?.id ?? 0,
                }),
          status: r.status as unknown as N.FirmwareUpdateStatus,
          progress: r.progress ?? undefined,
        })
      );
    },
  };
}

// Defaults of the v21 server (its config classes), shown as v22 defaults
function settingsDefaults(): N.SettingsDefaultsResponseT {
  const d = make(O.SettingsResponseT, {
    steamVrTrackers: make(O.SteamVRTrackersSettingT, {
      waist: true,
      chest: true,
      leftFoot: true,
      rightFoot: true,
      automaticTrackerToggle: true,
    }),
    filtering: make(O.FilteringSettingsT, {
      type: O.FilteringType.PREDICTION,
      amount: 0.2,
    }),
    modelSettings: make(O.ModelSettingsT, {
      toggles: make(O.ModelTogglesT, {
        floorClip: true,
        skatingCorrection: true,
        toeSnap: false,
        footPlant: true,
        selfLocalization: false,
        usePosition: true,
        enforceConstraints: true,
      }),
      ratios: make(O.ModelRatiosT, {
        imputeWaistFromChestHip: 0.3,
        interpKneeTrackerAnkle: 0.85,
      }),
      legTweaks: make(O.LegTweaksSettingsT, { correctionStrength: 0.3 }),
    }),
    tapDetectionSettings: make(O.TapDetectionSettingsT, {
      yawResetDelay: 0.2,
      fullResetDelay: 1,
      mountingResetDelay: 1,
      yawResetEnabled: true,
      fullResetEnabled: true,
      mountingResetEnabled: true,
      yawResetTaps: 2,
      fullResetTaps: 3,
      mountingResetTaps: 3,
      numberTrackersOverThreshold: 1,
      yawResetTracker: O.BodyPart.CHEST,
      fullResetTracker: O.BodyPart.LEFT_UPPER_LEG,
      mountingResetTracker: O.BodyPart.RIGHT_UPPER_LEG,
    }),
    resetsSettings: make(O.ResetsSettingsT, {}),
    stayAligned: make(O.StayAlignedSettingsT, {}),
    vrcOsc: make(O.VRCOSCSettingsT, {
      oscSettings: make(O.OSCSettingsT, {
        portIn: 9001,
        portOut: 9000,
        address: '127.0.0.1',
      }),
      trackers: make(O.OSCTrackersSettingT, { waist: true, feet: true }),
      oscqueryEnabled: true,
    }),
    vmcOsc: make(O.VMCOSCSettingsT, {
      oscSettings: make(O.OSCSettingsT, {
        portIn: 39540,
        portOut: 39539,
        address: '127.0.0.1',
      }),
      anchorHip: true,
    }),
    hidSettings: make(O.HIDSettingsT, {}),
    timeout: make(O.TimeoutSettingsT, { duration: 3 }),
    velocitySettings: make(O.VelocitySettingsT, {}),
  });
  return make(N.SettingsDefaultsResponseT, {
    skeleton: S.skeletonToNew(d),
    resets: S.resetsToNew(d),
    stayAligned: S.stayAlignedToNew(d),
    tapDetection: S.tapToNew(d),
    timeout: S.timeoutToNew(d),
    hid: S.hidToNew(d),
    driver: S.driverToNew(d),
    vrcosc: S.vrcOscToNew(d),
    vmcosc: S.vmcToNew(d),
    vrm: S.vrmToNew(d),
    boneRouting: S.routingToNew(d),
    errorReporting: noErrorReporting(),
    mag: make(N.MagToggleResponseT, { trackerId: 0, enable: false }),
  });
}

// VitalVR never sends crash reports
function noErrorReporting() {
  return make(N.ErrorReportingSettingsResponseT, {
    consent: N.ErrorReportingConsent.DENIED,
    userId: '',
    sessionId: '',
  });
}

const WIFI_STATUS: Partial<
  Record<O.WifiProvisioningStatus, N.TrackerProvisioningStatus>
> = {
  [O.WifiProvisioningStatus.SERIAL_INIT]: N.TrackerProvisioningStatus.SERIAL_INIT,
  [O.WifiProvisioningStatus.OBTAINING_MAC_ADDRESS]:
    N.TrackerProvisioningStatus.OBTAINING_MAC_ADDRESS,
  [O.WifiProvisioningStatus.PROVISIONING]: N.TrackerProvisioningStatus.PROVISIONING,
  [O.WifiProvisioningStatus.CONNECTING]: N.TrackerProvisioningStatus.CONNECTING,
  [O.WifiProvisioningStatus.CONNECTION_ERROR]:
    N.TrackerProvisioningStatus.CONNECTION_ERROR,
  [O.WifiProvisioningStatus.LOOKING_FOR_SERVER]:
    N.TrackerProvisioningStatus.LOOKING_FOR_SERVER,
  [O.WifiProvisioningStatus.COULD_NOT_FIND_SERVER]:
    N.TrackerProvisioningStatus.COULD_NOT_FIND_SERVER,
  [O.WifiProvisioningStatus.DONE]: N.TrackerProvisioningStatus.DONE,
  [O.WifiProvisioningStatus.NO_SERIAL_LOGS_ERROR]:
    N.TrackerProvisioningStatus.NO_SERIAL_LOGS_ERROR,
};

function stayAlignedPoseToOld(
  pose: N.StayAlignedRelaxedPose
): O.StayAlignedRelaxedPose | null {
  if (pose === N.StayAlignedRelaxedPose.STANDING)
    return O.StayAlignedRelaxedPose.STANDING;
  if (pose === N.StayAlignedRelaxedPose.SITTING)
    return O.StayAlignedRelaxedPose.SITTING;
  if (pose === N.StayAlignedRelaxedPose.FLAT) return O.StayAlignedRelaxedPose.FLAT;
  return null;
}
