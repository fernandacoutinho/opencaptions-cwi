/**
 * @opencaptions/types — Core type definitions for CWI caption documents
 *
 * This package is the foundation of the OpenCaptions pipeline.
 * Zero runtime dependencies. Every other package depends on this.
 */

// ============================================================================
// Schema 1: RawTranscript
// ============================================================================

/** A single transcribed word with timing and confidence. */
export type RawWord = {
	/** The transcribed word text. */
	text: string;
	/** Start time in seconds. */
	start: number;
	/** End time in seconds. */
	end: number;
	/** Confidence score from the transcription model, 0-1. */
	confidence: number;
};

/** Raw transcript output from a transcription backend (no speaker info). */
export type RawTranscript = {
	words: RawWord[];
	/** ISO 639-1 language code. */
	language: string;
	/** Total duration in seconds. */
	duration: number;
	/** Identifier of the backend that produced this transcript. */
	source_backend: string;
};

// ============================================================================
// Schema 2: DiarizedTranscript
// ============================================================================

/** A word with speaker attribution added by the diarization backend. */
export type DiarizedWord = RawWord & {
	/** Opaque speaker identifier from diarizer, e.g. "S0", "S1". */
	speaker_id: string;
};

/** A contiguous segment of speech from a single speaker. */
export type SpeakerSegment = {
	speaker_id: string;
	start: number;
	end: number;
};

/** Transcript enriched with speaker turn boundaries. */
export type DiarizedTranscript = {
	words: DiarizedWord[];
	segments: SpeakerSegment[];
	speaker_count: number;
	source_backend: string;
};

// ============================================================================
// Schema 3: IntentFrame (Core Semantic Layer)
// ============================================================================

/** Emotion categories for the affect layer. */
export type Emotion =
	| "joy"
	| "sadness"
	| "anger"
	| "fear"
	| "surprise"
	| "disgust"
	| "contempt"
	| "neutral"
	| "uncertain";

/**
 * Word-level override — only exists when a word deviates
 * from the utterance-level baseline.
 */
export type WordIntent = {
	/** Index into the DiarizedTranscript.words array. */
	word_index: number;
	/** Override Roboto Flex wght axis: 100-900. */
	weight_override?: number;
	/** Override size multiplier: 0.7-1.5. */
	size_override?: number;
	/** Triggers the 15% bounce animation per CWI spec. */
	emphasis?: boolean;
	/** Word is whispered (low volume, intimate delivery). */
	whisper?: boolean;
	/** Word is shouted (high volume, forceful delivery). */
	shout?: boolean;
};

/**
 * Predicted neural activations from TRIBE v2 brain encoding model.
 * Maps video+audio+text → predicted fMRI voxel activations → 6 ROI scalars.
 * Each value is 0-1, representing normalized activation in that brain region.
 */
export type NeuralPrediction = {
	/** Amygdala-adjacent cortex: emotional intensity. Drives CWI size. */
	amygdala_activation: number;
	/** Right temporal cortex: emotional prosody processing. Drives CWI weight. */
	right_temporal_activation: number;
	/** Broca's area: syntactic load / speech production. Drives CWI emphasis. */
	broca_activation: number;
	/** Insular cortex: empathic/visceral response. Drives animation speed. */
	insula_activation: number;
	/** Default Mode Network suppression: engagement level. High = engaged. */
	dmn_suppression: number;
	/** Fusiform Face Area: face/identity processing. Drives attribution timing. */
	ffa_activation: number;
};

/** Rhetorical device classification for the semantic layer. */
export type RhetoricalDevice = "question" | "exclamation" | "command" | "aside";

/**
 * Utterance-level intent — the felt register of a speech segment.
 * Two-level model: utterance sets the emotional register,
 * individual words that deviate get point overrides via word_overrides.
 */
