---
name: opencaptions-tool
category: core
description: Tool guidance for the opencaptions CLI and Python integration
---

# OpenCaptions Tool Guide

## Overview

OpenCaptions is an open-source pipeline that generates CWI (Caption with Intention) compliant captions. It extracts cinematic intent from video -- pitch, volume, emotion, emphasis, sarcasm, pacing -- then maps that intent to CWI visual language.

The `opencaptions_cwi` tool wraps the `opencaptions` CLI for use in OpenMontage pipelines.

## Prerequisites

- **Node.js 18+** or **Bun** (Bun is preferred for faster execution)
- **Python 3.11+** (for audio analysis and vision extraction backends)
- **FFmpeg** (for audio extraction from video containers)
- **System dependencies** (installed by the setup command):
  - `whisper.cpp` -- speech-to-text transcription
  - `pyannote-audio` -- speaker diarization
  - `parselmouth` (Praat) -- pitch and volume extraction

### Initial Setup

```bash
# Option A: Using Bun (recommended)
bunx opencaptions setup
bunx opencaptions doctor

# Option B: Using npx
npx opencaptions setup
npx opencaptions doctor
```

The `setup` command installs Python dependencies into a local virtual environment. The `doctor` command verifies all components are working.

### Doctor Output (Healthy)

```
opencaptions doctor
  Node.js        18.20.0     OK
  Bun            1.1.38      OK
  Python         3.11.9      OK
  FFmpeg         7.0         OK
  whisper.cpp    1.7.2       OK
  pyannote       3.3.1       OK
  parselmouth    0.4.4       OK

  All components healthy.
```

## CLI Reference

### `opencaptions generate <video>`

Run the full pipeline: transcription, diarization, intent extraction, CWI mapping, and validation.

```bash
opencaptions generate film.mp4
opencaptions generate film.mp4 --output output/film.cwi.json
```

**Input**: Any video file FFmpeg can decode (MP4, MKV, MOV, AVI, WebM).

**Output** (written to same directory as input, or `--output` directory):
- `<name>.cwi.json` -- CWI document (the primary artifact)
- `<name>.vtt` -- WebVTT fallback for legacy players

**Timing**: Approximately 1.5x real-time for a standard 1080p video on an M1 Mac. A 10-minute video takes ~15 minutes.

### `opencaptions validate <file.cwi.json>`

Validate a CWI document against all 12 rules across three pillars.

```bash
opencaptions validate film.cwi.json
```

**Output**: Validation report printed to stdout with pillar scores and findings. Exit code 0 if all pillars >= 80, exit code 1 otherwise.

**Rules checked**:

| Rule | Pillar | What It Checks |
|---|---|---|
| ATT_001 | Attribution | Every caption references a valid speaker |
| ATT_002 | Attribution | All speakers have unique colors |
| ATT_003 | Attribution | Colors meet WCAG AA contrast (4.5:1) |
| SYN_001 | Synchronization | All words have start/end timestamps |
| SYN_002 | Synchronization | Timestamps monotonically increasing |
| SYN_003 | Synchronization | Caption events do not overlap |
| SYN_004 | Synchronization | Animation duration is 600ms |
| INT_001 | Intonation | Font weight in 100-900 range |
| INT_002 | Intonation | Font size in 0.7-1.5 range |
| INT_003 | Intonation | >20% of words have non-default weight |
| FCC_001 | FCC Baseline | No gaps > 3s during speech |
| FCC_002 | FCC Baseline | Max 42 characters per line |

### `opencaptions preview <file.cwi.json>`

Render a CWI document as colored, styled ANSI text in the terminal. Useful for quick inspection without a browser.

```bash
opencaptions preview film.cwi.json
```

### `opencaptions export <file.cwi.json> --format <format>`

Export a CWI document to other subtitle formats.

```bash
opencaptions export film.cwi.json --format webvtt
```

**Supported formats**:
- `webvtt` -- Standard WebVTT with speaker labels and timing (no styling)

**Planned formats** (Phase 2):
- `ae-json` -- After Effects motion graphics JSON
- `premiere-xml` -- Premiere Pro subtitle XML

### `opencaptions annotate <file.cwi.json>`

Interactively correct mapper predictions. Corrections are stored as tracing data that can train the LearnedMapper V2.

```bash
opencaptions annotate film.cwi.json
```

**Note**: This command opens a web-based editor at `opencaptions.tools`. The local CLI version is planned for Phase 2.

### `opencaptions setup`

Install Python dependencies (whisper.cpp, pyannote-audio, parselmouth) into a local virtual environment.

```bash
opencaptions setup
```

### `opencaptions doctor`

Verify all components are installed and working.

```bash
opencaptions doctor
```

### `opencaptions telemetry [show|on|off]`

Manage anonymous telemetry. Telemetry is opt-in and never contains PII.

```bash
opencaptions telemetry show   # Check current status
opencaptions telemetry on     # Enable (helps improve CWI intent recognition)
opencaptions telemetry off    # Disable
```

## Input/Output Contract

### Input

Any video file that FFmpeg can decode. The pipeline extracts audio and video frames independently.

**Minimum requirements:**
- Audio track present (no silent videos)
- Duration >= 1 second
- At least one speaking voice

