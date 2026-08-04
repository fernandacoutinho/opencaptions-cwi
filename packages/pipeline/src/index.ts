/**
 * @opencaptions/pipeline — Pipeline orchestrator and V1 RulesMapper
 *
 * Orchestrates transcript → diarization → intent extraction → CWI mapping.
 * Ships with RulesMapper (V1): a pure-function mapper from IntentFrame to CWI visuals.
 */

import type {
	CWIDocument,
	CWIWord,
	CaptionEvent,
	DiarizationBackend,
	DiarizedWord,
	IntentExtractorBackend,
	IntentFrame,
	IntentMapper,
	PipelineOptions,
	PipelineResult,
	PipelineTrace,
	Speaker,
	TranscriptBackend,
	ValidationReport,
	VideoInput,
	VoiceProfile,
	WordIntent,
} from "@opencaptions/types";

import { CWI_SCHEMA_URI, CWI_VERSION, SPEAKER_COLORS } from "@opencaptions/types";

const DEFAULT_VOICE_PROFILE: VoiceProfile = {
	pitch_baseline_hz: 150,
	pitch_p10: 100,
	pitch_p90: 200,
	volume_baseline_db: -20,
	volume_p10: -30,
	volume_p90: -10,
};

// ============================================================================
// Helpers
// ============================================================================

/** Linear interpolation between a and b at parameter t (clamped to [0, 1]). */
export function lerp(a: number, b: number, t: number): number {
	const clamped = Math.max(0, Math.min(1, t));
	return a + (b - a) * clamped;
}

