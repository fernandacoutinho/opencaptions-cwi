/**
 * @opencaptions/pipeline — Unit tests for RulesMapper and helper functions
 */

import { describe, expect, test } from "bun:test";
import type { DiarizedWord, IntentFrame, Speaker, WordIntent } from "@opencaptions/types";
import { SPEAKER_COLORS } from "@opencaptions/types";
import { assignSpeakerColors, computeVoiceProfile, lerp, rulesMapper } from "./index";

// ============================================================================
// lerp
// ============================================================================

describe("lerp", () => {
	test("t=0 returns a", () => {
		expect(lerp(0, 100, 0)).toBe(0);
	});

	test("t=1 returns b", () => {
		expect(lerp(0, 100, 1)).toBe(100);
	});

	test("t=0.5 returns midpoint", () => {
		expect(lerp(0, 100, 0.5)).toBe(50);
	});

	test("non-zero a with t=0 returns a", () => {
		expect(lerp(200, 700, 0)).toBe(200);
	});

	test("non-zero a with t=1 returns b", () => {
		expect(lerp(200, 700, 1)).toBe(700);
	});

	test("clamps t < 0 to 0", () => {
		expect(lerp(0, 100, -0.5)).toBe(0);
	});

	test("clamps t > 1 to 1", () => {
		expect(lerp(0, 100, 1.5)).toBe(100);
	});
});

// ============================================================================
// assignSpeakerColors
// ============================================================================

describe("assignSpeakerColors", () => {
	test("1 speaker gets the first palette color", () => {
		const map = assignSpeakerColors(["S1"]);
		expect(map.get("S1")).toBe(SPEAKER_COLORS[0]);
	});

	test("3 speakers each get a different color", () => {
		const map = assignSpeakerColors(["S1", "S2", "S3"]);
		const colors = [...map.values()];
		expect(colors[0]).toBe(SPEAKER_COLORS[0]);
		expect(colors[1]).toBe(SPEAKER_COLORS[1]);
		expect(colors[2]).toBe(SPEAKER_COLORS[2]);
		// All distinct
		const unique = new Set(colors);
		expect(unique.size).toBe(3);
	});

	test("13 speakers wraps around the 12-color palette", () => {
		const ids = Array.from({ length: 13 }, (_, i) => `S${i}`);
		const map = assignSpeakerColors(ids);
		// 13th speaker (index 12) wraps to palette index 0
		expect(map.get("S12")).toBe(SPEAKER_COLORS[0]);
		// First speaker also has palette index 0
		expect(map.get("S0")).toBe(SPEAKER_COLORS[0]);
	});
});

// ============================================================================
// computeVoiceProfile
// ============================================================================

describe("computeVoiceProfile", () => {
	test("computes correct baseline, p10, and p90 for a single speaker", () => {
		const frames: IntentFrame[] = [
			makeFrame("S1", { pitch_mean_hz: 100, volume_mean_db: -20 }),
			makeFrame("S1", { pitch_mean_hz: 200, volume_mean_db: -10 }),
			makeFrame("S1", { pitch_mean_hz: 150, volume_mean_db: -15 }),
		];
		const profile = computeVoiceProfile(frames, "S1");
		expect(profile.pitch_baseline_hz).toBe(150);
		expect(profile.volume_baseline_db).toBe(-15);
		// p10 and p90 should bracket the range
		expect(profile.pitch_p10).toBeLessThanOrEqual(profile.pitch_baseline_hz);
		expect(profile.pitch_p90).toBeGreaterThanOrEqual(profile.pitch_baseline_hz);
	});

	test("filters frames by speaker_id", () => {
		const frames: IntentFrame[] = [
			makeFrame("S1", { pitch_mean_hz: 200, volume_mean_db: -20 }),
			makeFrame("S2", { pitch_mean_hz: 100, volume_mean_db: -10 }),
		];
		const profile = computeVoiceProfile(frames, "S1");
		// Should only use S1's frame
		expect(profile.pitch_baseline_hz).toBe(200);
		expect(profile.volume_baseline_db).toBe(-20);
	});
});

// ============================================================================
// rulesMapper
// ============================================================================

