# OpenCaptions x OpenMontage Integration

Adds CWI (Caption with Intention) caption support to OpenMontage pipelines. Replaces flat SRT/VTT with expressive captions that convey speaker attribution, word-level synchronization, and intonation -- the same captioning standard that won the 2025 Academy Award.

## What This Adds

- **1 Python tool** (`tools/subtitle/opencaptions_cwi.py`) -- wraps the `opencaptions` CLI for use in any OpenMontage pipeline
- **3 skill files** -- creative direction, tool guidance, and quality review protocol for CWI captions

## Installation

Copy the integration files into your OpenMontage installation:

```bash
# From the OpenMontage root directory
cp -r <path-to-opencaptions>/integrations/openmontage/tools/subtitle/opencaptions_cwi.py \
      tools/subtitle/

cp -r <path-to-opencaptions>/integrations/openmontage/skills/creative/cwi-captions.md \
      skills/creative/

cp -r <path-to-opencaptions>/integrations/openmontage/skills/core/opencaptions-tool.md \
      skills/core/

cp -r <path-to-opencaptions>/integrations/openmontage/skills/meta/cwi-quality-review.md \
      skills/meta/
```

Then install the OpenCaptions CLI:

```bash
# Using Bun (recommended)
bunx opencaptions setup
bunx opencaptions doctor

# Or using npx
npx opencaptions setup
npx opencaptions doctor
```

## Prerequisites

- **Node.js 18+** or **Bun** (for the opencaptions CLI)
- **Python 3.11+** (for audio/vision extraction backends)
- **FFmpeg** (for audio extraction from video)

The `opencaptions setup` command handles installing Python-side dependencies (whisper.cpp, pyannote-audio, parselmouth).

## Usage

### In a Pipeline YAML

The `opencaptions_cwi` tool is available as a subtitle tool in any OpenMontage pipeline:

```yaml
pipeline:
  name: video-with-cwi-captions
  steps:
    - name: generate-captions
      tool: opencaptions_cwi
      inputs:
        video_path: "{{ input.video }}"
        output_dir: "{{ workspace }}/captions/"
        speaker_names: ["Alice", "Bob"]
        language: "en"

    - name: quality-gate
      condition: "{{ steps.generate-captions.validation_score < 80 }}"
      action: review
      message: "CWI score below threshold"
```

### In Python

```python
from tools.subtitle.opencaptions_cwi import generate_cwi_captions, check_available

# Verify dependencies
status = check_available()
print(f"Ready: {status['available']}, Runner: {status['runner']}")

# Generate CWI captions
result = generate_cwi_captions(
    video_path="input/interview.mp4",
    output_dir="output/",
    speaker_names=["Dr. Martinez", "Interviewer"],
)

if result["success"]:
    print(f"CWI:   {result['cwi_path']}")       # output/interview.cwi.json
    print(f"VTT:   {result['vtt_path']}")        # output/interview.vtt
    print(f"Score: {result['validation_score']}") # 0-100
```

### From the Command Line

```bash
# Generate captions
npx opencaptions generate video.mp4

# Validate an existing CWI document
npx opencaptions validate video.cwi.json

# Preview in terminal (ANSI-colored output)
npx opencaptions preview video.cwi.json

# Export to WebVTT for legacy players
npx opencaptions export video.cwi.json --format webvtt
```

## Output Files

| File | Format | Purpose |
|---|---|---|
| `<name>.cwi.json` | CWI JSON | Primary artifact -- full CWI document with word-level styling |
| `<name>.vtt` | WebVTT | Fallback for players that do not support CWI rendering |

## Quality Validation

Every generated CWI document is validated against 12 rules across three pillars:

| Pillar | Rules | What It Checks |
|---|---|---|
| Attribution | ATT_001-003 | Speaker assignment, color uniqueness, WCAG contrast |
| Synchronization | SYN_001-004, FCC_001-002 | Timing, overlap, animation, gaps, line length |
| Intonation | INT_001-003 | Weight range, size range, variation threshold |

Each pillar scores 0-100. The overall score is the average. A pillar passes at >= 80.

See `skills/meta/cwi-quality-review.md` for the full quality review protocol.

## Skills Reference

| Skill | Category | Purpose |
|---|---|---|
| `cwi-captions` | creative | When to use CWI, color strategy, emotional arc guidelines |
| `opencaptions-tool` | core | CLI reference, input/output contract, fallback behavior |
| `cwi-quality-review` | meta | Validation protocol, common issues, correction workflow |

## Architecture

```
Video File
  --> opencaptions generate
      --> Whisper (transcription)
      --> pyannote (speaker diarization)
      --> parselmouth + vision (intent extraction)
      --> RulesMapper (intent -> CWI visual parameters)
      --> CWI Validator (12-rule check)
  --> .cwi.json + .vtt
```

## Fallback Behavior

If OpenCaptions dependencies are partially missing, the tool degrades gracefully:

- No pyannote: single-speaker mode (all speech attributed to one speaker)
- No parselmouth: flat intonation (all weights = 400, all sizes = 1.0)
- No FFmpeg: pipeline fails with a clear error message
- No Node.js/Bun: `check_available()` returns `False` with install instructions

The WebVTT fallback is always generated, ensuring accessibility compliance regardless of CWI pipeline health.

## Links

- **OpenCaptions**: https://github.com/broomva/opencaptions
- **OpenMontage**: https://github.com/calesthio/OpenMontage
- **CWI Standard**: https://www.captionwithintention.org/
- **CWI JSON Schema**: https://opencaptions.tools/schema/cwi/1.0.json
