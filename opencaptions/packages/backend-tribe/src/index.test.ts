import { describe, expect, test } from "bun:test";
import type {
	DiarizedTranscript,
	DiarizedWord,
	IntentFrame,
	NeuralPrediction,
	Speaker,
	VideoInput,
} from "@opencaptions/types";
import { SPEAKER_COLORS } from "@opencaptions/types";
import { TribeExtractorBackend, createTribeBackend, neuralMapper } from "./index";

// ============================================================================
// Mock data
// ============================================================================

const mockTranscript: DiarizedTranscript = {
	words: [
		{ text: "Where", start: 0.0, end: 0.18, confidence: 0.99, speaker_id: "S0" },
		{ text: "were", start: 0.18, end: 0.34, confidence: 0.99, speaker_id: "S0" },
		{ text: "you", start: 0.34, end: 0.5, confidence: 0.99, speaker_id: "S0" },
		{ text: "last", start: 0.5, end: 0.76, confidence: 0.99, speaker_id: "S0" },
		{ text: "night?", start: 0.76, end: 1.08, confidence: 0.99, speaker_id: "S0" },
		// 0.5s pause
		{ text: "I", start: 1.6, end: 1.86, confidence: 0.99, speaker_id: "S0" },
		{ text: "was", start: 1.86, end: 2.1, confidence: 0.99, speaker_id: "S0" },
		{ text: "working", start: 2.1, end: 2.46, confidence: 0.99, speaker_id: "S0" },
	],
	segments: [{ speaker_id: "S0", start: 0, end: 2.46 }],
	speaker_count: 1,
	source_backend: "test",
};

const mockInput: VideoInput = { path: "/tmp/test-video.mp4" };

const mockSpeaker: Speaker = {
	id: "S0",
	name: "Speaker 1",
	color: SPEAKER_COLORS[0],
	voice_profile: {
		pitch_baseline_hz: 150,
		pitch_p10: 100,
		pitch_p90: 200,
		volume_baseline_db: -20,
		volume_p10: -30,
		volume_p90: -10,
	},
};

function makeFrame(neural: NeuralPrediction): IntentFrame {
	return {
		id: "utt_0",
		speaker_id: "S0",
		start: 0,
		end: 1.08,
		vocal: {
			pitch_mean_hz: 150,
			pitch_normalized: 0.5,
			volume_mean_db: -20,
			volume_normalized: 0.5,
			speech_rate_wpm: 130,
			pause_before_ms: 0,
			pause_after_ms: 500,
		},
		affect: {
			valence: 0,
			arousal: 0.3,
			dominant_emotion: "neutral",
			confidence: 0.5,
		},
		semantic: {
			sarcasm_probability: 0,
			emphasis_words: [],
		},
		word_overrides: [],
		extractor_id: "tribe-v2-mock",
		extractor_version: "0.1.0",
		neural_prediction: neural,
	};
}

const mockWord: DiarizedWord = {
	text: "night?",
	start: 0.76,
	end: 1.08,
	confidence: 0.99,
	speaker_id: "S0",
};

// ============================================================================
// Tests: TribeExtractorBackend
// ============================================================================

describe("TribeExtractorBackend", () => {
	test("extract returns IntentFrames with neural_prediction populated", async () => {
		const backend = new TribeExtractorBackend(true); // mock mode
		const frames = await backend.extract(mockTranscript, mockInput);

		expect(frames.length).toBeGreaterThan(0);
		for (const frame of frames) {
			expect(frame.neural_prediction).toBeDefined();
			expect(frame.neural_prediction?.amygdala_activation).toBeGreaterThanOrEqual(0);
			expect(frame.neural_prediction?.amygdala_activation).toBeLessThanOrEqual(1);
			expect(frame.neural_prediction?.right_temporal_activation).toBeGreaterThanOrEqual(0);
			expect(frame.neural_prediction?.broca_activation).toBeGreaterThanOrEqual(0);
			expect(frame.neural_prediction?.insula_activation).toBeGreaterThanOrEqual(0);
			expect(frame.neural_prediction?.dmn_suppression).toBeGreaterThanOrEqual(0);
			expect(frame.neural_prediction?.ffa_activation).toBeGreaterThanOrEqual(0);
		}
	});

	test("extract splits utterances on pauses", async () => {
		const backend = new TribeExtractorBackend(true);
		const frames = await backend.extract(mockTranscript, mockInput);

		// 0.5s gap between "night?" and "I" should split into 2 utterances
		expect(frames.length).toBe(2);
		expect(frames[0].id).toBe("utt_0");
		expect(frames[1].id).toBe("utt_1");
	});

	test("extract includes vocal and affect derived from neural predictions", async () => {
		const backend = new TribeExtractorBackend(true);
		const frames = await backend.extract(mockTranscript, mockInput);

		for (const frame of frames) {
			expect(typeof frame.vocal.pitch_normalized).toBe("number");
			expect(typeof frame.vocal.volume_normalized).toBe("number");
			expect(typeof frame.affect.valence).toBe("number");
			expect(typeof frame.affect.arousal).toBe("number");
		}
	});

	test("createTribeBackend returns a TribeExtractorBackend", () => {
		const backend = createTribeBackend(true);
		expect(backend).toBeInstanceOf(TribeExtractorBackend);
	});
});

