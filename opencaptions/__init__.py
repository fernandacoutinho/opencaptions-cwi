import subprocess
import sys
from pathlib import Path

def process_video(video_path: str, return_ttml: bool = False, output: str = None) -> str:
    video_file = Path(video_path).resolve()
    if not video_file.exists():
        raise FileNotFoundError(f"Vídeo não encontrado: {video_file}")

    base_dir = Path(__file__).resolve().parent.parent
    cli_path = base_dir / "packages" / "cli" / "dist" / "index.js"

    # Se o arquivo compilado não existir na máquina, tenta configurar o ambiente
    if not cli_path.exists():
        print("[*] Configurando dependências do Bun...")
        res_install = subprocess.run(["bun", "install"], cwd=base_dir, capture_output=True, text=True)
        if res_install.returncode != 0:
            raise RuntimeError(f"Erro ao rodar bun install:\n{res_install.stderr.strip()}")

        # Tenta compilar via turbo da raiz caso os artefatos não tenham vindo prontos
        turbo_path = base_dir / "node_modules" / ".bin" / "turbo"
        if not turbo_path.exists():
            turbo_path = base_dir / "node_modules" / "turbo" / "bin" / "turbo.js"

        if (base_dir / "turbo.json").exists() and turbo_path.exists():
            cmd_build = ["bun", "run", str(turbo_path), "build"] if turbo_path.suffix == ".js" else [str(turbo_path), "build"]
            res_build = subprocess.run(cmd_build, cwd=base_dir, capture_output=True, text=True)
            if res_build.returncode != 0:
                raise RuntimeError(f"Erro ao compilar via Turbo:\n{res_build.stderr.strip()}")

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