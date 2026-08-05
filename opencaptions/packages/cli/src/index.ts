#!/usr/bin/env bun
/**
 * opencaptions CLI — Feel the film. Render the intent.
 *
 * Commands:
 *   generate <video>    Generate CWI captions from a video file
 *   validate <cwi.json> Validate a CWI document against the spec
 *   annotate <cwi.json> Correct mapper predictions interactively
 *   preview <cwi.json>  Preview captions in the terminal
 *   export <cwi.json>   Export to WebVTT, AE JSON, or Premiere XML
 *   telemetry           Manage anonymous telemetry
 *   setup               Install Python dependencies
 *   doctor              Verify all components are working
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createV1Backends } from "@opencaptions/backend-av";
import { createTribeBackend, neuralMapper } from "@opencaptions/backend-tribe";
import { Pipeline } from "@opencaptions/pipeline";
import { rulesMapper } from "@opencaptions/pipeline";
import {
	TerminalRenderer,
	exportAfterEffectsScript,
	exportPremiereXML,
	exportWebVTT,
} from "@opencaptions/renderer";
import { validate } from "@opencaptions/spec";
import { TracingCollector } from "@opencaptions/tracing";
import type { CWIDocument } from "@opencaptions/types";
import { cmdDoctor, cmdSetup } from "./setup.js";

// ============================================================================
// CLI Helpers
// ============================================================================

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";

function print(msg: string) {
	console.log(msg);
}

function printError(msg: string) {
	console.error(`${RED}Error:${RESET} ${msg}`);
}

function printSuccess(msg: string) {
	print(`${GREEN}✓${RESET} ${msg}`);
}

function printUsage() {
	print(`
${BOLD}opencaptions${RESET} — Feel the film. Render the intent.

${BOLD}Usage:${RESET}
  opencaptions generate <video> [--output <file.cwi.json>] [--backend av|tribe]
  opencaptions validate <file.cwi.json>
  opencaptions annotate <file.cwi.json>
  opencaptions preview <file.cwi.json>
  opencaptions export <file.cwi.json> --format <webvtt|ae-json|premiere-xml>
  opencaptions telemetry [show|on|off]
  opencaptions setup
  opencaptions doctor

${BOLD}Options:${RESET}
  --help, -h     Show this help message
  --version, -v  Show version
`);
}

// ============================================================================
// Commands
// ============================================================================

async function cmdGenerate(args: string[]) {
	const videoPath = args[0];
	if (!videoPath) {
		printError("Missing video file path");
		print("Usage: opencaptions generate <video> [--output <file.cwi.json>]");
		process.exit(2);
	}

	const outputIdx = args.indexOf("--output");
	const outputPath =
		outputIdx !== -1 ? args[outputIdx + 1] : videoPath.replace(/\.[^.]+$/, ".cwi.json");

	const backendIdx = args.indexOf("--backend");
	const backendType = backendIdx !== -1 ? args[backendIdx + 1] : "av";

	const isNeural = backendType === "tribe" || backendType === "neural";

	print(
		`${BOLD}Generating CWI captions${RESET} from ${CYAN}${videoPath}${RESET}` +
			` ${DIM}(${isNeural ? "TRIBE v2 neural" : "audio+vision"} backend)${RESET}\n`,
	);

	const avBackends = createV1Backends();
	const extractor = isNeural ? createTribeBackend() : avBackends.extractor;
	const mapper = isNeural ? neuralMapper : rulesMapper;

	const pipeline = new Pipeline({
		transcript: avBackends.transcript,
		diarization: avBackends.diarization,
		extractor,
		mapper,
	});

	const startTime = performance.now();

	try {
		const result = await pipeline.run({ path: resolve(videoPath) }, { output_path: outputPath });

		const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);

		printSuccess(`Pipeline complete in ${elapsed}s`);
		print("");
		printSuccess(`Transcript     ${(result.trace.stages.transcript_ms / 1000).toFixed(1)}s`);
		printSuccess(
			`Diarization    ${(result.trace.stages.diarization_ms / 1000).toFixed(1)}s  ${result.trace.input.speaker_count} speakers`,
		);
		printSuccess(`Intent         ${(result.trace.stages.extraction_ms / 1000).toFixed(1)}s`);
		printSuccess(`Mapping        ${(result.trace.stages.mapping_ms / 1000).toFixed(1)}s`);

		// Validate
		const report = validate(result.document);
		printSuccess(
			`Validation     Score: ${report.overall_score}/100  ${report.passed ? "PASSED" : "FAILED"}`,
		);
		print("");
		print(
			`  Attribution:     ${report.pillars.attribution.score}/100 ${report.pillars.attribution.passed ? "✓" : "✗"}`,
		);
		print(
			`  Synchronization: ${report.pillars.synchronization.score}/100 ${report.pillars.synchronization.passed ? "✓" : "✗"}`,
		);
		print(
			`  Intonation:      ${report.pillars.intonation.score}/100 ${report.pillars.intonation.passed ? "✓" : "✗"}`,
		);
		print("");

		// Write output
		const { writeFileSync } = await import("node:fs");
		writeFileSync(resolve(outputPath), JSON.stringify(result.document, null, 2));
		printSuccess(`Output: ${outputPath}`);

		// Also generate WebVTT sidecar
		const vttPath = outputPath.replace(/\.cwi\.json$/, ".vtt");
		writeFileSync(resolve(vttPath), exportWebVTT(result.document));
		printSuccess(`WebVTT: ${vttPath}`);

		// Record trace
		const tracing = new TracingCollector();
		if (await tracing.isEnabled()) {
			await tracing.recordTrace(result.trace);
		}
	} catch (err) {
		printError(err instanceof Error ? err.message : String(err));
		process.exit(2);
	}
}

async function cmdValidate(args: string[]) {
	const filePath = args[0];
	if (!filePath) {
		printError("Missing CWI file path");
		process.exit(2);
	}

	try {
		const doc: CWIDocument = JSON.parse(readFileSync(resolve(filePath), "utf-8"));
		const report = validate(doc);

		print(`${BOLD}Validation Report${RESET}\n`);
		print(
			`  Overall: ${report.passed ? `${GREEN}PASSED${RESET}` : `${RED}FAILED${RESET}`}  Score: ${report.overall_score}/100\n`,
		);
		print(
			`  Attribution:     ${report.pillars.attribution.score}/100 ${report.pillars.attribution.passed ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`}`,
		);
		print(
			`  Synchronization: ${report.pillars.synchronization.score}/100 ${report.pillars.synchronization.passed ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`}`,
		);
		print(
			`  Intonation:      ${report.pillars.intonation.score}/100 ${report.pillars.intonation.passed ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`}`,
		);

		// Show findings
		const allFindings = [
			...report.pillars.attribution.findings,
			...report.pillars.synchronization.findings,
			...report.pillars.intonation.findings,
		];

		if (allFindings.length > 0) {
			print(`\n  ${BOLD}Findings:${RESET}`);
			for (const f of allFindings) {
				const icon =
					f.severity === "error" ? `${RED}✗` : f.severity === "warning" ? `${YELLOW}!` : `${DIM}i`;
				print(`    ${icon}${RESET} [${f.rule_id}] ${f.message}`);
			}
		}

		process.exit(report.passed ? 0 : 1);
	} catch (err) {
		printError(err instanceof Error ? err.message : String(err));
		process.exit(2);
	}
}

async function cmdPreview(args: string[]) {
	const filePath = args[0];
	if (!filePath) {
		printError("Missing CWI file path");
		process.exit(2);
	}

	try {
		const doc: CWIDocument = JSON.parse(readFileSync(resolve(filePath), "utf-8"));
		const renderer = new TerminalRenderer();
		print(renderer.renderSummary(doc));
	} catch (err) {
		printError(err instanceof Error ? err.message : String(err));
		process.exit(2);
	}
}

async function cmdExport(args: string[]) {
	const filePath = args[0];
	const formatIdx = args.indexOf("--format");
	const format = formatIdx !== -1 ? args[formatIdx + 1] : "webvtt";

	if (!filePath) {
		printError("Missing CWI file path");
		process.exit(2);
	}

	try {
		const doc: CWIDocument = JSON.parse(readFileSync(resolve(filePath), "utf-8"));

		const { writeFileSync } = await import("node:fs");

		if (format === "webvtt") {
			const vtt = exportWebVTT(doc);
			const outPath = filePath.replace(/\.cwi\.json$/, ".vtt");
			writeFileSync(resolve(outPath), vtt);
			printSuccess(`Exported WebVTT: ${outPath}`);
		} else if (format === "ae-json") {
			const jsx = exportAfterEffectsScript(doc);
			const outPath = filePath.replace(/\.cwi\.json$/, ".jsx");
			writeFileSync(resolve(outPath), jsx);
			printSuccess(`Exported After Effects script: ${outPath}`);
		} else if (format === "premiere-xml") {
			const xml = exportPremiereXML(doc);
			const outPath = filePath.replace(/\.cwi\.json$/, ".xml");
			writeFileSync(resolve(outPath), xml);
			printSuccess(`Exported Premiere Pro XML: ${outPath}`);
		} else {
			printError(`Format "${format}" not supported. Available: webvtt, ae-json, premiere-xml`);
			process.exit(2);
		}
	} catch (err) {
		printError(err instanceof Error ? err.message : String(err));
		process.exit(2);
	}
}

async function cmdTelemetry(args: string[]) {
	const subcommand = args[0] ?? "show";
	const collector = new TracingCollector();

	switch (subcommand) {
		case "on": {
			await collector.setEnabled(true);
			printSuccess("Telemetry enabled. Thank you for helping improve CWI intent recognition.");
			break;
		}
		case "off": {
			await collector.setEnabled(false);
			printSuccess("Telemetry disabled.");
			break;
		}
		case "show": {
			const enabled = await collector.isEnabled();
			print(`Telemetry: ${enabled ? `${GREEN}enabled${RESET}` : `${DIM}disabled${RESET}`}`);
			if (enabled) {
				const pending = await collector.getPending();
				print(`Pending traces:      ${pending.traces.length}`);
				print(`Pending corrections: ${pending.corrections.length}`);
				print(`Pending overrides:   ${pending.overrides.length}`);
			}
			break;
		}
		default:
			printError(`Unknown telemetry command: ${subcommand}`);
			print("Usage: opencaptions telemetry [show|on|off]");
			process.exit(2);
	}
}

// ============================================================================
// Main
// ============================================================================

async function main() {
	const args = process.argv.slice(2);
	const command = args[0];

	if (!command || command === "--help" || command === "-h") {
		printUsage();
		process.exit(0);
	}

	if (command === "--version" || command === "-v") {
		print("opencaptions 0.1.0");
		process.exit(0);
	}

	const commandArgs = args.slice(1);

	switch (command) {
		case "generate":
			await cmdGenerate(commandArgs);
			break;
		case "validate":
			await cmdValidate(commandArgs);
			break;
		case "preview":
			await cmdPreview(commandArgs);
			break;
		case "export":
			await cmdExport(commandArgs);
			break;
		case "telemetry":
			await cmdTelemetry(commandArgs);
			break;
		case "annotate":
			print(
				`${YELLOW}annotate${RESET} command coming soon — use the web editor at opencaptions.tools`,
			);
			break;
		case "setup":
			await cmdSetup();
			break;
		case "doctor":
			await cmdDoctor();
			break;
		default:
			printError(`Unknown command: ${command}`);
			printUsage();
			process.exit(2);
	}
}

main().catch((err) => {
	printError(err instanceof Error ? err.message : String(err));
	process.exit(2);
});
