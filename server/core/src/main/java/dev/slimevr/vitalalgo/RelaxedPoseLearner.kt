package dev.slimevr.vitalalgo

import dev.slimevr.config.StayAlignedConfig
import dev.slimevr.config.StayAlignedRelaxedPoseConfig
import dev.slimevr.tracking.processor.skeleton.HumanSkeleton
import dev.slimevr.tracking.processor.stayaligned.poses.PlayerPose
import dev.slimevr.tracking.processor.stayaligned.poses.RelaxedPose
import dev.slimevr.tracking.processor.stayaligned.trackers.RestDetector
import io.eiren.util.logging.LogManager
import kotlin.math.abs

/**
 * Vital Algo: learns how the player naturally stands and sits (the relaxed
 * poses Stay Aligned pulls the legs towards) from their own still moments,
 * instead of one recording. Samples are only taken shortly after a reset,
 * before the trackers drift, so the learned pose never takes in drift.
 */
class RelaxedPoseLearner(private val saveConfig: () -> Unit) {
	private var lastResetNanos: Long? = null
	private var sampledThisRest = false
	private var dirty = false
	private var lastSaveNanos = 0L

	fun onReset(now: Long = System.nanoTime()) {
		lastResetNanos = now
		sampledThisRest = false
	}

	fun update(skeleton: HumanSkeleton, config: StayAlignedConfig, now: Long = System.nanoTime()) {
		if (dirty && now - lastSaveNanos > SAVE_EVERY_NANOS) {
			dirty = false
			lastSaveNanos = now
			saveConfig()
		}
		if (!config.enabled) return
		val reset = lastResetNanos ?: return
		if (now - reset > LEARN_WINDOW_NANOS) return

		val trackers = skeleton.trackerSkeleton
		if (trackers.leftUpperLeg == null || trackers.rightUpperLeg == null) return
		val still = trackers.allTrackers
			.filter { it.isImu() }
			.all { it.stayAligned.restDetector.state == RestDetector.State.AT_REST }
		if (!still) {
			sampledThisRest = false
			return
		}
		// One sample per still moment
		if (sampledThisRest) return
		sampledThisRest = true

		val pose = PlayerPose.ofTrackers(trackers)
		val poseConfig = when (pose) {
			PlayerPose.STANDING -> config.standingRelaxedPose
			PlayerPose.SITTING_IN_CHAIR -> config.sittingRelaxedPose
			else -> return
		}
		val sample = RelaxedPose.fromTrackers(skeleton)
		if (learn(poseConfig, sample.upperLeg.toDeg(), sample.lowerLeg.toDeg(), sample.foot.toDeg())) {
			dirty = true
			LogManager.info("[VitalAlgo] Learned relaxed pose $pose: $sample")
		}
	}

	companion object {
		// Learn during the first minutes after a reset only
		private const val LEARN_WINDOW_NANOS = 3 * 60 * 1_000_000_000L
		private const val SAVE_EVERY_NANOS = 60 * 1_000_000_000L

		// Weight of a new sample in the learned pose
		const val LEARN_RATE = 0.2f

		// A stance wider than this is a dance or stretching pose, not a relaxed one
		const val MAX_ANGLE_DEG = 25f

		/** Moves the pose towards the sample. Returns false if the sample was refused. */
		fun learn(pose: StayAlignedRelaxedPoseConfig, upperLeg: Float, lowerLeg: Float, foot: Float): Boolean {
			if (abs(upperLeg) > MAX_ANGLE_DEG || abs(lowerLeg) > MAX_ANGLE_DEG || abs(foot) > MAX_ANGLE_DEG) {
				return false
			}
			if (!pose.enabled) {
				pose.enabled = true
				pose.upperLegAngleInDeg = upperLeg
				pose.lowerLegAngleInDeg = lowerLeg
				pose.footAngleInDeg = foot
				return true
			}
			pose.upperLegAngleInDeg += (upperLeg - pose.upperLegAngleInDeg) * LEARN_RATE
			pose.lowerLegAngleInDeg += (lowerLeg - pose.lowerLegAngleInDeg) * LEARN_RATE
			pose.footAngleInDeg += (foot - pose.footAngleInDeg) * LEARN_RATE
			return true
		}
	}
}
