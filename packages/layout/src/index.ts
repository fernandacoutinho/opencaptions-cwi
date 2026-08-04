/**
 * @opencaptions/layout — Word geometry engine for CWI caption rendering
 *
 * Uses Cheng Lou's Pretext for DOM-free text measurement.
 * Computes per-word x/y positions, line breaks, and total dimensions.
 */

import type { CWIWord, CaptionEvent, Speaker } from "@opencaptions/types";
import { CWI_DEFAULTS } from "@opencaptions/types";

// ============================================================================
// Types
// ============================================================================

/** Computed position and dimensions for a single word. */
export type WordLayout = {
	/** Word index within the caption event. */
	index: number;
	/** Horizontal position in pixels. */
	x: number;
	/** Vertical position in pixels. */
	y: number;
	/** Measured width in pixels. */
	width: number;
	/** Line height in pixels. */
	height: number;
	/** Which line this word is on (0-indexed). */
	line: number;
};

/** Complete layout for a caption event. */
export type CaptionLayout = {
	/** Per-word layout data. */
	words: WordLayout[];
	/** Total width of the laid-out caption. */
	totalWidth: number;
	/** Total height of the laid-out caption. */
	totalHeight: number;
	/** Number of lines after wrapping. */
	lineCount: number;
};

/** Configuration for the layout engine. */
export type LayoutConfig = {
	/** Base font size in pixels. Default: 24. */
	baseFontSize: number;
	/** Line height multiplier. Default: 1.4. */
	lineHeightMultiplier: number;
	/** Horizontal gap between words in pixels. Default: 6. */
	wordGap: number;
	/** Horizontal padding in pixels. Default: 16. */
	padding: number;
};

const DEFAULT_LAYOUT_CONFIG: LayoutConfig = {
	baseFontSize: 24,
	lineHeightMultiplier: 1.4,
	wordGap: 6,
	padding: 16,
};

// ============================================================================
// Font string builder
// ============================================================================

/**
 * Build a CSS font string for a CWI word with variable weight and size.
 * Used by Pretext's `prepare()` function.
 */
export function buildFontString(word: CWIWord, baseFontSize: number): string {
	const weight = Math.max(CWI_DEFAULTS.WEIGHT_MIN, Math.min(CWI_DEFAULTS.WEIGHT_MAX, word.weight));
	const fontSize = Math.round(baseFontSize * word.size * 100) / 100;
	return `${weight} ${fontSize}px "${CWI_DEFAULTS.FONT_FAMILY}"`;
}

// ============================================================================
// Simple layout engine (no Pretext dependency for V1)
// ============================================================================

/**
 * Estimate word width using character count heuristic.
 *
 * In V1 we use a character-count approximation since Pretext's
 * `prepare()` requires a Canvas context (browser/node-canvas).
 * V2 will integrate Pretext for pixel-accurate measurement.
 */
function estimateWordWidth(text: string, fontSize: number, weight: number): number {
	// Average character width is ~0.6x font size for proportional fonts
	// Weight affects width: heavier fonts are slightly wider
	const weightFactor = 0.9 + (weight / CWI_DEFAULTS.WEIGHT_MAX) * 0.2;
	return text.length * fontSize * 0.6 * weightFactor;
}

/**
 * Compute layout for a caption event's words within a container.
 *
 * Performs word-wrapping and assigns x/y positions to each word.
 * Uses character-count width estimation in V1.
 */
export function layoutCaptionEvent(
	event: CaptionEvent,
	containerWidth: number,
	config: Partial<LayoutConfig> = {},
): CaptionLayout {
	const cfg = { ...DEFAULT_LAYOUT_CONFIG, ...config };
	const availableWidth = containerWidth - cfg.padding * 2;
	const lineHeight = cfg.baseFontSize * cfg.lineHeightMultiplier;

	const wordLayouts: WordLayout[] = [];
	let currentX = cfg.padding;
	let currentLine = 0;
	let maxLineWidth = 0;

	for (let i = 0; i < event.words.length; i++) {
		const word = event.words[i];
		const fontSize = cfg.baseFontSize * word.size;
		const wordWidth = estimateWordWidth(word.text, fontSize, word.weight);

		// Check if word fits on current line
		if (currentX + wordWidth > availableWidth + cfg.padding && i > 0) {
			// Wrap to next line
			maxLineWidth = Math.max(maxLineWidth, currentX - cfg.padding);
			currentLine++;
			currentX = cfg.padding;
		}

		wordLayouts.push({
			index: i,
			x: currentX,
			y: currentLine * lineHeight,
			width: wordWidth,
			height: lineHeight,
			line: currentLine,
		});

		currentX += wordWidth + cfg.wordGap;
	}

	maxLineWidth = Math.max(maxLineWidth, currentX - cfg.padding - cfg.wordGap);

	return {
		words: wordLayouts,
		totalWidth: maxLineWidth + cfg.padding * 2,
		totalHeight: (currentLine + 1) * lineHeight,
		lineCount: currentLine + 1,
	};
}

/**
 * Estimate the number of lines a caption event will occupy.
 * Quick check without full layout computation.
 */
export function estimateLineCount(event: CaptionEvent, containerWidth: number): number {
	const totalChars = event.words.reduce((sum, w) => sum + w.text.length + 1, 0);
	const charsPerLine = Math.floor(containerWidth / (DEFAULT_LAYOUT_CONFIG.baseFontSize * 0.6));
	return Math.max(1, Math.ceil(totalChars / charsPerLine));
}

/**
 * Get all caption events that are active at a given time.
 */
export function getActiveEvents(events: CaptionEvent[], currentTime: number): CaptionEvent[] {
	return events.filter((e) => currentTime >= e.start && currentTime <= e.end);
}

/**
 * Get the animation progress for a word at a given time.
 * Returns 0 before animation starts, 0-1 during animation, 1 after.
 */
export function getWordAnimationProgress(
	word: CWIWord,
	currentTime: number,
	animDuration = CWI_DEFAULTS.ANIMATION_DURATION_MS,
	animDelay = CWI_DEFAULTS.ANIMATION_DELAY_MS,
): number {
	const wordStartMs = word.start * 1000;
	const currentMs = currentTime * 1000;

	if (currentMs < wordStartMs + animDelay) return 0;

	const elapsed = currentMs - wordStartMs - animDelay;
	if (elapsed >= animDuration) return 1;

	return elapsed / animDuration;
}

/**
 * CSS ease function approximation.
 * cubic-bezier(0.25, 0.1, 0.25, 1.0)
 */
export function easeTimingFunction(t: number): number {
	// Approximation of CSS ease curve
	return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

/**
 * Interpolate between two hex colors.
 */
export function lerpColor(colorA: string, colorB: string, t: number): string {
	const a = hexToRgb(colorA);
	const b = hexToRgb(colorB);

	const r = Math.round(a.r + (b.r - a.r) * t);
	const g = Math.round(a.g + (b.g - a.g) * t);
	const bl = Math.round(a.b + (b.b - a.b) * t);

	return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${bl.toString(16).padStart(2, "0")}`;
}

/** Parse hex color to RGB components. */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
	const h = hex.replace("#", "");
	return {
		r: Number.parseInt(h.substring(0, 2), 16),
		g: Number.parseInt(h.substring(2, 4), 16),
		b: Number.parseInt(h.substring(4, 6), 16),
	};
}
