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
        raise RuntimeError(f"Erro ao decodificar JSON do transcribe.py: {e}\nSaída recebida: {result.stdout[:300]}")

    formatted_words = []
    for w in raw_data.get("words", []):
        formatted_words.append({
            "text": str(w.get("text", "")),
            "start": float(w.get("start", 0.0)),
            "end": float(w.get("end", 0.0)),
            "weight": int(w.get("weight", 500)),
            "size": float(w.get("size", 1.096835)),
            "emphasis": bool(w.get("emphasis", False))
        })

    cwi_blocks = []
    if formatted_words:
        cwi_blocks.append({
            "id": str(uuid.uuid4()),
            "start": formatted_words[0]["start"],
            "end": formatted_words[-1]["end"],
            "speaker_id": "S0",
            "words": formatted_words
        })

    # Aqui está o segredo: entregamos o dicionario com "captions" que o seu json_to_ttml espera
    output_data = {"captions": cwi_blocks}
    
    with open(output_cwi_file, "w", encoding="utf-8") as f:
        json.dump(output_data, f, ensure_ascii=False, indent=2)

    if return_ttml:
        return convert_cwi_json_to_ttml(str(output_cwi_file))

    return str(output_cwi_file)

__all__ = [
    "convert_cwi_json_to_ttml",
    "process_video",
]