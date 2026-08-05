import subprocess
import sys
from pathlib import Path

def _ensure_bun_dependencies(base_dir: Path):
    """
    Verifica se o node_modules existe na raiz do monorepo embutido
    """
    node_modules = base_dir / "node_modules"
    if not node_modules.exists():
        print("[*] Primeira execução detectada nesta máquina. Instalando dependências do Bun...")
        result = subprocess.run(["bun", "install"], cwd=base_dir, capture_output=True, text=True)
        if result.returncode != 0:
            raise RuntimeError(f"Erro ao rodar 'bun install' nas dependências do projeto:\n{result.stderr.strip()}")
        print("[+] Dependências instaladas com sucesso!")

def process_video(video_path: str, return_ttml: bool = False, output: str = None) -> str:
    video_file = Path(video_path).resolve()
    if not video_file.exists():
        raise FileNotFoundError(f"Vídeo não encontrado: {video_file}")

    # Encontra a raiz onde o repositório/pacote está estruturado
    base_dir = Path(__file__).resolve().parent
    current = base_dir
    while current != current.parent:
        if (current / "package.json").exists() and (current / "packages").exists():
            break
        current = current.parent

    # Garante que o ambiente do Bun/Node está pronto na máquina atual
    _ensure_bun_dependencies(current)

    cli_path = current / "packages" / "cli" / "src" / "index.ts"
    if not cli_path.exists():
        cli_path = current / "packages" / "cli" / "dist" / "index.js"

    json_output = output or str(video_file.with_suffix(".cwi.json"))

    cmd = ["bun", "run", str(cli_path), "generate", str(video_file), "--output", json_output]
    
    print(f"[*] Executando pipeline via OpenCaptions...")
    result = subprocess.run(cmd, cwd=current, capture_output=True, text=True)

    if result.returncode != 0:
        raise RuntimeError(f"Erro ao executar o pipeline:\n{result.stderr.strip()}")

    if return_ttml:
        try:
            from .json_to_ttml import convert_cwi_json_to_ttml
            return convert_cwi_json_to_ttml(json_output)
        except ImportError:
            return json_output

    return json_output