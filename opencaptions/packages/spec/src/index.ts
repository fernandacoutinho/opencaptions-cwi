/**
 * @opencaptions/spec — CWI validation rules engine
 *
 * Validates CWI documents against 12 rules across three pillars:
 * Attribution, Synchronization, and Intonation (plus FCC baseline).
 */

import type {
	CWIDocument,
	CWIWord,
	CaptionEvent,
	PillarScore,
	RuleId,
	Severity,
	ValidationFinding,
	ValidationReport,
} from "@opencaptions/types";
import { CWI_DEFAULTS } from "@opencaptions/types";

// ============================================================================
// WCAG AA Contrast Utilities
// ============================================================================

/** Parse hex color to [r, g, b] in 0-255. */
function hexToRgb(hex: string): [number, number, number] {
	const h = hex.replace("#", "");
	return [
		Number.parseInt(h.substring(0, 2), 16),
		Number.parseInt(h.substring(2, 4), 16),
		Number.parseInt(h.substring(4, 6), 16),
	];
}

/** Linearize an sRGB channel value (0-255) to linear light. */
function linearize(channel: number): number {
	const c = channel / 255;
	return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance per WCAG 2.x. */
function luminance(hex: string): number {
	const [r, g, b] = hexToRgb(hex);
	return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

/** WCAG contrast ratio between two hex colors. */
function contrastRatio(hex1: string, hex2: string): number {
	const l1 = luminance(hex1);
	const l2 = luminance(hex2);
	const lighter = Math.max(l1, l2);
	const darker = Math.min(l1, l2);
	return (lighter + 0.05) / (darker + 0.05);
}

// ============================================================================
// Hashing Utilities
// ============================================================================

/**
 * Synchronous SHA-256 using Bun's built-in hasher.
 * Falls back to a hex-encoded digest via node:crypto if Bun is unavailable.
 */
function sha256(data: string): string {
	// Bun global hasher (synchronous, no import needed)
	if (typeof globalThis.Bun !== "undefined") {
		const hasher = new globalThis.Bun.CryptoHasher("sha256");
		hasher.update(data);
		return hasher.digest("hex") as string;
	}
	// Node.js fallback (dynamic require avoids static TS resolution)
	// biome-ignore lint/suspicious/noExplicitAny: runtime fallback
	const crypto = require("node:crypto") as any;
	return crypto.createHash("sha256").update(data, "utf8").digest("hex");
}

// ============================================================================
// Rule Functions
// ============================================================================

type RuleFn = (doc: CWIDocument) => ValidationFinding[];

const BACKGROUND = "#1a1a1a";

/** ATT_001: Every caption event has a speaker_id that exists in doc.cast. */
function att001(doc: CWIDocument): ValidationFinding[] {
	const castIds = new Set(doc.cast.map((s) => s.id));
	const findings: ValidationFinding[] = [];
	for (const event of doc.captions) {
		if (!event.speaker_id || !castIds.has(event.speaker_id)) {
			findings.push({
				rule_id: "ATT_001",
				severity: "error",
				message: `Caption "${event.id}" references unknown speaker "${event.speaker_id}"`,
				location: { caption_id: event.id },
				suggestion: `Add speaker "${event.speaker_id}" to the cast array or fix the speaker_id`,
			});
		}
	}
	return findings;
}

/** ATT_002: All speakers have unique colors. */
function att002(doc: CWIDocument): ValidationFinding[] {
	const findings: ValidationFinding[] = [];
	const seen = new Map<string, string>();
	for (const speaker of doc.cast) {
		const normalized = speaker.color.toLowerCase();
		if (seen.has(normalized)) {
			findings.push({
				rule_id: "ATT_002",
				severity: "error",
				message: `Speaker "${speaker.id}" shares color ${speaker.color} with speaker "${seen.get(normalized)}"`,
				suggestion: "Assign a unique color to each speaker",
			});
		} else {
			seen.set(normalized, speaker.id);
		}
	}
	return findings;
}

/** ATT_003: Colors meet WCAG AA contrast (4.5:1) against #1a1a1a. */
function att003(doc: CWIDocument): ValidationFinding[] {
	const findings: ValidationFinding[] = [];
	for (const speaker of doc.cast) {
		const ratio = contrastRatio(speaker.color, BACKGROUND);
		if (ratio < 4.5) {
			findings.push({
				rule_id: "ATT_003",
				severity: "error",
				message: `Speaker "${speaker.id}" color ${speaker.color} has contrast ratio ${ratio.toFixed(2)}:1 against ${BACKGROUND} (minimum 4.5:1)`,
				suggestion: "Use a lighter or more saturated color from SPEAKER_COLORS",
			});
		}
	}
	return findings;
}

/** SYN_001: All words have valid timestamps (start >= 0, end > 0, end > start). */
function syn001(doc: CWIDocument): ValidationFinding[] {
	const findings: ValidationFinding[] = [];
	for (const event of doc.captions) {
		for (let i = 0; i < event.words.length; i++) {
			const w = event.words[i];
			if (w.start < 0 || w.end <= 0 || w.end <= w.start) {
				findings.push({
					rule_id: "SYN_001",
					severity: "error",
					message: `Word "${w.text}" in caption "${event.id}" has invalid timestamps (start=${w.start}, end=${w.end})`,
					location: { caption_id: event.id, word_index: i },
					suggestion:
						"Ensure all words have start >= 0, end > 0, and end > start",
				});
			}
		}
	}
	return findings;
}

/** SYN_002: Timestamps monotonically increasing within each event. */
function syn002(doc: CWIDocument): ValidationFinding[] {
	const findings: ValidationFinding[] = [];
	for (const event of doc.captions) {
		for (let i = 1; i < event.words.length; i++) {
			const prev = event.words[i - 1];
			const curr = event.words[i];
			if (curr.start < prev.start || curr.end < prev.end) {
				findings.push({
					rule_id: "SYN_002",
					severity: "error",
					message: `Word "${curr.text}" in caption "${event.id}" has non-monotonic timestamps (${curr.start}s after ${prev.start}s)`,
					location: { caption_id: event.id, word_index: i },
					suggestion: "Ensure word timestamps are monotonically increasing",
				});
			}
		}
	}
	return findings;
}

/** SYN_003: Caption events don't overlap. */
function syn003(doc: CWIDocument): ValidationFinding[] {
	const findings: ValidationFinding[] = [];
	const sorted = [...doc.captions].sort((a, b) => a.start - b.start);
	for (let i = 1; i < sorted.length; i++) {
		const prev = sorted[i - 1];
		const curr = sorted[i];
		if (curr.start < prev.end) {
			findings.push({
				rule_id: "SYN_003",
				severity: "error",
				message: `Caption "${curr.id}" (${curr.start}s) overlaps with "${prev.id}" (ends ${prev.end}s)`,
				location: { caption_id: curr.id },
				suggestion: "Adjust caption timing to prevent overlap",
			});
		}
	}
	return findings;
}

/** SYN_004: All animations use 600ms duration (or no override). */
function syn004(doc: CWIDocument): ValidationFinding[] {
	const findings: ValidationFinding[] = [];
	for (const event of doc.captions) {
		for (let i = 0; i < event.words.length; i++) {
			const w = event.words[i];
			if (
				w.animation?.duration_ms !== undefined &&
				w.animation.duration_ms !== CWI_DEFAULTS.ANIMATION_DURATION_MS
			) {
				findings.push({
					rule_id: "SYN_004",
					severity: "warning",
					message: `Word "${w.text}" in caption "${event.id}" uses ${w.animation.duration_ms}ms animation (spec: ${CWI_DEFAULTS.ANIMATION_DURATION_MS}ms)`,
					location: { caption_id: event.id, word_index: i },
					suggestion: `Set animation duration to ${CWI_DEFAULTS.ANIMATION_DURATION_MS}ms or remove the override`,
				});
			}
		}
	}
	return findings;
}

/** INT_001: Weight in valid Roboto Flex range (100-900). */
function int001(doc: CWIDocument): ValidationFinding[] {
	const findings: ValidationFinding[] = [];
	for (const event of doc.captions) {
		for (let i = 0; i < event.words.length; i++) {
			const w = event.words[i];
			if (w.weight < CWI_DEFAULTS.WEIGHT_MIN || w.weight > CWI_DEFAULTS.WEIGHT_MAX) {
				findings.push({
					rule_id: "INT_001",
					severity: "error",
					message: `Word "${w.text}" in caption "${event.id}" has weight ${w.weight} (valid range: ${CWI_DEFAULTS.WEIGHT_MIN}-${CWI_DEFAULTS.WEIGHT_MAX})`,
					location: { caption_id: event.id, word_index: i },
					suggestion: `Clamp weight to ${CWI_DEFAULTS.WEIGHT_MIN}-${CWI_DEFAULTS.WEIGHT_MAX}`,
				});
			}
		}
	}
	return findings;
}

/** INT_002: Size in valid range (0.7-1.5). */
function int002(doc: CWIDocument): ValidationFinding[] {
	const findings: ValidationFinding[] = [];
	for (const event of doc.captions) {
		for (let i = 0; i < event.words.length; i++) {
			const w = event.words[i];
			if (w.size < CWI_DEFAULTS.SIZE_MIN || w.size > CWI_DEFAULTS.SIZE_MAX) {
				findings.push({
					rule_id: "INT_002",
					severity: "error",
					message: `Word "${w.text}" in caption "${event.id}" has size ${w.size} (valid range: ${CWI_DEFAULTS.SIZE_MIN}-${CWI_DEFAULTS.SIZE_MAX})`,
					location: { caption_id: event.id, word_index: i },
					suggestion: `Clamp size to ${CWI_DEFAULTS.SIZE_MIN}-${CWI_DEFAULTS.SIZE_MAX}`,
				});
			}
		}
	}
	return findings;
}

/** INT_003: >20% of words have non-default weight (not all 400). */
function int003(doc: CWIDocument): ValidationFinding[] {
	const findings: ValidationFinding[] = [];
	let total = 0;
	let varied = 0;
	for (const event of doc.captions) {
		for (const w of event.words) {
			total++;
			if (w.weight !== 400) varied++;
		}
	}
	if (total > 0) {
		const percent = (varied / total) * 100;
		if (percent < CWI_DEFAULTS.INTONATION_MIN_VARIED_PERCENT) {
			findings.push({
				rule_id: "INT_003",
				severity: "warning",
				message: `Only ${percent.toFixed(1)}% of words have non-default weight (minimum ${CWI_DEFAULTS.INTONATION_MIN_VARIED_PERCENT}%)`,
				suggestion:
					"The intent mapper may not be capturing enough vocal variation. Check pitch extraction.",
			});
		}
	}
	return findings;
}

/** FCC_001: No gaps >3s during speech between consecutive events. */
function fcc001(doc: CWIDocument): ValidationFinding[] {
	const findings: ValidationFinding[] = [];
	const sorted = [...doc.captions].sort((a, b) => a.start - b.start);
	for (let i = 1; i < sorted.length; i++) {
		const prev = sorted[i - 1];
		const curr = sorted[i];
		const gap = curr.start - prev.end;
		if (gap > CWI_DEFAULTS.MAX_SPEECH_GAP_SECONDS) {
			findings.push({
				rule_id: "FCC_001",
				severity: "warning",
				message: `${gap.toFixed(1)}s gap between caption "${prev.id}" and "${curr.id}" (max ${CWI_DEFAULTS.MAX_SPEECH_GAP_SECONDS}s)`,
				location: { caption_id: curr.id },
				suggestion: "Check if there is missing speech in this gap",
			});
		}
	}
	return findings;
}

/** FCC_002: Max 42 chars per line (estimate: sum of word lengths + spaces per caption event). */
function fcc002(doc: CWIDocument): ValidationFinding[] {
	const findings: ValidationFinding[] = [];
	for (const event of doc.captions) {
		const lineLength = event.words.reduce((sum, w, i) => sum + w.text.length + (i > 0 ? 1 : 0), 0);
		if (lineLength > CWI_DEFAULTS.MAX_CHARS_PER_LINE) {
			findings.push({
				rule_id: "FCC_002",
				severity: "warning",
				message: `Caption "${event.id}" is ${lineLength} chars (max ${CWI_DEFAULTS.MAX_CHARS_PER_LINE})`,
				location: { caption_id: event.id },
				suggestion: "Split this caption into multiple events or reduce word count",
			});
		}
	}
	return findings;
}

// ============================================================================
// Rule Registry
// ============================================================================

type Pillar = "attribution" | "synchronization" | "intonation";

const RULE_PILLAR_MAP: Record<RuleId, Pillar> = {
	ATT_001: "attribution",
	ATT_002: "attribution",
	ATT_003: "attribution",
	SYN_001: "synchronization",
	SYN_002: "synchronization",
	SYN_003: "synchronization",
	SYN_004: "synchronization",
	INT_001: "intonation",
	INT_002: "intonation",
	INT_003: "intonation",
	FCC_001: "synchronization",
	FCC_002: "synchronization",
};

const ALL_RULES: Array<{ id: RuleId; fn: RuleFn }> = [
	{ id: "ATT_001", fn: att001 },
	{ id: "ATT_002", fn: att002 },
	{ id: "ATT_003", fn: att003 },
	{ id: "SYN_001", fn: syn001 },
	{ id: "SYN_002", fn: syn002 },
	{ id: "SYN_003", fn: syn003 },
	{ id: "SYN_004", fn: syn004 },
	{ id: "INT_001", fn: int001 },
	{ id: "INT_002", fn: int002 },
	{ id: "INT_003", fn: int003 },
	{ id: "FCC_001", fn: fcc001 },
	{ id: "FCC_002", fn: fcc002 },
];

// ============================================================================
// Pillar Score Computation
// ============================================================================

function computePillarScore(findings: ValidationFinding[]): PillarScore {
	const errors = findings.filter((f) => f.severity === "error").length;
	const warnings = findings.filter((f) => f.severity === "warning").length;
	const raw = 100 - (errors * 15 + warnings * 5);
	const score = Math.max(0, Math.min(100, raw));
	return {
		score,
		passed: score >= CWI_DEFAULTS.PILLAR_PASS_THRESHOLD,
		findings,
	};
}

// ============================================================================
// Main Validation Entry Point
// ============================================================================

/**
 * Validate a CWI document against all 12 rules.
 *
 * Returns a complete `ValidationReport` with pillar scores,
 * individual findings, document stats, and integrity hashes.
 */
export function validate(doc: CWIDocument): ValidationReport {
	// Collect findings by pillar
	const pillarFindings: Record<Pillar, ValidationFinding[]> = {
		attribution: [],
		synchronization: [],
		intonation: [],
	};

	for (const rule of ALL_RULES) {
		const findings = rule.fn(doc);
		const pillar = RULE_PILLAR_MAP[rule.id];
		pillarFindings[pillar].push(...findings);
	}

	// Compute pillar scores
	const attribution = computePillarScore(pillarFindings.attribution);
	const synchronization = computePillarScore(pillarFindings.synchronization);
	const intonation = computePillarScore(pillarFindings.intonation);

	const passed = attribution.passed && synchronization.passed && intonation.passed;
	const overallScore = Math.round(
		(attribution.score + synchronization.score + intonation.score) / 3,
	);

	// Count total words
	const wordsTotal = doc.captions.reduce((sum, e) => sum + e.words.length, 0);

	// Document hash
	const documentHash = sha256(JSON.stringify(doc));

	// Build report (without report_hash, which we compute last)
	const report: Omit<ValidationReport, "report_hash"> & { report_hash: string } = {
		document_id: `${doc.metadata.title ?? "untitled"}-${doc.version}`,
		report_id: crypto.randomUUID(),
		generated_at: new Date().toISOString(),
		passed,
		overall_score: overallScore,
		pillars: {
			attribution,
			synchronization,
			intonation,
		},
		stats: {
			duration_seconds: doc.metadata.duration,
			caption_events: doc.captions.length,
			words_total: wordsTotal,
			speakers_detected: doc.cast.length,
			extractor_backend: doc.metadata.extractor_backend,
		},
		document_hash: documentHash,
		report_hash: "", // placeholder
	};

	// Compute report hash over everything except report_hash itself
	report.report_hash = sha256(JSON.stringify(report));

	return report;
}

// ============================================================================
// Individual Rule Exports
// ============================================================================

export const rules = {
	att001,
	att002,
	att003,
	syn001,
	syn002,
	syn003,
	syn004,
	int001,
	int002,
	int003,
	fcc001,
	fcc002,
} as const;

export { contrastRatio, luminance, sha256 };
