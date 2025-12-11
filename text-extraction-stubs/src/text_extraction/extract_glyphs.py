"""Stub definitions for glyph extraction types."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterator


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
    """Iterate over glyph specifications from a font entry."""
    raise NotImplementedError("Actual implementation not included in stubs")


def build_font_metrics(font_entry: dict) -> FontMetrics | None:
    """Build font metrics from a font entry."""
    raise NotImplementedError("Actual implementation not included in stubs")
