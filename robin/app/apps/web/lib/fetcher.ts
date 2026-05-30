/** Typed JSON fetcher for SWR. Throws on non-2xx so SWR surfaces `error`. */
export async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url);

  // Parse defensively: a non-JSON error response (HTML 500 page, proxy error)
  // must surface the real status, not a JSON-parse error that masks it.
  let json: (T & { error?: string }) | null = null;
  try {
    json = (await res.json()) as T & { error?: string };
  } catch {
    if (!res.ok) throw new Error(`request_failed_${res.status}`);
    throw new Error('invalid_json_response');
  }

  if (!res.ok) {
    throw new Error(json?.error || `request_failed_${res.status}`);
  }
  return json as T;
}
