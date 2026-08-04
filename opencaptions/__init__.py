import subprocess
import sys
import os
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
        transcribe_script = _find_repo_path("packages/backend-av/scripts/transcribe.py")
    except FileNotFoundError:
        transcribe_script = _find_repo_path("opencaptions/transcribe.py")

    env = os.environ.copy()
    python_bin_dir = str(Path(sys.executable).parent)
    env["PATH"] = f"{python_bin_dir}{os.pathsep}{env.get('PATH', '')}"
    env["PYTHONWARNINGS"] = "ignore"
    env["PYTHONUNBUFFERED"] = "1"

    # Forçamos o parâmetro de saída (--output ou -o) para salvar no output_cwi_file
    cmd = [
        sys.executable,
        str(transcribe_script),
        "--input", str(video_file),
        "--output", str(output_cwi_file)
    ]

    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        env=env,
        shell=(sys.platform == "win32")
    )

    # Se por acaso o script criar como "video.mp4.cwi.json", tratamos o fallback:
    fallback_cwi_file = Path(str(video_file) + ".cwi.json")
    
    actual_output = None
    if output_cwi_file.exists():
        actual_output = output_cwi_file
    elif fallback_cwi_file.exists():
        actual_output = fallback_cwi_file
    else:
        raise RuntimeError(
            f"Erro ao processar vídeo no OpenCaptions (Arquivo JSON não gerado em {output_cwi_file}):\n"
            f"{result.stderr or result.stdout}"
        )

    if return_ttml:
        return convert_cwi_json_to_ttml(str(actual_output))

    return str(actual_output)

__all__ = [
    "convert_cwi_json_to_ttml",
    "process_video",
]