import subprocess
import sys
import os
import json
import uuid
from pathlib import Path
from .json_to_ttml import convert_cwi_json_to_ttml

PACKAGE_DIR = Path(__file__).parent.resolve()

def _find_repo_path(relative_path: str) -> Path:
    site_packages_path = PACKAGE_DIR.parent / relative_path
    if site_packages_path.exists():
        return site_packages_path

    curr = PACKAGE_DIR
    while curr != curr.parent:
        candidate = curr / relative_path
        if candidate.exists():
            return candidate
        curr = curr.parent

    raise FileNotFoundError(f"Não foi possível encontrar o recurso: {relative_path}")


def process_video(video_path: str, output_cwi: str = None, return_ttml: bool = False):
    video_file = Path(video_path).resolve()
    if not video_file.exists():
        raise FileNotFoundError(f"Arquivo de vídeo não encontrado: {video_path}")

    if output_cwi is None:
        output_cwi_file = video_file.with_suffix(".cwi.json")
    else:
        output_cwi_file = Path(output_cwi).resolve()

    try:
        backend_dir = _find_repo_path("packages/backend-av/scripts")
    except FileNotFoundError:
        backend_dir = PACKAGE_DIR.parent / "packages" / "backend-av" / "scripts"

    transcribe_script = backend_dir / "transcribe.py"

    env = os.environ.copy()
    python_bin_dir = str(Path(sys.executable).parent)
    env["PATH"] = f"{python_bin_dir}{os.pathsep}{env.get('PATH', '')}"
    env["PYTHONWARNINGS"] = "ignore"
    env["PYTHONUNBUFFERED"] = "1"

    if not transcribe_script.exists():
        raise FileNotFoundError(f"Script de transcrição não encontrado em: {transcribe_script}")

    # Executa o transcribe.py passando apenas --input e capturando o JSON do stdout
    cmd = [
        sys.executable,
        str(transcribe_script),
        "--input", str(video_file)
    ]

    result = subprocess.run(cmd, capture_output=True, text=True, env=env)
    if result.returncode != 0:
        error_msg = result.stderr.strip() or result.stdout.strip()
        raise RuntimeError(f"Erro ao executar o transcribe.py: {error_msg}")

    try:
        raw_data = json.loads(result.stdout)
    except Exception as e:
        raise RuntimeError(f"Erro ao decodificar JSON do transcribe.py: {e}\nSaída recebida: {result.stdout[:200]}")

    cwi_blocks = []
    segments = raw_data.get("segments", [])
    if not segments and isinstance(raw_data, list):
        segments = raw_data
    elif not segments and "text" in raw_data:
        segments = [raw_data]

    for seg in segments:
        block_id = str(uuid.uuid4())
        start = float(seg.get("start", 0.0))
        end = float(seg.get("end", start + 1.0))
        speaker_id = str(seg.get("speaker", "S0"))
        
        words_raw = seg.get("words", [])
        if not words_raw and "text" in seg:
            text_tokens = seg["text"].split()
            duration = max(0.1, end - start)
            token_duration = duration / max(1, len(text_tokens))
            words_raw = []
            for idx, token in enumerate(text_tokens):
                w_start = start + (idx * token_duration)
                w_end = w_start + token_duration
                words_raw.append({"text": token, "start": w_start, "end": w_end})

        formatted_words = []
        for w in words_raw:
            formatted_words.append({
                "text": str(w.get("text", "")),
                "start": float(w.get("start", start)),
                "end": float(w.get("end", end)),
                "weight": int(w.get("weight", 500)),
                "size": float(w.get("size", 1.096835)),
                "emphasis": bool(w.get("emphasis", False))
            })

        cwi_blocks.append({
            "id": block_id,
            "start": start,
            "end": end,
            "speaker_id": speaker_id,
            "words": formatted_words
        })

    output_data = cwi_blocks[0] if len(cwi_blocks) == 1 else {"captions": cwi_blocks}
    with open(output_cwi_file, "w", encoding="utf-8") as f:
        json.dump(output_data, f, ensure_ascii=False, indent=2)

    if return_ttml:
        return convert_cwi_json_to_ttml(str(output_cwi_file))

    return str(output_cwi_file)

__all__ = [
    "convert_cwi_json_to_ttml",
    "process_video",
]