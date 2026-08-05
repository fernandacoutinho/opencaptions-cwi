/**
 * @opencaptions/renderer — Terminal renderer and WebVTT exporter for CWI documents
 *
 * Phase 1: TerminalRenderer (ANSI-colored CLI output) + WebVTT exporter
 * Phase 2: Canvas/DOM renderers (not yet implemented)
 */

import type { CWIDocument, CWIWord, CaptionEvent, Speaker } from "@opencaptions/types";

// ============================================================================
// ANSI Color Helpers
// ============================================================================

/** Parse a hex color string (e.g. "#6B8AFF") into RGB components. */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
	const cleaned = hex.replace(/^#/, "");
	if (cleaned.length !== 6) {
		throw new Error(`Invalid hex color: "${hex}" — expected 6-digit hex like "#RRGGBB"`);
	}
	const num = Number.parseInt(cleaned, 16);
	return {
		r: (num >> 16) & 0xff,
		g: (num >> 8) & 0xff,
		b: num & 0xff,
	};
}

/** Wrap text in ANSI 24-bit foreground color from a hex string. */
export function ansiColor(hex: string, text: string): string {
	const { r, g, b } = hexToRgb(hex);
	return `\x1b[38;2;${r};${g};${b}m${text}\x1b[0m`;
}

/** Wrap text in ANSI bold. */
export function ansiBold(text: string): string {
	return `\x1b[1m${text}\x1b[0m`;
}

/** Wrap text in ANSI dim. */
export function ansiDim(text: string): string {
	return `\x1b[2m${text}\x1b[0m`;
}

/** Return the ANSI reset sequence. */
export function ansiReset(): string {
	return "\x1b[0m";
}

// ============================================================================
// Internal helpers
// ============================================================================

const DIM_GRAY = "#666666";

/** Format seconds as HH:MM:SS.mmm for WebVTT timestamps. */
function formatVTTTime(seconds: number): string {
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = Math.floor(seconds % 60);
	const ms = Math.round((seconds % 1) * 1000);
	return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

/** Find a speaker in the cast by id. Returns undefined if not found. */
function findSpeaker(doc: CWIDocument, speakerId: string): Speaker | undefined {
	return doc.cast.find((s) => s.id === speakerId);
}

/**
 * Render a single CWI word with ANSI styling based on its state relative to currentTime.
 *
 * - Not yet spoken (start > currentTime): dim gray
 * - Currently active (start <= currentTime <= end): speaker color, bold if emphasis
 * - Already spoken (end < currentTime): speaker color (no bold)
 * - Weight > 500: bold
 * - Weight < 300: dim
 */
function renderWord(word: CWIWord, speakerColor: string, currentTime: number): string {
	const { r, g, b } = hexToRgb(speakerColor);
	const colorOpen = `\x1b[38;2;${r};${g};${b}m`;
	const reset = "\x1b[0m";

	// Not yet spoken
	if (word.start > currentTime) {
		const { r: dr, g: dg, b: db } = hexToRgb(DIM_GRAY);
		return `\x1b[38;2;${dr};${dg};${db}m${word.text}${reset}`;
	}

	// Build style codes
	const codes: string[] = [];

	// Active word (currently being spoken)
	const isActive = word.start <= currentTime && word.end >= currentTime;

	if (isActive && word.emphasis) {
		codes.push("\x1b[1m"); // bold for emphasis
	} else if (word.weight > 500) {
		codes.push("\x1b[1m"); // bold for heavy weight
	} else if (word.weight < 300) {
		codes.push("\x1b[2m"); // dim for light weight
	}

	const prefix = codes.join("");
	return `${prefix}${colorOpen}${word.text}${reset}`;
}

// ============================================================================
// TerminalRenderer
// ============================================================================

/**
 * Renders CWI captions as ANSI-colored terminal output.
 * Used by the CLI `preview` command.
 */
export class TerminalRenderer {
	/**
	 * Render a single caption event as colored terminal text.
	 * Shows speaker name in their color followed by their words.
	 */
	renderEvent(event: CaptionEvent, speaker: Speaker, currentTime: number): string {
		const label = ansiColor(speaker.color, `${speaker.name}:`);
		const words = event.words.map((w) => renderWord(w, speaker.color, currentTime)).join(" ");
		return `${label} ${words}`;
	}

	/**
	 * Render all caption events active at a given time.
	 * A caption event is active if its time range overlaps currentTime.
	 */
	renderFrame(doc: CWIDocument, currentTime: number): string {
		const activeEvents = doc.captions.filter((e) => e.start <= currentTime && e.end >= currentTime);

		if (activeEvents.length === 0) {
			return "";
		}

		const lines: string[] = [];
		for (const event of activeEvents) {
			const speaker = findSpeaker(doc, event.speaker_id);
			if (!speaker) continue;
			lines.push(this.renderEvent(event, speaker, currentTime));
		}

		return lines.join("\n");
	}

	/**
	 * Generate a static summary of the full document for terminal display.
	 * Shows document metadata, cast, and all caption events.
	 */
	renderSummary(doc: CWIDocument): string {
		const lines: string[] = [];

		// Header
		const title = doc.metadata.title ?? "Untitled";
		lines.push(ansiBold(`CWI Document: ${title}`));
		lines.push(
			ansiDim(
				`Duration: ${formatVTTTime(doc.metadata.duration)} | Language: ${doc.metadata.language} | Generator: ${doc.metadata.generator}`,
			),
		);
		lines.push("");

		// Cast
		lines.push(ansiBold("Cast:"));
		for (const speaker of doc.cast) {
			const swatch = ansiColor(speaker.color, "\u2588\u2588");
			lines.push(`  ${swatch} ${ansiColor(speaker.color, speaker.name)} (${speaker.color})`);
		}
		lines.push("");

		// Captions summary
		lines.push(ansiBold(`Captions: ${doc.captions.length} events`));
		lines.push("");

		for (const event of doc.captions) {
			const speaker = findSpeaker(doc, event.speaker_id);
			if (!speaker) continue;

			const timeRange = `[${formatVTTTime(event.start)} --> ${formatVTTTime(event.end)}]`;
			const label = ansiColor(speaker.color, speaker.name);
			const text = event.words.map((w) => w.text).join(" ");
			lines.push(`${ansiDim(timeRange)} ${label}: ${text}`);
		}

		return lines.join("\n");
	}
}

// ============================================================================
// After Effects / Premiere Pro Exporters
// ============================================================================

export { exportAfterEffectsScript, exportPremiereXML } from "./export-ae.js";

// ============================================================================
// WebVTT Exporter
// ============================================================================

/**
 * Export a CWI document to standard WebVTT format.
 * Serves as the FCC-compliant fallback alongside visual CWI rendering.
 *
 * Output uses speaker voice tags (`<v Name>`) per the WebVTT spec.
 */
export function exportWebVTT(doc: CWIDocument): string {
	const lines: string[] = ["WEBVTT", ""];

	for (let i = 0; i < doc.captions.length; i++) {
		const event = doc.captions[i];
		const speaker = findSpeaker(doc, event.speaker_id);
		const speakerName = speaker?.name ?? event.speaker_id;

		const text = event.words.map((w) => w.text).join(" ");
		const startTime = formatVTTTime(event.start);
		const endTime = formatVTTTime(event.end);

		lines.push(String(i + 1));
		lines.push(`${startTime} --> ${endTime}`);
		lines.push(`<v ${speakerName}>${text}`);
		lines.push("");
	}

	return lines.join("\n");
}
