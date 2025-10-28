#!/usr/bin/env python3
"""
set_reading_position.py

Usage:
  python set_reading_position.py <input_file> [--pos NEW_POS] [--timestamp ISO_TS] [--dry-run] [--url URL]

Description:
  Parses a text file containing a captured Kindle 'sidecar' request (headers + XML payload),
  extracts headers and the XML annotations body, optionally updates the <last_read pos="..."> and timestamps,
  and then executes a curl POST that mirrors the original request (data is sent via a temporary file).

Notes:
  - The script does NOT attempt to generate or modify signatures or tokens. If you change the XML body
    and the server validates signatures against the exact body, the request may be rejected.
  - The script writes the (possibly modified) XML payload to a temporary file and invokes curl with --data-binary @file
    to avoid quoting issues.
"""
import argparse
import re
import sys
import tempfile
import subprocess
import xml.etree.ElementTree as ET
from pathlib import Path

HEADER_RE = re.compile(r"""-H\s+['"]([^:]+):\s*(.*?)['"]""", re.DOTALL)
# Also accept lines formatted like: -H 'X-ADP-SW: 1191417226' or " -H "Name: value" "
USER_AGENT_RE = re.compile(r"""-H\s+['"]User-Agent:\s*(.*?)['"]""", re.DOTALL)

def read_input_file(path: Path) -> str:
    return path.read_text(encoding='utf-8', errors='replace')

def extract_headers(raw: str) -> dict:
    headers = {}
    for m in HEADER_RE.finditer(raw):
        name = m.group(1).strip()
        value = m.group(2).strip()
        headers[name] = value
    # fallback: capture other header styles like Header: value (lines)
    # but only if not already captured
    for line in raw.splitlines():
        if ':' in line and line.strip().startswith(('X-', 'x-', 'Accept', 'User-Agent', 'Content-Type')):
            parts = line.split(':', 1)
            name = parts[0].strip()
            if name not in headers:
                headers[name] = parts[1].strip()
    return headers

def find_xml_block(raw: str) -> str | None:
    # First check if XML is inside a printf or similar command with escape sequences
    printf_match = re.search(r"""\$\(printf\s+['"](.+?)['"](?:\s*\)|$)""", raw, re.DOTALL)
    if printf_match:
        # Decode escape sequences like \x0a (newline)
        escaped_xml = printf_match.group(1)
        # Decode common escape sequences
        xml_candidate = escaped_xml.encode('utf-8').decode('unicode_escape')
    else:
        # find the first '<?xml' and then attempt to extract until the matching root close tag
        idx = raw.find('<?xml')
        if idx == -1:
            # fallback: look for '<annotations'
            idx = raw.find('<annotations')
            if idx == -1:
                return None
        xml_candidate = raw[idx:]

    # attempt to find matching closing tag for top-level element
    # parse progressively until XML parse succeeds
    # simple heuristic: try to find the end by searching for '</annotations>'
    end_tag = '</annotations>'
    end_idx = xml_candidate.rfind(end_tag)
    if end_idx != -1:
        end_idx += len(end_tag)
        return xml_candidate[:end_idx]
    # last resort: try to parse incremental lines until parseable
    lines = xml_candidate.splitlines()
    for i in range(len(lines)):
        try_blk = "\n".join(lines[:i+1])
        try:
            ET.fromstring(try_blk)
            return try_blk
        except Exception:
            continue
    return None

def parse_last_read(xml_text: str):
    # return (pos, begin, last_read_ts, annotations_ts, guid, key, full_xml_root)
    root = ET.fromstring(xml_text)
    annotations_ts = root.attrib.get('timestamp') or root.attrib.get('time') or None
    # find book -> last_read
    book_el = root.find('.//book')
    if book_el is None:
        return None
    guid = book_el.attrib.get('guid')
    key = book_el.attrib.get('key')
    last_read = book_el.find('last_read')
    if last_read is None:
        return None
    pos = last_read.attrib.get('pos')
    begin = last_read.attrib.get('begin')
    lr_ts = last_read.attrib.get('timestamp')
    return {
        'pos': pos,
        'begin': begin,
        'last_read_ts': lr_ts,
        'annotations_ts': annotations_ts,
        'guid': guid,
        'key': key,
        'root': root
    }

def set_values_and_serialize(root: ET.Element, new_pos: str | None, new_ts: str | None) -> str:
    # set attributes on <last_read> and on top-level annotations timestamp if requested
    book_el = root.find('.//book')
    last_read = book_el.find('last_read')
    if new_pos is not None:
        last_read.set('pos', str(new_pos))
    if new_ts is not None:
        # set both the last_read timestamp and annotations top-level timestamp
        last_read.set('timestamp', new_ts)
        root.set('timestamp', new_ts)
    # return pretty (not guaranteed) serialized XML; preserve CDATA content by not touching inner text
    xml_bytes = ET.tostring(root, encoding='utf-8')
    return xml_bytes.decode('utf-8')

def build_curl_command(url: str, headers: dict, data_file_path: Path, extra: dict | None = None):
    cmd = ['curl', '-v', '-X', 'POST', url]
    # ensure Content-Type present; if missing, set to application/x-octet-stream
    headers_lower = {k.lower(): k for k in headers.keys()}
    if 'content-type' not in headers_lower:
        cmd += ['-H', 'Content-Type: application/x-octet-stream']
    # preserve the order-ish: add common Kindle headers first if present
    preferred_order = [
        'X-ADP-SW', 'x-adp-signature', 'x-adp-token', 'x-adp-alg',
        'X-DeviceFirmwareVersion', 'x-dual-write-weblab-status',
        'Accept', 'Accept-Language', 'User-Agent', 'X-Amzn-RequestId', 'Connection'
    ]
    added = set()
    for h in preferred_order:
        if h in headers:
            cmd += ['-H', f"{h}: {headers[h]}"]
            added.add(h)
    # add remaining headers
    for k, v in headers.items():
        if k in added:
            continue
        cmd += ['-H', f"{k}: {v}"]
    # data
    cmd += ['--data-binary', f"@{str(data_file_path)}"]
    return cmd

