import subprocess
import sys
import os
import shutil
from pathlib import Path
from .json_to_ttml import convert_cwi_json_to_ttml

def process_video(video_path: str, output_cwi: str = None, return_ttml: bool = False):
    """
    Processa um vídeo utilizando a CLI do OpenCaptions por trás dos panos.
    
    :param video_path: Caminho do arquivo de vídeo (.mp4, etc.)
    :param output_cwi: Caminho opcional para salvar o arquivo .cwi.json de saída
    :param return_ttml: Se True, converte e retorna a string TTML diretamente
    :return: Caminho do arquivo JSON gerado ou a string TTML
    """
    video_file = Path(video_path).resolve()
    if not video_file.exists():
        raise FileNotFoundError(f"Arquivo de vídeo não encontrado: {video_path}")

    # Encontra a raiz do projeto (onde está o package.json / packages/)
    root_dir = Path(__file__).resolve().parent.parent

    # Define o arquivo .cwi.json de saída
    if output_cwi is None:
        output_cwi_file = video_file.with_suffix(".cwi.json")
    else:
        output_cwi_file = Path(output_cwi).resolve()

    # --- RESOLUÇÃO DO AMBIENTE (WINDOWS & PYTHON3) ---
    env = os.environ.copy()
    python_bin_dir = str(Path(sys.executable).parent)
    env["PATH"] = f"{python_bin_dir}{os.pathsep}{env.get('PATH', '')}"

    # Garante que o executável 'python3' exista na pasta do ambiente virtual (necessário para a CLI)
    python3_exe = Path(python_bin_dir) / ("python3.exe" if sys.platform == "win32" else "python3")
    if not python3_exe.exists():
        python_exe = Path(sys.executable)
        if python_exe.exists():
            try:
                shutil.copy(python_exe, python3_exe)
            except Exception:
                pass

    # --- DEFINIÇÃO DO COMANDO DA CLI ---
    cli_entry = root_dir / "packages" / "cli" / "src" / "index.ts"

    # Tenta usar 'bun' primeiro; se não houver bun, tenta 'npx'
    if shutil.which("bun"):
        cmd = ["bun", str(cli_entry), "generate", str(video_file)]
    else:
        cmd = ["npx", "opencaptions", "generate", str(video_file), "--output", str(output_cwi_file)]

    # Executa o processo da CLI em segundo plano
    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        cwd=root_dir,
        env=env,
        shell=(sys.platform == "win32")
    )

    if result.returncode != 0:
        raise RuntimeError(f"Erro ao processar vídeo na CLI do OpenCaptions:\n{result.stderr or result.stdout}")

    # Se o parâmetro return_ttml for True, faz a conversão direta para TTML
    if return_ttml:
        return convert_cwi_json_to_ttml(str(output_cwi_file))

    return str(output_cwi_file)

__all__ = [
    "convert_cwi_json_to_ttml",
    "process_video",
]