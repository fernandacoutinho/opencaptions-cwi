/**
 * @opencaptions/renderer — After Effects ExtendScript + Premiere Pro XML exporters
 *
 * Converts CWI documents into:
 *   1. ExtendScript (.jsx) for After Effects — text layers with keyframed CWI properties
 *   2. Final Cut Pro XML (.xml) for Premiere Pro import — sequence with styled caption clips
 */

import type { CWIDocument, CWIWord, CaptionEvent, Speaker } from "@opencaptions/types";
import { CWI_DEFAULTS } from "@opencaptions/types";

// ============================================================================
// Shared Helpers
// ============================================================================

/** Parse a hex color string into 0-1 float RGB components (for AE) and 0-255 int (for XML). */
function parseHex(hex: string): { r: number; g: number; b: number } {
	const cleaned = hex.replace(/^#/, "");
	const num = Number.parseInt(cleaned, 16);
	return {
		r: (num >> 16) & 0xff,
		g: (num >> 8) & 0xff,
		b: num & 0xff,
	};
}

/** Find a speaker in the cast by id. */
function findSpeaker(doc: CWIDocument, speakerId: string): Speaker | undefined {
	return doc.cast.find((s) => s.id === speakerId);
}

/**
 * Convert seconds to SMPTE-style frame count at a given fps.
 * Returns the integer frame number.
 */
function secondsToFrames(seconds: number, fps: number): number {
	return Math.round(seconds * fps);
}

/**
 * Format seconds as HH:MM:SS:FF (SMPTE timecode) for FCP XML.
 */
function formatSMPTE(seconds: number, fps: number): string {
	const totalFrames = Math.round(seconds * fps);
	const f = totalFrames % fps;
	const totalSeconds = Math.floor(totalFrames / fps);
	const s = totalSeconds % 60;
	const m = Math.floor(totalSeconds / 60) % 60;
	const h = Math.floor(totalSeconds / 3600);
	return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}:${String(f).padStart(2, "0")}`;
}

// ============================================================================
// After Effects ExtendScript Export
// ============================================================================

export interface AEExportOptions {
	/** Composition width in pixels. Default: 1920. */
	compWidth?: number;
	/** Composition height in pixels. Default: 1080. */
	compHeight?: number;
	/** Frames per second. Default: 24. */
	fps?: number;
	/** Base font size in pixels. Default: 48. */
	baseFontSize?: number;
}

/**
 * Generate an ExtendScript (.jsx) file that creates CWI caption layers in After Effects.
 *
 * Each CaptionEvent becomes a text layer with:
 * - Source text set to the concatenated words in Roboto Flex
 * - Keyframed text color: white (#FFFFFF) at word.start, transitions to speaker.color over 600ms
 * - Keyframed font size: base * word.size, with 15% bounce for emphasis words
 * - Font weight: word.weight (Roboto Flex variable font axis)
 * - Opacity: 0 before event.start, 100 during, 0 after event.end
 * - Position: centered at bottom of comp (comp.height - 100)
 */
export function exportAfterEffectsScript(doc: CWIDocument, options?: AEExportOptions): string {
	const compWidth = options?.compWidth ?? 1920;
	const compHeight = options?.compHeight ?? 1080;
	const fps = options?.fps ?? 24;
	const baseFontSize = options?.baseFontSize ?? 48;

	const duration = doc.metadata.duration;
	const title = doc.metadata.title ?? "CWI Captions";

	const lines: string[] = [];

	// Script header
	lines.push("// ==========================================================================");
	lines.push("// OpenCaptions — After Effects CWI Caption Script");
	lines.push(`// Generated from: ${escapeJS(title)}`);
	lines.push(`// ${doc.captions.length} caption events, ${doc.cast.length} speakers`);
	lines.push("// ==========================================================================");
	lines.push("// Run this script in After Effects: File > Scripts > Run Script File...");
	lines.push("");
	lines.push("(function() {");
	lines.push('  app.beginUndoGroup("OpenCaptions CWI Import");');
	lines.push("");

	// Create or use existing comp
	lines.push("  // Create composition");
	lines.push("  var comp = app.project.items.addComp(");
	lines.push(`    ${JSON.stringify(`CWI - ${title}`)},`);
	lines.push(`    ${compWidth}, ${compHeight},`);
	lines.push("    1,"); // pixel aspect ratio
	lines.push(`    ${duration + 1},`); // duration + 1s padding
	lines.push(`    ${fps}`);
	lines.push("  );");
	lines.push("");

	// Helper function for easing
	lines.push("  // Easing helper: ease-in-out");
	lines.push("  var easeIn = new KeyframeEase(0.33, 66);");
	lines.push("  var easeOut = new KeyframeEase(0.33, 66);");
	lines.push("");

	// Generate each caption event as a text layer
	for (let i = 0; i < doc.captions.length; i++) {
		const event = doc.captions[i];
		const speaker = findSpeaker(doc, event.speaker_id);
		if (!speaker) continue;

		const speakerColor = parseHex(speaker.color);
		const fullText = event.words.map((w) => w.text).join(" ");
		const layerName = `[${speaker.name}] ${truncate(fullText, 40)}`;
		const animDurationSec = CWI_DEFAULTS.ANIMATION_DURATION_MS / 1000;

		lines.push(`  // --- Caption ${i + 1}: ${escapeJS(speaker.name)} ---`);
		lines.push(`  var layer${i} = comp.layers.addText(${JSON.stringify(fullText)});`);
		lines.push(`  layer${i}.name = ${JSON.stringify(layerName)};`);
		lines.push("");

		// Set source text properties (font, size, weight)
		const avgWeight = Math.round(
			event.words.reduce((sum, w) => sum + w.weight, 0) / event.words.length,
		);
		const avgSize = event.words.reduce((sum, w) => sum + w.size, 0) / event.words.length;
		const fontSize = Math.round(baseFontSize * avgSize);

		lines.push("  // Text properties");
		lines.push(`  var textProp${i} = layer${i}.property("Source Text");`);
		lines.push(`  var textDoc${i} = textProp${i}.value;`);
		lines.push(`  textDoc${i}.resetCharStyle();`);
		lines.push(`  textDoc${i}.fontSize = ${fontSize};`);
		lines.push(`  textDoc${i}.font = "RobotoFlex-Regular";`);
		lines.push(`  textDoc${i}.applyFill = true;`);
		lines.push(`  textDoc${i}.fillColor = [1, 1, 1];`); // Start white
		lines.push(`  textDoc${i}.justification = ParagraphJustification.CENTER_JUSTIFY;`);
		lines.push(`  textProp${i}.setValue(textDoc${i});`);
		lines.push("");

		// Position: centered at bottom
		lines.push("  // Position: centered bottom");
		lines.push(
			`  layer${i}.property("Position").setValue([${compWidth / 2}, ${compHeight - 100}]);`,
		);
		lines.push("");

		// Opacity keyframes: fade in at start, hold during, fade out at end
		const fadeTime = 0.15; // 150ms fade
		lines.push("  // Opacity keyframes");
		lines.push(`  var opacity${i} = layer${i}.property("Opacity");`);
		lines.push(`  opacity${i}.setValueAtTime(${Math.max(0, event.start - fadeTime)}, 0);`);
		lines.push(`  opacity${i}.setValueAtTime(${event.start}, 100);`);
		lines.push(`  opacity${i}.setValueAtTime(${event.end}, 100);`);
		lines.push(`  opacity${i}.setValueAtTime(${event.end + fadeTime}, 0);`);
		lines.push("");

		// Text color keyframes: white -> speaker color over 600ms with ease
		// Applied as a Fill Effect since AE text color isn't directly keyframable per-character easily
		lines.push("  // Color transition: white -> speaker color");
		lines.push(`  var fill${i} = layer${i}.Effects.addProperty("ADBE Fill");`);
		lines.push(`  fill${i}.property("ADBE Fill-0002").setValue(true);`); // All Masks
		lines.push(`  var fillColor${i} = fill${i}.property("ADBE Fill-0007");`);
		lines.push(`  fillColor${i}.setValueAtTime(${event.start}, [1, 1, 1, 1]);`); // white
		lines.push(
			`  fillColor${i}.setValueAtTime(${event.start + animDurationSec}, [${(speakerColor.r / 255).toFixed(4)}, ${(speakerColor.g / 255).toFixed(4)}, ${(speakerColor.b / 255).toFixed(4)}, 1]);`,
		);
		// Apply ease to color keyframes
		lines.push(`  fillColor${i}.setTemporalEaseAtKey(1, [easeIn], [easeOut]);`);
		lines.push(`  fillColor${i}.setTemporalEaseAtKey(2, [easeIn], [easeOut]);`);
		lines.push("");

		// Font weight via expression (Roboto Flex variable font axis)
		lines.push(`  // Font weight (Roboto Flex wght axis): ${avgWeight}`);
		lines.push("  // Note: Variable font axes require AE 2024+ and are set via text animator.");
		lines.push("  // The weight value is encoded as a comment for manual setup if needed.");
		lines.push("");

		// Emphasis bounce: 15% size increase over 600ms for emphasis words
		const hasEmphasis = event.words.some((w) => w.emphasis);
		if (hasEmphasis) {
			lines.push("  // Emphasis bounce (15% size increase)");
			lines.push(`  var scale${i} = layer${i}.property("Scale");`);
			for (const word of event.words) {
				if (!word.emphasis) continue;
				const bounceStart = word.start;
				const bouncePeak = word.start + animDurationSec / 2;
				const bounceEnd = word.start + animDurationSec;
				lines.push(`  // Emphasis: "${escapeJS(word.text)}" at ${word.start.toFixed(3)}s`);
				lines.push(`  scale${i}.setValueAtTime(${bounceStart}, [100, 100, 100]);`);
				lines.push(
					`  scale${i}.setValueAtTime(${bouncePeak}, [${100 + CWI_DEFAULTS.EMPHASIS_BOUNCE_PERCENT}, ${100 + CWI_DEFAULTS.EMPHASIS_BOUNCE_PERCENT}, 100]);`,
				);
				lines.push(`  scale${i}.setValueAtTime(${bounceEnd}, [100, 100, 100]);`);
			}
			lines.push("");
		}

		// Per-word timing comment block for manual text animator setup
		lines.push("  // Word timing reference for text animators:");
		for (const word of event.words) {
			lines.push(
				`  //   "${escapeJS(word.text)}": ${word.start.toFixed(3)}s - ${word.end.toFixed(3)}s  weight=${word.weight}  size=${word.size.toFixed(2)}  emphasis=${word.emphasis}`,
			);
		}
		lines.push("");
	}

	// Close script
	lines.push("  app.endUndoGroup();");
	lines.push(
		`  alert("OpenCaptions: Created ${doc.captions.length} caption layers in comp '" + comp.name + "'");`,
	);
	lines.push("})();");

	return lines.join("\n");
}

