from __future__ import annotations

import argparse
import json
import shutil
import subprocess
from pathlib import Path
from typing import Any, Dict, List

from render_page import render_page, resolve_versioned_json


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Render Kindle pages and run OCR.")
    parser.add_argument(
        "--extract-root",
        required=True,
        help="Path to extracted renderer payload (contains glyphs.json, page_data_*.json).",
    )
    parser.add_argument(
        "--output-dir",
        required=True,
        help="Directory to write rendered PNGs and OCR outputs.",
    )
    parser.add_argument(
        "--start-page",
        type=int,
        default=0,
        help="Page index to start from.",
    )
    parser.add_argument(
        "--max-pages",
        type=int,
        default=5,
        help="Maximum number of pages to process.",
    )
    return parser.parse_args()


def detect_tesseract() -> bool:
    return shutil.which("tesseract") is not None


def run_tesseract(png_path: Path, txt_path: Path) -> bool:
    try:
        subprocess.run(
            ["tesseract", str(png_path), str(txt_path.with_suffix(""))],
            check=True,
            capture_output=True,
        )
        return True
    except subprocess.CalledProcessError:
        return False


def load_page_count(extract_root: Path) -> int:
    page_data_path = resolve_versioned_json(extract_root, "page_data")
    data = json.loads(page_data_path.read_text())
    return len(data)


def main() -> None:
    args = parse_args()
    extract_root = Path(args.extract_root).expanduser().resolve()
    output_dir = Path(args.output_dir).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    total_pages = load_page_count(extract_root)
    start_index = max(args.start_page, 0)
    end_index = min(total_pages, start_index + max(args.max_pages, 1))

    processed_pages: List[Dict[str, Any]] = []
    combined_text = []
    ocr_enabled = detect_tesseract()

    for page_index in range(start_index, end_index):
        png_dir = output_dir / "pages"
        png_path = render_page(
            extract_root=extract_root,
            output_dir=png_dir,
            page_index=page_index,
        )

        text_path = None
        if ocr_enabled:
            txt_dir = output_dir / "ocr"
            txt_dir.mkdir(parents=True, exist_ok=True)
            text_path = txt_dir / f"page_{page_index:04d}.txt"
            if run_tesseract(png_path, text_path):
                combined_text.append(
                    text_path.read_text(encoding="utf-8", errors="ignore")
                )
            else:
                text_path = None

        processed_pages.append(
            {
                "index": page_index,
                "png": str(png_path),
                "text_path": str(text_path) if text_path else None,
            }
        )

    combined_path = None
    if combined_text:
        combined_path = output_dir / "combined.txt"
        combined_path.write_text("\n".join(combined_text))

    summary = {
        "total_pages": total_pages,
        "processed_pages": len(processed_pages),
        "pages": processed_pages,
        "combined_text_path": str(combined_path) if combined_path else None,
        "ocr_enabled": ocr_enabled,
    }

    print(json.dumps(summary))


if __name__ == "__main__":
    main()
