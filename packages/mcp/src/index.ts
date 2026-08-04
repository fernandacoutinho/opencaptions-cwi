#!/usr/bin/env node
/**
 * @opencaptions/mcp — MCP server for AI agent integration with CWI caption pipeline
 *
 * Exposes 4 tools via Model Context Protocol:
 *   1. generate_captions — run the pipeline on a video file
 *   2. validate_captions — validate a CWI document against 12 rules
 *   3. preview_captions  — terminal-formatted preview at a given time
 *   4. export_captions   — export to WebVTT format
 *
 * Transport: stdio (for Claude Code / agent integration)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { Pipeline } from "@opencaptions/pipeline";
import { TerminalRenderer, exportWebVTT } from "@opencaptions/renderer";
import { validate } from "@opencaptions/spec";
import type {
	CWIDocument,
	DiarizationBackend,
	DiarizedTranscript,
	DiarizedWord,
	IntentExtractorBackend,
	IntentFrame,
	RawTranscript,
	TranscriptBackend,
	VideoInput,
} from "@opencaptions/types";
import { SPEAKER_COLORS } from "@opencaptions/types";

// ============================================================================
// Logging — stderr only (stdout is the MCP transport)
// ============================================================================

function log(message: string): void {
	process.stderr.write(`[opencaptions-mcp] ${message}\n`);
}

// ============================================================================
// Mock Backends (V1 stubs — real backends require Python + system deps)
// ============================================================================

/**
 * Mock transcript backend — returns a placeholder transcript.
 * Real implementation requires whisper.cpp / Python whisper bindings.
 */
class MockTranscriptBackend implements TranscriptBackend {
	async transcribe(input: VideoInput): Promise<RawTranscript> {
		log(`Mock transcription for: ${input.path}`);
		return {
			words: [
				{ text: "This", start: 0.5, end: 0.8, confidence: 0.95 },
				{ text: "is", start: 0.8, end: 1.0, confidence: 0.98 },
				{ text: "a", start: 1.0, end: 1.1, confidence: 0.99 },
				{ text: "sample", start: 1.1, end: 1.5, confidence: 0.92 },
				{ text: "caption", start: 1.5, end: 2.0, confidence: 0.94 },
				{ text: "generated", start: 2.0, end: 2.5, confidence: 0.91 },
				{ text: "by", start: 2.5, end: 2.7, confidence: 0.97 },
				{ text: "OpenCaptions.", start: 2.7, end: 3.5, confidence: 0.93 },
			],
			language: "en",
			duration: 5.0,
			source_backend: "mock-whisper",
		};
	}
}

/**
 * Mock diarization backend — assigns all words to a single speaker.
 * Real implementation requires pyannote-audio Python package.
 */
class MockDiarizationBackend implements DiarizationBackend {
	async diarize(transcript: RawTranscript, _input: VideoInput): Promise<DiarizedTranscript> {
		const words: DiarizedWord[] = transcript.words.map((w) => ({
			...w,
			speaker_id: "S0",
		}));

		return {
			words,
			segments: [
				{
					speaker_id: "S0",
					start: transcript.words[0]?.start ?? 0,
					end: transcript.words[transcript.words.length - 1]?.end ?? 0,
				},
			],
			speaker_count: 1,
			source_backend: "mock-pyannote",
		};
	}
}

/**
 * Mock intent extractor — produces a single frame with neutral baseline values.
 * Real implementation requires parselmouth + vision model + LLM.
 */
class MockIntentExtractorBackend implements IntentExtractorBackend {
	async extract(transcript: DiarizedTranscript, _input: VideoInput): Promise<IntentFrame[]> {
		const start = transcript.words[0]?.start ?? 0;
		const end = transcript.words[transcript.words.length - 1]?.end ?? 0;

		return [
			{
				id: crypto.randomUUID(),
				speaker_id: "S0",
				start,
				end,
				vocal: {
					pitch_mean_hz: 150,
					pitch_normalized: 0.5,
					volume_mean_db: -20,
					volume_normalized: 0.5,
					speech_rate_wpm: 150,
					pause_before_ms: 0,
					pause_after_ms: 0,
				},
				affect: {
					valence: 0.2,
					arousal: 0.3,
					dominant_emotion: "neutral",
					confidence: 0.7,
				},
				semantic: {
					sarcasm_probability: 0.0,
					emphasis_words: ["OpenCaptions."],
				},
				word_overrides: [],
				extractor_id: "mock-extractor",
				extractor_version: "0.1.0",
			},
		];
	}
}

// ============================================================================
// Helper: Parse CWI JSON safely
// ============================================================================