export type IntentFrame = {
	/** Unique identifier for this frame. */
	id: string;
	/** Speaker who produced this utterance. */
	speaker_id: string;
	/** Start time in seconds. */
	start: number;
	/** End time in seconds. */
	end: number;

	/** Vocal signal extracted from audio waveform. */
	vocal: {
		pitch_mean_hz: number;
		/** 0-1, normalized relative to this speaker's baseline. */
		pitch_normalized: number;
		volume_mean_db: number;
		/** 0-1, normalized relative to this speaker's baseline. */
		volume_normalized: number;
		speech_rate_wpm: number;
		pause_before_ms: number;
		pause_after_ms: number;
	};

	/** Emotional register from vision model on keyframes. */
	affect: {
		/** -1 (negative) to 1 (positive). */
		valence: number;
		/** 0 (calm) to 1 (excited). */
		arousal: number;
		dominant_emotion: Emotion;
		/** 0-1, how confident the model is. */
		confidence: number;
	};

	/** Semantic layer from LLM on transcript context window. */
	semantic: {
		sarcasm_probability: number;
		/** Words the model flags as load-bearing. */
		emphasis_words: string[];
		rhetorical_device?: RhetoricalDevice;
	};

	/** Word-level deviations from utterance baseline. */
	word_overrides: WordIntent[];

	/** Identifier of the extractor backend. */
	extractor_id: string;
	extractor_version: string;

	/** V2: JEPA world model embedding (null in V1). Float32, 256-dim. */
	world_embedding?: number[];

	/** V3: TRIBE v2 predicted neural activations (null in V1/V2). */
	neural_prediction?: NeuralPrediction;
};

// ============================================================================
// Schema 4: CWIDocument (Canonical Output)
// ============================================================================

/** Voice profile derived from aggregating a speaker's IntentFrames. */
export type VoiceProfile = {
	pitch_baseline_hz: number;
	/** 10th percentile — their "quiet". */
	pitch_p10: number;
	/** 90th percentile — their "loud". */
	pitch_p90: number;
	volume_baseline_db: number;
	volume_p10: number;
	volume_p90: number;
};

/** A character/speaker in the caption document. */
export type Speaker = {
	id: string;
	name: string;
	/** Hex color for attribution, e.g. "#6B8AFF". */
	color: string;
	voice_profile: VoiceProfile;
};

/** CWI animation parameters (null fields use CWI spec defaults). */
export type CWIAnimation = {
	/** Animation duration in ms. Default: 600. */
	duration_ms?: number;
	/** Animation delay in ms. Default: 100. */
	delay_ms?: number;
	/** Easing function. Default: "ease". */
	easing?: string;
};

/** A single word with CWI rendering parameters. */
export type CWIWord = {
	text: string;
	/** Start time in seconds. */
	start: number;
	/** End time in seconds. */
	end: number;
	/** Roboto Flex wght axis: 100-900. Maps from pitch. */
	weight: number;
	/** Size multiplier: 0.7-1.5. Maps from volume. */
	size: number;
	/** Triggers the 15% size bounce upward animation. */
	emphasis: boolean;
	/** Per-word animation overrides. */
	animation?: CWIAnimation;
};

/** Layout hints pre-computed by the layout engine. */
export type LayoutHint = {
	estimated_lines: number;
	max_line_width_chars: number;
};

/** A caption event — a contiguous speech segment from one speaker. */
export type CaptionEvent = {
	id: string;
	/** Start time in seconds. */
	start: number;
	/** End time in seconds. */
	end: number;
	speaker_id: string;
	words: CWIWord[];
	layout_hint?: LayoutHint;
};

/** Metadata about how the CWI document was generated. */
export type CWIMetadata = {
	title?: string;
	/** Total video duration in seconds. */
	duration: number;
	/** ISO 639-1 language code. */
	language: string;
	/** ISO 8601 creation timestamp. */
	created_at: string;
	/** Generator identifier, e.g. "opencaptions/0.1.0". */
	generator: string;
	/** Extractor backend used. */
	extractor_backend: string;
	/** SHA-256 hash of the input video file. */
	source_file_hash?: string;
};

