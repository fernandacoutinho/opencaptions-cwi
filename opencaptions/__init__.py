import sys
import subprocess
from pathlib import Path

try:
    from .json_to_ttml import convert_cwi_json_to_ttml
except ImportError:
    convert_cwi_json_to_ttml = None

def process_video(video_path: str, return_ttml: bool = False, output: str = None) -> str:
    video_file = Path(video_path).resolve()
    if not video_file.exists():
        raise FileNotFoundError(f"Vídeo não encontrado: {video_file}")

    base_dir = Path(__file__).resolve().parent
    cli_path = base_dir / "packages" / "cli" / "dist" / "index.js"
    if not cli_path.exists():
        cli_path = base_dir / "packages" / "cli" / "src" / "index.ts"

    json_output = output or str(video_file.with_suffix(".cwi.json"))
    cmd = ["bun", "run", str(cli_path), "generate", str(video_file), "--output", json_output]
    
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"Erro ao executar o pipeline:\n{result.stderr.strip()}")

    if return_ttml:
        if not convert_cwi_json_to_ttml:
            raise ImportError("A função convert_cwi_json_to_ttml não foi encontrada.")
        return convert_cwi_json_to_ttml(json_output)

    return json_output

def main():
    """
    Ponto de entrada chamado diretamente quando o usuário digita 'opencaptions' no terminal.
    """
    base_dir = Path(__file__).resolve().parent
    cli_path = base_dir / "packages" / "cli" / "dist" / "index.js"
    if not cli_path.exists():
        cli_path = base_dir / "packages" / "cli" / "src" / "index.ts"

    # Repassa os argumentos passados no terminal (sys.argv[1:]) para a CLI em TypeScript
    cmd = ["bun", "run", str(cli_path)] + sys.argv[1:]
    
    try:
        completed = subprocess.run(cmd)
        sys.exit(completed.returncode)
    except Exception as e:
        print(f"Erro ao executar o comando OpenCaptions: {e}", file=sys.stderr)
        sys.exit(1)