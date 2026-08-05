import subprocess
import sys
from pathlib import Path

def _find_monorepo_root():
    """
    Procura de forma inteligente onde está o package.json principal 
    do monorepo, seja no diretório atual ou dentro da instalação do site-packages.
    """
    # 1. Começa a procurar a partir da pasta do próprio arquivo __init__.py instalado
    start_path = Path(__file__).resolve().parent
    current = start_path
    
    while current != current.parent:
        if (current / "package.json").exists() and (current / "packages").exists():
            return current
        current = current.parent

    # 2. Se não achou subindo, tenta olhar no diretório de trabalho atual (onde o usuário chamou o script)
    current = Path.cwd()
    while current != current.parent:
        if (current / "package.json").exists() and (current / "packages").exists():
            return current
        current = current.parent

    # Fallback para o diretório atual
    return Path.cwd()

def _ensure_bun_dependencies(base_dir: Path):
    """
    Garante que as dependências do Bun estão instaladas na raiz correta do monorepo.
    """
    node_modules = base_dir / "node_modules"
    pkg_json = base_dir / "package.json"
    
    if not pkg_json.exists():
        raise FileNotFoundError(
            f"O arquivo 'package.json' não foi encontrado em '{base_dir}'. "
            "Certifique-se de que o pacote foi empacotado corretamente com todos os arquivos do monorepo."
        )

    if not node_modules.exists():
        print(f"[*] Instalando dependências do Bun em {base_dir}...")
        result = subprocess.run(["bun", "install"], cwd=base_dir, capture_output=True, text=True)
        if result.returncode != 0:
            raise RuntimeError(f"Erro ao rodar 'bun install':\n{result.stderr.strip()}")
        print("[+] Dependências instaladas com sucesso!")

def process_video(video_path: str, return_ttml: bool = False, output: str = None) -> str:
    video_file = Path(video_path).resolve()
    if not video_file.exists():
        raise FileNotFoundError(f"Vídeo não encontrado: {video_file}")

    # Descobre a raiz exata do monorepo
    base_dir = _find_monorepo_root()
    
    # Garante o bun install no lugar certo
    _ensure_bun_dependencies(base_dir)

    # Localiza o arquivo da CLI
    cli_path = base_dir / "packages" / "cli" / "src" / "index.ts"
    if not cli_path.exists():
        cli_path = base_dir / "packages" / "cli" / "dist" / "index.js"

    if not cli_path.exists():
        raise FileNotFoundError(f"Não foi possível encontrar o arquivo de entrada da CLI em: {cli_path}")

    json_output = output or str(video_file.with_suffix(".cwi.json"))

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