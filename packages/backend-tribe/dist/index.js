/**
 * @opencaptions/backend-tribe — V3 TRIBE v2 neural intent extractor
 *
 * Uses Meta's TRIBE v2 brain encoding model to predict fMRI brain
 * activations from video, then extracts 6 ROI (Region of Interest)
 * scalars that drive CWI caption styling.
 *
 * Brain ROIs → CWI Parameters:
 *   amygdala_activation      → size (emotional intensity)
 *   right_temporal_activation → weight (prosody processing)
 *   broca_activation         → emphasis (syntactic load)
 *   insula_activation        → animation speed (visceral response)
 *   dmn_suppression          → emphasis (engagement spikes)
 *   ffa_activation           → attribution timing (face salience)
 *
 * Requires: Python 3.11+, PyTorch, CUDA GPU (RTX 3060+)
 * Falls back to mock inference when GPU/model not available.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
// ============================================================================
// Script resolution
// ============================================================================
const SCRIPTS_DIR = (() => {
    const fromSrc = join(import.meta.dirname ?? __dirname, "..", "scripts");
    if (existsSync(fromSrc))
        return fromSrc;
    const fromDist = join(import.meta.dirname ?? __dirname, "..", "..", "scripts");
    if (existsSync(fromDist))
        return fromDist;
    return fromSrc;
})();
async function runPython(scriptPath, args) {
    const venvPython = join(homedir(), ".opencaptions", "venv", "bin", "python3");
    const python = existsSync(venvPython) ? venvPython : "python3";
    return new Promise((resolve, reject) => {
        const proc = spawn(python, [scriptPath, ...args], {
            stdio: ["pipe", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        proc.stdout.on("data", (data) => {
            stdout += data.toString();
        });
        proc.stderr.on("data", (data) => {
            stderr += data.toString();
        });
        proc.on("close", (code) => {
            resolve({ stdout, stderr, exitCode: code ?? 1 });
        });
        proc.on("error", reject);
    });
}
// ============================================================================
// TribeExtractorBackend
// ============================================================================
export class TribeExtractorBackend {
    useMock;
    /**
     * @param useMock - Force mock mode (no GPU/model needed). Default: auto-detect.
     */
    constructor(useMock) {
        this.useMock = useMock ?? false;
    }
    async extract(transcript, input) {
        // Group words into utterances by speaker + pauses
        const utterances = this.groupIntoUtterances(transcript);
        // Build utterance windows for TRIBE v2
        const windows = utterances.map((utt) => ({
            id: utt.id,
            start: utt.start,
            end: utt.end,
        }));
        // Run TRIBE v2 inference
        const tribeOutput = await this.runTribeInference(input, windows);
        // Build activation lookup
        const activationMap = new Map();
        for (const act of tribeOutput.activations) {
            activationMap.set(act.utterance_id, act.neural_prediction);
        }
        // Build IntentFrames with neural predictions
        return utterances.map((utt, idx) => {
            const neural = activationMap.get(utt.id) ?? DEFAULT_NEURAL;
            return {
                id: utt.id,
                speaker_id: utt.speaker_id,
                start: utt.start,
                end: utt.end,
                vocal: {
                    // TRIBE v2 doesn't extract raw vocal features — these come from
                    // the neural predictions instead. We derive approximate values.
                    pitch_mean_hz: 150 * (1 + (neural.right_temporal_activation - 0.5)),
                    pitch_normalized: neural.right_temporal_activation,
                    volume_mean_db: -20 + 20 * (neural.amygdala_activation - 0.5),
                    volume_normalized: neural.amygdala_activation,
                    speech_rate_wpm: 130,
                    pause_before_ms: idx > 0 ? (utt.start - utterances[idx - 1].end) * 1000 : 0,
                    pause_after_ms: idx < utterances.length - 1 ? (utterances[idx + 1].start - utt.end) * 1000 : 0,
                },
                affect: {
                    // Derive affect from neural activations
                    valence: (neural.amygdala_activation - 0.5) * 2,
                    arousal: neural.insula_activation,
                    dominant_emotion: neural.amygdala_activation > 0.7
                        ? "surprise"
                        : neural.amygdala_activation < 0.3
                            ? "neutral"
                            : "uncertain",
                    confidence: Math.max(neural.amygdala_activation, neural.right_temporal_activation, neural.ffa_activation),
                },
                semantic: {
                    sarcasm_probability: 0,
                    emphasis_words: [],
                },
                word_overrides: [],
                extractor_id: `tribe-v2-${tribeOutput.model}`,
                extractor_version: "0.1.0",
                neural_prediction: neural,
            };
        });
    }
    async runTribeInference(input, windows) {
        const scriptPath = join(SCRIPTS_DIR, "extract_roi.py");
        if (!existsSync(scriptPath)) {
            console.warn("TRIBE v2 script not found, using mock inference");
            return this.mockInference(input, windows);
        }
        const args = ["--input", input.path, "--output", "-"];
        if (this.useMock) {
            args.push("--mock");
        }
        // Write utterance windows to a temp file for the script
        const { writeFileSync, unlinkSync } = await import("node:fs");
        const { tmpdir } = await import("node:os");
        const windowsPath = join(tmpdir(), `opencaptions-tribe-windows-${Date.now()}.json`);
        writeFileSync(windowsPath, JSON.stringify(windows));
        args.push("--utterances", windowsPath);
        try {
            const result = await runPython(scriptPath, args);
            if (result.exitCode !== 0) {
                console.warn(`TRIBE v2 inference failed (exit ${result.exitCode}): ${result.stderr.slice(0, 200)}`);
                console.warn("Falling back to mock inference...");
                return this.mockInference(input, windows);
            }
            try {
                return JSON.parse(result.stdout);
            }
            catch {
                console.warn("TRIBE v2 returned invalid JSON, using mock");
                return this.mockInference(input, windows);
            }
        }
        finally {
            try {
                unlinkSync(windowsPath);
            }
            catch {
                // ignore cleanup errors
            }
        }
    }
    mockInference(input, windows) {
        const activations = windows.map((w) => {
            const t = (w.start + w.end) / 2;
            return {
                utterance_id: w.id,
                start: w.start,
                end: w.end,
                neural_prediction: {
                    amygdala_activation: round(0.5 + 0.3 * Math.sin(t * 0.8), 4),
                    right_temporal_activation: round(0.5 + 0.25 * Math.sin(t * 1.2 + 1.0), 4),
                    broca_activation: round(0.4 + 0.2 * Math.sin(t * 0.5 + 2.0), 4),
                    insula_activation: round(0.3 + 0.2 * Math.sin(t * 0.7 + 0.5), 4),
                    dmn_suppression: round(0.6 + 0.25 * Math.sin(t * 0.3 + 3.0), 4),
                    ffa_activation: round(0.5 + 0.3 * Math.sin(t * 1.0 + 1.5), 4),
                },
                inference_ms: 5.0,
            };
        });
        return {
            version: "1.0",
            model: "mock",
            video: input.path,
            total_inference_ms: activations.length * 5,
            activations,
        };
    }
    groupIntoUtterances(transcript) {
        const utterances = [];
        let current = null;
        const PAUSE_THRESHOLD = 0.4;
        for (const word of transcript.words) {
            const shouldSplit = !current ||
                current.speaker_id !== word.speaker_id ||
                word.start - current.end > PAUSE_THRESHOLD;
            if (shouldSplit) {
                if (current)
                    utterances.push(current);
                current = {
                    id: `utt_${utterances.length}`,
                    speaker_id: word.speaker_id,
                    start: word.start,
                    end: word.end,
                };
            }
            else if (current) {
                current.end = word.end;
            }
        }
        if (current)
            utterances.push(current);
        return utterances;
    }
}
// ============================================================================
// NeuralMapper V3
// ============================================================================
/**
 * V3 NeuralMapper — derives CWI visual parameters from predicted brain
 * activations instead of acoustic features.
 *
 * Mapping:
 *   amygdala_activation      → size (0.8-1.35)  — emotional intensity
 *   right_temporal_activation → weight (200-700) — prosody processing
 *   broca_activation > 0.7   → emphasis: true    — syntactic load
 *   dmn_suppression > 0.85   → emphasis: true    — engagement spike
 *   insula_activation        → (future: animation speed)
 *   ffa_activation           → (future: attribution timing)
 */