// ============================================================================
// Tests: NeuralMapper V3
// ============================================================================

describe("neuralMapper", () => {
	describe("neural prediction → weight", () => {
		test("high right_temporal_activation → high weight", () => {
			const frame = makeFrame({
				amygdala_activation: 0.5,
				right_temporal_activation: 0.9,
				broca_activation: 0.3,
				insula_activation: 0.3,
				dmn_suppression: 0.5,
				ffa_activation: 0.5,
			});
			const result = neuralMapper(mockWord, frame, mockSpeaker);
			expect(result.weight).toBeGreaterThanOrEqual(600);
		});

		test("low right_temporal_activation → low weight", () => {
			const frame = makeFrame({
				amygdala_activation: 0.5,
				right_temporal_activation: 0.1,
				broca_activation: 0.3,
				insula_activation: 0.3,
				dmn_suppression: 0.5,
				ffa_activation: 0.5,
			});
			const result = neuralMapper(mockWord, frame, mockSpeaker);
			expect(result.weight).toBeLessThanOrEqual(300);
		});
	});

	describe("neural prediction → size", () => {
		test("high amygdala_activation → large size", () => {
			const frame = makeFrame({
				amygdala_activation: 0.95,
				right_temporal_activation: 0.5,
				broca_activation: 0.3,
				insula_activation: 0.3,
				dmn_suppression: 0.5,
				ffa_activation: 0.5,
			});
			const result = neuralMapper(mockWord, frame, mockSpeaker);
			expect(result.size).toBeGreaterThan(1.2);
		});

		test("low amygdala_activation → small size", () => {
			const frame = makeFrame({
				amygdala_activation: 0.05,
				right_temporal_activation: 0.5,
				broca_activation: 0.3,
				insula_activation: 0.3,
				dmn_suppression: 0.5,
				ffa_activation: 0.5,
			});
			const result = neuralMapper(mockWord, frame, mockSpeaker);
			expect(result.size).toBeLessThan(0.9);
		});
	});

	describe("neural prediction → emphasis", () => {
		test("broca_activation > 0.7 → emphasis true", () => {
			const frame = makeFrame({
				amygdala_activation: 0.5,
				right_temporal_activation: 0.5,
				broca_activation: 0.85,
				insula_activation: 0.3,
				dmn_suppression: 0.5,
				ffa_activation: 0.5,
			});
			const result = neuralMapper(mockWord, frame, mockSpeaker);
			expect(result.emphasis).toBe(true);
		});

		test("dmn_suppression > 0.85 → emphasis true", () => {
			const frame = makeFrame({
				amygdala_activation: 0.5,
				right_temporal_activation: 0.5,
				broca_activation: 0.3,
				insula_activation: 0.3,
				dmn_suppression: 0.95,
				ffa_activation: 0.5,
			});
			const result = neuralMapper(mockWord, frame, mockSpeaker);
			expect(result.emphasis).toBe(true);
		});

		test("low broca + low dmn → no emphasis", () => {
			const frame = makeFrame({
				amygdala_activation: 0.5,
				right_temporal_activation: 0.5,
				broca_activation: 0.3,
				insula_activation: 0.3,
				dmn_suppression: 0.5,
				ffa_activation: 0.5,
			});
			const result = neuralMapper(mockWord, frame, mockSpeaker);
			expect(result.emphasis).toBe(false);
		});
	});

	describe("fallback behavior", () => {
		test("falls back to acoustic mapping when neural_prediction is null", () => {
			const frame = makeFrame({
				amygdala_activation: 0.5,
				right_temporal_activation: 0.5,
				broca_activation: 0.3,
				insula_activation: 0.3,
				dmn_suppression: 0.5,
				ffa_activation: 0.5,
			});
			// Remove neural prediction
			frame.neural_prediction = undefined;

			const result = neuralMapper(mockWord, frame, mockSpeaker);
			// Should still produce valid output using vocal features
			expect(result.weight).toBeGreaterThanOrEqual(200);
			expect(result.weight).toBeLessThanOrEqual(700);
			expect(result.size).toBeGreaterThanOrEqual(0.8);
			expect(result.size).toBeLessThanOrEqual(1.35);
		});
	});

	describe("word overrides", () => {
		test("override takes precedence over neural prediction", () => {
			const frame = makeFrame({
				amygdala_activation: 0.1,
				right_temporal_activation: 0.1,
				broca_activation: 0.1,
				insula_activation: 0.1,
				dmn_suppression: 0.1,
				ffa_activation: 0.1,
			});
			const override = {
				word_index: 0,
				weight_override: 900,
				size_override: 1.5,
				emphasis: true,
			};
			const result = neuralMapper(mockWord, frame, mockSpeaker, override);
			expect(result.weight).toBe(900);
			expect(result.size).toBe(1.5);
			expect(result.emphasis).toBe(true);
		});
	});
});
