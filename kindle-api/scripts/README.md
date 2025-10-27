# Kindle Extraction Scripts

This folder contains scripts for extracting and processing Kindle book content.

## Scripts Overview

### Basic Testing
- **test-basic.js** - Test basic Kindle API connection and book listing
  ```bash
  node scripts/test-basic.js
  ```

### Book Details
- **test-book-details.js** - Fetch detailed metadata for books
  ```bash
  node scripts/test-book-details.js
  ```

### Renderer Endpoint
- **test-renderer.js** - Test renderer endpoint (will fail without token)
  ```bash
  node scripts/test-renderer.js
  ```

- **test-renderer-with-token.js** - Download book content as TAR file
  ```bash
  # Requires RENDERING_TOKEN in .env
  node scripts/test-renderer-with-token.js
  ```
  Output: `output/book-content-<ASIN>.tar`

### Content Extraction
- **extract-book-content.js** - Extract and analyze TAR contents
  ```bash
  node scripts/extract-book-content.js [ASIN]
  ```
  Extracts to: `extracted/book-content-<ASIN>/`

- **read-book-text.js** - Attempt to decode text from glyphs (partial)
  ```bash
  node scripts/read-book-text.js [ASIN]
  ```
  Note: Currently cannot fully decode text due to Amazon's obfuscation

### Reading Position Management
- **update-reading-position.js** - Update your reading position for a book
  ```bash
  # Requires ADP_SESSION_TOKEN and GUID in .env
  node scripts/update-reading-position.js [ASIN] [POSITION]
  ```
  Example: `node scripts/update-reading-position.js B0CPWQZNQB 2791479`

  This syncs your reading position across all Kindle devices/apps.

## Workflow

1. **Get your rendering token:**
   - Open https://read.amazon.com in your browser
   - Open a book
   - Open DevTools → Network tab
   - Find `/renderer/render` request
   - Copy `x-amz-rendering-token` header value
   - Add to `.env`: `RENDERING_TOKEN="your-token-here"`

2. **Download book content:**
   ```bash
   node scripts/test-renderer-with-token.js
   ```

3. **Extract the TAR file:**
   ```bash
   node scripts/extract-book-content.js B0CPWQZNQB
   ```

4. **View extracted files:**
   - Check `extracted/book-content-<ASIN>/` folder
   - Contains: metadata.json, toc.json, glyphs.json, tokens_*.json, etc.

## Environment Variables

Required in `.env`:
```
COOKIES="at-main=...; session-id=...; ubid-main=...; x-main=..."
DEVICE_TOKEN="your-device-token"
TLS_SERVER_URL="http://localhost:8080"
TLS_SERVER_API_KEY="your-api-key"
RENDERING_TOKEN="your-rendering-token"

# For reading position updates:
ADP_SESSION_TOKEN="your-x-adp-session-token"
GUID="your-device-guid"
```

### Getting the Required Tokens

**For RENDERING_TOKEN and ADP_SESSION_TOKEN:**
1. Open https://read.amazon.com in your browser
2. Open a book
3. Open DevTools → Network tab
4. For RENDERING_TOKEN: Find `/renderer/render` request → Copy `x-amz-rendering-token` header
5. For ADP_SESSION_TOKEN: Find `/stillReading` request → Copy `x-adp-session-token` header
6. For GUID: Find `/stillReading` request → Copy `guid` parameter from URL

## Notes

- Rendering tokens expire quickly (session-based)
- Each script run requires a fresh token
- TAR files only contain 5 pages per request
- Full book extraction requires multiple requests (not yet implemented)
- Text decoding requires font matching (see KINDLE_DECRYPTION_GUIDE.md)

## Full Text Extraction (Not Yet Implemented)

To get readable text, you need to implement:
1. Glyph rendering (SVG → images)
2. Font matching (SSIM comparison)
3. Character mapping (glyphs → text)
4. Multi-page downloading (184 requests for 920 pages)

See `../KINDLE_DECRYPTION_GUIDE.md` for details.
