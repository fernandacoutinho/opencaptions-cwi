import subprocess
import sys
from pathlib import Path

def process_video(video_path: str, return_ttml: bool = False, output: str = None) -> str:
    video_file = Path(video_path).resolve()
    if not video_file.exists():
        raise FileNotFoundError(f"Vídeo não encontrado: {video_file}")

    base_dir = Path(__file__).resolve().parent.parent
    cli_path = base_dir / "packages" / "cli" / "dist" / "index.js"

    if not cli_path.exists():
        print("[*] Configurando dependências do Bun...")
        res_install = subprocess.run(["bun", "install"], cwd=base_dir, capture_output=True, text=True)
        if res_install.returncode != 0:
            raise RuntimeError(f"Erro ao rodar bun install:\n{res_install.stderr.strip()}")

        print("[*] Compilando pacotes do monorepo na ordem correta...")
        
        # Ordem de dependência: compila primeiro os tipos, depois os backends/módulos e por fim a CLI
        subpackages = ["packages/types", "packages/backend-av", "packages/cli"]
        
        for subpkg in subpackages:
            pkg_dir = base_dir / subpkg
            if (pkg_dir / "package.json").exists():
                print(f"[*] Compilando {subpkg}...")
                res_build = subprocess.run(["bun", "run", "build"], cwd=pkg_dir, capture_output=True, text=True)
                if res_build.returncode != 0:
                    # Se falhar o build específico, tenta rodar o tsc direto se existir
                    res_tsc = subprocess.run(["bun", "x", "tsc"], cwd=pkg_dir, capture_output=True, text=True)
                    if res_tsc.returncode != 0:
                        raise RuntimeError(f"Erro ao compilar {subpkg}:\n{res_build.stderr.strip()}\n{res_tsc.stderr.strip()}")

    if not cli_path.exists():
        raise FileNotFoundError(f"O motor compilado da CLI não foi encontrado em: {cli_path}")

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