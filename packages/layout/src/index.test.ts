import { describe, expect, test } from "bun:test";
import type { CaptionEvent } from "@opencaptions/types";
import {
	easeTimingFunction,
	estimateLineCount,
	getWordAnimationProgress,
	hexToRgb,
	layoutCaptionEvent,
	lerpColor,
} from "./index";

// ============================================================================
// Mock CaptionEvent with 5 words
// ============================================================================

const mockEvent: CaptionEvent = {
	id: "test-1",
	start: 0,
	end: 5,
	speaker_id: "S1",
	words: [
		{ text: "Hello", start: 0.0, end: 0.4, weight: 400, size: 1.0, emphasis: false },
		{ text: "there", start: 0.5, end: 0.9, weight: 450, size: 1.05, emphasis: false },
		{ text: "my", start: 1.0, end: 1.2, weight: 400, size: 1.0, emphasis: false },
		{ text: "dear", start: 1.3, end: 1.7, weight: 550, size: 1.15, emphasis: true },
		{ text: "friend", start: 1.8, end: 2.3, weight: 500, size: 1.1, emphasis: false },
	],
};

// ============================================================================
// layoutCaptionEvent
// ============================================================================

describe("layoutCaptionEvent", () => {
	const layout = layoutCaptionEvent(mockEvent, 800);

	test("returns correct number of word layouts", () => {
		expect(layout.words.length).toBe(mockEvent.words.length);
	});

	test("all word layouts have required properties", () => {
		for (const w of layout.words) {
			expect(w).toHaveProperty("x");
			expect(w).toHaveProperty("y");
			expect(w).toHaveProperty("width");
			expect(w).toHaveProperty("height");
			expect(w).toHaveProperty("line");
			expect(typeof w.x).toBe("number");
			expect(typeof w.y).toBe("number");
			expect(typeof w.width).toBe("number");
			expect(typeof w.height).toBe("number");
			expect(typeof w.line).toBe("number");
		}
	});

	test("first word starts near left padding (default 16px)", () => {
		// Default padding is 16
		expect(layout.words[0].x).toBe(16);
	});

	test("words on line 0 have y = 0", () => {
		const line0Words = layout.words.filter((w) => w.line === 0);
		expect(line0Words.length).toBeGreaterThan(0);
		for (const w of line0Words) {
			expect(w.y).toBe(0);
		}
	});

	test("totalHeight is greater than 0", () => {
		expect(layout.totalHeight).toBeGreaterThan(0);
	});

	test("lineCount is at least 1", () => {
		expect(layout.lineCount).toBeGreaterThanOrEqual(1);
	});

	test("word widths are positive", () => {
		for (const w of layout.words) {
			expect(w.width).toBeGreaterThan(0);
		}
	});
});

// ============================================================================
// estimateLineCount
// ============================================================================

describe("estimateLineCount", () => {
	test("short text in wide container fits on 1 line", () => {
		const lineCount = estimateLineCount(mockEvent, 800);
		expect(lineCount).toBe(1);
	});

	test("long text in narrow container wraps to multiple lines", () => {
		const longEvent: CaptionEvent = {
			id: "test-long",
			start: 0,
			end: 10,
			speaker_id: "S1",
			words: Array.from({ length: 20 }, (_, i) => ({
				text: "longword",
				start: i * 0.5,
				end: i * 0.5 + 0.4,
				weight: 400,
				size: 1.0,
				emphasis: false,
			})),
		};
		const lineCount = estimateLineCount(longEvent, 200);
		expect(lineCount).toBeGreaterThan(1);
	});
});

// ============================================================================
// getWordAnimationProgress
// ============================================================================

describe("getWordAnimationProgress", () => {
	const word = mockEvent.words[0]; // starts at 0.0s

	test("returns 0 before word animation starts", () => {
		// Animation starts at word.start + delay (100ms = 0.1s)
		// So at time 0.0s (before the delay elapses), progress = 0
		const progress = getWordAnimationProgress(word, 0.0);
		expect(progress).toBe(0);
	});

	test("returns 1 after animation completes", () => {
		// word.start=0, delay=100ms, duration=600ms
		// Animation completes at 0 + 0.1 + 0.6 = 0.7s
		const progress = getWordAnimationProgress(word, 1.0);
		expect(progress).toBe(1);
	});

	test("returns value between 0 and 1 during animation", () => {
		// Midpoint of animation: 0 + 0.1 + 0.3 = 0.4s
		const progress = getWordAnimationProgress(word, 0.4);
		expect(progress).toBeGreaterThan(0);
		expect(progress).toBeLessThan(1);
	});
});

// ============================================================================
// easeTimingFunction
// ============================================================================

describe("easeTimingFunction", () => {
	test("ease(0) returns 0", () => {
		expect(easeTimingFunction(0)).toBe(0);
	});

	test("ease(1) returns approximately 1", () => {
		expect(easeTimingFunction(1)).toBeCloseTo(1, 2);
	});

	test("ease(0.5) returns approximately 0.5", () => {
		const result = easeTimingFunction(0.5);
		expect(result).toBeCloseTo(0.5, 1);
	});

	test("output is monotonically increasing for 0 to 1 inputs", () => {
		let prev = easeTimingFunction(0);
		for (let t = 0.1; t <= 1.0; t += 0.1) {
			const curr = easeTimingFunction(t);
			expect(curr).toBeGreaterThanOrEqual(prev);
			prev = curr;
		}
	});
});

// ============================================================================
// lerpColor
// ============================================================================

describe("lerpColor", () => {
	test("t=0 returns the first color", () => {
		expect(lerpColor("#000000", "#FFFFFF", 0)).toBe("#000000");
	});

	test("t=1 returns the second color", () => {
		expect(lerpColor("#000000", "#FFFFFF", 1)).toBe("#ffffff");
	});

	test("t=0.5 returns a gray-ish middle value", () => {
		const result = lerpColor("#000000", "#FFFFFF", 0.5);
		const rgb = hexToRgb(result);
		// Each channel should be ~128 (half of 255, rounded)
		expect(rgb.r).toBeGreaterThanOrEqual(126);
		expect(rgb.r).toBeLessThanOrEqual(129);
		expect(rgb.g).toBeGreaterThanOrEqual(126);
		expect(rgb.g).toBeLessThanOrEqual(129);
		expect(rgb.b).toBeGreaterThanOrEqual(126);
		expect(rgb.b).toBeLessThanOrEqual(129);
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

	test("parses white", () => {
		expect(hexToRgb("#FFFFFF")).toEqual({ r: 255, g: 255, b: 255 });
	});
});
