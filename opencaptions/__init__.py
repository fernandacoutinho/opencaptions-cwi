import subprocess
import sys
import os
import shutil
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

    try:
        transcribe_script = _find_repo_path("packages/backend-av/scripts/transcribe.py")
    except FileNotFoundError:
        transcribe_script = _find_repo_path("opencaptions/transcribe.py")

    env = os.environ.copy()
    python_bin_dir = str(Path(sys.executable).parent)
    env["PATH"] = f"{python_bin_dir}{os.pathsep}{env.get('PATH', '')}"
    env["PYTHONWARNINGS"] = "ignore"
    env["PYTHONUNBUFFERED"] = "1"

    # Chamamos o transcribe.py apenas com os argumentos válidos (--input)
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

    # Possíveis locais onde o transcribe.py pode ter salvo o JSON
    possible_outputs = [
        video_file.with_suffix(".cwi.json"),
        Path(str(video_file) + ".cwi.json"),
        video_file.with_suffix(".json"),
        Path(str(video_file) + ".json"),
        Path.cwd() / f"{video_file.stem}.cwi.json",
        Path.cwd() / f"{video_file.stem}.json"
    ]

    generated_file = None
    for p in possible_outputs:
        if p.exists():
            generated_file = p
            break

    if not generated_file:
        error_log = result.stderr.strip() or result.stdout.strip()
        raise RuntimeError(
            f"O script transcribe.py falhou antes de gerar o JSON.\n"
            f"--- LOG DE ERRO DO TRANSMITTER ---\n"
            f"{error_log}\n"
            f"----------------------------------"
        )

    # Se o usuário passou um caminho de saída customizado, movemos o arquivo para lá
    final_output = generated_file
    if output_cwi:
        target_path = Path(output_cwi).resolve()
        if generated_file != target_path:
            shutil.move(str(generated_file), str(target_path))
            final_output = target_path

    if return_ttml:
        return convert_cwi_json_to_ttml(str(final_output))

    return str(final_output)

__all__ = [
    "convert_cwi_json_to_ttml",
    "process_video",
]