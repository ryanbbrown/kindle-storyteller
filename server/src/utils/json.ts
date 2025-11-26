export function tryParseJson<T = unknown>(payload: unknown): T | null {
  if (typeof payload !== "string") {
    return null;
  }

  try {
    return JSON.parse(payload) as T;
  } catch {
    return null;
  }
}
