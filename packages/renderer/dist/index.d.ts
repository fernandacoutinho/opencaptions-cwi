/**
 * @opencaptions/renderer — Terminal renderer and WebVTT exporter for CWI documents
 *
 * Phase 1: TerminalRenderer (ANSI-colored CLI output) + WebVTT exporter
 * Phase 2: Canvas/DOM renderers (not yet implemented)
 */
import type { CWIDocument, CaptionEvent, Speaker } from "@opencaptions/types";
/** Parse a hex color string (e.g. "#6B8AFF") into RGB components. */
export declare function hexToRgb(hex: string): {
    r: number;
    g: number;
    b: number;
};
/** Wrap text in ANSI 24-bit foreground color from a hex string. */
export declare function ansiColor(hex: string, text: string): string;
/** Wrap text in ANSI bold. */
export declare function ansiBold(text: string): string;
/** Wrap text in ANSI dim. */
export declare function ansiDim(text: string): string;
/** Return the ANSI reset sequence. */
export declare function ansiReset(): string;
/**
 * Renders CWI captions as ANSI-colored terminal output.
 * Used by the CLI `preview` command.
 */
export declare class TerminalRenderer {
    /**
     * Render a single caption event as colored terminal text.
     * Shows speaker name in their color followed by their words.
     */
    renderEvent(event: CaptionEvent, speaker: Speaker, currentTime: number): string;
    /**
     * Render all caption events active at a given time.
     * A caption event is active if its time range overlaps currentTime.
     */
    renderFrame(doc: CWIDocument, currentTime: number): string;
    /**
     * Generate a static summary of the full document for terminal display.
     * Shows document metadata, cast, and all caption events.
     */
    renderSummary(doc: CWIDocument): string;
}
export { exportAfterEffectsScript, exportPremiereXML } from "./export-ae.js";
/**
 * Export a CWI document to standard WebVTT format.
 * Serves as the FCC-compliant fallback alongside visual CWI rendering.
 *
 * Output uses speaker voice tags (`<v Name>`) per the WebVTT spec.
 */
export declare function exportWebVTT(doc: CWIDocument): string;
//# sourceMappingURL=index.d.ts.map