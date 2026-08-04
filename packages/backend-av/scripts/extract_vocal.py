#!/usr/bin/env python3
"""
Vocal feature extraction using parselmouth (Praat) and librosa.

Input:  --input <video_path>, stdin receives JSON array of utterance windows:
        [{"id": "utt_0", "start": 0.0, "end": 2.5}, ...]
Output: JSON to stdout mapping utterance ID to VocalFeatures:
{
  "utt_0": {
    "pitch_mean_hz": 150.0,
    "pitch_normalized": 0.45,
    "volume_mean_db": -20.0,
    "volume_normalized": 0.55,
    "speech_rate_wpm": 130
  },
  ...
}
"""

import argparse
import json
import sys
import subprocess
import tempfile
import os
import numpy as np


def extract_audio(video_path: str) -> str:
    """Extract audio from video as WAV."""
    audio_path = tempfile.mktemp(suffix=".wav")
    subprocess.run(
        ["ffmpeg", "-i", video_path, "-vn", "-acodec", "pcm_s16le",
         "-ar", "16000", "-ac", "1", "-y", audio_path],
        capture_output=True, text=True, check=True,
    )
    return audio_path


def extract_pitch_praat(audio_path: str, start: float, end: float) -> tuple[float, list[float]]:
    """Extract F0 (pitch) using Praat via parselmouth."""
    try:
        import parselmouth
        from parselmouth.praat import call
    except ImportError:
        return None, []

    snd = parselmouth.Sound(audio_path)

    # Extract segment
    if end > start:
        snd = snd.extract_part(start, end, parselmouth.WindowShape.HANNING, 1, False)

    pitch = snd.to_pitch(time_step=0.01, pitch_floor=75, pitch_ceiling=600)
    pitch_values = pitch.selected_array["frequency"]

    # Filter out unvoiced frames (0 Hz)
    voiced = pitch_values[pitch_values > 0]

    if len(voiced) == 0:
        return 0.0, []

    return float(np.mean(voiced)), voiced.tolist()


def extract_intensity_praat(audio_path: str, start: float, end: float) -> tuple[float, list[float]]:
    """Extract intensity (volume in dB) using Praat."""
    try:
        import parselmouth
    except ImportError:
        return None, []

    snd = parselmouth.Sound(audio_path)
    if end > start:
        snd = snd.extract_part(start, end, parselmouth.WindowShape.HANNING, 1, False)

    intensity = snd.to_intensity(time_step=0.01)
    values = intensity.values[0]

    # Filter out silence (very low intensity)
    voiced = values[values > 30]

    if len(voiced) == 0:
        return -40.0, []

    return float(np.mean(voiced)), voiced.tolist()


def extract_speech_rate(audio_path: str, start: float, end: float, word_count: int) -> float:
    """Estimate speech rate in words per minute."""
    duration = end - start
    if duration <= 0 or word_count <= 0:
        return 0.0
    return round(word_count / (duration / 60.0), 1)


def extract_with_librosa(audio_path: str, start: float, end: float) -> dict:
    """Fallback: use librosa for basic features when parselmouth unavailable."""
    try:
        import librosa
    except ImportError:
        return None

    y, sr = librosa.load(audio_path, sr=16000, offset=start, duration=end - start)

    if len(y) == 0:
        return None

    # Pitch via librosa (less accurate than Praat but works)
    pitches, magnitudes = librosa.piptrack(y=y, sr=sr)
    pitch_values = []
    for t in range(pitches.shape[1]):
        idx = magnitudes[:, t].argmax()
        p = pitches[idx, t]
        if p > 75:
            pitch_values.append(p)

    pitch_mean = float(np.mean(pitch_values)) if pitch_values else 150.0

    # Volume via RMS
    rms = librosa.feature.rms(y=y)[0]
    rms_db = librosa.amplitude_to_db(rms)
    volume_mean = float(np.mean(rms_db))

    return {
        "pitch_mean_hz": round(pitch_mean, 1),
        "pitch_values": pitch_values,
        "volume_mean_db": round(volume_mean, 1),
        "volume_values": rms_db.tolist(),
    }


def normalize_values(values: list[float], all_speaker_values: list[float]) -> float:
    """Normalize to 0-1 relative to all speaker values."""
    if not values or not all_speaker_values:
        return 0.5

    v = np.mean(values)
    all_v = np.array(all_speaker_values)

    if np.std(all_v) == 0:
        return 0.5

    # Z-score normalization, then sigmoid to 0-1
    z = (v - np.mean(all_v)) / (np.std(all_v) + 1e-8)
    return round(float(1 / (1 + np.exp(-z))), 4)


def main():
    parser = argparse.ArgumentParser(description="Extract vocal features")
    parser.add_argument("--input", required=True, help="Path to video/audio file")
    args = parser.parse_args()

    if not os.path.exists(args.input):
        print(f"ERROR: File not found: {args.input}", file=sys.stderr)
        sys.exit(1)

    # Read utterance windows from stdin
    utterances = json.loads(sys.stdin.read())

    # Extract audio
    audio_path = args.input
    if not args.input.endswith((".wav", ".mp3", ".flac", ".ogg")):
        audio_path = extract_audio(args.input)

    try:
        # First pass: collect all pitch/volume values for normalization
        all_pitch_values = []
        all_volume_values = []
        raw_features = {}

        use_praat = True
        try:
            import parselmouth
        except ImportError:
            use_praat = False
            print("parselmouth not available, using librosa fallback", file=sys.stderr)

        for utt in utterances:
            uid = utt["id"]
            start = utt["start"]
            end = utt["end"]

            if use_praat:
                pitch_mean, pitch_vals = extract_pitch_praat(audio_path, start, end)
                volume_mean, volume_vals = extract_intensity_praat(audio_path, start, end)

                raw_features[uid] = {
                    "pitch_mean_hz": round(pitch_mean, 1) if pitch_mean else 150.0,
                    "pitch_values": pitch_vals,
                    "volume_mean_db": round(volume_mean, 1) if volume_mean else -20.0,
                    "volume_values": volume_vals,
                }
            else:
                features = extract_with_librosa(audio_path, start, end)
                if features is None:
                    raw_features[uid] = {
                        "pitch_mean_hz": 150.0, "pitch_values": [],
                        "volume_mean_db": -20.0, "volume_values": [],
                    }
                else:
                    raw_features[uid] = features

            all_pitch_values.extend(raw_features[uid].get("pitch_values", []))
            all_volume_values.extend(raw_features[uid].get("volume_values", []))

        # Second pass: normalize and build output
        result = {}
        for utt in utterances:
            uid = utt["id"]
            rf = raw_features[uid]

            result[uid] = {
                "pitch_mean_hz": rf["pitch_mean_hz"],
                "pitch_normalized": normalize_values(
                    rf.get("pitch_values", []), all_pitch_values
                ),
                "volume_mean_db": rf["volume_mean_db"],
                "volume_normalized": normalize_values(
                    rf.get("volume_values", []), all_volume_values
                ),
                "speech_rate_wpm": extract_speech_rate(
                    audio_path, utt["start"], utt["end"],
                    utt.get("word_count", 5),
                ),
            }

        print(json.dumps(result))

    finally:
        if audio_path != args.input and os.path.exists(audio_path):
            os.unlink(audio_path)


if __name__ == "__main__":
    main()
