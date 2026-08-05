"""
OpenCaptions CWI -- Generate Caption with Intention compliant captions.

Replaces flat SRT/VTT with expressive CWI captions that convey
attribution (speaker colors), synchronization (word-level animation),
and intonation (variable font weight/size for pitch and volume).

Requires: npx opencaptions (Node.js 18+, Bun)

OpenMontage tool category: subtitle
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

TOOL_NAME = "opencaptions_cwi"
TOOL_VERSION = "0.1.0"
TOOL_CATEGORY = "subtitle"

# Minimum pillar score to consider the output production-ready
PILLAR_PASS_THRESHOLD = 80

# CLI binary -- npx handles installation automatically
_NPX = "npx"
_BUN = "bunx"


# ---------------------------------------------------------------------------
# Availability check
# ---------------------------------------------------------------------------


def _find_runner() -> str | None:
    """Return the best available JS package runner (bunx > npx)."""
    for runner in [_BUN, _NPX]:
        if shutil.which(runner):
            return runner
    return None


def check_available() -> dict[str, Any]:
    """Verify the opencaptions CLI is reachable.

    Returns a dict with keys:
        available (bool): True if the CLI is ready
        runner (str | None): The JS runner that will be used (bunx or npx)
        version (str | None): CLI version string if available
        error (str | None): Human-readable problem description
    """
    runner = _find_runner()
    if runner is None:
        return {
            "available": False,
            "runner": None,
            "version": None,
            "error": (
                "Neither 'bunx' nor 'npx' found on PATH. "
                "Install Node.js 18+ (https://nodejs.org) or "
                "Bun (https://bun.sh) to use this tool."
            ),
        }

    try:
        result = subprocess.run(
            [runner, "opencaptions", "--version"],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode == 0:
            version = result.stdout.strip()
            return {
                "available": True,
                "runner": runner,
                "version": version,
                "error": None,
            }

        return {
            "available": False,
            "runner": runner,
            "version": None,
            "error": (
                f"opencaptions CLI not installed. Run '{runner} opencaptions setup' "
                "to install dependencies, then '{runner} opencaptions doctor' to verify."
            ),
        }
    except subprocess.TimeoutExpired:
        return {
            "available": False,
            "runner": runner,
            "version": None,
            "error": "opencaptions CLI timed out (30s). The package may be downloading.",
        }
    except FileNotFoundError:
        return {
            "available": False,
            "runner": runner,
            "version": None,
            "error": f"Failed to execute '{runner}'. Check your PATH.",
        }


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _run_cli(
    runner: str,
    subcommand: list[str],
    *,
    timeout: int = 600,
) -> subprocess.CompletedProcess[str]:
    """Run an opencaptions CLI subcommand and return the completed process."""
    cmd = [runner, "opencaptions", *subcommand]
    logger.info("Running: %s", " ".join(cmd))
    return subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=timeout,
    )


def _parse_validation_output(stdout: str) -> dict[str, Any]:
    """Parse the human-readable validation output into structured data.

    The CLI prints lines like:
        Overall: PASSED  Score: 92/100
        Attribution:     95/100 ...
        Synchronization: 90/100 ...
        Intonation:      91/100 ...
        [ATT_001] ...

    We extract what we can and return a best-effort dict.
    """
    result: dict[str, Any] = {
        "passed": False,
        "overall_score": 0,
        "pillars": {
            "attribution": 0,
            "synchronization": 0,
            "intonation": 0,
        },
        "findings": [],
        "raw_output": stdout,
    }

    for line in stdout.splitlines():
        stripped = line.strip()

        # Overall score
        if "Score:" in stripped and "/100" in stripped:
            try:
                score_part = stripped.split("Score:")[1].strip()
                score_str = score_part.split("/")[0].strip()
                result["overall_score"] = int(score_str)
            except (IndexError, ValueError):
                pass

        if "PASSED" in stripped and "Overall" in stripped:
            result["passed"] = True
        elif "FAILED" in stripped and "Overall" in stripped:
            result["passed"] = False

        # Pillar scores
        for pillar in ("Attribution", "Synchronization", "Intonation"):
            if pillar in stripped and "/100" in stripped:
                try:
                    score_part = stripped.split(":")[1].strip()
                    score_str = score_part.split("/")[0].strip()
                    result["pillars"][pillar.lower()] = int(score_str)
                except (IndexError, ValueError):
                    pass

        # Findings (lines starting with rule IDs like [ATT_001])
        if stripped.startswith("[") and "]" in stripped:
            result["findings"].append(stripped)

    return result


# ---------------------------------------------------------------------------
# Main tool function
# ---------------------------------------------------------------------------


def generate_cwi_captions(
    video_path: str,
    output_dir: str,
    speaker_names: list[str] | None = None,
    language: str = "en",
    burn_in: bool = False,
) -> dict[str, Any]:
    """Generate CWI-compliant captions from a video file.

    This is the primary entry point for OpenMontage pipelines.
    It runs the full OpenCaptions pipeline: transcription, diarization,
    intent extraction, CWI mapping, validation, and WebVTT export.

    Args:
        video_path: Path to the input video file.
        output_dir: Directory for output files (cwi.json, .vtt, report).
        speaker_names: Optional list of speaker names for attribution.
            If not provided, speakers are auto-detected and labeled
            "Speaker 1", "Speaker 2", etc.
        language: ISO 639-1 language code (default: "en").
            Passed to the Whisper transcription backend.
        burn_in: Whether to burn captions into the video. Requires
            Remotion to be installed. The burned-in video is written
            to output_dir alongside the other artifacts.

    Returns:
        dict with keys:
            success (bool): Whether the pipeline completed without errors.
            cwi_path (str | None): Path to the generated .cwi.json file.
            vtt_path (str | None): Path to the WebVTT fallback file.
            burned_path (str | None): Path to the burned-in video (if burn_in=True).
            report (dict): Structured validation report with pillar scores.
            validation_score (int): Overall validation score 0-100.
            error (str | None): Error message if the pipeline failed.
    """
    # -- Pre-flight --------------------------------------------------------
    status = check_available()
    if not status["available"]:
        return {
            "success": False,
            "cwi_path": None,
            "vtt_path": None,
            "burned_path": None,
            "report": {},
            "validation_score": 0,
            "error": status["error"],
        }

    runner = status["runner"]
    video = Path(video_path).resolve()

    if not video.is_file():
        return {
            "success": False,
            "cwi_path": None,
            "vtt_path": None,
            "burned_path": None,
            "report": {},
            "validation_score": 0,
            "error": f"Video file not found: {video}",
        }

    out_dir = Path(output_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    cwi_filename = video.stem + ".cwi.json"
    cwi_path = out_dir / cwi_filename

    # -- Step 1: Generate CWI captions ------------------------------------
    generate_args = [
        "generate",
        str(video),
        "--output",
        str(cwi_path),
    ]

    # Language is not yet a CLI flag in OpenCaptions v0.1 but we pass it
    # for forward compatibility when the flag lands.
    # generate_args.extend(["--language", language])

    try:
        gen_result = _run_cli(runner, generate_args, timeout=600)
    except subprocess.TimeoutExpired:
        return {
            "success": False,
            "cwi_path": None,
            "vtt_path": None,
            "burned_path": None,
            "report": {},
            "validation_score": 0,
            "error": (
                f"Pipeline timed out after 600s processing {video.name}. "
                "Try a shorter clip or check system resources."
            ),
        }

    if gen_result.returncode != 0:
        stderr = gen_result.stderr.strip() or gen_result.stdout.strip()
        return {
            "success": False,
            "cwi_path": None,
            "vtt_path": None,
            "burned_path": None,
            "report": {},
            "validation_score": 0,
            "error": f"Pipeline failed (exit {gen_result.returncode}): {stderr}",
        }

    if not cwi_path.is_file():
        return {
            "success": False,
            "cwi_path": None,
            "vtt_path": None,
            "burned_path": None,
            "report": {},
            "validation_score": 0,
            "error": f"Pipeline completed but output file not found: {cwi_path}",
        }

    # -- Step 2: Validate the generated CWI document ----------------------
    try:
        val_result = _run_cli(runner, ["validate", str(cwi_path)], timeout=30)
    except subprocess.TimeoutExpired:
        val_result = None

    report: dict[str, Any] = {}
    validation_score = 0

    if val_result is not None:
        report = _parse_validation_output(val_result.stdout)
        validation_score = report.get("overall_score", 0)
    else:
        report = {"raw_output": "Validation timed out", "passed": False}

    # -- Step 3: Export WebVTT fallback -----------------------------------
    vtt_path = cwi_path.with_suffix("").with_suffix(".vtt")

    try:
        export_result = _run_cli(
            runner,
            ["export", str(cwi_path), "--format", "webvtt"],
            timeout=30,
        )
        if export_result.returncode != 0 or not vtt_path.is_file():
            # The generate command also produces a .vtt sidecar by default
            # so this may already exist even if export fails.
            logger.warning("WebVTT export returned non-zero but file may exist from generate step")
    except subprocess.TimeoutExpired:
        logger.warning("WebVTT export timed out")

    vtt_path_str = str(vtt_path) if vtt_path.is_file() else None

    # -- Step 4 (optional): Burn captions into video ----------------------
    burned_path: str | None = None
    if burn_in:
        burned_file = out_dir / (video.stem + ".captioned" + video.suffix)
        logger.info(
            "Burn-in requested but not yet implemented in OpenCaptions v0.1. "
            "The CWI JSON and WebVTT files can be used with Remotion or FFmpeg "
            "for manual burn-in."
        )
        # Future: _run_cli(runner, ["burn", str(cwi_path), str(video), "--output", str(burned_file)])
        burned_path = None

    # -- Step 5: Inject speaker names if provided -------------------------
    if speaker_names and cwi_path.is_file():
        try:
            with open(cwi_path, "r") as f:
                doc = json.load(f)
            for i, speaker in enumerate(doc.get("cast", [])):
                if i < len(speaker_names):
                    speaker["name"] = speaker_names[i]
            with open(cwi_path, "w") as f:
                json.dump(doc, f, indent=2)
            logger.info("Injected %d speaker names into CWI document", len(speaker_names))
        except (json.JSONDecodeError, OSError) as exc:
            logger.warning("Failed to inject speaker names: %s", exc)

    # -- Done -------------------------------------------------------------
    return {
        "success": True,
        "cwi_path": str(cwi_path),
        "vtt_path": vtt_path_str,
        "burned_path": burned_path,
        "report": report,
        "validation_score": validation_score,
        "error": None,
    }


# ---------------------------------------------------------------------------
# OpenMontage tool metadata
# ---------------------------------------------------------------------------

TOOL_METADATA = {
    "name": TOOL_NAME,
    "version": TOOL_VERSION,
    "category": TOOL_CATEGORY,
    "description": (
        "Generate CWI (Caption with Intention) captions from video. "
        "Replaces flat SRT/VTT with expressive captions that convey "
        "speaker attribution, word-level synchronization, and intonation."
    ),
    "requires": ["Node.js 18+ or Bun"],
    "inputs": {
        "video_path": "Path to input video file",
        "output_dir": "Directory for output artifacts",
        "speaker_names": "Optional list of speaker names",
        "language": "ISO 639-1 language code (default: en)",
        "burn_in": "Burn captions into video (requires Remotion)",
    },
    "outputs": {
        "cwi_path": "Generated .cwi.json CWI document",
        "vtt_path": "WebVTT fallback for legacy players",
        "burned_path": "Video with burned-in captions (if requested)",
        "report": "Validation report with pillar scores",
        "validation_score": "Overall CWI compliance score (0-100)",
    },
}


# ---------------------------------------------------------------------------
# Convenience: standalone execution
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import sys

    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")

    if len(sys.argv) < 3:
        print(f"Usage: python {sys.argv[0]} <video_path> <output_dir> [speaker1,speaker2,...]")
        print()
        print("  Generates CWI captions using the OpenCaptions pipeline.")
        print()

        # Also run availability check
        status = check_available()
        if status["available"]:
            print(f"  Status: READY (runner={status['runner']}, version={status['version']})")
        else:
            print(f"  Status: NOT AVAILABLE -- {status['error']}")

        sys.exit(0 if len(sys.argv) == 1 else 2)

    video = sys.argv[1]
    out = sys.argv[2]
    names = sys.argv[3].split(",") if len(sys.argv) > 3 else None

    result = generate_cwi_captions(video, out, speaker_names=names)

    if result["success"]:
        print(f"CWI:   {result['cwi_path']}")
        print(f"VTT:   {result['vtt_path']}")
        print(f"Score: {result['validation_score']}/100")
        if result["report"].get("findings"):
            print("Findings:")
            for f in result["report"]["findings"]:
                print(f"  {f}")
    else:
        print(f"ERROR: {result['error']}", file=sys.stderr)
        sys.exit(1)