**Optimal input:**
- Clean audio (minimal background music/noise)
- Visible speaker faces (improves emotion detection)
- Standard frame rate (24-60 fps)

### Output: CWI Document (`.cwi.json`)

```json
{
  "$schema": "https://opencaptions.tools/schema/cwi/1.0.json",
  "version": "1.0",
  "metadata": {
    "title": "My Film",
    "duration": 120.5,
    "language": "en",
    "created_at": "2026-04-06T12:00:00Z",
    "generator": "opencaptions/0.1.0",
    "extractor_backend": "audio-vision-v1"
  },
  "cast": [
    {
      "id": "S0",
      "name": "Speaker 1",
      "color": "#6B8AFF",
      "voice_profile": {
        "pitch_baseline_hz": 180.0,
        "pitch_p10": 140.0,
        "pitch_p90": 280.0,
        "volume_baseline_db": -20.0,
        "volume_p10": -35.0,
        "volume_p90": -10.0
      }
    }
  ],
  "captions": [
    {
      "id": "evt_001",
      "start": 1.2,
      "end": 3.8,
      "speaker_id": "S0",
      "words": [
        {
          "text": "Hello",
          "start": 1.2,
          "end": 1.6,
          "weight": 450,
          "size": 1.0,
          "emphasis": false
        },
        {
          "text": "world",
          "start": 1.7,
          "end": 2.1,
          "weight": 500,
          "size": 1.1,
          "emphasis": true
        }
      ]
    }
  ]
}
```

### Output: WebVTT Fallback (`.vtt`)

Standard WebVTT with speaker labels. Produced alongside the CWI document as a fallback for players that do not support CWI rendering.

```
WEBVTT

00:01.200 --> 00:03.800
<v Speaker 1>Hello world</v>
```

## Integration with WhisperX

If your OpenMontage pipeline already uses WhisperX for transcription, you can skip OpenCaptions' built-in Whisper step by providing a pre-existing transcript.

**Current approach (v0.1):** OpenCaptions runs its own Whisper transcription because it needs word-level timestamps with confidence scores. In a future version, a `--transcript` flag will accept a WhisperX JSON output directly.

**Workaround for now:** Let OpenCaptions run its own transcription. The overhead is minimal (Whisper is the fastest stage in the pipeline), and using a consistent transcription backend avoids timestamp alignment issues between the transcript and diarization.

**Future plan (v0.2+):**

```bash
# Not yet implemented -- planned for Phase 2
opencaptions generate film.mp4 --transcript whisperx-output.json
```

When this lands, the expected input format will be a JSON array of word objects:

```json
[
  { "word": "Hello", "start": 1.2, "end": 1.6, "score": 0.98 },
  { "word": "world", "start": 1.7, "end": 2.1, "score": 0.95 }
]
```

## Fallback Behavior

OpenCaptions degrades gracefully when dependencies are missing:

| Missing Dependency | Fallback Behavior |
|---|---|
| Python / pyannote | Single-speaker mode (all speech attributed to one speaker) |
| parselmouth | Flat intonation (all weights = 400, all sizes = 1.0) |
| FFmpeg | Cannot extract audio -- pipeline fails with clear error |
| Bun / Node.js | Cannot run CLI at all -- `check_available()` returns False |

When running in degraded mode, the validation report will include findings:
- Missing diarization: ATT_001 warnings (single speaker may be incorrect)
- Missing pitch analysis: INT_003 warning (all words have default weight)

The WebVTT fallback is always generated, even in degraded mode. This ensures accessibility compliance regardless of CWI pipeline health.

## Python API (for OpenMontage pipelines)

```python
from tools.subtitle.opencaptions_cwi import generate_cwi_captions, check_available

# Check availability first
status = check_available()
if not status["available"]:
    print(f"OpenCaptions not ready: {status['error']}")

# Generate captions
result = generate_cwi_captions(
    video_path="input/film.mp4",
    output_dir="output/",
    speaker_names=["Alice", "Bob"],
    language="en",
)

if result["success"]:
    print(f"CWI document: {result['cwi_path']}")
    print(f"WebVTT:       {result['vtt_path']}")
    print(f"Score:        {result['validation_score']}/100")
else:
    print(f"Failed: {result['error']}")
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `OPENCAPTIONS_RUNNER` | auto-detect | Force `bunx` or `npx` |
| `OPENCAPTIONS_TIMEOUT` | `600` | Pipeline timeout in seconds |
| `OPENCAPTIONS_TELEMETRY` | `off` | Enable anonymous telemetry |

## Troubleshooting

**"Neither bunx nor npx found"**: Install Node.js 18+ from https://nodejs.org or Bun from https://bun.sh.

**"Pipeline timed out"**: The default timeout is 600 seconds (10 minutes). For long videos (>30 min), increase the timeout or split the video into segments.

**INT_003 warning (flat intonation)**: This usually means parselmouth is not installed or the audio has very little pitch variation. Run `opencaptions doctor` to check, and review the audio quality.

**ATT_001 errors (unknown speaker)**: The diarization backend may have assigned more speakers than expected. Check the `cast` array in the CWI document and merge duplicate speakers if needed.
