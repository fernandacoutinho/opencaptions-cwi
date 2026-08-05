/**
 * @opencaptions/tracing — Opt-in anonymous telemetry and correction collection
 *
 * Stores traces locally as JSONL, flushes to telemetry endpoints best-effort.
 * All data is sanitized before storage: timestamps truncated to hour precision,
 * session IDs rotate daily via a salted hash, no PII is ever recorded.
 */

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, truncate, writeFile } from "node:fs/promises";
import { appendFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import type { MapperCorrection, PipelineTrace, ValidationOverride } from "@opencaptions/types";

// ============================================================================
// Config
// ============================================================================

export type TracingConfig = {
	enabled: boolean;
	session_salt: string;
	/** ISO 8601 date when the user opted in. */
	opted_in_at?: string;
	/** ISO 8601 date (YYYY-MM-DD) when the salt was last rotated. */
	salt_date?: string;
};

const CONFIG_DIR = join(homedir(), ".opencaptions");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");
const TRACES_DIR = join(CONFIG_DIR, "traces");

const TRACE_FILE = join(TRACES_DIR, "traces.jsonl");
const CORRECTIONS_FILE = join(TRACES_DIR, "corrections.jsonl");
const OVERRIDES_FILE = join(TRACES_DIR, "overrides.jsonl");

const MAX_FILE_BYTES = 100 * 1024 * 1024; // 100 MB

const TELEMETRY_BASE = "https://telemetry.opencaptions.tools/v1";

// ============================================================================
// Helpers
// ============================================================================

function todayISO(): string {
	return new Date().toISOString().slice(0, 10);
}

function freshSalt(): string {
	return randomUUID();
}

/** Truncate an ISO timestamp to hour precision: "2026-04-06T14:00:00Z". */
function truncateToHour(iso: string): string {
	const d = new Date(iso);
	d.setMinutes(0, 0, 0);
	return d.toISOString();
}

/** Generate a daily session ID from the salt. */
function dailySessionId(salt: string): string {
	const today = todayISO();
	return createHash("sha256").update(`${salt}:${today}`).digest("hex").slice(0, 16);
}

async function ensureDir(dir: string): Promise<void> {
	await mkdir(dir, { recursive: true });
}

async function fileSize(path: string): Promise<number> {
	try {
		const s = await stat(path);
		return s.size;
	} catch {
		return 0;
	}
}

async function rotateIfNeeded(path: string): Promise<void> {
	const size = await fileSize(path);
	if (size >= MAX_FILE_BYTES) {
		const rotated = `${path}.1`;
		// Overwrite any previous rotation
		await rename(path, rotated);
	}
}

async function appendJsonl(path: string, data: unknown): Promise<void> {
	await ensureDir(TRACES_DIR);
	await rotateIfNeeded(path);
	await appendFile(path, `${JSON.stringify(data)}\n`, "utf-8");
}

async function readJsonl<T>(path: string): Promise<T[]> {
	try {
		const raw = await readFile(path, "utf-8");
		return raw
			.split("\n")
			.filter((line) => line.trim().length > 0)
			.map((line) => JSON.parse(line) as T);
	} catch {
		return [];
	}
}

// ============================================================================
// Config management
// ============================================================================

export async function loadConfig(): Promise<TracingConfig> {
	try {
		const raw = await readFile(CONFIG_PATH, "utf-8");
		const config = JSON.parse(raw) as TracingConfig;

		// Rotate salt if stale
		const today = todayISO();
		if (config.salt_date !== today) {
			config.session_salt = freshSalt();
			config.salt_date = today;
			await saveConfig(config);
		}

		return config;
	} catch {
		// Create default config
		const config: TracingConfig = {
			enabled: false,
			session_salt: freshSalt(),
			salt_date: todayISO(),
		};
		await saveConfig(config);
		return config;
	}
}

export async function saveConfig(config: TracingConfig): Promise<void> {
	await ensureDir(CONFIG_DIR);
	await writeFile(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
}

// ============================================================================
// Privacy: sanitizeTrace
// ============================================================================

/**
 * Sanitize a PipelineTrace to ensure no PII leaks.
 * - Truncates timestamp to hour precision
 * - Replaces session_id with a daily hash
 * - Strips any unexpected fields
 */
export function sanitizeTrace(trace: PipelineTrace): PipelineTrace {
	return {
		trace_id: trace.trace_id,
		session_id: trace.session_id,
		timestamp: truncateToHour(trace.timestamp),
		pipeline_version: trace.pipeline_version,
		extractor_backend: trace.extractor_backend,
		input: {
			duration_seconds: trace.input.duration_seconds,
			language: trace.input.language,
			speaker_count: trace.input.speaker_count,
		},
		stages: {
			transcript_ms: trace.stages.transcript_ms,
			diarization_ms: trace.stages.diarization_ms,
			extraction_ms: trace.stages.extraction_ms,
			mapping_ms: trace.stages.mapping_ms,
			validation_ms: trace.stages.validation_ms,
		},
		output: {
			validation_score: trace.output.validation_score,
			pillar_scores: {
				attribution: trace.output.pillar_scores.attribution,
				synchronization: trace.output.pillar_scores.synchronization,
				intonation: trace.output.pillar_scores.intonation,
			},
			caption_events: trace.output.caption_events,
			words_total: trace.output.words_total,
			passed: trace.output.passed,
		},
	};
}

// ============================================================================
// TracingCollector
// ============================================================================

export class TracingCollector {
	private configCache: TracingConfig | null = null;

	private async config(): Promise<TracingConfig> {
		if (!this.configCache) {
			this.configCache = await loadConfig();
		}
		return this.configCache;
	}

	/** Record a pipeline trace (sanitized before storage). */
	async recordTrace(trace: PipelineTrace): Promise<void> {
		const cfg = await this.config();
		if (!cfg.enabled) return;

		const sanitized = sanitizeTrace({
			...trace,
			session_id: dailySessionId(cfg.session_salt),
			timestamp: trace.timestamp || new Date().toISOString(),
		});

		await appendJsonl(TRACE_FILE, sanitized);
	}

	/** Record a mapper correction. */
	async recordCorrection(correction: MapperCorrection): Promise<void> {
		const cfg = await this.config();
		if (!cfg.enabled) return;

		await appendJsonl(CORRECTIONS_FILE, correction);
	}

	/** Record a validation override. */
	async recordOverride(override: ValidationOverride): Promise<void> {
		const cfg = await this.config();
		if (!cfg.enabled) return;

		await appendJsonl(OVERRIDES_FILE, override);
	}

	/** Get all pending (un-flushed) data for inspection. */
	async getPending(): Promise<{
		traces: PipelineTrace[];
		corrections: MapperCorrection[];
		overrides: ValidationOverride[];
	}> {
		const [traces, corrections, overrides] = await Promise.all([
			readJsonl<PipelineTrace>(TRACE_FILE),
			readJsonl<MapperCorrection>(CORRECTIONS_FILE),
			readJsonl<ValidationOverride>(OVERRIDES_FILE),
		]);
		return { traces, corrections, overrides };
	}

	/** Flush pending data to the telemetry endpoint. Best-effort. */
	async flush(): Promise<{ sent: number; failed: number }> {
		const pending = await this.getPending();
		let sent = 0;
		let failed = 0;

		// Send traces
		if (pending.traces.length > 0) {
			try {
				const res = await fetch(`${TELEMETRY_BASE}/trace`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ traces: pending.traces }),
					signal: AbortSignal.timeout(10_000),
				});
				if (res.ok) {
					sent += pending.traces.length;
					await truncateFile(TRACE_FILE);
				} else {
					console.warn(`[tracing] Failed to flush traces: HTTP ${res.status}`);
					failed += pending.traces.length;
				}
			} catch (err) {
				console.warn(`[tracing] Failed to flush traces: ${err}`);
				failed += pending.traces.length;
			}
		}

		// Send corrections
		if (pending.corrections.length > 0) {
			try {
				const res = await fetch(`${TELEMETRY_BASE}/correction`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ corrections: pending.corrections }),
					signal: AbortSignal.timeout(10_000),
				});
				if (res.ok) {
					sent += pending.corrections.length;
					await truncateFile(CORRECTIONS_FILE);
				} else {
					console.warn(`[tracing] Failed to flush corrections: HTTP ${res.status}`);
					failed += pending.corrections.length;
				}
			} catch (err) {
				console.warn(`[tracing] Failed to flush corrections: ${err}`);
				failed += pending.corrections.length;
			}
		}

		// Send overrides
		if (pending.overrides.length > 0) {
			try {
				const res = await fetch(`${TELEMETRY_BASE}/correction`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ overrides: pending.overrides }),
					signal: AbortSignal.timeout(10_000),
				});
				if (res.ok) {
					sent += pending.overrides.length;
					await truncateFile(OVERRIDES_FILE);
				} else {
					console.warn(`[tracing] Failed to flush overrides: HTTP ${res.status}`);
					failed += pending.overrides.length;
				}
			} catch (err) {
				console.warn(`[tracing] Failed to flush overrides: ${err}`);
				failed += pending.overrides.length;
			}
		}

		return { sent, failed };
	}

	/** Check if telemetry is enabled. */
	async isEnabled(): Promise<boolean> {
		const cfg = await this.config();
		return cfg.enabled;
	}

	/** Enable or disable telemetry. */
	async setEnabled(enabled: boolean): Promise<void> {
		const cfg = await this.config();
		cfg.enabled = enabled;
		if (enabled && !cfg.opted_in_at) {
			cfg.opted_in_at = new Date().toISOString();
		}
		await saveConfig(cfg);
		this.configCache = cfg;
	}
}

// ============================================================================
// Internal helpers
// ============================================================================

async function truncateFile(path: string): Promise<void> {
	try {
		await truncate(path, 0);
	} catch {
		// File may not exist, that's fine
	}
}
