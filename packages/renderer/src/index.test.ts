import { describe, expect, test } from "bun:test";
import type { CWIDocument } from "@opencaptions/types";
import dialogue from "../../../fixtures/valid/dialogue.cwi.json";
import { TerminalRenderer, ansiColor, exportWebVTT, hexToRgb } from "./index";

const doc = dialogue as unknown as CWIDocument;

// ============================================================================
// exportWebVTT
// ============================================================================

describe("exportWebVTT", () => {
	const vtt = exportWebVTT(doc);

	test("output starts with WEBVTT header", () => {
		expect(vtt.startsWith("WEBVTT")).toBe(true);
	});

	test("contains voice tags for both speakers", () => {
		expect(vtt).toContain("<v Elara>");
		expect(vtt).toContain("<v Marcus>");
	});

	test("has correct number of cues (4 for dialogue fixture)", () => {
		// Each cue has a sequence number line — count lines that are just a digit
		const cueNumbers = vtt.split("\n").filter((line) => /^\d+$/.test(line.trim()));
		expect(cueNumbers.length).toBe(4);
	});

	test("timestamps are in HH:MM:SS.mmm format", () => {
		const timestampPattern = /\d{2}:\d{2}:\d{2}\.\d{3}/g;
		const matches = vtt.match(timestampPattern);
		// 4 cues * 2 timestamps each = 8
		expect(matches).not.toBeNull();
		expect(matches?.length).toBe(8);
	});

	test("contains the actual dialogue text", () => {
		expect(vtt).toContain("Where were you last night?");
		expect(vtt).toContain("I told you, I was working late.");
		expect(vtt).toContain("That's not what they said.");
		expect(vtt).toContain("You don't understand.");
	});
});

// ============================================================================
// hexToRgb
// ============================================================================

describe("hexToRgb", () => {
	test("parses pure red", () => {
		expect(hexToRgb("#FF0000")).toEqual({ r: 255, g: 0, b: 0 });
	});

	test("parses a CWI speaker color (#6B8AFF)", () => {
		expect(hexToRgb("#6B8AFF")).toEqual({ r: 107, g: 138, b: 255 });
	});

	test("parses black", () => {
		expect(hexToRgb("#000000")).toEqual({ r: 0, g: 0, b: 0 });
	});

	test("throws on invalid hex string", () => {
		expect(() => hexToRgb("#ZZZ")).toThrow();
	});
});

// ============================================================================
// ansiColor
// ============================================================================

describe("ansiColor", () => {
	test("returned string contains the original text", () => {
		const result = ansiColor("#FF0000", "hello");
		expect(result).toContain("hello");
	});

	test("contains ANSI 24-bit color escape code", () => {
		const result = ansiColor("#FF0000", "hello");
		expect(result).toContain("\x1b[38;2;");
	});

	test("ends with ANSI reset code", () => {
		const result = ansiColor("#FF0000", "hello");
		expect(result.endsWith("\x1b[0m")).toBe(true);
	});

	test("encodes correct RGB values", () => {
		const result = ansiColor("#FF0000", "test");
		expect(result).toContain("\x1b[38;2;255;0;0m");
	});
});

// ============================================================================
// TerminalRenderer
// ============================================================================

describe("TerminalRenderer", () => {
	const renderer = new TerminalRenderer();

	describe("renderSummary", () => {
		const summary = renderer.renderSummary(doc);

		test("includes speaker name Elara", () => {
			expect(summary).toContain("Elara");
		});

		test("includes speaker name Marcus", () => {
			expect(summary).toContain("Marcus");
		});

		test("includes '4 events' count", () => {
			expect(summary).toContain("4 events");
		});

		test("includes cast color hex values (swatches)", () => {
			expect(summary).toContain("#6B8AFF");
			expect(summary).toContain("#FF6B6B");
		});

		test("includes document title", () => {
			expect(summary).toContain("Dialogue");
		});
	});

	describe("renderFrame", () => {
		test("returns empty string when no events are active", () => {
			const frame = renderer.renderFrame(doc, 100);
			expect(frame).toBe("");
		});

		test("returns content when a caption event is active", () => {
			// Caption C1 runs from 0.5 to 4.0
			const frame = renderer.renderFrame(doc, 1.0);
			expect(frame.length).toBeGreaterThan(0);
			expect(frame).toContain("Elara");
		});
	});

	describe("renderEvent", () => {
		test("renders speaker label and word text", () => {
			const event = doc.captions[0];
			const speaker = doc.cast[0];
			const result = renderer.renderEvent(event, speaker, 1.0);
			expect(result).toContain("Elara");
			expect(result).toContain("Where");
		});
	});
});
