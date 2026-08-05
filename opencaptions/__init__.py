import subprocess
import sys
from pathlib import Path

# tenta importar o conversor de JSON para TTML que já existe na sua estrutura
try:
    from .json_to_ttml import convert_cwi_json_to_ttml
except ImportError:
    # caso esteja rodando de outro contexto, tenta importação absoluta
    try:
        from json_to_ttml import convert_cwi_json_to_ttml
    except ImportError:
        convert_cwi_json_to_ttml = None

def process_video(video_path: str, return_ttml: bool = False, output: str = None) -> str:
    """
    processa o vídeo chamando a CLI via Bun e opcionalmente retorna o conteúdo em TTML.
    """
    video_file = Path(video_path).resolve()
    if not video_file.exists():
        raise FileNotFoundError(f"Vídeo não encontrado: {video_file}")

    # define a raiz do repositório
    base_dir = Path(__file__).resolve().parent
    while base_dir != base_dir.parent:
        if (base_dir / "packages" / "cli").exists() or (base_dir / "package.json").exists():
            break
        base_dir = base_dir.parent

    cli_path = base_dir / "packages" / "cli" / "src" / "index.ts"
    if not cli_path.exists():
        cli_path = base_dir / "packages" / "core" / "src" / "index.ts"

    # define o caminho padrão de saída do JSON caso não seja especificado
    json_output = output or str(video_file.with_suffix(".cwi.json"))

    # monta e executa o comando da CLI
    cmd = ["bun", "run", str(cli_path), "generate", str(video_file), "--output", json_output]
    
    print(f"[*] Executando pipeline via CLI do OpenCaptions...")
    result = subprocess.run(cmd, capture_output=True, text=True)

    if result.returncode != 0:
        raise RuntimeError(f"Erro ao executar o pipeline:\n{result.stderr.strip()}")

    # se o usuário pediu o TTML -> converte o JSON gerado
    if return_ttml:
        if not convert_cwi_json_to_ttml:
            raise ImportError("A função convert_cwi_json_to_ttml não foi encontrada no módulo json_to_ttml.")
        
        print(f"[*] Convertendo JSON gerado para TTML...")
        
        # chama a função e lê o resultado
        ttml_content = convert_cwi_json_to_ttml(json_output)
        return ttml_content

    return json_output