/**
 * @opencaptions/spec — Unit tests for the CWI validation engine
 */

import { describe, expect, test } from "bun:test";
import type { CWIDocument, ValidationReport } from "@opencaptions/types";
import { validate } from "./index";

// Load valid fixtures
import dialogue from "../../../fixtures/valid/dialogue.cwi.json";
import emotional from "../../../fixtures/valid/emotional.cwi.json";
import monologue from "../../../fixtures/valid/monologue.cwi.json";

// Load invalid fixtures
import flat from "../../../fixtures/invalid/flat-intonation.cwi.json";
import missingSpeaker from "../../../fixtures/invalid/missing-speaker.cwi.json";
import overlapping from "../../../fixtures/invalid/overlapping-events.cwi.json";

// UUID v4 regex
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ============================================================================
// Valid Documents
// ============================================================================

describe("validate — valid documents", () => {
	test("monologue passes with overall_score >= 80 and all pillars passing", () => {
		const report = validate(monologue as CWIDocument);
		expect(report.passed).toBe(true);
		expect(report.overall_score).toBeGreaterThanOrEqual(80);
		expect(report.pillars.attribution.passed).toBe(true);
		expect(report.pillars.synchronization.passed).toBe(true);
		expect(report.pillars.intonation.passed).toBe(true);
	});

	test("dialogue passes validation", () => {
		const report = validate(dialogue as CWIDocument);
		expect(report.passed).toBe(true);
	});

	test("emotional passes validation", () => {
		const report = validate(emotional as CWIDocument);
		expect(report.passed).toBe(true);
	});
});

// ============================================================================
// Invalid Documents
// ============================================================================

describe("validate — invalid documents", () => {
	test("missing-speaker triggers ATT_001 finding", () => {
		const report = validate(missingSpeaker as CWIDocument);
		const allFindings = [
			...report.pillars.attribution.findings,
			...report.pillars.synchronization.findings,
			...report.pillars.intonation.findings,
		];
		const att001 = allFindings.filter((f) => f.rule_id === "ATT_001");
		expect(att001.length).toBeGreaterThanOrEqual(1);
	});

	test("overlapping-events triggers SYN_003 finding", () => {
		const report = validate(overlapping as CWIDocument);
		const syncFindings = report.pillars.synchronization.findings;
		const syn003 = syncFindings.filter((f) => f.rule_id === "SYN_003");
		expect(syn003.length).toBeGreaterThanOrEqual(1);
	});

	test("overlapping-events triggers INT_001 finding (weight out of range)", () => {
		const report = validate(overlapping as CWIDocument);
		const intFindings = report.pillars.intonation.findings;
		const int001 = intFindings.filter((f) => f.rule_id === "INT_001");
		expect(int001.length).toBeGreaterThanOrEqual(1);
	});

	test("flat-intonation triggers INT_003 finding", () => {
		const report = validate(flat as CWIDocument);
		const intFindings = report.pillars.intonation.findings;
		const int003 = intFindings.filter((f) => f.rule_id === "INT_003");
		expect(int003.length).toBeGreaterThanOrEqual(1);
	});
});

// ============================================================================
// Report Integrity
// ============================================================================

describe("validate — report integrity", () => {
	let report: ValidationReport;

	test("report has non-empty document_hash", () => {
		report = validate(monologue as CWIDocument);
		expect(typeof report.document_hash).toBe("string");
		expect(report.document_hash.length).toBeGreaterThan(0);
	});

	test("report has non-empty report_hash", () => {
		report = validate(monologue as CWIDocument);
		expect(typeof report.report_hash).toBe("string");
		expect(report.report_hash.length).toBeGreaterThan(0);
	});

	test("report has report_id in UUID format", () => {
		report = validate(monologue as CWIDocument);
		expect(report.report_id).toMatch(UUID_RE);
	});

	test("document_hash and report_hash are different", () => {
		report = validate(monologue as CWIDocument);
		expect(report.document_hash).not.toBe(report.report_hash);
	});

	test("report stats reflect the input document", () => {
		report = validate(monologue as CWIDocument);
		expect(report.stats.caption_events).toBe(monologue.captions.length);
		expect(report.stats.speakers_detected).toBe(monologue.cast.length);
		expect(report.stats.duration_seconds).toBe(monologue.metadata.duration);
		expect(report.stats.extractor_backend).toBe(monologue.metadata.extractor_backend);

		const totalWords = monologue.captions.reduce(
			(sum: number, e: { words: unknown[] }) => sum + e.words.length,
			0,
		);
		expect(report.stats.words_total).toBe(totalWords);
	});
});
