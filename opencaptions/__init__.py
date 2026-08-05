import subprocess
import sys
from pathlib import Path

def _get_base_dir():
    """
    Varre os locais possíveis onde o package.json e a pasta packages 
    foram instalados pelo pip (tanto no site-packages quanto na raiz).
    """
    # 1. Olha na mesma pasta do __init__.py
    current = Path(__file__).resolve().parent
    if (current / "package.json").exists() and (current / "packages").exists():
        return current
        
    # 2. Olha na pasta pai (caso estejam no nível do site-packages)
    if (current.parent / "package.json").exists() and (current.parent / "packages").exists():
        return current.parent
        
    # 3. Sobe subindo os diretórios até achar
    temp = current
    while temp != temp.parent:
        if (temp / "package.json").exists() and (temp / "packages").exists():
            return temp
        temp = temp.parent
        
    # Fallback absolute para a pasta do __init__.py se nada mais for achado
    return current

def process_video(video_path: str, return_ttml: bool = False, output: str = None) -> str:
    video_file = Path(video_path).resolve()
    if not video_file.exists():
        raise FileNotFoundError(f"Vídeo não encontrado: {video_file}")

    base_dir = _get_base_dir()

    # Validação rigorosa para garantir que o package.json existe antes de chamar o Bun
    if not (base_dir / "package.json").exists():
        raise FileNotFoundError(
            f"O 'package.json' não foi encontrado em '{base_dir}'. "
            "Verifique se o pyproject.toml / MANIFEST.in copiou os arquivos da raiz."
        )

    cli_path = base_dir / "packages" / "cli" / "src" / "index.ts"
    if not cli_path.exists():
        cli_path = base_dir / "packages" / "cli" / "dist" / "index.js"

    if not cli_path.exists():
        raise FileNotFoundError(f"O motor da CLI não foi encontrado em: {cli_path}")

    # Configura o ambiente Bun se o node_modules não existir na raiz correta
    node_modules = base_dir / "node_modules"
    if not node_modules.exists():
        print(f"[*] Configurando dependências do Bun em '{base_dir}'...")
        res_install = subprocess.run(["bun", "install"], cwd=base_dir, capture_output=True, text=True)
        if res_install.returncode != 0:
            raise RuntimeError(f"Erro ao rodar bun install:\n{res_install.stderr.strip()}")
        print("[+] Dependências configuradas com sucesso!")

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