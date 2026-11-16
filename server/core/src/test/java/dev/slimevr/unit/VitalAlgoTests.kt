package dev.slimevr.unit

import dev.slimevr.config.StayAlignedRelaxedPoseConfig
import dev.slimevr.vitalalgo.ProportionLearner
import dev.slimevr.vitalalgo.RelaxedPoseLearner
import org.junit.jupiter.api.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class VitalAlgoTests {

	@Test
	fun proportionStepIsSmallAndBounded() {
		// A third of the way, but never more than 2 % of the bone in one fit
		assertEquals(0.403f, ProportionLearner.blend(0.40f, 0.41f), 1e-6f)
		assertEquals(0.4080f, ProportionLearner.blend(0.40f, 0.60f), 1e-6f)
		assertEquals(0.3920f, ProportionLearner.blend(0.40f, 0.10f), 1e-6f)
		// Tiny bones still move a little
		assertEquals(0.012f, ProportionLearner.blend(0.01f, 0.10f), 1e-6f)
		assertEquals(0.40f, ProportionLearner.blend(0.40f, 0.40f))
	}

	@Test
	fun firstRelaxedSampleIsTakenAsIs() {
		val pose = StayAlignedRelaxedPoseConfig()
		assertTrue(RelaxedPoseLearner.learn(pose, 4f, 2f, -3f))
		assertTrue(pose.enabled)
		assertEquals(4f, pose.upperLegAngleInDeg)
		assertEquals(-3f, pose.footAngleInDeg)
	}

	@Test
	fun relaxedPoseMovesTowardsSamples() {
		val pose = StayAlignedRelaxedPoseConfig()
		RelaxedPoseLearner.learn(pose, 0f, 0f, 0f)
		RelaxedPoseLearner.learn(pose, 10f, 5f, -5f)
		assertEquals(2f, pose.upperLegAngleInDeg, 1e-6f)
		assertEquals(1f, pose.lowerLegAngleInDeg, 1e-6f)
		assertEquals(-1f, pose.footAngleInDeg, 1e-6f)
	}

	@Test
	fun wideStanceIsNotLearned() {
		val pose = StayAlignedRelaxedPoseConfig()
		assertFalse(RelaxedPoseLearner.learn(pose, 40f, 0f, 0f))
		assertFalse(pose.enabled)
	}
}
