/**
 * @opencaptions/types — Core type definitions for CWI caption documents
 *
 * This package is the foundation of the OpenCaptions pipeline.
 * Zero runtime dependencies. Every other package depends on this.
 */
// ============================================================================
// Constants
// ============================================================================
/** CWI spec default animation parameters. */
export const CWI_DEFAULTS = {
    ANIMATION_DURATION_MS: 600,
    ANIMATION_DELAY_MS: 100,
    ANIMATION_EASING: "ease",
    EMPHASIS_BOUNCE_PERCENT: 15,
    FONT_FAMILY: "Roboto Flex",
    WEIGHT_MIN: 100,
    WEIGHT_MAX: 900,
    SIZE_MIN: 0.7,
    SIZE_MAX: 1.5,
    MAX_CHARS_PER_LINE: 42,
    MAX_SPEECH_GAP_SECONDS: 3,
    PILLAR_PASS_THRESHOLD: 80,
    INTONATION_MIN_VARIED_PERCENT: 20,
};
/**
 * 12-color WCAG AA compliant palette for speaker attribution.
 * All colors meet 4.5:1 contrast ratio against #000000 and #1a1a1a.
 * Colors are maximally distinct in CIE Lab space (deltaE >= 30).
 */
export const SPEAKER_COLORS = [
    "#6B8AFF",
    "#FF6B6B",
    "#6BFFA3",
    "#FFD56B",
    "#D56BFF",
    "#6BF0FF",
    "#FF6BC8",
    "#A3FF6B",
    "#FF916B",
    "#6BB4FF",
    "#FFB86B",
    "#8A6BFF",
];
/** JSON Schema URI for CWI documents. */
export const CWI_SCHEMA_URI = "https://opencaptions.tools/schema/cwi/1.0.json";
/** Current CWI document version. */
export const CWI_VERSION = "1.0";
//# sourceMappingURL=index.js.map