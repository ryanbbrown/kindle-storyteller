from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any, Dict, List

import requests
from dotenv import load_dotenv

from render_page import render_page, resolve_versioned_json

load_dotenv()


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


def run_ocr(png_path: Path, api_key: str) -> str | None:
    """Run OCR using OCR.space API."""
    payload = {"isOverlayRequired": False, "apikey": api_key, "language": "eng"}
    with open(png_path, "rb") as f:
        response = requests.post(
            "https://api.ocr.space/parse/image",
            files={"file": f},
            data=payload,
        )
    if response.status_code != 200:
        return None
    result = response.json()
    if result.get("IsErroredOnProcessing"):
        return None
    parsed_results = result.get("ParsedResults", [])
    if not parsed_results:
        return None
    return parsed_results[0].get("ParsedText")


def load_page_data(extract_root: Path) -> List[Dict[str, Any]]:
    page_data_path = resolve_versioned_json(extract_root, "page_data")
    data = json.loads(page_data_path.read_text())
    if not isinstance(data, list):
        raise ValueError(f"Unexpected page data format in {page_data_path}")
    return data


def normalize_position(value: Any) -> str:
    if isinstance(value, (int, float)):
        return str(int(value))
    if isinstance(value, str):
        if ";" in value:
            major, minor = value.split(";", 1)
            major_digits = "".join(ch for ch in major if ch.isdigit())
            minor_digits = "".join(ch for ch in minor if ch.isdigit())
            if major_digits:
                minor_digits = minor_digits.zfill(3)
                return f"{int(major_digits)}{minor_digits}"
        digits = "".join(ch for ch in value if ch.isdigit())
        if digits:
            return digits
    raise ValueError(f"Unable to normalize position value: {value!r}")


def page_position(entry: Dict[str, Any], kind: str) -> Dict[str, Any]:
    raw_key = f"{kind}Position"
    id_key = f"{kind}PositionId"
    raw = entry.get(raw_key)
    raw_str = str(raw) if raw is not None else ""
    try:
        normalized = normalize_position(raw)
    except ValueError:
        normalized = normalize_position(entry.get(id_key))
    position_id = entry.get(id_key)
    if isinstance(position_id, (int, float)):
        position_id = int(position_id)
    else:
        position_id = None
    return {"raw": raw_str, "normalized": normalized, "position_id": position_id}


def build_chunk_id(start_meta: Dict[str, Any], end_meta: Dict[str, Any]) -> str:
    if start_meta.get("position_id") is not None and end_meta.get("position_id") is not None:
        return f"chunk_pid_{start_meta['position_id']}_{end_meta['position_id']}"
    return f"chunk_pos_{start_meta['normalized']}_{end_meta['normalized']}"


def main() -> None:
    args = parse_args()
    extract_root = Path(args.extract_root).expanduser().resolve()
    output_dir = Path(args.output_dir).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    page_data = load_page_data(extract_root)
    total_pages = len(page_data)
    start_index = max(args.start_page, 0)
    end_index = min(total_pages, start_index + max(args.max_pages, 1))
    end_index = max(end_index, start_index + 1)

    start_meta = page_position(page_data[start_index], "start")
    end_meta = page_position(page_data[end_index - 1], "end")
    chunk_id = build_chunk_id(start_meta, end_meta)

    pages_dir = output_dir / "pages" / chunk_id
    pages_dir.mkdir(parents=True, exist_ok=True)
    combined_text: List[str] = []

    processed_pages: List[Dict[str, Any]] = []
    api_key = os.environ.get("OCRSPACE_API_KEY")
    ocr_enabled = api_key is not None

    for page_index in range(start_index, end_index):
        png_path = render_page(
            extract_root=extract_root,
            output_dir=pages_dir,
            page_index=page_index,
        )

        if ocr_enabled:
            text_data = run_ocr(png_path, api_key)
            if text_data:
                combined_text.append(text_data)

        processed_pages.append(
            {
                "index": page_index,
                "png": str(png_path),
                "chunk_id": chunk_id,
            }
        )

    combined_path = None
    if combined_text:
        combined_path = output_dir / "full-content.txt"
        output_dir.mkdir(parents=True, exist_ok=True)
        combined_path.write_text("\n\n".join(combined_text), encoding="utf-8")

    summary = {
        "chunk_id": chunk_id,
        "pages_dir": str(pages_dir),
        "start_position": start_meta["normalized"],
        "end_position": end_meta["normalized"],
        "start_position_raw": start_meta["raw"],
        "end_position_raw": end_meta["raw"],
        "start_position_id": start_meta.get("position_id"),
        "end_position_id": end_meta.get("position_id"),
        "total_pages": total_pages,
        "processed_pages": len(processed_pages),
        "pages": processed_pages,
        "combined_text_path": str(combined_path) if combined_path else None,
        "ocr_enabled": ocr_enabled,
    }

    print(json.dumps(summary))


if __name__ == "__main__":
    main()
