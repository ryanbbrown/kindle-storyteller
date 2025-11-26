"""Test script for OCR.space API integration."""

import os
from pathlib import Path

from dotenv import load_dotenv

from pipeline import run_ocr

load_dotenv()

TEST_IMAGE = Path(__file__).parent.parent / "server/data/books/B01E3PFTXK/chunks/chunk_pid_98467_106883/pages/page_0000.png"


def main():
    api_key = os.environ.get("OCRSPACE_API_KEY")
    if not api_key:
        print("ERROR: OCRSPACE_API_KEY not set in environment")
        print("Make sure you have a .env file with OCRSPACE_API_KEY=your_key")
        return

    if not TEST_IMAGE.exists():
        print(f"ERROR: Test image not found at {TEST_IMAGE}")
        return

    print(f"Testing OCR.space API with: {TEST_IMAGE}")
    print("-" * 50)

    text = run_ocr(TEST_IMAGE, api_key)
    if text:
        print("SUCCESS! Extracted text:")
        print("-" * 50)
        print(text)
    else:
        print("FAILED: No text extracted")


if __name__ == "__main__":
    main()
