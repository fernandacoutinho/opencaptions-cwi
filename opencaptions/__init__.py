import subprocess
import sys
import os
import shutil
from pathlib import Path
from .json_to_ttml import convert_cwi_json_to_ttml

def process_video(video_path: str, output_cwi: str = None, return_ttml: bool = False):
    """
    Processa um vídeo utilizando a CLI do OpenCaptions por trás dos panos.
    """
    video_file = Path(video_path).resolve()
    if not video_file.exists():
        raise FileNotFoundError(f"Arquivo de vídeo não encontrado: {video_path}")

    # 1. Encontra a raiz do projeto (procura por package.json subindo os diretórios)
    current_dir = Path(__file__).resolve().parent
    root_dir = current_dir.parent

    # Se não encontrar localmente (ex: instalado via pip site-packages), usa o diretório de trabalho atual
    cli_entry = root_dir / "packages" / "cli" / "src" / "index.ts"
    if not cli_entry.exists():
        # Fallback para o diretório atual onde o usuário está executando
        root_dir = Path.cwd()
        cli_entry = root_dir / "packages" / "cli" / "src" / "index.ts"

    # Define o arquivo .cwi.json de saída
    if output_cwi is None:
        output_cwi_file = video_file.with_suffix(".cwi.json")
    else:
        output_cwi_file = Path(output_cwi).resolve()

    # --- RESOLUÇÃO DO AMBIENTE (WINDOWS & PYTHON3) ---
    env = os.environ.copy()
    python_bin_dir = str(Path(sys.executable).parent)
    env["PATH"] = f"{python_bin_dir}{os.pathsep}{env.get('PATH', '')}"

    # Garante executável python3.exe na pasta do venv para a CLI
    python3_exe = Path(python_bin_dir) / ("python3.exe" if sys.platform == "win32" else "python3")
    if not python3_exe.exists():
        python_exe = Path(sys.executable)
        if python_exe.exists():
            try:
                shutil.copy(python_exe, python3_exe)
            except Exception:
                pass

    # --- MONTAGEM DO COMANDO ---
    if cli_entry.exists() and shutil.which("bun"):
        cmd = ["bun", str(cli_entry), "generate", str(video_file)]
    elif shutil.which("bun"):
        cmd = ["bun", "run", "opencaptions", "generate", str(video_file)]
    else:
        cmd = ["npx", "opencaptions", "generate", str(video_file)]

    # Executa o processo da CLI em segundo plano
    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        cwd=root_dir if root_dir.exists() else None,
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