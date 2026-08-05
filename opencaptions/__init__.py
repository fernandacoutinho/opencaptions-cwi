import subprocess
import sys
from pathlib import Path

def _get_base_dir():
    """
    Localiza a raiz onde os arquivos do monorepo foram instalados pelo pip
    (procura tanto na pasta do pacote quanto no diretório pai no site-packages).
    """
    current = Path(__file__).resolve().parent  # Pasta opencaptions/
    
    # Procura subindo até achar onde o packages/ e o package.json foram instalados juntos
    while current != current.parent:
        if (current / "packages").exists() and (current / "package.json").exists():
            return current
        if (current.parent / "packages").exists() and (current.parent / "package.json").exists():
            return current.parent
        current = current.parent
        
    return Path(__file__).resolve().parent.parent

def process_video(video_path: str, return_ttml: bool = False, output: str = None) -> str:
    video_file = Path(video_path).resolve()
    if not video_file.exists():
        raise FileNotFoundError(f"Vídeo não encontrado: {video_file}")

    base_dir = _get_base_dir()

    cli_path = base_dir / "packages" / "cli" / "src" / "index.ts"
    if not cli_path.exists():
        cli_path = base_dir / "packages" / "cli" / "dist" / "index.js"

    if not cli_path.exists():
        raise FileNotFoundError(
            f"O motor do OpenCaptions não foi encontrado em: {base_dir}. "
            "Verifique se o pyproject.toml incluiu a pasta 'packages'."
        )

    # Configura o ambiente Bun se o node_modules não existir na pasta instalada
    node_modules = base_dir / "node_modules"
    if not node_modules.exists():
        print("[*] Configurando dependências do Bun na máquina...")
        res_install = subprocess.run(["bun", "install"], cwd=base_dir, capture_output=True, text=True)
        if res_install.returncode != 0:
            raise RuntimeError(f"Erro ao rodar bun install:\n{res_install.stderr.strip()}")

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