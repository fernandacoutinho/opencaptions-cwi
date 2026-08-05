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
import type { DiarizedTranscript, IntentExtractorBackend, IntentFrame, VideoInput } from "@opencaptions/types";
export declare class TribeExtractorBackend implements IntentExtractorBackend {
    private useMock;
    /**
     * @param useMock - Force mock mode (no GPU/model needed). Default: auto-detect.
     */
    constructor(useMock?: boolean);
    extract(transcript: DiarizedTranscript, input: VideoInput): Promise<IntentFrame[]>;
    private runTribeInference;
    private mockInference;
    private groupIntoUtterances;
}
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
export declare function neuralMapper(word: import("@opencaptions/types").DiarizedWord, frame: IntentFrame, speaker: import("@opencaptions/types").Speaker, override?: import("@opencaptions/types").WordIntent): Pick<import("@opencaptions/types").CWIWord, "weight" | "size" | "emphasis">;
/** Create a TRIBE v2 backend (auto-detects GPU, falls back to mock). */
export declare function createTribeBackend(useMock?: boolean): TribeExtractorBackend;
//# sourceMappingURL=index.d.ts.map