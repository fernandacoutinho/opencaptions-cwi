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
        transcribe_script = _find_repo_path("packages/backend-av/scripts/transcribe.py")
    except FileNotFoundError:
        transcribe_script = _find_repo_path("opencaptions/transcribe.py")

    env = os.environ.copy()
    python_bin_dir = str(Path(sys.executable).parent)
    env["PATH"] = f"{python_bin_dir}{os.pathsep}{env.get('PATH', '')}"
    env["PYTHONWARNINGS"] = "ignore"
    env["PYTHONUNBUFFERED"] = "1"

    cmd = [
        sys.executable,
        str(transcribe_script),
        "--input", str(video_file)
    ]

    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        env=env,
        shell=(sys.platform == "win32")
    )

    # Verifica se já existe algum arquivo gerado por convenção
    possible_outputs = [
        output_cwi_file,
        video_file.with_suffix(".cwi.json"),
        Path(str(video_file) + ".cwi.json"),
        video_file.with_suffix(".json"),
        Path(str(video_file) + ".json"),
    ]

    generated_file = None
    for p in possible_outputs:
        if p.exists():
            generated_file = p
            break

    # Se não gerou arquivo físico, tentamos extrair o JSON do stdout do transcribe.py
    if not generated_file:
        stdout_text = result.stdout.strip()
        # Procura onde começa o JSON impresso na tela (geralmente começa com '{' ou '[')
        json_start_idx = stdout_text.find("{")
        if json_start_idx != -1:
            potential_json = stdout_text[json_start_idx:]
            try:
                # Valida se é um JSON válido
                parsed_json = json.loads(potential_json)
                # Salva o JSON no local esperado
                with open(output_cwi_file, "w", encoding="utf-8") as f:
                    json.dump(parsed_json, f, ensure_ascii=False, indent=2)
                generated_file = output_cwi_file
            except json.JSONDecodeError:
                pass

    if not generated_file:
        error_log = result.stderr.strip() or result.stdout.strip()
        raise RuntimeError(
            f"O script transcribe.py executou, mas nenhum JSON válido foi gerado ou retornado.\n"
            f"--- LOG ---\n{error_log}\n------------"
        )

    # Se o arquivo gerado for diferente do output_cwi desejado, ajustamos
    final_output = generated_file
    if output_cwi and generated_file != Path(output_cwi).resolve():
        target_path = Path(output_cwi).resolve()
        target_path.write_text(Path(generated_file).read_text(encoding="utf-8"), encoding="utf-8")
        final_output = target_path

    if return_ttml:
        return convert_cwi_json_to_ttml(str(final_output))

    return str(final_output)

__all__ = [
    "convert_cwi_json_to_ttml",
    "process_video",
]