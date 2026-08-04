import subprocess
import sys
import os
import json
from pathlib import Path
from .json_to_ttml import convert_cwi_json_to_ttml

PACKAGE_DIR = Path(__file__).parent.resolve()

def _find_repo_path(relative_path: str) -> Path:
    site_packages_path = PACKAGE_DIR.parent / relative_path
    if site_packages_path.exists():
        return site_packages_path

    curr = PACKAGE_DIR
    while curr != curr.parent:
        candidate = curr / relative_path
        if candidate.exists():
            return candidate
        curr = curr.parent

    raise FileNotFoundError(f"Não foi possível encontrar o recurso: {relative_path}")


def process_video(video_path: str, output_cwi: str = None, return_ttml: bool = False):
    video_file = Path(video_path).resolve()
    if not video_file.exists():
        raise FileNotFoundError(f"Arquivo de vídeo não encontrado: {video_path}")

    if output_cwi is None:
        output_cwi_file = video_file.with_suffix(".cwi.json")
    else:
        output_cwi_file = Path(output_cwi).resolve()

    try:
        backend_dir = _find_repo_path("packages/backend-av/scripts")
    except FileNotFoundError:
        backend_dir = PACKAGE_DIR.parent / "packages" / "backend-av" / "scripts"

    transcribe_script = backend_dir / "transcribe.py"

    env = os.environ.copy()
    python_bin_dir = str(Path(sys.executable).parent)
    env["PATH"] = f"{python_bin_dir}{os.pathsep}{env.get('PATH', '')}"
    env["PYTHONWARNINGS"] = "ignore"
    env["PYTHONUNBUFFERED"] = "1"

    if not transcribe_script.exists():
        raise FileNotFoundError(f"Script de transcrição não encontrado em: {transcribe_script}")

    cmd = [
        sys.executable,
        str(transcribe_script),
        "--input", str(video_file)
    ]

    result = subprocess.run(cmd, capture_output=True, text=True, env=env)
    if result.returncode != 0:
        error_msg = result.stderr.strip() or result.stdout.strip()
        raise RuntimeError(f"Erro ao executar o transcribe.py: {error_msg}")

    try:
        raw_data = json.loads(result.stdout)
    except Exception as e:
        raise RuntimeError(f"Erro ao decodificar JSON do transcribe.py: {e}\nSaída recebida: {result.stdout[:300]}")

    # Se a própria ferramenta interna tiver um script ou função de formatação/agrupamento de blocos, podemos chamá-la ou reutilizá-la.
    # Caso contrário, se o transcribe.py retornar apenas a lista de palavras na chave "words", 
    # podemos procurar se existe um formatador dentro do backend ou agrupar dinamicamente por pausas/sentenças.
    
    # Vamos verificar se o raw_data já traz "captions" ou "segments" prontos com os IDs e tempos de início/fim:
    captions = raw_data.get("captions", raw_data.get("segments", []))
    
    if not captions and "words" in raw_data:
        # Se veio apenas a lista de palavras cruas, agrupamos por pausas naturais (ex: intervalo maior que 0.6s) ou por blocos de X palavras
        words = raw_data["words"]
        captions = []
        current_words = []
        
        for w in words:
            current_words.append(w)
            # Regra de quebra de trecho automática baseada em pontuação ou limite de palavras
            text = w.get("text", "")
            if len(current_words) >= 12 or text.endswith(('.', '?', '!')):
                if current_words:
                    captions.append({
                        "start": current_words[0].get("start", 0.0),
                        "end": current_words[-1].get("end", 0.0),
                        "words": current_words
                    })
                    current_words = []
        
        if current_words:
            captions.append({
                "start": current_words[0].get("start", 0.0),
                "end": current_words[-1].get("end", 0.0),
                "words": current_words
            })

    output_data = {"captions": captions}
    
    with open(output_cwi_file, "w", encoding="utf-8") as f:
        json.dump(output_data, f, ensure_ascii=False, indent=2)

    if return_ttml:
        return convert_cwi_json_to_ttml(str(output_cwi_file))

    return str(output_cwi_file)

__all__ = [
    "convert_cwi_json_to_ttml",
    "process_video",
]