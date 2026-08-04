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
        # Tenta encontrar o script integrador oficial do repositório
        pipeline_script = _find_repo_path("integrations/openmontage/tools/subtitle/opencaptions_cwi.py")
    except FileNotFoundError:
        # Fallback caso esteja empacotado de outra forma
        pipeline_script = _find_repo_path("opencaptions/opencaptions_cwi.py")

    env = os.environ.copy()
    python_bin_dir = str(Path(sys.executable).parent)
    env["PATH"] = f"{python_bin_dir}{os.pathsep}{env.get('PATH', '')}"
    env["PYTHONWARNINGS"] = "ignore"
    env["PYTHONUNBUFFERED"] = "1"

    # O script integrador geralmente aceita o vídeo de entrada e a saída
    cmd = [
        sys.executable,
        str(pipeline_script),
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

    if result.returncode != 0 or not output_cwi_file.exists() or output_cwi_file.stat().st_size == 0:
        error_log = result.stderr.strip() or result.stdout.strip()
        raise RuntimeError(
            f"A pipeline completa do OpenCaptions falhou ao gerar o CWI JSON.\n"
            f"--- LOG ---\n{error_log}\n------------"
        )

    if return_ttml:
        return convert_cwi_json_to_ttml(str(output_cwi_file))

    return str(output_cwi_file)

__all__ = [
    "convert_cwi_json_to_ttml",
    "process_video",
]