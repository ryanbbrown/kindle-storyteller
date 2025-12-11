"""Stub definitions for page rendering."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Tuple

from .extract_glyphs import FontMetrics, GlyphSpec


@dataclass(frozen=True)
class GlyphRender:
    image: Any  # PIL.Image.Image
    mask: Any  # PIL.Image.Image
    baseline_px: float
    font_size: float


def load_fonts(glyphs_path: Path) -> Tuple[Dict[str, FontMetrics], Dict[str, Dict[str, GlyphSpec]]]:
    """Load font metrics and glyph specs from a glyphs.json file."""
    raise NotImplementedError("Actual implementation not included in stubs")


def rasterize_glyph(spec: GlyphSpec, metrics: FontMetrics, font_size: float) -> GlyphRender:
    """Rasterize a single glyph to an image."""
    raise NotImplementedError("Actual implementation not included in stubs")


def render_page(
    extract_root: Path,
    output_dir: Path,
    page_index: int = 0,
) -> Path:
    """Render a single page to a PNG file."""
    raise NotImplementedError("Actual implementation not included in stubs")


def resolve_versioned_json(extract_root: Path, base_name: str) -> Path:
    """Locate Kindle renderer artifacts that may be versioned."""
    raise NotImplementedError("Actual implementation not included in stubs")
