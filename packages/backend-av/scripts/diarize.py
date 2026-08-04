#!/usr/bin/env python3
"""
Speaker diarization backend using pyannote-audio.

Input:  --input <video_path>, stdin receives RawTranscript JSON
Output: JSON to stdout matching { segments: SpeakerSegment[] }:
{
  "segments": [
    {"speaker_id": "S0", "start": 0.0, "end": 5.2},
    {"speaker_id": "S1", "start": 5.5, "end": 10.1},
    ...
  ]
}
"""

import argparse
import json
import sys
import subprocess
import tempfile
import os


def extract_audio(video_path: str) -> str:
    """Extract audio from video as WAV using ffmpeg."""
    audio_path = tempfile.mktemp(suffix=".wav")
    result = subprocess.run(
        [
            "ffmpeg", "-i", video_path,
            "-vn", "-acodec", "pcm_s16le",
            "-ar", "16000", "-ac", "1",
            "-y", audio_path,
        ],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"Failed to extract audio: {result.stderr[:200]}")
    return audio_path


def diarize_with_pyannote(audio_path: str) -> list[dict]:
    """Run pyannote-audio speaker diarization."""
    try:
        from pyannote.audio import Pipeline
    except ImportError:
        raise ImportError("pyannote.audio not installed")

    print("Loading pyannote diarization pipeline...", file=sys.stderr)

    # Try to use HuggingFace token for pyannote models
    hf_token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN")

    try:
        pipeline = Pipeline.from_pretrained(
            "pyannote/speaker-diarization-3.1",
            use_auth_token=hf_token,
        )
    except Exception as e:
        # Fallback: try without auth (for cached models)
        print(f"Warning: Could not load with auth token: {e}", file=sys.stderr)
        try:
            pipeline = Pipeline.from_pretrained("pyannote/speaker-diarization-3.1")
        except Exception as e2:
            raise ImportError(
                f"Cannot load pyannote model: {e2}\n"
                "Set HF_TOKEN env var or run: huggingface-cli login"
            )

    print("Running diarization...", file=sys.stderr)
    diarization = pipeline(audio_path)

    # Convert to segments
    segments = []
    speaker_map = {}
    speaker_idx = 0

    for turn, _, speaker in diarization.itertracks(yield_label=True):
        # Map pyannote speaker labels to S0, S1, etc.
        if speaker not in speaker_map:
            speaker_map[speaker] = f"S{speaker_idx}"
            speaker_idx += 1

        segments.append({
            "speaker_id": speaker_map[speaker],
            "start": round(turn.start, 3),
            "end": round(turn.end, 3),
        })

    # Merge adjacent segments from the same speaker
    merged = []
    for seg in segments:
        if merged and merged[-1]["speaker_id"] == seg["speaker_id"]:
            # Extend previous segment if gap < 0.5s
            if seg["start"] - merged[-1]["end"] < 0.5:
                merged[-1]["end"] = seg["end"]
                continue
        merged.append(seg)

    print(f"Found {len(speaker_map)} speakers, {len(merged)} segments", file=sys.stderr)
    return merged


def diarize_simple_energy(audio_path: str) -> list[dict]:
    """
    Fallback: simple energy-based segmentation (single speaker).
    Used when pyannote is not available.
    """
    try:
        import librosa
        import numpy as np
    except ImportError:
        # Ultimate fallback: single speaker for entire duration
        return None

    print("Using energy-based segmentation (pyannote not available)...", file=sys.stderr)

    y, sr = librosa.load(audio_path, sr=16000)
    duration = len(y) / sr

    # Compute RMS energy in 0.5s windows
    frame_length = int(0.5 * sr)
    hop_length = frame_length // 2
    rms = librosa.feature.rms(y=y, frame_length=frame_length, hop_length=hop_length)[0]

    # Find speech regions (above 20% of max energy)
    threshold = 0.2 * np.max(rms)
    is_speech = rms > threshold

    # Convert to time segments
    segments = []
    in_speech = False
    start = 0.0

    for i, speaking in enumerate(is_speech):
        t = i * hop_length / sr
        if speaking and not in_speech:
            start = t
            in_speech = True
        elif not speaking and in_speech:
            segments.append({
                "speaker_id": "S0",
                "start": round(start, 3),
                "end": round(t, 3),
            })
            in_speech = False

    if in_speech:
        segments.append({
            "speaker_id": "S0",
            "start": round(start, 3),
            "end": round(duration, 3),
        })

    if not segments:
        segments = [{"speaker_id": "S0", "start": 0.0, "end": round(duration, 3)}]

    print(f"Energy segmentation: {len(segments)} segments (single speaker)", file=sys.stderr)
    return segments


def main():
    parser = argparse.ArgumentParser(description="Speaker diarization")
    parser.add_argument("--input", required=True, help="Path to video/audio file")
    args = parser.parse_args()

    if not os.path.exists(args.input):
        print(f"ERROR: File not found: {args.input}", file=sys.stderr)
        sys.exit(1)

    # Extract audio if needed
    audio_path = args.input
    if not args.input.endswith((".wav", ".mp3", ".flac", ".ogg")):
        audio_path = extract_audio(args.input)

    try:
        # Try pyannote first
        try:
            segments = diarize_with_pyannote(audio_path)
        except SystemExit:
            raise
        except Exception as e:
            print(f"Pyannote failed: {e}, trying fallback...", file=sys.stderr)
            segments = diarize_simple_energy(audio_path)

            if segments is None:
                # Read duration from ffprobe
                probe = subprocess.run(
                    ["ffprobe", "-v", "quiet", "-show_entries", "format=duration",
                     "-of", "csv=p=0", audio_path],
                    capture_output=True, text=True,
                )
                duration = float(probe.stdout.strip()) if probe.stdout.strip() else 30.0
                segments = [{"speaker_id": "S0", "start": 0.0, "end": round(duration, 3)}]

        print(json.dumps({"segments": segments}))

    finally:
        if audio_path != args.input and os.path.exists(audio_path):
            os.unlink(audio_path)


if __name__ == "__main__":
    main()
