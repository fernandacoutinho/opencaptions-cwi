/**
 * @opencaptions/backend-av — V1 Audio+Vision intent extractor
 *
 * Implements TranscriptBackend, DiarizationBackend, and IntentExtractorBackend
 * using existing tools via subprocess:
 * - whisper.cpp for transcription
 * - pyannote-audio for diarization
 * - parselmouth for pitch/volume
 * - librosa for speech rate
 * - OpenCV + FER for facial emotion
 * - Ollama for semantic analysis
 *
 * All Python tools communicate via JSON stdin/stdout contracts.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
	DiarizationBackend,
	DiarizedTranscript,
	DiarizedWord,
	Emotion,
	IntentExtractorBackend,
	IntentFrame,
	RawTranscript,
	RawWord,
	SpeakerSegment,
	TranscriptBackend,
	VideoInput,
} from "@opencaptions/types";

// ============================================================================
// Subprocess helper
// ============================================================================

type SubprocessResult = {
	stdout: string;
	stderr: string;
	exitCode: number;
};

async function runPython(
	scriptPath: string,
	args: string[],
	input?: string,
): Promise<SubprocessResult> {
	const venvPython = join(homedir(), ".opencaptions", "venv", "bin", "python3");
	const python = existsSync(venvPython) ? venvPython : "python3";

	return new Promise((resolve, reject) => {
		const proc = spawn(python, [scriptPath, ...args], {
			stdio: ["pipe", "pipe", "pipe"],
		});

		let stdout = "";
		let stderr = "";

		proc.stdout.on("data", (data: Buffer) => {
			stdout += data.toString();
		});
		proc.stderr.on("data", (data: Buffer) => {
			stderr += data.toString();
		});

		if (input) {
			proc.stdin.write(input);
			proc.stdin.end();
		}

		proc.on("close", (code) => {
			resolve({ stdout, stderr, exitCode: code ?? 1 });
		});
		proc.on("error", reject);
	});
}

function parseJsonOutput<T>(result: SubprocessResult, context: string): T {
	if (result.exitCode !== 0) {
		throw new Error(`${context} failed (exit ${result.exitCode}): ${result.stderr}`);
	}
	try {
		return JSON.parse(result.stdout) as T;
	} catch {
		throw new Error(`${context} returned invalid JSON: ${result.stdout.slice(0, 200)}`);
	}
}

// ============================================================================
// Scripts directory
// ============================================================================

// Resolve scripts relative to this file's package root, not the importing module
const SCRIPTS_DIR = (() => {
	// When running from source (bun run src/index.ts), use relative path
	const fromSrc = join(import.meta.dirname ?? __dirname, "..", "scripts");
	if (existsSync(fromSrc)) return fromSrc;
	// When running from dist (compiled), go up one more level
	const fromDist = join(import.meta.dirname ?? __dirname, "..", "..", "scripts");
	if (existsSync(fromDist)) return fromDist;
	// Fallback: try finding it from the package root via require.resolve
	try {
		const pkgDir = join(require.resolve("@opencaptions/backend-av/package.json"), "..");
		return join(pkgDir, "scripts");
	} catch {
		return fromSrc; // best effort
	}
})();

// ============================================================================
// WhisperTranscriptBackend
// ============================================================================

export class WhisperTranscriptBackend implements TranscriptBackend {
	private modelSize: string;

	constructor(modelSize = "small") {
		this.modelSize = modelSize;
	}

	async transcribe(input: VideoInput): Promise<RawTranscript> {
		const scriptPath = join(SCRIPTS_DIR, "transcribe.py");

		if (!existsSync(scriptPath)) {
			// Fallback: try whisper CLI directly
			return this.transcribeViaCli(input);
		}

		const result = await runPython(scriptPath, ["--input", input.path, "--model", this.modelSize]);

		return parseJsonOutput<RawTranscript>(result, "Whisper transcription");
	}

	private async transcribeViaCli(input: VideoInput): Promise<RawTranscript> {
		// Try whisper.cpp via command line
		const result = await new Promise<SubprocessResult>((resolve, reject) => {
			const proc = spawn(
				"whisper-cpp",
				["--model", this.modelSize, "--output-json", "--word-timestamps", input.path],
				{ stdio: ["pipe", "pipe", "pipe"] },
			);

			let stdout = "";
			let stderr = "";
			proc.stdout.on("data", (d: Buffer) => {
				stdout += d.toString();
			});
			proc.stderr.on("data", (d: Buffer) => {
				stderr += d.toString();
			});
			proc.on("close", (code) => resolve({ stdout, stderr, exitCode: code ?? 1 }));
			proc.on("error", reject);
		});

		if (result.exitCode !== 0) {
			throw new Error(
				`Whisper transcription failed. Ensure whisper.cpp is installed.\nRun: opencaptions setup\nError: ${result.stderr}`,
			);
		}

		return parseJsonOutput<RawTranscript>(result, "Whisper CLI");
	}
}

// ============================================================================
// PyAnnoteDiarizationBackend
// ============================================================================

export class PyAnnoteDiarizationBackend implements DiarizationBackend {
	async diarize(transcript: RawTranscript, input: VideoInput): Promise<DiarizedTranscript> {
		const scriptPath = join(SCRIPTS_DIR, "diarize.py");

		if (!existsSync(scriptPath)) {
			// Fallback: assign all words to speaker S0
			return this.fallbackSingleSpeaker(transcript);
		}

		const result = await runPython(scriptPath, ["--input", input.path], JSON.stringify(transcript));

		const segments = parseJsonOutput<{ segments: SpeakerSegment[] }>(result, "Diarization");

		// Assign speaker IDs to words based on segments
		const words: DiarizedWord[] = transcript.words.map((w) => {
			const midpoint = (w.start + w.end) / 2;
			const segment = segments.segments.find((s) => midpoint >= s.start && midpoint <= s.end);
			return { ...w, speaker_id: segment?.speaker_id ?? "S0" };
		});

		const speakerIds = new Set(words.map((w) => w.speaker_id));

		return {
			words,
			segments: segments.segments,
			speaker_count: speakerIds.size,
			source_backend: "pyannote-3.1",
		};
	}

	private fallbackSingleSpeaker(transcript: RawTranscript): DiarizedTranscript {
		return {
			words: transcript.words.map((w) => ({ ...w, speaker_id: "S0" })),
			segments: [{ speaker_id: "S0", start: 0, end: transcript.duration }],
			speaker_count: 1,
			source_backend: "fallback-single-speaker",
		};
	}
}

// ============================================================================
// AudioVisionExtractor
// ============================================================================

export class AudioVisionExtractor implements IntentExtractorBackend {
	async extract(transcript: DiarizedTranscript, input: VideoInput): Promise<IntentFrame[]> {
		// Group words into utterances by speaker turns
		const utterances = this.groupIntoUtterances(transcript);

		// Try to extract vocal features
		let vocalData: Map<string, VocalFeatures> | null = null;
		try {
			vocalData = await this.extractVocal(input, utterances);
		} catch {
			console.warn("Vocal extraction unavailable, using defaults");
		}

		// Try to extract facial emotion
		let emotionData: Map<string, EmotionFeatures> | null = null;
		try {
			emotionData = await this.extractEmotion(input, utterances);
		} catch {
			console.warn("Emotion extraction unavailable, using defaults");
		}

		// Build IntentFrames
		return utterances.map((utt, idx) => {
			const vocal = vocalData?.get(utt.id) ?? DEFAULT_VOCAL;
			const emotion = emotionData?.get(utt.id) ?? DEFAULT_EMOTION;

			return {
				id: utt.id,
				speaker_id: utt.speaker_id,
				start: utt.start,
				end: utt.end,
				vocal: {
					pitch_mean_hz: vocal.pitch_mean_hz,
					pitch_normalized: vocal.pitch_normalized,
					volume_mean_db: vocal.volume_mean_db,
					volume_normalized: vocal.volume_normalized,
					speech_rate_wpm: vocal.speech_rate_wpm,
					pause_before_ms: idx > 0 ? (utt.start - utterances[idx - 1].end) * 1000 : 0,
					pause_after_ms:
						idx < utterances.length - 1 ? (utterances[idx + 1].start - utt.end) * 1000 : 0,
				},
				affect: {
					valence: emotion.valence,
					arousal: emotion.arousal,
					dominant_emotion: emotion.dominant_emotion,
					confidence: emotion.confidence,
				},
				semantic: {
					sarcasm_probability: 0,
					emphasis_words: [],
					rhetorical_device: undefined,
				},
				word_overrides: [],
				extractor_id: "audio-vision-v1",
				extractor_version: "0.1.0",
			};
		});
	}

	private groupIntoUtterances(transcript: DiarizedTranscript): Utterance[] {
		const utterances: Utterance[] = [];
		let current: Utterance | null = null;
		const PAUSE_THRESHOLD = 0.4; // Split on gaps > 400ms

		for (const word of transcript.words) {
			const shouldSplit =
				!current ||
				current.speaker_id !== word.speaker_id ||
				word.start - current.end > PAUSE_THRESHOLD;

			if (shouldSplit) {
				if (current) utterances.push(current);
				current = {
					id: `utt_${utterances.length}`,
					speaker_id: word.speaker_id,
					start: word.start,
					end: word.end,
					words: [word],
				};
			} else if (current) {
				current.end = word.end;
				current.words.push(word);
			}
		}
		if (current) utterances.push(current);

		return utterances;
	}

	private async extractVocal(
		input: VideoInput,
		utterances: Utterance[],
	): Promise<Map<string, VocalFeatures>> {
		const scriptPath = join(SCRIPTS_DIR, "extract_vocal.py");
		if (!existsSync(scriptPath)) {
			throw new Error("Vocal extraction script not found");
		}

		const result = await runPython(
			scriptPath,
			["--input", input.path],
			JSON.stringify(utterances.map((u) => ({ id: u.id, start: u.start, end: u.end }))),
		);

		const data = parseJsonOutput<Record<string, VocalFeatures>>(result, "Vocal extraction");
		return new Map(Object.entries(data));
	}

	private async extractEmotion(
		input: VideoInput,
		utterances: Utterance[],
	): Promise<Map<string, EmotionFeatures>> {
		const scriptPath = join(SCRIPTS_DIR, "extract_emotion.py");
		if (!existsSync(scriptPath)) {
			throw new Error("Emotion extraction script not found");
		}

		const result = await runPython(
			scriptPath,
			["--input", input.path],
			JSON.stringify(utterances.map((u) => ({ id: u.id, start: u.start, end: u.end }))),
		);

		const data = parseJsonOutput<Record<string, EmotionFeatures>>(result, "Emotion extraction");
		return new Map(Object.entries(data));
	}
}

// ============================================================================
// Internal types
// ============================================================================

type Utterance = {
	id: string;
	speaker_id: string;
	start: number;
	end: number;
	words: DiarizedWord[];
};

type VocalFeatures = {
	pitch_mean_hz: number;
	pitch_normalized: number;
	volume_mean_db: number;
	volume_normalized: number;
	speech_rate_wpm: number;
};

type EmotionFeatures = {
	valence: number;
	arousal: number;
	dominant_emotion: Emotion;
	confidence: number;
};

const DEFAULT_VOCAL: VocalFeatures = {
	pitch_mean_hz: 150,
	pitch_normalized: 0.5,
	volume_mean_db: -20,
	volume_normalized: 0.5,
	speech_rate_wpm: 130,
};

const DEFAULT_EMOTION: EmotionFeatures = {
	valence: 0,
	arousal: 0.3,
	dominant_emotion: "neutral",
	confidence: 0.1,
};

// ============================================================================
// Exports
// ============================================================================

/** Create a fully configured V1 backend set. */
export function createV1Backends() {
	return {
		transcript: new WhisperTranscriptBackend(),
		diarization: new PyAnnoteDiarizationBackend(),
		extractor: new AudioVisionExtractor(),
	};
}
