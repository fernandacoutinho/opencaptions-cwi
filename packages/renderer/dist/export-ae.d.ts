/**
 * @opencaptions/renderer — After Effects ExtendScript + Premiere Pro XML exporters
 *
 * Converts CWI documents into:
 *   1. ExtendScript (.jsx) for After Effects — text layers with keyframed CWI properties
 *   2. Final Cut Pro XML (.xml) for Premiere Pro import — sequence with styled caption clips
 */
import type { CWIDocument } from "@opencaptions/types";
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
export declare function exportAfterEffectsScript(doc: CWIDocument, options?: AEExportOptions): string;
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
export declare function exportPremiereXML(doc: CWIDocument, options?: PremiereXMLOptions): string;
//# sourceMappingURL=export-ae.d.ts.map