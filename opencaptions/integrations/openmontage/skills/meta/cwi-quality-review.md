---
name: cwi-quality-review
category: meta
description: Review protocol for CWI caption quality assessment and correction
---

# CWI Quality Review Protocol

## Purpose

This protocol ensures CWI captions meet the three-pillar quality standard before they reach an audience. It is designed for use as a post-render validation step in OpenMontage pipelines, or as a standalone review workflow.

## Post-Render Validation

### Step 1: Run Automated Validation

```bash
opencaptions validate <file.cwi.json>
```

This checks all 12 rules across three pillars and produces a score per pillar (0-100) and an overall score. The pass threshold is 80 per pillar.

### Step 2: Check Pillar Scores

All three pillars must independently score >= 80 for the document to pass:

| Pillar | Score >= 80 | Action |
|---|---|---|
| Attribution | Yes | Proceed |
| Attribution | No | Fix speaker assignment and color issues |
| Synchronization | Yes | Proceed |
| Synchronization | No | Fix timing, overlap, and animation issues |
| Intonation | Yes | Proceed |
| Intonation | No | Fix weight/size mapping or review audio quality |

### Step 3: Review Findings

Findings are returned with rule IDs, severity levels, and suggestions. Address them in this priority order:

1. **Errors** (severity: `error`) -- these must be fixed before release
2. **Warnings** (severity: `warning`) -- review and fix if impactful
3. **Info** (severity: `info`) -- informational, no action required

### Step 4: Re-validate After Corrections

After making corrections (either automated or manual via `opencaptions annotate`), re-run validation to confirm the score improved and all errors are resolved.

## Common Issues and Fixes

### ATT_001: Missing or Unknown Speaker

**What it means**: A caption event references a `speaker_id` that does not exist in the `cast` array.

**Common cause**: The diarization backend detected a new speaker mid-video that was not assigned a color/name.

**Fix**:
- Open the `.cwi.json` file
- Add the missing speaker to the `cast` array with a unique color from the SPEAKER_COLORS palette
- Or: merge the unknown speaker with an existing speaker if the diarizer over-segmented

```json
{
  "id": "S2",
  "name": "Narrator",
  "color": "#FFD56B",
  "voice_profile": {
    "pitch_baseline_hz": 160.0,
    "pitch_p10": 130.0,
    "pitch_p90": 220.0,
    "volume_baseline_db": -22.0,
    "volume_p10": -30.0,
    "volume_p90": -14.0
  }
}
```

### ATT_002: Duplicate Speaker Colors

**What it means**: Two speakers share the same hex color, making them visually indistinguishable.

**Fix**: Assign a unique color to each speaker. Use the 12-color WCAG AA palette:

```
#6B8AFF  #FF6B6B  #6BFFA3  #FFD56B  #D56BFF  #6BF0FF
#FF6BC8  #A3FF6B  #FF916B  #6BB4FF  #FFB86B  #8A6BFF
```

### ATT_003: Poor Color Contrast

**What it means**: A speaker's color has a contrast ratio below 4.5:1 against the background (#1a1a1a), failing WCAG AA.

**Fix**: Choose a lighter or more saturated color. All colors in the default palette meet this threshold.

### SYN_001: Missing Timestamps

**What it means**: One or more words have a start or end time of 0 or negative.

**Common cause**: Whisper returned a word with missing alignment, usually at the very start or end of audio.

**Fix**: Manually set timestamps based on the surrounding words. Ensure `start > 0` and `end > start`.

### SYN_002: Non-Monotonic Timestamps

**What it means**: A word's start time is earlier than the previous word's start time within the same caption event.

**Common cause**: Whisper word-level alignment glitch, especially with overlapping speech.

**Fix**: Sort words by start time within each caption event, or manually adjust the out-of-order word.

### SYN_003: Overlapping Caption Events

**What it means**: Two caption events have overlapping time ranges.

**Common cause**: Rapid speaker turns where the diarizer did not cleanly separate turns.

**Fix**: Adjust the `end` time of the earlier event or the `start` time of the later event so they do not overlap. A 50ms gap between events is recommended.

### SYN_004: Non-Standard Animation Duration

**What it means**: A word has an animation duration override that is not 600ms (the CWI spec default).

**Severity**: Warning. Custom animation durations are technically valid but deviate from the CWI spec.

**Fix**: Remove the `animation.duration_ms` override unless there is a specific creative reason for the deviation.

### INT_001: Font Weight Out of Range

**What it means**: A word has a `weight` value below 100 or above 900, which is outside the Roboto Flex variable font range.

