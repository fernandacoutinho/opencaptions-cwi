import subprocess
import shutil
from .json_to_ttml import convert_cwi_json_to_ttml

def process_video(video_path: str, **kwargs):
    npx_path = shutil.which("npx")
    if not npx_path:
        raise RuntimeError("npx não encontrado no ambiente. Certifique-se de ter o Node.js instalado.")

    cmd = [npx_path, "opencaptions", "generate", video_path]
    
    result = subprocess.run(cmd, capture_output=True, text=True)
    
    if result.returncode != 0:
        raise RuntimeError(f"Erro ao processar vídeo: {result.stderr}")
        
    return result.stdout

__all__ = [
    "convert_cwi_json_to_ttml", 
    "process_video", 
]