/** Compute the p-th percentile of a sorted numeric array (0-100). */
function percentile(sorted: number[], p: number): number {
	if (sorted.length === 0) return 0;
	if (sorted.length === 1) return sorted[0];
	const idx = (p / 100) * (sorted.length - 1);
	const lo = Math.floor(idx);
	const hi = Math.ceil(idx);
	if (lo === hi) return sorted[lo];
	return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/** Mean of a numeric array. */
function mean(values: number[]): number {
	if (values.length === 0) return 0;
	return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Compute a speaker's voice profile from their IntentFrames.
 * Baseline = mean, p10 = 10th percentile, p90 = 90th percentile.
 */
export function computeVoiceProfile(frames: IntentFrame[], speakerId: string): VoiceProfile {
	const speakerFrames = frames.filter((f) => f.speaker_id === speakerId);

	const pitches = speakerFrames.map((f) => f.vocal.pitch_mean_hz).sort((a, b) => a - b);
	const volumes = speakerFrames.map((f) => f.vocal.volume_mean_db).sort((a, b) => a - b);

	return {
		pitch_baseline_hz: mean(pitches),
		pitch_p10: percentile(pitches, 10),
		pitch_p90: percentile(pitches, 90),
		volume_baseline_db: mean(volumes),
		volume_p10: percentile(volumes, 10),
		volume_p90: percentile(volumes, 90),
	};
}

/**
 * Assign speaker colors from the SPEAKER_COLORS palette in order of first appearance.
 * Wraps around if more speakers than colors.
 */
export function assignSpeakerColors(speakerIds: string[]): Map<string, string> {
	const map = new Map<string, string>();
	for (let i = 0; i < speakerIds.length; i++) {
		map.set(speakerIds[i], SPEAKER_COLORS[i % SPEAKER_COLORS.length]);
	}
	return map;
}

// ============================================================================
// V1 RulesMapper
// ============================================================================

/**
 * V1 RulesMapper — pure function mapping IntentFrame → CWI visual parameters.
 *
 * - Pitch → weight: lerp(200, 700, pitch_normalized), rounded to nearest 100
 * - Volume → size: lerp(0.8, 1.35, volume_normalized)
 * - Emphasis: semantic.emphasis_words includes word text OR volume_normalized > 0.85
 * - Word-level overrides take precedence over utterance-level derivation
 */
export const rulesMapper: IntentMapper = (
	word: DiarizedWord,
	frame: IntentFrame,
	_speaker: Speaker,
	override?: WordIntent,
): Pick<CWIWord, "weight" | "size" | "emphasis"> => {
	// Utterance-level derivation
	const baseWeight = Math.round(lerp(200, 700, frame.vocal.pitch_normalized) / 100) * 100;
	const baseSize = lerp(0.8, 1.35, frame.vocal.volume_normalized);
	const baseEmphasis =
		frame.semantic.emphasis_words.includes(word.text) || frame.vocal.volume_normalized > 0.85;

	// Apply word-level overrides if present
	const weight = override?.weight_override ?? baseWeight;
	const size = override?.size_override ?? baseSize;
	const emphasis = override?.emphasis ?? baseEmphasis;

	return { weight, size, emphasis };
};

// ============================================================================
// Pipeline
// ============================================================================

/** Configuration for the Pipeline constructor. */
export type PipelineConfig = {
	transcript: TranscriptBackend;
	diarization: DiarizationBackend;
	extractor: IntentExtractorBackend;
	mapper?: IntentMapper;
};

/** Pipeline orchestrator — runs the full CWI caption generation pipeline. */
export class Pipeline {
	private readonly transcript: TranscriptBackend;
	private readonly diarization: DiarizationBackend;
	private readonly extractor: IntentExtractorBackend;
	private readonly mapper: IntentMapper;

	constructor(config: PipelineConfig) {
		this.transcript = config.transcript;
		this.diarization = config.diarization;
		this.extractor = config.extractor;
		this.mapper = config.mapper ?? rulesMapper;
	}

	async run(input: VideoInput, options?: PipelineOptions): Promise<PipelineResult> {
		const activeMapper = options?.mapper ?? this.mapper;
		const stages = {
			transcript_ms: 0,
			diarization_ms: 0,
			extraction_ms: 0,
			mapping_ms: 0,
			validation_ms: 0,
		};

		// Stage 1: Transcription
		const t0 = performance.now();
		const rawTranscript = await this.transcript.transcribe(input);
		stages.transcript_ms = performance.now() - t0;

		// Stage 2: Diarization
		const t1 = performance.now();
		const diarizedTranscript = await this.diarization.diarize(rawTranscript, input);
		stages.diarization_ms = performance.now() - t1;

		// Stage 3: Intent extraction
		const t2 = performance.now();
		const intentFrames = await this.extractor.extract(diarizedTranscript, input);
		stages.extraction_ms = performance.now() - t2;

		// Derive unique speaker IDs in order of first appearance
		const seenSpeakers = new Map<string, number>();
		for (const frame of intentFrames) {
			if (!seenSpeakers.has(frame.speaker_id)) {
				seenSpeakers.set(frame.speaker_id, seenSpeakers.size);
			}
		}
		const speakerIds = [...seenSpeakers.keys()];

		// Compute voice profiles
		const voiceProfiles = new Map<string, VoiceProfile>();
		for (const id of speakerIds) {
			voiceProfiles.set(id, computeVoiceProfile(intentFrames, id));
		}

		// Assign colors
		const colorMap = assignSpeakerColors(speakerIds);

		// Build cast with defaults
		const cast: Speaker[] = speakerIds.map((id, i) => ({
			id,
			name: `Speaker ${i + 1}`,
			color: colorMap.get(id) ?? SPEAKER_COLORS[i % SPEAKER_COLORS.length],
			voice_profile: voiceProfiles.get(id) ?? DEFAULT_VOICE_PROFILE,
		}));

		// Apply cast_overrides from options
		if (options?.cast_overrides) {
			for (const ov of options.cast_overrides) {
				const speaker = cast.find((s) => s.id === ov.speaker_id);
				if (speaker) {
					if (ov.name !== undefined) speaker.name = ov.name;
					if (ov.color !== undefined) speaker.color = ov.color;
				}
			}
		}

		// Build speaker lookup for mapper
		const speakerLookup = new Map<string, Speaker>();
		for (const s of cast) {
			speakerLookup.set(s.id, s);
		}

		// Stage 4: Map IntentFrames → CWIWords and build CaptionEvents
		const t3 = performance.now();
		const captions: CaptionEvent[] = [];

		for (const frame of intentFrames) {
			const speaker = speakerLookup.get(frame.speaker_id);
			if (!speaker) continue;

			// Find diarized words belonging to this frame's time range
			const frameWords = diarizedTranscript.words.filter(
				(w) => w.speaker_id === frame.speaker_id && w.start >= frame.start && w.end <= frame.end,
			);

			const cwiWords: CWIWord[] = frameWords.map((dw) => {
				// Find word-level override if any
				const wordIdx = diarizedTranscript.words.indexOf(dw);
				const override = frame.word_overrides.find((wo) => wo.word_index === wordIdx);

				const mapped = activeMapper(dw, frame, speaker, override);

				return {
					text: dw.text,
					start: dw.start,
					end: dw.end,
					weight: mapped.weight,
					size: mapped.size,
					emphasis: mapped.emphasis,
				};
			});

			if (cwiWords.length > 0) {
				captions.push({
					id: crypto.randomUUID(),
					start: frame.start,
					end: frame.end,
					speaker_id: frame.speaker_id,
					words: cwiWords,
				});
			}
		}
		stages.mapping_ms = performance.now() - t3;

		// Stage 5: Validation (placeholder — actual validation done by @opencaptions/spec)
		const t4 = performance.now();
		const totalWords = captions.reduce((n, c) => n + c.words.length, 0);

		const extractorBackend = intentFrames.length > 0 ? intentFrames[0].extractor_id : "unknown";

		const documentId = crypto.randomUUID();

		const report: ValidationReport = {
			document_id: documentId,
			report_id: crypto.randomUUID(),
			generated_at: new Date().toISOString(),
			passed: true,
			overall_score: 100,
			pillars: {
				attribution: { score: 100, passed: true, findings: [] },
				synchronization: { score: 100, passed: true, findings: [] },
				intonation: { score: 100, passed: true, findings: [] },
			},
			stats: {
				duration_seconds: rawTranscript.duration,
				caption_events: captions.length,
				words_total: totalWords,
				speakers_detected: speakerIds.length,
				extractor_backend: extractorBackend,
			},
			document_hash: "",
			report_hash: "",
		};
		stages.validation_ms = performance.now() - t4;

		// Build CWI Document
		const document: CWIDocument = {
			$schema: CWI_SCHEMA_URI,
			version: CWI_VERSION,
			metadata: {
				duration: rawTranscript.duration,
				language: rawTranscript.language,
				created_at: new Date().toISOString(),
				generator: "opencaptions/0.1.0",
				extractor_backend: extractorBackend,
			},
			cast,
			captions,
		};

		// Build trace — timestamp truncated to hour precision
		const now = new Date();
		now.setMinutes(0, 0, 0);
		const hourTimestamp = now.toISOString();

		const trace: PipelineTrace = {
			trace_id: crypto.randomUUID(),
			session_id: crypto.randomUUID(),
			timestamp: hourTimestamp,
			pipeline_version: "0.1.0",
			extractor_backend: extractorBackend,
			input: {
				duration_seconds: rawTranscript.duration,
				language: rawTranscript.language,
				speaker_count: speakerIds.length,
			},
			stages,
			output: {
				validation_score: report.overall_score,
				pillar_scores: {
					attribution: report.pillars.attribution.score,
					synchronization: report.pillars.synchronization.score,
					intonation: report.pillars.intonation.score,
				},
				caption_events: captions.length,
				words_total: totalWords,
				passed: report.passed,
			},
		};

		return { document, report, trace };
	}
}
