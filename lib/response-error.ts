/** Extract a safe API error for client-side mutation feedback. */
export async function responseError(
  response: Response | null,
  fallback = "Something went wrong. Please try again."
): Promise<string> {
  if (!response) return "Could not connect. Check your connection and try again.";
  try {
    const data = (await response.json()) as { error?: unknown };
    return typeof data.error === "string" && data.error ? data.error : fallback;
  } catch {
    return fallback;
  }
}
