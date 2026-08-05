/**
 * @opencaptions/spec — CWI validation rules engine
 *
 * Validates CWI documents against 12 rules across three pillars:
 * Attribution, Synchronization, and Intonation (plus FCC baseline).
 */
import type { CWIDocument, ValidationFinding, ValidationReport } from "@opencaptions/types";
/** Relative luminance per WCAG 2.x. */
declare function luminance(hex: string): number;
/** WCAG contrast ratio between two hex colors. */
declare function contrastRatio(hex1: string, hex2: string): number;
/**
 * Synchronous SHA-256 using Bun's built-in hasher.
 * Falls back to a hex-encoded digest via node:crypto if Bun is unavailable.
 */
declare function sha256(data: string): string;
/** ATT_001: Every caption event has a speaker_id that exists in doc.cast. */
declare function att001(doc: CWIDocument): ValidationFinding[];
/** ATT_002: All speakers have unique colors. */
declare function att002(doc: CWIDocument): ValidationFinding[];
/** ATT_003: Colors meet WCAG AA contrast (4.5:1) against #1a1a1a. */
declare function att003(doc: CWIDocument): ValidationFinding[];
/** SYN_001: All words have valid timestamps (start >= 0, end > 0, end > start). */
declare function syn001(doc: CWIDocument): ValidationFinding[];
/** SYN_002: Timestamps monotonically increasing within each event. */
declare function syn002(doc: CWIDocument): ValidationFinding[];
/** SYN_003: Caption events don't overlap. */
declare function syn003(doc: CWIDocument): ValidationFinding[];
/** SYN_004: All animations use 600ms duration (or no override). */
declare function syn004(doc: CWIDocument): ValidationFinding[];
/** INT_001: Weight in valid Roboto Flex range (100-900). */
declare function int001(doc: CWIDocument): ValidationFinding[];
/** INT_002: Size in valid range (0.7-1.5). */
declare function int002(doc: CWIDocument): ValidationFinding[];
/** INT_003: >20% of words have non-default weight (not all 400). */
declare function int003(doc: CWIDocument): ValidationFinding[];
/** FCC_001: No gaps >3s during speech between consecutive events. */
declare function fcc001(doc: CWIDocument): ValidationFinding[];
/** FCC_002: Max 42 chars per line (estimate: sum of word lengths + spaces per caption event). */
declare function fcc002(doc: CWIDocument): ValidationFinding[];
/**
 * Validate a CWI document against all 12 rules.
 *
 * Returns a complete `ValidationReport` with pillar scores,
 * individual findings, document stats, and integrity hashes.
 */
export declare function validate(doc: CWIDocument): ValidationReport;
export declare const rules: {
    readonly att001: typeof att001;
    readonly att002: typeof att002;
    readonly att003: typeof att003;
    readonly syn001: typeof syn001;
    readonly syn002: typeof syn002;
    readonly syn003: typeof syn003;
    readonly syn004: typeof syn004;
    readonly int001: typeof int001;
    readonly int002: typeof int002;
    readonly int003: typeof int003;
    readonly fcc001: typeof fcc001;
    readonly fcc002: typeof fcc002;
};
export { contrastRatio, luminance, sha256 };
//# sourceMappingURL=index.d.ts.map