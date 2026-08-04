#!/usr/bin/env python3
"""
Transcription backend using OpenAI Whisper.

Input:  --input <video_path> --model <model_size>
Output: JSON to stdout matching RawTranscript schema:
{
  "words": [{"text": "...", "start": 0.0, "end": 0.5, "confidence": 0.95}, ...],
  "language": "en",
  "duration": 15.0,
  "source_backend": "whisper-large-v3"
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
        print(f"ffmpeg error: {result.stderr}", file=sys.stderr)
        raise RuntimeError(f"Failed to extract audio: {result.stderr[:200]}")
    return audio_path


def transcribe_with_whisper(audio_path: str, model_size: str) -> dict:
    """Run Whisper transcription with word-level timestamps."""
    try:
        import whisper
    except ImportError:
        print("ERROR: whisper not installed. Run: opencaptions setup", file=sys.stderr)
        sys.exit(1)

    print(f"Loading whisper model: {model_size}", file=sys.stderr)
    model = whisper.load_model(model_size)

    print("Transcribing...", file=sys.stderr)
    result = model.transcribe(
        audio_path,
        word_timestamps=True,
        verbose=False,
    )

    # Extract word-level data
    words = []
    for segment in result.get("segments", []):
        for word_info in segment.get("words", []):
            words.append({
                "text": word_info["word"].strip(),
                "start": round(word_info["start"], 3),
                "end": round(word_info["end"], 3),
                "confidence": round(word_info.get("probability", 0.9), 4),
            })

    # Get duration from the last word or segment
    duration = 0.0
    if words:
        duration = words[-1]["end"]
    elif result.get("segments"):
        duration = result["segments"][-1]["end"]

    language = result.get("language", "en")

    return {
        "words": words,
        "language": language,
        "duration": round(duration, 3),
        "source_backend": f"whisper-{model_size}",
    }


def transcribe_with_faster_whisper(audio_path: str, model_size: str) -> dict:
    """Fallback: use faster-whisper if available."""
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        return None

    print(f"Using faster-whisper model: {model_size}", file=sys.stderr)
    model = WhisperModel(model_size, device="auto", compute_type="auto")

    segments, info = model.transcribe(audio_path, word_timestamps=True)

    words = []
    for segment in segments:
        for word in segment.words:
            words.append({
                "text": word.word.strip(),
                "start": round(word.start, 3),
                "end": round(word.end, 3),
                "confidence": round(word.probability, 4),
            })

    duration = words[-1]["end"] if words else info.duration

    return {
        "words": words,
        "language": info.language,
        "duration": round(duration, 3),
        "source_backend": f"faster-whisper-{model_size}",
    }


def main():
    parser = argparse.ArgumentParser(description="Transcribe video with Whisper")
    parser.add_argument("--input", required=True, help="Path to video/audio file")
    parser.add_argument("--model", default="base", help="Whisper model size (tiny, base, small, medium, large-v3)")
    args = parser.parse_args()

    if not os.path.exists(args.input):
        print(f"ERROR: File not found: {args.input}", file=sys.stderr)
        sys.exit(1)

    # Extract audio if needed
    audio_path = args.input
    if not args.input.endswith((".wav", ".mp3", ".flac", ".ogg")):
        print("Extracting audio from video...", file=sys.stderr)
        audio_path = extract_audio(args.input)

    try:
        # Try faster-whisper first (faster, lower memory)
        result = transcribe_with_faster_whisper(audio_path, args.model)

        # Fall back to openai-whisper
        if result is None:
            result = transcribe_with_whisper(audio_path, args.model)

        print(json.dumps(result))

    finally:
        # Clean up temp audio file
        if audio_path != args.input and os.path.exists(audio_path):
            os.unlink(audio_path)


if __name__ == "__main__":
    main()