/** The canonical CWI caption document. */
export type CWIDocument = {
	$schema: string;
	version: "1.0";
	metadata: CWIMetadata;
	cast: Speaker[];
	captions: CaptionEvent[];
};

// ============================================================================
// Schema 5: IntentMapper (Pure Function Contract)
// ============================================================================

/** The pure function that maps felt intent → CWI visual parameters. */
export type IntentMapper = (
	word: DiarizedWord,
	frame: IntentFrame,
	speaker: Speaker,
	override?: WordIntent,
) => Pick<CWIWord, "weight" | "size" | "emphasis">;

// ============================================================================
// Schema 6: ValidationReport
// ============================================================================

/** Validation rule identifiers organized by CWI pillar. */
export type RuleId =
	// Attribution
	| "ATT_001" // every caption has a speaker
	| "ATT_002" // speakers have unique colors
	| "ATT_003" // colors meet WCAG AA contrast (4.5:1 min)
	// Synchronization
	| "SYN_001" // all words have timestamps
	| "SYN_002" // timestamps monotonically increasing
	| "SYN_003" // caption events don't overlap
	| "SYN_004" // animation duration 600ms per spec
	// Intonation
	| "INT_001" // weight in valid Roboto Flex range (100-900)
	| "INT_002" // size in valid range (0.7-1.5)
	| "INT_003" // >20% of words have non-default weight
	// FCC baseline
	| "FCC_001" // no gaps >3s during speech
	| "FCC_002"; // max 42 chars per line

export type Severity = "error" | "warning" | "info";

/** A single validation finding. */
export type ValidationFinding = {
	rule_id: RuleId;
	severity: Severity;
	message: string;
	location?: { caption_id: string; word_index?: number };
	suggestion?: string;
};

/** Score for one of the three CWI pillars. */
export type PillarScore = {
	/** 0-100. */
	score: number;
	/** True if score >= 80. */
	passed: boolean;
	findings: ValidationFinding[];
};

/** Complete validation report for a CWI document. */
export type ValidationReport = {
	document_id: string;
	/** Stable UUID reference for this report. */
	report_id: string;
	/** ISO 8601 timestamp. */
	generated_at: string;

	/** True if all three pillars >= 80. */
	passed: boolean;
	/** Weighted average of pillar scores. */
	overall_score: number;

	pillars: {
		attribution: PillarScore;
		synchronization: PillarScore;
		intonation: PillarScore;
	};

	stats: {
		duration_seconds: number;
		caption_events: number;
		words_total: number;
		speakers_detected: number;
		extractor_backend: string;
	};

	/** SHA-256 of the CWIDocument. */
	document_hash: string;
	/** SHA-256 of this report. */
	report_hash: string;

	/** Hosted report URL (paid tier). */
	report_url?: string;
	/** Embeddable badge URL (paid tier). */
	badge_url?: string;
	/** Expiration: null for paid tier, ISO 8601 for free tier. */
	expires_at?: string;
};

// ============================================================================
// Schema 7: Tracing Types
// ============================================================================

/** Aggregate stats per pipeline run. Never contains PII. */
export type PipelineTrace = {
	trace_id: string;
	/** Rotating session ID, resets every 24h. */
	session_id: string;
	/** Hour-precision only for privacy. */
	timestamp: string;
	pipeline_version: string;
	extractor_backend: string;

	input: {
		duration_seconds: number;
		language: string;
		speaker_count: number;
	};
	stages: {
		transcript_ms: number;
		diarization_ms: number;
		extraction_ms: number;
		mapping_ms: number;
		validation_ms: number;
		/** V3: TRIBE v2 neural prediction inference time. 0 if not used. */
		tribe_inference_ms?: number;
	};
	output: {
		validation_score: number;
		pillar_scores: {
			attribution: number;
			synchronization: number;
			intonation: number;
		};
		caption_events: number;
		words_total: number;
		passed: boolean;
	};
};

