"""Stub definitions for the text extraction pipeline."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List


def run_ocr(png_path: Path, api_key: str) -> str | None:
    """Run OCR on a PNG image using OCR.space API."""
    raise NotImplementedError("Actual implementation not included in stubs")


def load_page_data(extract_root: Path) -> List[Dict[str, Any]]:
    """Load page data JSON from extract root."""
    raise NotImplementedError("Actual implementation not included in stubs")


def normalize_position(value: Any) -> str:
    """Normalize a Kindle position value to a comparable string."""
    raise NotImplementedError("Actual implementation not included in stubs")


def page_position(entry: Dict[str, Any], kind: str) -> Dict[str, Any]:
    """Extract and normalize position metadata from a page entry."""
    raise NotImplementedError("Actual implementation not included in stubs")


def build_chunk_id(start_meta: Dict[str, Any], end_meta: Dict[str, Any]) -> str:
    """Build a unique chunk ID from start and end position metadata."""
    raise NotImplementedError("Actual implementation not included in stubs")


def process_chunk(
    extract_root: Path,
    output_dir: Path,
    start_page: int = 0,
    max_pages: int = 5,
) -> Dict[str, Any]:
    """Render a range of pages and run OCR, returning chunk metadata."""
    raise NotImplementedError("Actual implementation not included in stubs")
