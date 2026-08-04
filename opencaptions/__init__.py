import subprocess
import sys
import os
import shutil
from pathlib import Path
from .json_to_ttml import convert_cwi_json_to_ttml

def _find_cli_entry():
    # 1. Tenta achar subindo os diretórios da instalação
    curr = Path(__file__).resolve().parent
    while curr != curr.parent:
        cli_path = curr / "packages" / "cli" / "src" / "index.ts"
        if cli_path.exists():
            return cli_path, curr
        curr = curr.parent

    # 2. Tenta achar a partir do diretório onde o terminal está rodando
    curr = Path.cwd()
    while curr != curr.parent:
        cli_path = curr / "packages" / "cli" / "src" / "index.ts"
        if cli_path.exists():
            return cli_path, curr
        curr = curr.parent

    return None, None

def process_video(video_path: str, output_cwi: str = None, return_ttml: bool = False):
    video_file = Path(video_path).resolve()
    if not video_file.exists():
        raise FileNotFoundError(f"Arquivo de vídeo não encontrado: {video_path}")

    cli_entry, root_dir = _find_cli_entry()

    if output_cwi is None:
        output_cwi_file = video_file.with_suffix(".cwi.json")
    else:
        output_cwi_file = Path(output_cwi).resolve()

    # --- AMBIENTE (PYTHON3 NO WINDOWS) ---
    env = os.environ.copy()
    python_bin_dir = str(Path(sys.executable).parent)
    env["PATH"] = f"{python_bin_dir}{os.pathsep}{env.get('PATH', '')}"

    python3_exe = Path(python_bin_dir) / ("python3.exe" if sys.platform == "win32" else "python3")
    if not python3_exe.exists():
        python_exe = Path(sys.executable)
        if python_exe.exists():
            try:
                shutil.copy(python_exe, python3_exe)
            except Exception:
                pass

    # --- MONTAGEM DO COMANDO ---
    if cli_entry and cli_entry.exists() and shutil.which("bun"):
        cmd = ["bun", str(cli_entry), "generate", str(video_file)]
    elif shutil.which("bun"):
        cmd = ["bun", "run", "opencaptions", "generate", str(video_file)]
    else:
        cmd = ["npx", "opencaptions", "generate", str(video_file)]

    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        cwd=str(root_dir) if root_dir else None,
        env=env,
        shell=(sys.platform == "win32")
    )

    if result.returncode != 0:
        raise RuntimeError(f"Erro ao processar vídeo na CLI do OpenCaptions:\n{result.stderr or result.stdout}")

    if return_ttml:
        return convert_cwi_json_to_ttml(str(output_cwi_file))

    return str(output_cwi_file)

__all__ = [
    "convert_cwi_json_to_ttml",
    "process_video",
]