describe("rulesMapper", () => {
	const defaultSpeaker: Speaker = {
		id: "S1",
		name: "Test Speaker",
		color: "#6B8AFF",
		voice_profile: {
			pitch_baseline_hz: 150,
			pitch_p10: 100,
			pitch_p90: 200,
			volume_baseline_db: -20,
			volume_p10: -30,
			volume_p90: -10,
		},
	};

	const defaultWord: DiarizedWord = {
		text: "hello",
		start: 1.0,
		end: 1.5,
		confidence: 0.95,
		speaker_id: "S1",
	};

	describe("pitch -> weight mapping", () => {
		test("pitch_normalized=0 produces weight near 200", () => {
			const frame = makeFrame("S1", { pitch_normalized: 0 });
			const result = rulesMapper(defaultWord, frame, defaultSpeaker);
			expect(result.weight).toBe(200);
		});

		test("pitch_normalized=1 produces weight near 700", () => {
			const frame = makeFrame("S1", { pitch_normalized: 1 });
			const result = rulesMapper(defaultWord, frame, defaultSpeaker);
			expect(result.weight).toBe(700);
		});

		test("pitch_normalized=0.5 produces weight near 450 (rounded to 500)", () => {
			const frame = makeFrame("S1", { pitch_normalized: 0.5 });
			const result = rulesMapper(defaultWord, frame, defaultSpeaker);
			// lerp(200, 700, 0.5) = 450, rounded to nearest 100 = 500
			expect(result.weight).toBe(500);
		});
	});

	describe("volume -> size mapping", () => {
		test("volume_normalized=0 produces size near 0.8", () => {
			const frame = makeFrame("S1", { volume_normalized: 0 });
			const result = rulesMapper(defaultWord, frame, defaultSpeaker);
			expect(result.size).toBeCloseTo(0.8, 2);
		});

		test("volume_normalized=1 produces size near 1.35", () => {
			const frame = makeFrame("S1", { volume_normalized: 1 });
			const result = rulesMapper(defaultWord, frame, defaultSpeaker);
			expect(result.size).toBeCloseTo(1.35, 2);
		});
	});

	describe("emphasis detection", () => {
		test("volume_normalized > 0.85 triggers emphasis", () => {
			const frame = makeFrame("S1", { volume_normalized: 0.9 });
			const result = rulesMapper(defaultWord, frame, defaultSpeaker);
			expect(result.emphasis).toBe(true);
		});

		test("volume_normalized <= 0.85 does not trigger emphasis alone", () => {
			const frame = makeFrame("S1", { volume_normalized: 0.5 });
			const word: DiarizedWord = { ...defaultWord, text: "ordinary" };
			const result = rulesMapper(word, frame, defaultSpeaker);
			expect(result.emphasis).toBe(false);
		});

		test("word in emphasis_words list triggers emphasis", () => {
			const frame = makeFrame("S1", {
				volume_normalized: 0.3,
				emphasis_words: ["hello"],
			});
			const result = rulesMapper(defaultWord, frame, defaultSpeaker);
			expect(result.emphasis).toBe(true);
		});
	});

	describe("word overrides", () => {
		test("weight_override takes precedence over frame-derived weight", () => {
			const frame = makeFrame("S1", { pitch_normalized: 0 });
			const override: WordIntent = {
				word_index: 0,
				weight_override: 600,
			};
			const result = rulesMapper(defaultWord, frame, defaultSpeaker, override);
			expect(result.weight).toBe(600);
		});

		test("size_override takes precedence over frame-derived size", () => {
			const frame = makeFrame("S1", { volume_normalized: 0 });
			const override: WordIntent = {
				word_index: 0,
				size_override: 1.3,
			};
			const result = rulesMapper(defaultWord, frame, defaultSpeaker, override);
			expect(result.size).toBe(1.3);
		});

		test("emphasis override takes precedence over frame values", () => {
			const frame = makeFrame("S1", { volume_normalized: 0.3 });
			const override: WordIntent = {
				word_index: 0,
				emphasis: true,
			};
			const result = rulesMapper(defaultWord, frame, defaultSpeaker, override);
			expect(result.emphasis).toBe(true);
		});
	});
});

// ============================================================================
// Helpers
// ============================================================================

/**
 * Build a minimal IntentFrame for testing.
 * Accepts partial vocal/semantic overrides so tests only specify what matters.
 */
function makeFrame(
	speakerId: string,
	overrides: {
		pitch_mean_hz?: number;
		pitch_normalized?: number;
		volume_mean_db?: number;
		volume_normalized?: number;
		emphasis_words?: string[];
	} = {},
): IntentFrame {
	return {
		id: crypto.randomUUID(),
		speaker_id: speakerId,
		start: 0,
		end: 5,
		vocal: {
			pitch_mean_hz: overrides.pitch_mean_hz ?? 150,
			pitch_normalized: overrides.pitch_normalized ?? 0.5,
			volume_mean_db: overrides.volume_mean_db ?? -20,
			volume_normalized: overrides.volume_normalized ?? 0.5,
			speech_rate_wpm: 130,
			pause_before_ms: 0,
			pause_after_ms: 0,
		},
		affect: {
			valence: 0,
			arousal: 0.5,
			dominant_emotion: "neutral",
			confidence: 0.9,
		},
		semantic: {
			sarcasm_probability: 0,
			emphasis_words: overrides.emphasis_words ?? [],
		},
		word_overrides: [],
		extractor_id: "test",
		extractor_version: "0.1.0",
	};
}
