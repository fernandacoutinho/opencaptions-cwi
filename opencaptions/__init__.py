import subprocess
import sys
from pathlib import Path

def _get_cli_path():
    # Procura a partir da pasta onde o pacote Python está instalado ou rodando
    base_dir = Path(__file__).resolve().parent
    
    # Tenta achar a pasta packages subindo nos diretórios pai se necessário
    current = base_dir
    while current != current.parent:
        cli_candidate = current / "packages" / "cli" / "src" / "index.ts"
        if cli_candidate.exists():
            return cli_candidate
        current = current.parent
        
    # Caminho padrão relativo ao diretório atual de execução
    return Path("packages/cli/src/index.ts").resolve()

def process_video(video_path: str, return_ttml: bool = False, output: str = None) -> str:
    video_file = Path(video_path).resolve()
    if not video_file.exists():
        raise FileNotFoundError(f"Vídeo não encontrado: {video_file}")

    cli_path = _get_cli_path()
    if not cli_path.exists():
        raise FileNotFoundError(f"Não foi possível localizar o arquivo da CLI em: {cli_path}")

    json_output = output or str(video_file.with_suffix(".cwi.json"))

    # Executa usando o Bun apontando para a CLI do repositório base
    cmd = ["bun", "run", str(cli_path), "generate", str(video_file), "--output", json_output]
    
    print(f"[*] Executando pipeline via OpenCaptions...")
    result = subprocess.run(cmd, capture_output=True, text=True)

    if result.returncode != 0:
        raise RuntimeError(f"Erro ao executar o pipeline:\n{result.stderr.strip()}")

    if return_ttml:
        try:
            from .json_to_ttml import convert_cwi_json_to_ttml
            return convert_cwi_json_to_ttml(json_output)
        except ImportError:
            # Fallback caso o conversor esteja na raiz
            import json
            # Retorna o JSON cru formatado caso o conversor ttml não esteja no escopo
            return json_output

    return json_output