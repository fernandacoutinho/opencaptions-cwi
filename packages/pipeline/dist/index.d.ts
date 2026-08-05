/**
 * @opencaptions/pipeline — Pipeline orchestrator and V1 RulesMapper
 *
 * Orchestrates transcript → diarization → intent extraction → CWI mapping.
 * Ships with RulesMapper (V1): a pure-function mapper from IntentFrame to CWI visuals.
 */
import type { DiarizationBackend, IntentExtractorBackend, IntentFrame, IntentMapper, PipelineOptions, PipelineResult, TranscriptBackend, VideoInput, VoiceProfile } from "@opencaptions/types";
/** Linear interpolation between a and b at parameter t (clamped to [0, 1]). */
export declare function lerp(a: number, b: number, t: number): number;
/**
 * Compute a speaker's voice profile from their IntentFrames.
 * Baseline = mean, p10 = 10th percentile, p90 = 90th percentile.
 */
export declare function computeVoiceProfile(frames: IntentFrame[], speakerId: string): VoiceProfile;
/**
 * Assign speaker colors from the SPEAKER_COLORS palette in order of first appearance.
 * Wraps around if more speakers than colors.
 */
export declare function assignSpeakerColors(speakerIds: string[]): Map<string, string>;
/**
 * V1 RulesMapper — pure function mapping IntentFrame → CWI visual parameters.
 *
 * - Pitch → weight: lerp(200, 700, pitch_normalized), rounded to nearest 100
 * - Volume → size: lerp(0.8, 1.35, volume_normalized)
 * - Emphasis: semantic.emphasis_words includes word text OR volume_normalized > 0.85
 * - Word-level overrides take precedence over utterance-level derivation
 */
export declare const rulesMapper: IntentMapper;
/** Configuration for the Pipeline constructor. */
export type PipelineConfig = {
    transcript: TranscriptBackend;
    diarization: DiarizationBackend;
    extractor: IntentExtractorBackend;
    mapper?: IntentMapper;
};
/** Pipeline orchestrator — runs the full CWI caption generation pipeline. */
export declare class Pipeline {
    private readonly transcript;
    private readonly diarization;
    private readonly extractor;
    private readonly mapper;
    constructor(config: PipelineConfig);
    run(input: VideoInput, options?: PipelineOptions): Promise<PipelineResult>;
}
//# sourceMappingURL=index.d.ts.map