export function neuralMapper(word, frame, speaker, override) {
    // If word-level override exists, use it
    if (override) {
        return {
            weight: override.weight_override ?? deriveWeight(frame),
            size: override.size_override ?? deriveSize(frame),
            emphasis: override.emphasis ?? deriveEmphasis(frame, word.text),
        };
    }
    // If no neural prediction, fall back to acoustic-based mapping
    if (!frame.neural_prediction) {
        return {
            weight: Math.round(lerp(200, 700, frame.vocal.pitch_normalized) / 100) * 100,
            size: lerp(0.8, 1.35, frame.vocal.volume_normalized),
            emphasis: frame.semantic.emphasis_words.includes(word.text) || frame.vocal.volume_normalized > 0.85,
        };
    }
    return {
        weight: deriveWeight(frame),
        size: deriveSize(frame),
        emphasis: deriveEmphasis(frame, word.text),
    };
}
function deriveWeight(frame) {
    const np = frame.neural_prediction;
    if (!np) {
        return Math.round(lerp(200, 700, frame.vocal.pitch_normalized) / 100) * 100;
    }
    // Right temporal cortex activation drives felt prosody → font weight
    return Math.round(lerp(200, 700, np.right_temporal_activation) / 100) * 100;
}
function deriveSize(frame) {
    const np = frame.neural_prediction;
    if (!np) {
        return lerp(0.8, 1.35, frame.vocal.volume_normalized);
    }
    // Amygdala activation drives emotional intensity → perceived volume → font size
    return lerp(0.8, 1.35, np.amygdala_activation);
}
function deriveEmphasis(frame, wordText) {
    const np = frame.neural_prediction;
    if (!np) {
        return frame.semantic.emphasis_words.includes(wordText) || frame.vocal.volume_normalized > 0.85;
    }
    // Broca's area (syntactic load) or DMN suppression (high engagement) → emphasis
    return np.broca_activation > 0.7 || np.dmn_suppression > 0.85;
}
function lerp(a, b, t) {
    const clamped = Math.max(0, Math.min(1, t));
    return a + (b - a) * clamped;
}
function round(n, decimals) {
    const factor = 10 ** decimals;
    return Math.round(n * factor) / factor;
}
// ============================================================================
// Default values
// ============================================================================
const DEFAULT_NEURAL = {
    amygdala_activation: 0.5,
    right_temporal_activation: 0.5,
    broca_activation: 0.3,
    insula_activation: 0.3,
    dmn_suppression: 0.5,
    ffa_activation: 0.5,
};
// ============================================================================
// Exports
// ============================================================================
/** Create a TRIBE v2 backend (auto-detects GPU, falls back to mock). */
export function createTribeBackend(useMock) {
    return new TribeExtractorBackend(useMock);
}
//# sourceMappingURL=index.js.map