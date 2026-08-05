/**
 * @opencaptions/tracing — Opt-in anonymous telemetry and correction collection
 *
 * Stores traces locally as JSONL, flushes to telemetry endpoints best-effort.
 * All data is sanitized before storage: timestamps truncated to hour precision,
 * session IDs rotate daily via a salted hash, no PII is ever recorded.
 */
import type { MapperCorrection, PipelineTrace, ValidationOverride } from "@opencaptions/types";
export type TracingConfig = {
    enabled: boolean;
    session_salt: string;
    /** ISO 8601 date when the user opted in. */
    opted_in_at?: string;
    /** ISO 8601 date (YYYY-MM-DD) when the salt was last rotated. */
    salt_date?: string;
};
export declare function loadConfig(): Promise<TracingConfig>;
export declare function saveConfig(config: TracingConfig): Promise<void>;
/**
 * Sanitize a PipelineTrace to ensure no PII leaks.
 * - Truncates timestamp to hour precision
 * - Replaces session_id with a daily hash
 * - Strips any unexpected fields
 */
export declare function sanitizeTrace(trace: PipelineTrace): PipelineTrace;
export declare class TracingCollector {
    private configCache;
    private config;
    /** Record a pipeline trace (sanitized before storage). */
    recordTrace(trace: PipelineTrace): Promise<void>;
    /** Record a mapper correction. */
    recordCorrection(correction: MapperCorrection): Promise<void>;
    /** Record a validation override. */
    recordOverride(override: ValidationOverride): Promise<void>;
    /** Get all pending (un-flushed) data for inspection. */
    getPending(): Promise<{
        traces: PipelineTrace[];
        corrections: MapperCorrection[];
        overrides: ValidationOverride[];
    }>;
    /** Flush pending data to the telemetry endpoint. Best-effort. */
    flush(): Promise<{
        sent: number;
        failed: number;
    }>;
    /** Check if telemetry is enabled. */
    isEnabled(): Promise<boolean>;
    /** Enable or disable telemetry. */
    setEnabled(enabled: boolean): Promise<void>;
}
//# sourceMappingURL=index.d.ts.map