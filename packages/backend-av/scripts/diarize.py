#!/usr/bin/env python3
"""
Speaker diarization backend using pyannote-audio + whisperx alignment.

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


def diarize_with_whisperx_and_pyannote(
    audio_path: str,
    min_speakers: int = None,
    max_speakers: int = None
) -> list[dict]:
    """
    Tenta rodar a diarização e alinhamento via WhisperX / PyAnnote.
    """
    hf_token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN")

    # 1. TENTATIVA COM WHISPERX (Alinhamento em Nível de Palavra)
    try:
        import whisperx
        import torch

        device = "cuda" if torch.cuda.is_available() else "cpu"
        print(f"Running WhisperX diarization on {device}...", file=sys.stderr)

        # Carrega o pipeline de diarização do WhisperX (que envelopa o PyAnnote de forma otimizada)
        diarize_model = whisperx.DiarizationPipeline(
            use_auth_token=hf_token,
            device=device
        )

        audio = whisperx.load_audio(audio_path)
        diarize_df = diarize_model(
            audio,
            min_speakers=min_speakers,
            max_speakers=max_speakers
        )

        segments = []
        speaker_map = {}
        speaker_idx = 0

        # Itera sobre os segmentos detectados pelo WhisperX
        for _, row in diarize_df.iterrows():
            speaker = row.get("speaker", "SPEAKER_00")
            if speaker not in speaker_map:
                speaker_map[speaker] = f"S{speaker_idx}"
                speaker_idx += 1

            segments.append({
                "speaker_id": speaker_map[speaker],
                "start": round(float(row["start"]), 3),
                "end": round(float(row["end"]), 3),
            })

        print(f"[WhisperX] Found {len(speaker_map)} speakers, {len(segments)} segments", file=sys.stderr)
        return merge_segments(segments, max_gap=0.1)

    except Exception as e:
        print(f"WhisperX pipeline not available or failed ({e}). Falling back to pure PyAnnote...", file=sys.stderr)

    # 2. FALLBACK PARA PYANNOTE PURO (Se o WhisperX não estiver instalado/configurado)
    try:
        from pyannote.audio import Pipeline
    except ImportError:
        raise ImportError("Neither whisperx nor pyannote.audio are installed.")

    print("Loading pyannote diarization pipeline...", file=sys.stderr)

    try:
        pipeline = Pipeline.from_pretrained(
            "pyannote/speaker-diarization-3.1",
            use_auth_token=hf_token,
        )
    except Exception as e:
        print(f"Warning: Could not load with auth token: {e}", file=sys.stderr)
        pipeline = Pipeline.from_pretrained("pyannote/speaker-diarization-3.1")

    kwargs = {}
    if min_speakers is not None:
        kwargs["min_speakers"] = min_speakers
    if max_speakers is not None:
        kwargs["max_speakers"] = max_speakers

    diarization = pipeline(audio_path, **kwargs)

    segments = []
    speaker_map = {}
    speaker_idx = 0

    for turn, _, speaker in diarization.itertracks(yield_label=True):
        if speaker not in speaker_map:
            speaker_map[speaker] = f"S{speaker_idx}"
            speaker_idx += 1

        segments.append({
            "speaker_id": speaker_map[speaker],
            "start": round(turn.start, 3),
            "end": round(turn.end, 3),
        })

    print(f"[PyAnnote] Found {len(speaker_map)} speakers, {len(segments)} segments", file=sys.stderr)
    return merge_segments(segments, max_gap=0.1)


def merge_segments(segments: list[dict], max_gap: float = 0.1) -> list[dict]:
    """
    Funde apenas segmentos consecutivos do MESMO locutor se a pausa for
    menor que `max_gap` (reduzido de 0.5s para 0.1s para capturar trocas rápidas de voz).
    """
    if not segments:
        return []

    merged = []
    for seg in segments:
        if merged and merged[-1]["speaker_id"] == seg["speaker_id"]:
            # Só funde se o mesmo falante der uma pausa menor que 100ms (0.1s)
            if seg["start"] - merged[-1]["end"] < max_gap:
                merged[-1]["end"] = seg["end"]
                continue
        merged.append(seg)

    return merged


def diarize_simple_energy(audio_path: str) -> list[dict]:
    """Fallback simples de energia (único locutor) se nada mais estiver disponível."""
    try:
        import librosa
        import numpy as np
    except ImportError:
        return None

    print("Using energy-based segmentation (fallback)...", file=sys.stderr)
    y, sr = librosa.load(audio_path, sr=16000)
    duration = len(y) / sr

    frame_length = int(0.5 * sr)
    hop_length = frame_length // 2
    rms = librosa.feature.rms(y=y, frame_length=frame_length, hop_length=hop_length)[0]

    threshold = 0.2 * np.max(rms)
    is_speech = rms > threshold

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

    return segments


def main():
    parser = argparse.ArgumentParser(description="Speaker diarization using WhisperX / PyAnnote")
    parser.add_argument("--input", required=True, help="Path to video/audio file")
    parser.add_argument("--min_speakers", type=int, default=None, help="Minimum number of speakers")
    parser.add_argument("--max_speakers", type=int, default=None, help="Maximum number of speakers")
    args = parser.parse_args()

    if not os.path.exists(args.input):
        print(f"ERROR: File not found: {args.input}", file=sys.stderr)
        sys.exit(1)

    audio_path = args.input
    if not args.input.endswith((".wav", ".mp3", ".flac", ".ogg")):
        audio_path = extract_audio(args.input)

    try:
        try:
            segments = diarize_with_whisperx_and_pyannote(
                audio_path,
                min_speakers=args.min_speakers,
                max_speakers=args.max_speakers
            )
        except Exception as e:
            print(f"Diarization failed: {e}, using energy fallback...", file=sys.stderr)
            segments = diarize_simple_energy(audio_path)

            if segments is None:
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