function parseCWIDocument(cwi_json: string): CWIDocument {
	const parsed = JSON.parse(cwi_json);

	// Minimal structural check
	if (!parsed.$schema || !parsed.version || !parsed.metadata || !parsed.cast || !parsed.captions) {
		throw new Error(
			"Invalid CWI document: missing required fields ($schema, version, metadata, cast, captions)",
		);
	}

	return parsed as CWIDocument;
}

// ============================================================================
// Helper: Format validation report for display
// ============================================================================

function formatValidationSummary(report: ReturnType<typeof validate>): string {
	const lines: string[] = [];
	lines.push(
		`Validation ${report.passed ? "PASSED" : "FAILED"} — Overall Score: ${report.overall_score}/100`,
	);
	lines.push("");
	lines.push("Pillar Scores:");
	lines.push(
		`  Attribution:     ${report.pillars.attribution.score}/100 ${report.pillars.attribution.passed ? "[PASS]" : "[FAIL]"}`,
	);
	lines.push(
		`  Synchronization: ${report.pillars.synchronization.score}/100 ${report.pillars.synchronization.passed ? "[PASS]" : "[FAIL]"}`,
	);
	lines.push(
		`  Intonation:      ${report.pillars.intonation.score}/100 ${report.pillars.intonation.passed ? "[PASS]" : "[FAIL]"}`,
	);
	lines.push("");
	lines.push("Stats:");
	lines.push(`  Duration:  ${report.stats.duration_seconds}s`);
	lines.push(`  Events:    ${report.stats.caption_events}`);
	lines.push(`  Words:     ${report.stats.words_total}`);
	lines.push(`  Speakers:  ${report.stats.speakers_detected}`);
	lines.push(`  Backend:   ${report.stats.extractor_backend}`);

	// List findings if any
	const allFindings = [
		...report.pillars.attribution.findings,
		...report.pillars.synchronization.findings,
		...report.pillars.intonation.findings,
	];

	if (allFindings.length > 0) {
		lines.push("");
		lines.push(`Findings (${allFindings.length}):`);
		for (const f of allFindings) {
			const icon =
				f.severity === "error" ? "[ERROR]" : f.severity === "warning" ? "[WARN]" : "[INFO]";
			lines.push(`  ${icon} ${f.rule_id}: ${f.message}`);
			if (f.suggestion) {
				lines.push(`         -> ${f.suggestion}`);
			}
		}
	}

	return lines.join("\n");
}

// ============================================================================
// MCP Server
// ============================================================================

const server = new McpServer({
	name: "opencaptions",
	version: "0.1.0",
});

// --------------------------------------------------------------------------
// Tool 1: generate_captions
// --------------------------------------------------------------------------