**Fix**: Clamp the weight to the valid range. This usually indicates a bug in the intent mapper.

### INT_002: Font Size Out of Range

**What it means**: A word has a `size` value below 0.7 or above 1.5.

**Fix**: Clamp the size to the valid range. As with INT_001, this is typically a mapper bug.

### INT_003: Flat Intonation

**What it means**: Fewer than 20% of words have a non-default weight (weight != 400). The captions lack intonation variation and will look like flat SRT with colors.

**Common causes**:
- `parselmouth` is not installed (pitch extraction is disabled)
- The audio is genuinely monotone (e.g., a text-to-speech voice)
- The intent extractor could not extract pitch from noisy audio

**Fix**:
1. Run `opencaptions doctor` to verify parselmouth is installed
2. Check audio quality -- clean audio produces better pitch extraction
3. If the content is genuinely monotone, consider whether CWI adds value over flat SRT
4. Use `opencaptions annotate` to manually adjust weight on key words

### FCC_001: Large Gap During Speech

**What it means**: There is a gap of more than 3 seconds between consecutive caption events.

**Common causes**:
- Actual silence or music in the video (expected, not a problem)
- The transcription backend missed spoken words in the gap

**Fix**: If there is speech in the gap, re-run with cleaner audio or manually add caption events. If the gap is intentional (music, silence), add a non-speech event like `[music]` or `[silence]`.

### FCC_002: Line Too Long

**What it means**: A caption event contains more than 42 characters, exceeding the FCC readability guideline.

**Fix**: Split the caption event into two shorter events at a natural break point (phrase boundary, comma, or conjunction).

## Correction Workflow

### Automated Correction

Some issues can be fixed automatically by re-running the pipeline with adjusted parameters:

```bash
# Re-generate with explicit speaker count (helps diarization)
# Note: --speakers flag planned for v0.2
opencaptions generate video.mp4 --output corrected/

# Re-validate
opencaptions validate corrected/video.cwi.json
```

### Manual Correction via Annotate

For fine-grained corrections (adjusting individual word weights, fixing speaker assignments), use the annotation workflow:

```bash
opencaptions annotate video.cwi.json
```

This opens a web-based editor where you can:
- Reassign speakers for individual caption events
- Adjust word weights and sizes
- Add/remove emphasis markers
- Insert non-speech events

Corrections are saved as `MapperCorrection` tracing records that contribute to training the LearnedMapper V2.

### Programmatic Correction

For batch corrections in OpenMontage pipelines, modify the CWI JSON directly:

```python
import json

with open("video.cwi.json") as f:
    doc = json.load(f)

# Fix speaker assignment for a specific caption
for event in doc["captions"]:
    if event["id"] == "evt_042":
        event["speaker_id"] = "S1"

# Clamp all weights to valid range
for event in doc["captions"]:
    for word in event["words"]:
        word["weight"] = max(100, min(900, word["weight"]))
        word["size"] = max(0.7, min(1.5, word["size"]))

with open("video.cwi.json", "w") as f:
    json.dump(doc, f, indent=2)
```

## Quality Metrics Over Time

Track these metrics across pipeline runs to identify systemic issues:

| Metric | Healthy Range | Investigation Trigger |
|---|---|---|
| Overall score | >= 85 | Score drops below 80 on 3+ consecutive runs |
| Attribution score | >= 90 | Consistent ATT_001 errors indicate diarization issues |
| Synchronization score | >= 85 | Frequent SYN_002/003 errors indicate alignment problems |
| Intonation score | >= 80 | Persistent INT_003 means pitch extraction is degraded |
| Pipeline duration | 1-2x real-time | > 3x real-time suggests resource constraints |

## Integration with OpenMontage Quality Gates

Use the validation score as a pipeline gate:

```yaml
steps:
  - name: generate-captions
    tool: opencaptions_cwi
    inputs:
      video_path: "{{ input.video }}"
      output_dir: "{{ workspace }}/captions/"

  - name: quality-check
    condition: "{{ steps.generate-captions.validation_score < 80 }}"
    action: fail
    message: "CWI validation score {{ steps.generate-captions.validation_score }}/100 is below threshold"
```

For non-blocking quality monitoring, log the score and findings without failing the pipeline:

```yaml
  - name: quality-log
    tool: log
    inputs:
      level: "{{ 'warn' if steps.generate-captions.validation_score < 80 else 'info' }}"
      message: "CWI score: {{ steps.generate-captions.validation_score }}/100"
      data: "{{ steps.generate-captions.report }}"
```
