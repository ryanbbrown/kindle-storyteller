from __future__ import annotations

import io
import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Tuple

os.environ.setdefault("DYLD_LIBRARY_PATH", "/opt/homebrew/lib")
os.environ.setdefault("LD_LIBRARY_PATH", "/opt/homebrew/lib")

from cairosvg import svg2png
from PIL import Image, ImageOps
from svgpathtools import parse_path

from extract_glyphs import FontMetrics, GlyphSpec, build_font_metrics, iter_glyph_specs


@dataclass(frozen=True)
class GlyphRender:
    image: Image.Image
    mask: Image.Image
    baseline_px: float
    font_size: float


def load_fonts(glyphs_path: Path) -> Tuple[Dict[str, FontMetrics], Dict[str, Dict[str, GlyphSpec]]]:
    fonts_data = json.loads(glyphs_path.read_text())
    metrics_map: Dict[str, FontMetrics] = {}
    glyph_map: Dict[str, Dict[str, GlyphSpec]] = {}

    for font_entry in fonts_data:
        metrics = build_font_metrics(font_entry)
        if metrics is None:
            continue
        metrics_map[metrics.font_key] = metrics
        glyph_map[metrics.font_key] = {
            spec.glyph_id: spec for spec in iter_glyph_specs(font_entry)
        }

    return metrics_map, glyph_map


def rasterize_glyph(spec: GlyphSpec, metrics: FontMetrics, font_size: float) -> GlyphRender:
    path = parse_path(spec.path_data)
    xmin, xmax, ymin, ymax = path.bbox()

    translate_x = -min(0.0, xmin)
    translate_y = metrics.baseline_units
    xmax_shifted = xmax + translate_x

    canvas_width_units = max(spec.advance_width, xmax_shifted)
    canvas_height_units = metrics.unit_height

    unit_to_px = metrics.unit_to_px(font_size)
    canvas_width_px = max(int(round(canvas_width_units * unit_to_px)), 1)
    canvas_height_px = max(int(round(canvas_height_units * unit_to_px)), 1)

    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'viewBox="0 0 {canvas_width_units} {canvas_height_units}">'
        f'<rect width="100%" height="100%" fill="#ffffff" />'
        f'<g transform="translate({translate_x},{translate_y})">'
        f'<path d="{spec.path_data}" fill="#000000" />'
        "</g></svg>"
    )

    png_bytes = svg2png(
        bytestring=svg.encode("utf-8"),
        output_width=canvas_width_px,
        output_height=canvas_height_px,
    )
    image = Image.open(io.BytesIO(png_bytes)).convert("L")
    mask = ImageOps.invert(image)
    baseline_px = translate_y * unit_to_px
    return GlyphRender(image=image, mask=mask, baseline_px=baseline_px, font_size=font_size)


def render_page(
    extract_root: Path,
    output_dir: Path,
    page_index: int = 0,
) -> Path:
    glyphs_path = extract_root / "glyphs.json"
    page_data_path = extract_root / "page_data_0_5.json"

    if not glyphs_path.exists():
        raise FileNotFoundError(f"missing glyphs.json at {glyphs_path}")
    if not page_data_path.exists():
        raise FileNotFoundError(f"missing page data at {page_data_path}")

    metrics_map, glyph_map = load_fonts(glyphs_path)

    page_data = json.loads(page_data_path.read_text())
    if page_index >= len(page_data):
        raise IndexError(f"page_index {page_index} out of bounds (total pages: {len(page_data)})")
    page = page_data[page_index]

    width = int(round(float(page.get("width", 0))))
    height = int(round(float(page.get("height", 0))))
    if width <= 0 or height <= 0:
        raise ValueError(f"Invalid page dimensions width={width} height={height}")

    canvas = Image.new("L", (width, height), color=255)
    glyph_cache: Dict[Tuple[str, str, float], GlyphRender] = {}

    for run in page.get("children", []):
        if run.get("type") != "run":
            continue

        font_key = run.get("fontKey")
        if font_key not in metrics_map:
            continue

        metrics = metrics_map[font_key]
        glyphs = run.get("glyphs", [])
        x_positions = run.get("xPosition", [])
        if not glyphs or not x_positions:
            continue

        if len(x_positions) < len(glyphs):
            # Kindle sometimes duplicates the last xPosition; pad as needed.
            last_x = x_positions[-1]
            x_positions = list(x_positions) + [last_x] * (len(glyphs) - len(x_positions))

        transform = run.get("transform", [1.0, 0.0, 0.0, 1.0, 0.0, 0.0])
        x_offset = float(transform[4]) if len(transform) > 4 else 0.0
        y_offset = float(transform[5]) if len(transform) > 5 else 0.0
        font_size = float(run.get("fontSize", metrics.height_px))

        glyph_specs = glyph_map.get(font_key, {})

        for glyph_id, x_pos in zip(glyphs, x_positions):
            spec = glyph_specs.get(str(glyph_id))
            if spec is None:
                continue
            key = (spec.font_key, spec.glyph_id, round(font_size, 3))
            render = glyph_cache.get(key)
            if render is None:
                render = rasterize_glyph(spec, metrics, font_size)
                glyph_cache[key] = render

            left = int(round(x_offset + float(x_pos)))
            top = int(round(y_offset - render.baseline_px))

            canvas.paste(render.image, (left, top), render.mask)

    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"page_{page_index:04d}.png"
    canvas.save(output_path)
    return output_path


def main() -> None:
    project_root = Path(__file__).resolve().parent
    extract_root = (project_root / "../extracted/book-content-B0CPWQZNQB").resolve()
    output_dir = project_root / "pages"
    output_path = render_page(extract_root, output_dir, page_index=0)
    print(f"Rendered page to {output_path}")


if __name__ == "__main__":
    main()