server.tool(
	"generate_captions",
	"Generate CWI (Caption with Intention) captions from a video file. " +
		"Runs the full OpenCaptions pipeline: transcription, diarization, " +
		"intent extraction, and CWI mapping. Returns the CWI document JSON " +
		"and a validation report. NOTE: Currently uses mock backends — " +
		"install Python dependencies (whisper, pyannote-audio) for real extraction.",
	{
		video_path: z.string().describe("Absolute path to the video file"),
		language: z
			.string()
			.optional()
			.describe("ISO 639-1 language code hint for transcription (default: auto-detect)"),
		speakers: z
			.array(
				z.object({
					name: z.string().describe("Speaker display name"),
					color: z.string().describe('Speaker color hex (e.g. "#6B8AFF")'),
				}),
			)
			.optional()
			.describe("Override speaker names and colors"),
	},
	async ({ video_path, language, speakers }) => {
		try {
			log(`generate_captions called for: ${video_path}`);

			// Create pipeline with mock backends
			const pipeline = new Pipeline({
				transcript: new MockTranscriptBackend(),
				diarization: new MockDiarizationBackend(),
				extractor: new MockIntentExtractorBackend(),
			});

			// Build cast overrides from speakers array
			const cast_overrides = speakers?.map((s, i) => ({
				speaker_id: `S${i}`,
				name: s.name,
				color: s.color,
			}));

			const result = await pipeline.run(
				{ path: video_path },
				{
					language,
					cast_overrides,
				},
			);

			// Validate the generated document with @opencaptions/spec
			const specReport = validate(result.document);

			const output = [
				"=== CWI Document ===",
				JSON.stringify(result.document, null, 2),
				"",
				"=== Validation Report ===",
				formatValidationSummary(specReport),
				"",
				"NOTE: This output was generated using mock backends. For real video processing,",
				"install the Python dependencies: pip install openai-whisper pyannote.audio parselmouth",
				"Then configure @opencaptions/backend-av as the transcript/diarization/extractor backend.",
			].join("\n");

			return {
				content: [{ type: "text" as const, text: output }],
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			log(`generate_captions error: ${message}`);
			return {
				content: [
					{
						type: "text" as const,
						text: `Error generating captions: ${message}\n\nMake sure the video file exists and is accessible.`,
					},
				],
				isError: true,
			};
		}
	},
);

// --------------------------------------------------------------------------
// Tool 2: validate_captions
// --------------------------------------------------------------------------

server.tool(
	"validate_captions",
	"Validate a CWI document against the 12-rule CWI specification. " +
		"Checks three pillars: Attribution (speaker colors, WCAG contrast), " +
		"Synchronization (timestamps, overlaps, animation), and Intonation " +
		"(weight range, size range, variation). Returns pillar scores and findings.",
	{
		cwi_json: z.string().describe("The CWI document as a JSON string"),
	},
	async ({ cwi_json }) => {
		try {
			log("validate_captions called");

			const doc = parseCWIDocument(cwi_json);
			const report = validate(doc);

			const output = [
				formatValidationSummary(report),
				"",
				"=== Full Report JSON ===",
				JSON.stringify(report, null, 2),
			].join("\n");

			return {
				content: [{ type: "text" as const, text: output }],
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			log(`validate_captions error: ${message}`);
			return {
				content: [
					{
						type: "text" as const,
						text: `Error validating captions: ${message}\n\nMake sure the input is valid CWI document JSON.`,
					},
				],
				isError: true,
			};
		}
	},
);

// --------------------------------------------------------------------------
// Tool 3: preview_captions
// --------------------------------------------------------------------------

server.tool(
	"preview_captions",
	"Preview CWI captions as terminal-formatted text. If a time is provided, " +
		"shows the caption events active at that moment with ANSI color styling. " +
		"If no time is provided, shows a full document summary with cast, " +
		"timing, and all caption events.",
	{
		cwi_json: z.string().describe("The CWI document as a JSON string"),
		time: z
			.number()
			.optional()
			.describe("Time in seconds to preview (omit for full document summary)"),
	},
	async ({ cwi_json, time }) => {
		try {
			log(`preview_captions called (time=${time ?? "summary"})`);

			const doc = parseCWIDocument(cwi_json);
			const renderer = new TerminalRenderer();

			let output: string;

			if (time !== undefined) {
				const frame = renderer.renderFrame(doc, time);
				if (frame === "") {
					output = `No captions active at ${time}s. Document duration: ${doc.metadata.duration}s.`;
				} else {
					output = `Caption at ${time}s:\n\n${frame}`;
				}
			} else {
				output = renderer.renderSummary(doc);
			}

			return {
				content: [{ type: "text" as const, text: output }],
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			log(`preview_captions error: ${message}`);
			return {
				content: [
					{
						type: "text" as const,
						text: `Error previewing captions: ${message}\n\nMake sure the input is valid CWI document JSON.`,
					},
				],
				isError: true,
			};
		}
	},
);

// --------------------------------------------------------------------------
// Tool 4: export_captions
// --------------------------------------------------------------------------

server.tool(
	"export_captions",
	"Export a CWI document to WebVTT format. WebVTT is the standard " +
		"subtitle format supported by all major video players and streaming " +
		"platforms. Includes speaker voice tags per the WebVTT spec.",
	{
		cwi_json: z.string().describe("The CWI document as a JSON string"),
		format: z.enum(["webvtt"]).describe('Export format (currently only "webvtt" is supported)'),
	},
	async ({ cwi_json, format }) => {
		try {
			log(`export_captions called (format=${format})`);

			const doc = parseCWIDocument(cwi_json);

			let output: string;

			switch (format) {
				case "webvtt":
					output = exportWebVTT(doc);
					break;
				default:
					// This shouldn't happen due to zod enum validation,
					// but handle it gracefully
					return {
						content: [
							{
								type: "text" as const,
								text: `Unsupported format: "${format}". Currently only "webvtt" is supported.`,
							},
						],
						isError: true,
					};
			}

			return {
				content: [{ type: "text" as const, text: output }],
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			log(`export_captions error: ${message}`);
			return {
				content: [
					{
						type: "text" as const,
						text: `Error exporting captions: ${message}\n\nMake sure the input is valid CWI document JSON.`,
					},
				],
				isError: true,
			};
		}
	},
);

// ============================================================================
// Server Startup
// ============================================================================

async function main(): Promise<void> {
	log("Starting OpenCaptions MCP server...");

	const transport = new StdioServerTransport();
	await server.connect(transport);

	log("OpenCaptions MCP server running on stdio");
}

main().catch((error) => {
	log(`Fatal error: ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
});
