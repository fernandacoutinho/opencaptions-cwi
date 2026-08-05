/**
 * @opencaptions/layout — Word geometry engine for CWI caption rendering
 *
 * Uses Cheng Lou's Pretext for DOM-free text measurement.
 * Computes per-word x/y positions, line breaks, and total dimensions.
 */
import type { CWIWord, CaptionEvent } from "@opencaptions/types";
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
/**
 * Build a CSS font string for a CWI word with variable weight and size.
 * Used by Pretext's `prepare()` function.
 */
export declare function buildFontString(word: CWIWord, baseFontSize: number): string;
/**
 * Compute layout for a caption event's words within a container.
 *
 * Performs word-wrapping and assigns x/y positions to each word.
 * Uses character-count width estimation in V1.
 */
export declare function layoutCaptionEvent(event: CaptionEvent, containerWidth: number, config?: Partial<LayoutConfig>): CaptionLayout;
/**
 * Estimate the number of lines a caption event will occupy.
 * Quick check without full layout computation.
 */
export declare function estimateLineCount(event: CaptionEvent, containerWidth: number): number;
/**
 * Get all caption events that are active at a given time.
 */
export declare function getActiveEvents(events: CaptionEvent[], currentTime: number): CaptionEvent[];
/**
 * Get the animation progress for a word at a given time.
 * Returns 0 before animation starts, 0-1 during animation, 1 after.
 */
export declare function getWordAnimationProgress(word: CWIWord, currentTime: number, animDuration?: 600, animDelay?: 100): number;
/**
 * CSS ease function approximation.
 * cubic-bezier(0.25, 0.1, 0.25, 1.0)
 */
export declare function easeTimingFunction(t: number): number;
/**
 * Interpolate between two hex colors.
 */
export declare function lerpColor(colorA: string, colorB: string, t: number): string;
/** Parse hex color to RGB components. */
export declare function hexToRgb(hex: string): {
    r: number;
    g: number;
    b: number;
};
//# sourceMappingURL=index.d.ts.map