# text-extraction-stubs

Stub package providing type definitions and interfaces for the text extraction module.

**This package does not contain a working implementation.** All functions raise `NotImplementedError` when called.

## Purpose

This stub package exists to:
- Document the expected interface for text extraction
- Allow the rest of the codebase to type-check against these interfaces

## Expected Interface

The actual implementation should provide:

- `render_page(extract_root, output_dir, page_index)` - Render a page to PNG
- `process_chunk(extract_root, output_dir, start_page, max_pages)` - Process multiple pages with OCR
- CLI entry point via `python -m text_extraction.cli`

## Return Types

### `process_chunk` returns:
```python
{
    "chunk_id": str,
    "pages_dir": str,
    "start_position": str,
    "end_position": str,
    "start_position_raw": str,
    "end_position_raw": str,
    "start_position_id": int | None,
    "end_position_id": int | None,
    "total_pages": int,
    "processed_pages": int,
    "pages": [{"index": int, "png": str, "chunk_id": str}, ...],
    "combined_text_path": str | None,
    "ocr_enabled": bool,
}
```
