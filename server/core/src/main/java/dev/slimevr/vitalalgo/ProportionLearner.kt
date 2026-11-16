package dev.slimevr.vitalalgo

import dev.slimevr.VRServer
import dev.slimevr.autobone.AutoBone
import dev.slimevr.poseframeformat.PoseRecorder
import io.eiren.util.logging.LogManager
import kotlin.concurrent.thread
import kotlin.math.abs
import kotlin.math.max

/**
 * Vital Algo: keeps refining the body proportions while the player uses VR.
 * Every few minutes, when the player is standing, it records 20 seconds of
 * movement, fits the proportions to it with AutoBone (the same solver as the
 * automatic proportions page) and moves the current proportions a small step
 * towards the result. A bad fit (sitting, on the floor, lost trackers) is
 * thrown away by AutoBone's own error check.
 */
class ProportionLearner(private val server: VRServer) {
	private val recorder = PoseRecorder(server)
	private val autoBone by lazy { AutoBone(server) }

	fun start() {
		thread(isDaemon = true, name = "VitalAlgo proportions", priority = Thread.MIN_PRIORITY) {
			Thread.sleep(FIRST_DELAY_MS)
			while (true) {
				try {
					learnOnce()
				} catch (e: InterruptedException) {
					return@thread
				} catch (e: Exception) {
					LogManager.info("[VitalAlgo] Proportions not learned this time: ${e.message}")
				}
				Thread.sleep(INTERVAL_MS)
			}
		}
	}

	private fun learnOnce() {
		val height = server.configManager.vrConfig.skeleton.userHeight
		if (height < MIN_USER_HEIGHT) return
		if (!isStanding(height) || !hasLegTrackers() || !recorder.isReadyToRecord) return

		val frames = recorder.startFrameRecording(SAMPLE_COUNT, SAMPLE_SECONDS).get()
		if (!isStanding(height)) return

		val results = autoBone.processFrames(frames)
		if (results.heightDifference > MAX_HEIGHT_ERROR) {
			LogManager.info("[VitalAlgo] Proportions fit refused, height off by ${results.heightDifference} m")
			return
		}

		server.queueTask {
			val poseManager = server.humanPoseManager
			val changes = StringBuilder()
			for ((offset, learned) in results.configValues) {
				val current = poseManager.getOffset(offset)
				val next = blend(current, learned)
				if (next == current) continue
				poseManager.setOffset(offset, next)
				changes.append(" ${offset.configKey} ${"%.1f".format(current * 100)}->${"%.1f".format(next * 100)} cm")
			}
			poseManager.saveConfig()
			server.configManager.saveConfig()
			LogManager.info("[VitalAlgo] Learned proportions:$changes")
		}
	}

	private fun isStanding(height: Float): Boolean {
		val head = server.humanPoseManager.skeleton.headTracker ?: return false
		if (!head.hasPosition) return false
		val floor = server.configManager.vrConfig.skeleton.floorHeight
		return head.position.y - floor > height * STANDING_RATIO
	}

	private fun hasLegTrackers(): Boolean = with(server.humanPoseManager.skeleton) {
		leftUpperLegTracker != null &&
			rightUpperLegTracker != null &&
			leftLowerLegTracker != null &&
			rightLowerLegTracker != null &&
			(hipTracker != null || waistTracker != null || chestTracker != null)
	}

	companion object {
		private const val FIRST_DELAY_MS = 5 * 60 * 1000L
		private const val INTERVAL_MS = 10 * 60 * 1000L

		// 500 samples, 40 ms apart: 20 seconds of movement
		private const val SAMPLE_COUNT = 500
		private const val SAMPLE_SECONDS = 0.04f
		private const val MIN_USER_HEIGHT = 1.0f
		private const val STANDING_RATIO = 0.85f
		private const val MAX_HEIGHT_ERROR = 0.05f

		// Each fit moves the proportions a third of the way, by 2 % at most
		const val BLEND = 0.3f
		const val MAX_STEP_RATIO = 0.02f
		const val MIN_STEP = 0.002f

		fun blend(current: Float, learned: Float): Float {
			val maxStep = max(abs(current) * MAX_STEP_RATIO, MIN_STEP)
			return current + ((learned - current) * BLEND).coerceIn(-maxStep, maxStep)
		}
	}
}
