"""Stub CLI entry point for text extraction pipeline."""

from __future__ import annotations

import argparse


def parse_args() -> argparse.Namespace:
    """Parse command line arguments."""
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


def main() -> None:
    """Run the text extraction pipeline from CLI arguments."""
    raise NotImplementedError("Actual implementation not included in stubs")


if __name__ == "__main__":
    main()