/** Mapper correction — the gold signal for training LearnedMapper V2. */
export type MapperCorrection = {
	trace_id: string;
	correction_id: string;

	/** IntentFrame snapshot (normalized values only — no PII). */
	intent_snapshot: {
		pitch_normalized: number;
		volume_normalized: number;
		arousal: number;
		valence: number;
		dominant_emotion: Emotion;
		speech_rate_wpm: number;
	};

	predicted: { weight: number; size: number; emphasis: boolean };
	corrected: { weight: number; size: number; emphasis: boolean };
	annotation?: string;
};

/** Validation rule override — builds the rules corpus. */
export type ValidationOverride = {
	trace_id: string;
	rule_id: RuleId;
	verdict: "false_positive" | "false_negative";
	annotation?: string;
};

// ============================================================================
// Pipeline Interfaces
// ============================================================================

/** Input to the pipeline — a reference to a video file. */
export type VideoInput = {
	/** Absolute path to the video file. */
	path: string;
	/** MIME type if known. */
	mime_type?: string;
};

/** Options for pipeline execution. */
export type PipelineOptions = {
	/** Output path for the CWI document. */
	output_path?: string;
	/** Override the default intent mapper. */
	mapper?: IntentMapper;
	/** Language hint for transcription. */
	language?: string;
	/** Speaker names/colors to override auto-detection. */
	cast_overrides?: Array<{ speaker_id: string; name?: string; color?: string }>;
};

/** Result of a full pipeline run. */
export type PipelineResult = {
	document: CWIDocument;
	report: ValidationReport;
	trace: PipelineTrace;
};

// ============================================================================
// Backend Interfaces
// ============================================================================

export interface TranscriptBackend {
	transcribe(input: VideoInput): Promise<RawTranscript>;
}

export interface DiarizationBackend {
	diarize(transcript: RawTranscript, input: VideoInput): Promise<DiarizedTranscript>;
}

export interface IntentExtractorBackend {
	extract(transcript: DiarizedTranscript, input: VideoInput): Promise<IntentFrame[]>;
}

// ============================================================================
// Constants
// ============================================================================

/** CWI spec default animation parameters. */
export const CWI_DEFAULTS = {
	ANIMATION_DURATION_MS: 600,
	ANIMATION_DELAY_MS: 100,
	ANIMATION_EASING: "ease",
	EMPHASIS_BOUNCE_PERCENT: 15,
	FONT_FAMILY: "Roboto Flex",
	WEIGHT_MIN: 100,
	WEIGHT_MAX: 900,
	SIZE_MIN: 0.7,
	SIZE_MAX: 1.5,
	MAX_CHARS_PER_LINE: 42,
	MAX_SPEECH_GAP_SECONDS: 3,
	PILLAR_PASS_THRESHOLD: 80,
	INTONATION_MIN_VARIED_PERCENT: 20,
} as const;

/**
 * 12-color WCAG AA compliant palette for speaker attribution.
 * All colors meet 4.5:1 contrast ratio against #000000 and #1a1a1a.
 * Colors are maximally distinct in CIE Lab space (deltaE >= 30).
 */
export const SPEAKER_COLORS = [
	"#6B8AFF",
	"#FF6B6B",
	"#6BFFA3",
	"#FFD56B",
	"#D56BFF",
	"#6BF0FF",
	"#FF6BC8",
	"#A3FF6B",
	"#FF916B",
	"#6BB4FF",
	"#FFB86B",
	"#8A6BFF",
] as const;

/** JSON Schema URI for CWI documents. */
export const CWI_SCHEMA_URI = "https://opencaptions.tools/schema/cwi/1.0.json";

/** Current CWI document version. */
export const CWI_VERSION = "1.0" as const;
