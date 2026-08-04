import subprocess
import sys
import os
from pathlib import Path
from .json_to_ttml import convert_cwi_json_to_ttml

# Pasta onde o pacote opencaptions está instalado
PACKAGE_DIR = Path(__file__).parent.resolve()

def _find_repo_path(relative_path: str) -> Path:
    """
    Busca qualquer pasta ou arquivo do repositório (fixtures, packages, scripts, etc.),
    seja rodando localmente em dev ou instalado no site-packages do pip.
    """
    # 1. Procura na raiz do site-packages / instalação
    site_packages_path = PACKAGE_DIR.parent / relative_path
    if site_packages_path.exists():
        return site_packages_path

    # 2. Busca subindo a árvore de diretórios
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

    cmd = [
        sys.executable,
        str(transcribe_script),
        "--input", str(video_file)
    ]

    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        env=env,
        shell=(sys.platform == "win32")
    )

    # Se o arquivo JSON não foi gerado, consideramos erro real
    if not output_cwi_file.exists():
        raise RuntimeError(
            f"Erro ao processar vídeo no OpenCaptions (Arquivo JSON não gerado):\n"
            f"{result.stderr or result.stdout}"
        )

    # Se o arquivo foi gerado com sucesso, retorna o formato solicitado
    if return_ttml:
        return convert_cwi_json_to_ttml(str(output_cwi_file))

    return str(output_cwi_file)

__all__ = [
    "convert_cwi_json_to_ttml",
    "process_video",
]