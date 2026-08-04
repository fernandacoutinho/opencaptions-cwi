import html
import json
from pathlib import Path
import sys
from typing import Any, Dict, Optional


def seconds_to_ttml_time(seconds: float) -> str:
    """Converte segundos para o formato HH:MM:SS.mmm aceito em TTML."""
    hrs = int(seconds // 3600)
    mins = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    millis = int(round((seconds - int(seconds)) * 1000))
    return f"{hrs:02d}:{mins:02d}:{secs:02d}.{millis:03d}"


class StyleManager:

    def __init__(self):
        self.styles = {}
        self.counter = 1

    def get_or_create_style(
        self,
        color: Optional[str] = None,
        font_weight: Optional[str] = None,
        font_size: Optional[str] = None,
        bg_color: Optional[str] = None,
        font_style: Optional[str] = None,
    ) -> str:
        key = (color, font_weight, font_size, bg_color, font_style)
        if key in self.styles:
            return self.styles[key]["id"]

        style_id = f"s{self.counter}"
        self.counter += 1

        attrs = {}
        if color:
            attrs["tts:color"] = color
        if bg_color:
            attrs["tts:backgroundColor"] = bg_color
        if font_weight:
            attrs["tts:fontWeight"] = font_weight
        if font_size:
            attrs["tts:fontSize"] = font_size
        if font_style:
            attrs["tts:fontStyle"] = font_style

        self.styles[key] = {"id": style_id, "attrs": attrs}
        return style_id

    def generate_xml_styles(self) -> str:
        lines = []
        for style_info in self.styles.values():
            attr_str = " ".join(
                f'{k}="{v}"' for k, v in style_info["attrs"].items()
            )
            lines.append(
                f'      <style xml:id="{style_info["id"]}" {attr_str} />'
            )
        return "\n".join(lines)


def convert_cwi_json_to_ttml(
    json_path: str,
    ttml_path: Optional[str] = None,
    font_family: str = "Noto Sans",
) -> str:
    json_file = Path(json_path)
    if not json_file.exists():
        raise FileNotFoundError(f"Arquivo não encontrado: {json_path}")

    ttml_file = (
        Path(ttml_path) if ttml_path else json_file.with_suffix(".ttml")
    )

    with open(json_file, "r", encoding="utf-8") as f:
        data = json.load(f)

    style_mgr = StyleManager()

    # 1. Configurações Globais
    global_styles = data.get("styles", {})
    global_color = global_styles.get("color", "#FFFFFF")
    global_bg = global_styles.get("backgroundColor", "#00000080")
    global_size = global_styles.get("fontSize", "100%")
    global_align = global_styles.get("textAlign", "center")
    lang = data.get("language", "pt-BR")

    # Mapear cores dos falantes (cast)
    speaker_styles = {}
    cast_data = data.get("cast", [])
    if isinstance(cast_data, list):
        for speaker in cast_data:
            s_id = speaker.get("id")
            s_color = speaker.get("color")
            if s_id and s_color:
                speaker_styles[s_id] = style_mgr.get_or_create_style(
                    color=s_color
                )

    # Metadados de Perfis de Voz (percorre todo o cast)
    metadata_tags = ["<ttm:title>OpenCaptions IMSC TTML Export</ttm:title>"]
    if isinstance(cast_data, list):
        for speaker in cast_data:
            v_profile = speaker.get("voice_profile", {})
            s_id = speaker.get("id", "S0")
            if v_profile:
                pitch_base = v_profile.get("pitch_baseline_hz", "")
                pitch_p10 = v_profile.get("pitch_p10", "")
                pitch_p90 = v_profile.get("pitch_p90", "")
                vol_base = v_profile.get("volume_baseline_db", "")
                metadata_tags.append(
                    f'<custom:voiceProfile speaker="{s_id}" pitchBaselineHz="{pitch_base}" pitchP10="{pitch_p10}" pitchP90="{pitch_p90}" volumeBaselineDb="{vol_base}" />'
                )

    metadata_xml = "\n      ".join(metadata_tags)

    captions = data.get("captions") or data.get("subtitles", [])
    paragraphs = []

    # 2. Processa as legendas e palavras
    for item in captions:
        p_start = seconds_to_ttml_time(
            item.get("start", item.get("begin", 0.0))
        )
        p_end = seconds_to_ttml_time(item.get("end", 0.0))
        speaker_id = item.get("speaker")

        p_style_attr = ""
        if speaker_id and speaker_id in speaker_styles:
            p_style_attr = f' style="{speaker_styles[speaker_id]}"'

        words = item.get("words", [])
        word_spans = []

        if words:
            for w in words:
                raw_text = w.get("text", w.get("word", ""))
                w_text = html.escape(raw_text)

                if not w_text.strip():
                    continue

                if raw_text.endswith(" ") and not w_text.endswith(" "):
                    w_text += " "

                w_start = seconds_to_ttml_time(
                    w.get("start", w.get("begin", item.get("start", 0.0)))
                )
                w_end = seconds_to_ttml_time(
                    w.get("end", item.get("end", 0.0))
                )

                # Extração de parâmetros da palavra
                style_data = (
                    w.get("style", {}) if isinstance(w.get("style"), dict) else {}
                )
                color = style_data.get("color") or w.get("color")
                bg_color = style_data.get("backgroundColor") or w.get(
                    "backgroundColor"
                )
                font_style = style_data.get("fontStyle") or w.get("fontStyle")

                raw_size = w.get("size")
                raw_weight = w.get("weight")
                is_emphasis = w.get("emphasis", False)

                # Cálculo do tamanho (fontSize) em porcentagem válida para TTML
                scale_factor = 1.0
                if raw_size is not None and isinstance(
                    raw_size, (int, float)
                ):
                    scale_factor = float(raw_size)

                tts_size_str = f"{int(round(scale_factor * 100))}%"

                # Mapeamento estrito do peso da fonte
                tts_weight = None
                if is_emphasis or (
                    isinstance(raw_weight, (int, float)) and raw_weight >= 600
                ):
                    tts_weight = "bold"
                    if not color and is_emphasis:
                        color = "#FFD700"
                else:
                    tts_weight = "normal"

                # Registra/recupera ID do estilo no <head>
                style_id = style_mgr.get_or_create_style(
                    color=color,
                    font_weight=tts_weight,
                    font_size=tts_size_str,
                    bg_color=bg_color,
                    font_style=font_style,
                )

                # Atributos nativos vs customizados
                custom_attrs = []
                if raw_size is not None:
                    custom_attrs.append(f'custom:size="{scale_factor:.3f}"')
                if raw_weight is not None:
                    custom_attrs.append(f'custom:weight="{raw_weight}"')
                if is_emphasis:
                    custom_attrs.append('custom:emphasis="true"')

                custom_str = (
                    (" " + " ".join(custom_attrs)) if custom_attrs else ""
                )

                word_spans.append(
                    f'<span begin="{w_start}" end="{w_end}" style="{style_id}"{custom_str}>{w_text}</span>'
                )

            inner_content = "".join(word_spans)
        else:
            inner_content = html.escape(item.get("text", ""))

        if inner_content.strip():
            paragraphs.append(
                f'      <p begin="{p_start}" end="{p_end}"{p_style_attr}>{inner_content}</p>'
            )

    paragraphs_xml = "\n".join(paragraphs)
    styles_xml = style_mgr.generate_xml_styles()

    # 3. Estrutura Final TTML com suporte a preservação de espaços
    ttml_content = f"""<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" 
    xmlns:tts="http://www.w3.org/ns/ttml#styling" 
    xmlns:ttm="http://www.w3.org/ns/ttml#metadata" 
    xmlns:custom="http://meudominio.com/ttml/custom"
    xml:lang="{lang}"
    xml:space="preserve">
  <head>
    <metadata>
      {metadata_xml}
    </metadata>
    <styling>
      <style xml:id="defaultStyle" 
             tts:fontFamily="{font_family}, sans-serif" 
             tts:fontSize="{global_size}" 
             tts:color="{global_color}" 
             tts:backgroundColor="{global_bg}" 
             tts:textAlign="{global_align}" />
{styles_xml}
    </styling>
    <layout>
      <region xml:id="bottom" tts:origin="10% 80%" tts:extent="80% 20%" tts:displayAlign="after" />
    </layout>
  </head>
  <body region="bottom" style="defaultStyle">
    <div>
{paragraphs_xml}
    </div>
  </body>
</tt>"""

    with open(ttml_file, "w", encoding="utf-8") as f:
        f.write(ttml_content)

    return str(ttml_file)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(
            "Uso: python json_to_ttml.py <arquivo.json> [arquivo_saida.ttml] [nome_da_fonte]"
        )
        sys.exit(1)

    input_json = sys.argv[1]
    output_ttml = (
        sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] != "" else None
    )
    font_name = sys.argv[3] if len(sys.argv) > 3 else "Noto Sans"

    try:
        out_path = convert_cwi_json_to_ttml(input_json, output_ttml, font_name)
        print(
            f"✓ Sucesso: Arquivo convertido e salvo em '{out_path}' com a fonte '{font_name}'"
        )
    except Exception as e:
        print(f"✗ Erro na conversão: {e}")
        sys.exit(1)