/**
 * @opencaptions/backend-av — V1 Audio+Vision intent extractor
 *
 * Implements TranscriptBackend, DiarizationBackend, and IntentExtractorBackend
 * using existing tools via subprocess:
 * - whisper.cpp for transcription
 * - pyannote-audio for diarization
 * - parselmouth for pitch/volume
 * - librosa for speech rate
 * - OpenCV + FER for facial emotion
 * - Ollama for semantic analysis
 *
 * All Python tools communicate via JSON stdin/stdout contracts.
 */
import type { DiarizationBackend, DiarizedTranscript, IntentExtractorBackend, IntentFrame, RawTranscript, TranscriptBackend, VideoInput } from "@opencaptions/types";
export declare class WhisperTranscriptBackend implements TranscriptBackend {
    private modelSize;
    constructor(modelSize?: string);
    transcribe(input: VideoInput): Promise<RawTranscript>;
    private transcribeViaCli;
}
export declare class PyAnnoteDiarizationBackend implements DiarizationBackend {
    diarize(transcript: RawTranscript, input: VideoInput): Promise<DiarizedTranscript>;
    private fallbackSingleSpeaker;
}
export declare class AudioVisionExtractor implements IntentExtractorBackend {
    extract(transcript: DiarizedTranscript, input: VideoInput): Promise<IntentFrame[]>;
    private groupIntoUtterances;
    private extractVocal;
    private extractEmotion;
}
/** Create a fully configured V1 backend set. */
export declare function createV1Backends(): {
    transcript: WhisperTranscriptBackend;
    diarization: PyAnnoteDiarizationBackend;
    extractor: AudioVisionExtractor;
};
//# sourceMappingURL=index.d.ts.map