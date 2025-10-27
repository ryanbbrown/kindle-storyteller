from __future__ import annotations

import io
import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

os.environ.setdefault("DYLD_LIBRARY_PATH", "/opt/homebrew/lib")
os.environ.setdefault("LD_LIBRARY_PATH", "/opt/homebrew/lib")

from cairosvg import svg2png
from PIL import Image
from svgpathtools import parse_path


@dataclass
class FontMetrics:
    font_key: str
    min_y: float
    max_y: float
    height_px: float

    @property
    def unit_height(self) -> float:
        return self.max_y - self.min_y

    @property
    def scale(self) -> float:
        if self.unit_height == 0:
            return 1.0
        return self.height_px / self.unit_height

    @property
    def baseline_units(self) -> float:
        return -self.min_y

    def unit_to_px(self, target_height: float) -> float:
        if self.unit_height == 0:
            return 1.0
        return target_height / self.unit_height

    @property
    def baseline_px(self) -> float:
        return self.baseline_units * self.unit_to_px(self.height_px)


@dataclass
class GlyphSpec:
    font_key: str
    glyph_id: str
    advance_width: float
    path_data: str


def iter_glyph_specs(font_entry: dict) -> Iterator[GlyphSpec]:
    font_key = font_entry["fontKey"]
    glyphs = font_entry.get("glyphs", {})
    for glyph_id, payload in glyphs.items():
        if not isinstance(payload, dict):
            continue
        if payload.get("type") != "path":
            continue
        path_data = payload.get("path")
        if not path_data:
            continue
        advance_width = float(payload.get("advanceWidth", 0.0))
        yield GlyphSpec(
            font_key=font_key,
            glyph_id=str(glyph_id),
            advance_width=advance_width,
            path_data=path_data,
        )


def build_font_metrics(font_entry: dict) -> FontMetrics | None:
    glyphs = font_entry.get("glyphs", {})
    min_y: float | None = None
    max_y: float | None = None
    for payload in glyphs.values():
        if not isinstance(payload, dict):
            continue
        if payload.get("type") != "path":
            continue
        path_data = payload.get("path")
        if not path_data:
            continue
        try:
            path = parse_path(path_data)
        except Exception:
            continue
        try:
            _, _, glyph_min_y, glyph_max_y = path.bbox()
        except ValueError:
            continue
        min_y = glyph_min_y if min_y is None else min(min_y, glyph_min_y)
        max_y = glyph_max_y if max_y is None else max(max_y, glyph_max_y)

    if min_y is None or max_y is None:
        return None

    height_px = float(font_entry.get("height", 0.0))
    if height_px <= 0:
        # fall back to unit height to keep scale sane
        height_px = max_y - min_y

    return FontMetrics(
        font_key=font_entry["fontKey"],
        min_y=min_y,
        max_y=max_y,
        height_px=height_px,
    )


def render_glyph(
    glyph: GlyphSpec,
    metrics: FontMetrics,
    output_dir: Path,
) -> dict[str, float | str]:
    path = parse_path(glyph.path_data)
    xmin, xmax, ymin, ymax = path.bbox()

    translate_x = -min(0.0, xmin)
    translate_y = -metrics.min_y
    xmax_shifted = xmax + translate_x

    canvas_width_units = max(glyph.advance_width, xmax_shifted)
    canvas_height_units = metrics.unit_height

    scale = metrics.scale
    canvas_width_px = max(int(round(canvas_width_units * scale)), 1)
    canvas_height_px = max(int(round(metrics.height_px)), 1)

    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {canvas_width_units} {canvas_height_units}">'
        f'<rect width="100%" height="100%" fill="#ffffff" />'
        f'<g transform="translate({translate_x},{translate_y})">'
        f'<path d="{glyph.path_data}" fill="#000000" />'
        "</g></svg>"
    )

    png_bytes = svg2png(
        bytestring=svg.encode("utf-8"),
        output_width=canvas_width_px,
        output_height=canvas_height_px,
    )
    image = Image.open(io.BytesIO(png_bytes)).convert("L")

    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"{glyph.font_key}_{glyph.glyph_id}.png"
    image.save(output_path)

    return {
        "path": str(output_path),
        "font_key": glyph.font_key,
        "glyph_id": glyph.glyph_id,
        "advance_width_units": glyph.advance_width,
        "canvas_width_units": canvas_width_units,
        "canvas_height_units": canvas_height_units,
        "canvas_width_px": canvas_width_px,
        "canvas_height_px": canvas_height_px,
        "xmin": xmin,
        "xmax": xmax,
        "ymin": ymin,
        "ymax": ymax,
        "translate_x": translate_x,
        "translate_y": translate_y,
    }


def main() -> None:
    project_root = Path(__file__).resolve().parent
    extract_root = (project_root / "../kindle-api/extracted/book-content-B0CPWQZNQB").resolve()
    glyphs_path = extract_root / "glyphs.json"
    if not glyphs_path.exists():
        raise FileNotFoundError(f"glyphs.json not found at {glyphs_path}")

    fonts_data = json.loads(glyphs_path.read_text())

    font_metrics: dict[str, FontMetrics] = {}
    for font_entry in fonts_data:
        metrics = build_font_metrics(font_entry)
        if metrics is not None:
            font_metrics[metrics.font_key] = metrics

    output_dir = project_root / "png"
    manifest: list[dict[str, float | str]] = []

    glyph_iter: Iterator[GlyphSpec] = (
        glyph
        for font_entry in fonts_data
        for glyph in iter_glyph_specs(font_entry)
    )

    for index, glyph in enumerate(glyph_iter, start=1):
        if index > 20:
            break
        metrics = font_metrics.get(glyph.font_key)
        if metrics is None:
            continue
        metadata = render_glyph(glyph, metrics, output_dir=output_dir)
        metadata["order"] = index
        manifest.append(metadata)
        print(
            f"[{index:02d}] {glyph.font_key}:{glyph.glyph_id} "
            f"-> {metadata['path']} "
            f"{metadata['canvas_width_px']}x{metadata['canvas_height_px']}px"
        )

    manifest_path = project_root / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2))
    print(f"Wrote metadata to {manifest_path}")


if __name__ == "__main__":
    main()
