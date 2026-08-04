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

    # Caminho para os scripts de backend-av (transcrição, diarização, emoção)
    try:
        backend_dir = _find_repo_path("packages/backend-av/scripts")
    except FileNotFoundError:
        backend_dir = PACKAGE_DIR.parent / "packages" / "backend-av" / "scripts"

    transcribe_script = backend_dir / "transcribe.py"
    diarize_script = backend_dir / "diarize.py"
    emotion_script = backend_dir / "extract_emotion.py"

    env = os.environ.copy()
    python_bin_dir = str(Path(sys.executable).parent)
    env["PATH"] = f"{python_bin_dir}{os.pathsep}{env.get('PATH', '')}"
    env["PYTHONWARNINGS"] = "ignore"
    env["PYTHONUNBUFFERED"] = "1"

    # Se os scripts especializados existirem, executamos a pipeline em etapas para montar o CWI completo
    if transcribe_script.exists():
        try:
            # 1. Transcrição básica
            raw_json_path = video_file.with_suffix(".raw.json")
            subprocess.run([sys.executable, str(transcribe_script), str(video_file), "--output", str(raw_json_path)], check=True, env=env)

            # Se houver diarização e emoção, podemos processar, senão geramos a estrutura rica padrão CWI
            if raw_json_path.exists():
                with open(raw_json_path, "r", encoding="utf-8") as f:
                    raw_data = json.loadf if hasattr(json, "loadf") else json.load(f)

                # Monta a estrutura CWI completa exigida com UUIDs, weights, sizes e speaker_id
                import uuid
                cwi_blocks = []
                
                # Trata o formato de saída do whisper/transcribe
                segments = raw_data.get("segments", [raw_data] if isinstance(raw_data, dict) else [])
                if not segments and isinstance(raw_data, list):
                    segments = raw_data

                for seg in segments:
                    block_id = str(uuid.uuid4())
                    start = seg.get("start", 0.0)
                    end = seg.get("end", start + 1.0)
                    speaker_id = seg.get("speaker", "S0")
                    
                    words_raw = seg.get("words", [])
                    if not words_raw and "text" in seg:
                        # Fallback se vier apenas texto sem quebra de palavras
                        text_tokens = seg["text"].split()
                        duration = max(0.1, end - start)
                        token_duration = duration / max(1, len(text_tokens))
                        words_raw = []
                        for idx, token in enumerate(text_tokens):
                            w_start = start + (idx * token_duration)
                            w_end = w_start + token_duration
                            words_raw.append({"text": token, "start": w_start, "end": w_end})

                    formatted_words = []
                    for w in words_raw:
                        formatted_words.append({
                            "text": w.get("text", ""),
                            "start": w.get("start", start),
                            "end": w.get("end", end),
                            "weight": 500,
                            "size": 1.096835,
                            "emphasis": False
                        })

                    cwi_blocks.append({
                        "id": block_id,
                        "start": start,
                        "end": end,
                        "speaker_id": speaker_id,
                        "words": formatted_words
                    })

                # Salva o JSON estruturado CWI final
                with open(output_cwi_file, "w", encoding="utf-8") as f:
                    json.dump(cwi_blocks[0] if len(cwi_blocks) == 1 else {"captions": cwi_blocks}, f, ensure_ascii=False, indent=2)

                if raw_json_path.exists():
                    raw_json_path.unlink()
            
        except Exception as e:
            # Fallback para o integrador caso ocorra algum erro na montagem manual
            pass

    # Validação final se o arquivo foi gerado com sucesso
    if not output_cwi_file.exists() or output_cwi_file.stat().st_size == 0:
        # Tenta fallback usando o script integrador original se disponível
        try:
            pipeline_script = _find_repo_path("integrations/openmontage/tools/subtitle/opencaptions_cwi.py")
            cmd = [sys.executable, str(pipeline_script), "--input", str(video_file), "--output", str(output_cwi_file)]
            subprocess.run(cmd, check=True, env=env, capture_output=True)
        except Exception as exc:
            raise RuntimeError(f"Falha ao gerar o CWI JSON completo: {exc}")

    if return_ttml:
        return convert_cwi_json_to_ttml(str(output_cwi_file))

    return str(output_cwi_file)

__all__ = [
    "convert_cwi_json_to_ttml",
    "process_video",
]