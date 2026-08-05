import subprocess
import sys
from pathlib import Path

def process_video(video_path: str, return_ttml: bool = False, output: str = None) -> str:
    video_file = Path(video_path).resolve()
    if not video_file.exists():
        raise FileNotFoundError(f"Vídeo não encontrado: {video_file}")

    # A raiz é SEMPRE a pasta onde este __init__.py está instalado (dentro do site-packages do Python)
    base_dir = Path(__file__).resolve().parent

    # Caminho onde a CLI compilada ou o index.ts deve estar empacotado dentro do seu pacote
    cli_path = base_dir / "packages" / "cli" / "src" / "index.ts"
    if not cli_path.exists():
        cli_path = base_dir / "packages" / "cli" / "dist" / "index.js"

    if not cli_path.exists():
        raise FileNotFoundError(
            f"O motor do OpenCaptions não foi encontrado dentro do pacote instalado em: {base_dir}. "
            "Verifique se o MANIFEST.in incluiu a pasta 'packages'."
        )

    # Verifica se as dependências do Bun já foram instaladas dentro da pasta do pacote
    node_modules = base_dir / "node_modules"
    if not node_modules.exists():
        print("[*] Configurando o ambiente pela primeira vez...")
        res_install = subprocess.run(["bun", "install"], cwd=base_dir, capture_output=True, text=True)
        if res_install.returncode != 0:
            raise RuntimeError(f"Erro ao preparar o ambiente do Bun:\n{res_install.stderr.strip()}")

    json_output = output or str(video_file.with_suffix(".cwi.json"))

    # Roda a CLI usando o Bun apontando para os arquivos internos do pacote
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