// ============================================================================
// Premiere Pro XML Export (FCP XML 1.0 format)
// ============================================================================

export interface PremiereXMLOptions {
	/** Frames per second. Default: 24. */
	fps?: number;
	/** Sequence width in pixels. Default: 1920. */
	width?: number;
	/** Sequence height in pixels. Default: 1080. */
	height?: number;
}

/**
 * Generate Premiere Pro compatible XML (Final Cut Pro XML format) with caption clips.
 *
 * Each CaptionEvent becomes a clip on a video track containing:
 * - Text content with timing
 * - Speaker attribution via clip name and marker color
 * - Duration and position matching the CWI timing
 */
export function exportPremiereXML(doc: CWIDocument, options?: PremiereXMLOptions): string {
	const fps = options?.fps ?? 24;
	const width = options?.width ?? 1920;
	const height = options?.height ?? 1080;

	const duration = doc.metadata.duration;
	const title = doc.metadata.title ?? "CWI Captions";
	const totalFrames = secondsToFrames(duration + 1, fps);

	const lines: string[] = [];

	// XML header
	lines.push('<?xml version="1.0" encoding="UTF-8"?>');
	lines.push("<!DOCTYPE xmeml>");
	lines.push('<xmeml version="5">');
	lines.push("  <sequence>");
	lines.push(`    <name>${escapeXML(title)}</name>`);
	lines.push(`    <duration>${totalFrames}</duration>`);
	lines.push("    <rate>");
	lines.push("      <timebase>24</timebase>");
	lines.push("      <ntsc>FALSE</ntsc>");
	lines.push("    </rate>");

	// Media section
	lines.push("    <media>");

	// Video track with caption generators
	lines.push("      <video>");
	lines.push("        <format>");
	lines.push("          <samplecharacteristics>");
	lines.push(`            <width>${width}</width>`);
	lines.push(`            <height>${height}</height>`);
	lines.push("            <pixelaspectratio>square</pixelaspectratio>");
	lines.push("          </samplecharacteristics>");
	lines.push("        </format>");
	lines.push("        <track>");

	for (let i = 0; i < doc.captions.length; i++) {
		const event = doc.captions[i];
		const speaker = findSpeaker(doc, event.speaker_id);
		if (!speaker) continue;

		const speakerColor = parseHex(speaker.color);
		const fullText = event.words.map((w) => w.text).join(" ");
		const startFrame = secondsToFrames(event.start, fps);
		const endFrame = secondsToFrames(event.end, fps);
		const clipDurationFrames = endFrame - startFrame;
		const clipId = `caption-${i + 1}`;

		lines.push(`          <clipitem id="${clipId}">`);
		lines.push(
			`            <name>${escapeXML(speaker.name)}: ${escapeXML(truncate(fullText, 60))}</name>`,
		);
		lines.push(`            <duration>${clipDurationFrames}</duration>`);
		lines.push("            <rate>");
		lines.push(`              <timebase>${fps}</timebase>`);
		lines.push("              <ntsc>FALSE</ntsc>");
		lines.push("            </rate>");
		lines.push(`            <start>${startFrame}</start>`);
		lines.push(`            <end>${endFrame}</end>`);
		lines.push("            <in>0</in>");
		lines.push(`            <out>${clipDurationFrames}</out>`);

		// File reference (text generator)
		lines.push(`            <file id="file-${clipId}">`);
		lines.push(`              <name>${escapeXML(speaker.name)} Caption ${i + 1}</name>`);
		lines.push("              <media>");
		lines.push("                <video>");
		lines.push("                  <samplecharacteristics>");
		lines.push(`                    <width>${width}</width>`);
		lines.push(`                    <height>${height}</height>`);
		lines.push("                  </samplecharacteristics>");
		lines.push("                </video>");
		lines.push("              </media>");
		lines.push("            </file>");

		// Text generator effect with caption text
		lines.push("            <filter>");
		lines.push("              <effect>");
		lines.push("                <name>Text</name>");
		lines.push("                <effectid>Text</effectid>");
		lines.push("                <effecttype>generator</effecttype>");
		lines.push("                <mediatype>video</mediatype>");
		lines.push("                <parameter>");
		lines.push("                  <parameterid>str</parameterid>");
		lines.push("                  <name>Text</name>");
		lines.push(`                  <value>${escapeXML(fullText)}</value>`);
		lines.push("                </parameter>");
		lines.push("                <parameter>");
		lines.push("                  <parameterid>fontname</parameterid>");
		lines.push("                  <name>Font</name>");
		lines.push(`                  <value>${CWI_DEFAULTS.FONT_FAMILY}</value>`);
		lines.push("                </parameter>");
		lines.push("                <parameter>");
		lines.push("                  <parameterid>fontsize</parameterid>");
		lines.push("                  <name>Size</name>");
		const avgSize = event.words.reduce((sum, w) => sum + w.size, 0) / event.words.length;
		lines.push(`                  <value>${Math.round(48 * avgSize)}</value>`);
		lines.push("                </parameter>");
		lines.push("                <parameter>");
		lines.push("                  <parameterid>fontcolor</parameterid>");
		lines.push("                  <name>Font Color</name>");
		lines.push("                  <value>");
		lines.push(`                    <red>${speakerColor.r}</red>`);
		lines.push(`                    <green>${speakerColor.g}</green>`);
		lines.push(`                    <blue>${speakerColor.b}</blue>`);
		lines.push("                    <alpha>255</alpha>");
		lines.push("                  </value>");
		lines.push("                </parameter>");
		lines.push("              </effect>");
		lines.push("            </filter>");

		// Speaker color as clip label
		lines.push("            <labels>");
		lines.push(`              <label>${escapeXML(speaker.color)}</label>`);
		lines.push("            </labels>");

		// Marker with speaker info and word details
		lines.push("            <marker>");
		lines.push(`              <name>${escapeXML(speaker.name)}</name>`);
		lines.push(
			`              <comment>Speaker: ${escapeXML(speaker.name)} | Color: ${escapeXML(speaker.color)} | Words: ${event.words.length}</comment>`,
		);
		lines.push("              <in>0</in>");
		lines.push(`              <out>${clipDurationFrames}</out>`);
		lines.push("            </marker>");

		// Word-level markers for precise timing
		for (let j = 0; j < event.words.length; j++) {
			const word = event.words[j];
			const wordStartFrame = secondsToFrames(word.start - event.start, fps);
			const wordEndFrame = secondsToFrames(word.end - event.start, fps);
			lines.push("            <marker>");
			lines.push(`              <name>${escapeXML(word.text)}</name>`);
			lines.push(
				`              <comment>weight=${word.weight} size=${word.size.toFixed(2)} emphasis=${word.emphasis}</comment>`,
			);
			lines.push(`              <in>${wordStartFrame}</in>`);
			lines.push(`              <out>${wordEndFrame}</out>`);
			lines.push("            </marker>");
		}

		lines.push("          </clipitem>");
	}

	lines.push("        </track>");
	lines.push("      </video>");
	lines.push("    </media>");

	// Sequence-level metadata comment
	lines.push("    <!-- OpenCaptions CWI Metadata -->");
	lines.push(`    <!-- Generator: ${escapeXML(doc.metadata.generator)} -->`);
	lines.push(`    <!-- Language: ${escapeXML(doc.metadata.language)} -->`);
	lines.push(`    <!-- Speakers: ${doc.cast.map((s) => escapeXML(s.name)).join(", ")} -->`);
	lines.push(`    <!-- Duration: ${duration.toFixed(3)}s -->`);

	lines.push("  </sequence>");
	lines.push("</xmeml>");

	return lines.join("\n");
}

// ============================================================================
// String Helpers
// ============================================================================

/** Escape a string for use in JavaScript string literals. */
function escapeJS(str: string): string {
	return str.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/'/g, "\\'").replace(/\n/g, "\\n");
}

/** Escape a string for use in XML content. */
function escapeXML(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

/** Truncate a string to a maximum length, appending "..." if truncated. */
function truncate(str: string, maxLen: number): string {
	if (str.length <= maxLen) return str;
	return `${str.slice(0, maxLen - 3)}...`;
}