def main():
    ap = argparse.ArgumentParser(description="Replay / test Kindle sidecar SetReadingPosition from a captured request file.")
    ap.add_argument('input_file', type=Path, help='Path to the captured request text file (curl-like or raw headers + body).')
    ap.add_argument('--pos', type=str, default=None, help='Override the <last_read pos="..."> value to this number.')
    ap.add_argument('--timestamp', type=str, default=None, help='Override the timestamp (ISO8601) used in <annotations> and <last_read>.')
    ap.add_argument('--dry-run', action='store_true', help='Print the curl command and payload but do not execute.')
    ap.add_argument('--url', type=str, default=None, help='Optional override URL (if different than captured).')
    args = ap.parse_args()

    raw = read_input_file(args.input_file)
    headers = extract_headers(raw)
    xml_block = find_xml_block(raw)
    if xml_block is None:
        print("ERROR: Could not find XML payload in the input file. Ensure the file contains '<?xml' or '<annotations'.", file=sys.stderr)
        sys.exit(2)

    parsed = parse_last_read(xml_block)
    if parsed is None:
        print("ERROR: Could not parse <book>/<last_read> from XML payload.", file=sys.stderr)
        print("Found XML snippet (first 400 chars):")
        print(xml_block[:400])
        sys.exit(3)

    print("Detected values from input:")
    print(f"  guid: {parsed.get('guid')}")
    print(f"  key: {parsed.get('key')}")
    print(f"  pos: {parsed.get('pos')}")
    print(f"  begin: {parsed.get('begin')}")
    print(f"  last_read timestamp: {parsed.get('last_read_ts')}")
    print(f"  annotations timestamp: {parsed.get('annotations_ts')}")
    print("Detected headers (subset):")
    for hk in ['x-adp-signature', 'x-adp-token', 'X-Amzn-RequestId', 'X-ADP-SW', 'x-adp-alg', 'User-Agent']:
        if hk in headers:
            print(f"  {hk}: {headers[hk][:80]}{'...' if len(headers[hk])>80 else ''}")
    # choose URL
    url = args.url
    if url is None:
        # try to extract a URL from the input file (simple heuristic)
        m = re.search(r'https?://[^\s\'"]+', raw)
        if m:
            url = m.group(0)
        else:
            # default to canonical sidecar endpoint (you can override with --url)
            url = "https://cde-ta-g7g.amazon.com/FionaCDEServiceEngine/sidecar"
            print(f"No URL found in capture; defaulting to {url} (override with --url).")

    # modify XML if asked
    root = parsed['root']
    new_xml = set_values_and_serialize(root, args.pos, args.timestamp)

    # write payload to temp file
    with tempfile.NamedTemporaryFile('w', delete=False, encoding='utf-8', suffix='.xml') as tf:
        tf.write(new_xml)
        temp_path = Path(tf.name)

    curl_cmd = build_curl_command(url, headers, temp_path)

    print("\nPrepared curl command (will send payload from temp file):")
    print(" ".join([f"'{p}'" if ' ' in p else p for p in curl_cmd]))
    print(f"\nPayload written to: {temp_path}\n")
    if args.dry_run:
        print("Dry run specified; not executing. Exiting.")
        sys.exit(0)

    # Execute the command
    try:
        print("Executing curl... (verbose output follows)\n")
        # run with check=False to capture return code even if non-zero
        proc = subprocess.run(curl_cmd, capture_output=False)
        print(f"\ncurl exited with return code: {proc.returncode}")

        # If successful, make the get_annotations call
        if proc.returncode == 0:
            print("\n" + "="*80)
            print("Making get_annotations API call...")
            print("="*80 + "\n")

            guid = parsed.get('guid')
            if guid:
                # Build the get_annotations XML payload
                annotations_xml = f'<?xml version="1.0"?><annotations version="1.0"><get_annotations guid="{guid}"/></annotations>'

                # Write to temp file
                with tempfile.NamedTemporaryFile('w', delete=False, encoding='utf-8', suffix='.xml') as tf2:
                    tf2.write(annotations_xml)
                    temp_path2 = Path(tf2.name)

                # Build curl command for get_annotations (reuse headers)
                curl_cmd2 = build_curl_command(url, headers, temp_path2)

                print("Prepared get_annotations curl command:")
                print(" ".join([f"'{p}'" if ' ' in p else p for p in curl_cmd2]))
                print(f"\nPayload written to: {temp_path2}\n")

                try:
                    print("Executing get_annotations curl... (verbose output follows)\n")
                    proc2 = subprocess.run(curl_cmd2, capture_output=False)
                    print(f"\nget_annotations curl exited with return code: {proc2.returncode}")
                except Exception as e:
                    print("ERROR executing get_annotations curl:", e, file=sys.stderr)
                finally:
                    print(f"get_annotations payload file retained at: {temp_path2} (delete when done)")
            else:
                print("WARNING: Could not extract guid from request, skipping get_annotations call", file=sys.stderr)
        else:
            print("\nSkipping get_annotations call due to failed set_reading_position request")

    except KeyboardInterrupt:
        print("Execution interrupted by user.", file=sys.stderr)
    except Exception as e:
        print("ERROR executing curl:", e, file=sys.stderr)
    finally:
        # do not automatically delete temp file (so you can inspect response payload if needed)
        print(f"\nPayload file retained at: {temp_path} (delete when done)")

if __name__ == '__main__':
    main()
