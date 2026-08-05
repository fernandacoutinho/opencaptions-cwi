import subprocess
import sys
from pathlib import Path

def process_video(video_path: str, return_ttml: bool = False, output: str = None) -> str:
    video_file = Path(video_path).resolve()
    if not video_file.exists():
        raise FileNotFoundError(f"Vídeo não encontrado: {video_file}")

    # A raiz onde os arquivos do monorepo foram instalados pelo pip
    base_dir = Path(__file__).resolve().parent

    # Caminho absoluto ou relativo para a CLI compilada (JavaScript)
    # Isso evita totalmente os erros de workspace do TypeScript em tempo de execução
    cli_path = base_dir / "packages" / "cli" / "dist" / "index.js"

    if not cli_path.exists():
        # Se não estiver compilado na máquina de destino, tenta rodar o build do turbo/bun
        print("[*] Compilando pacotes do monorepo pela primeira vez...")
        res_build = subprocess.run(["bun", "run", "build"], cwd=base_dir, capture_output=True, text=True)
        if res_build.returncode != 0:
            raise RuntimeError(f"Erro ao compilar o monorepo:\n{res_build.stderr.strip()}")

    if not cli_path.exists():
        raise FileNotFoundError(f"O motor compilado da CLI não foi encontrado em: {cli_path}")

    json_output = output or str(video_file.with_suffix(".cwi.json"))

    # Executa o script JavaScript compilado via Bun
    cmd = ["bun", "run", str(cli_path), "generate", str(video_file), "--output", json_output]
    
    print(f"[*] Executando pipeline via OpenCaptions...")
    result = subprocess.run(cmd, cwd=base_dir, capture_output=True, text=True)

    if result.returncode != 0:
        raise RuntimeError(f"Erro ao executar o pipeline:\n{result.stderr.strip()}")

    if return_ttml:
        try:
            from .json_to_ttml import convert_cwi_json_to_ttml
            return convert_cwi_json_to_ttml(json_output)
        except ImportError:
            return json_output

    return json_output