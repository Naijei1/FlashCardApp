import { NextResponse } from "next/server";
import { getAppSession } from "@/lib/app-session";
import { synthesizeEdgeSpeech } from "@/lib/edge-tts";
import {
  SPEECH_BROWSER_MAX_AGE_SECONDS,
  SpeechRateLimited,
  loadSpeechAudio,
  speechCacheKey,
  takeSpeechCredit,
} from "@/lib/speech-cache";
import { NEURAL_RATE, NEURAL_VOICE, acceptedSpeechText } from "@/lib/speech-request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function noStore(body: { error: string }, status: number, extra?: Record<string, string>): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...extra },
  });
}

/**
 * MPEG for a short Chinese flashcard line.
 * Voice and rate are pinned. The browser plays this URL from the tap handler
 * so Safari and the installed iOS app keep the user-gesture.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const session = await getAppSession();
  if (!session) return noStore({ error: "unauthorized" }, 401);

  const url = new URL(request.url);
  const voice = url.searchParams.get("voice");
  const rate = url.searchParams.get("rate");
  if ((voice && voice !== NEURAL_VOICE) || (rate && rate !== NEURAL_RATE && rate !== "0.9")) {
    return noStore({ error: "unsupported speech settings" }, 400);
  }
  const text = acceptedSpeechText(url.searchParams.get("text") ?? "");
  if (!text) return noStore({ error: "unsupported speech text" }, 400);

  const hash = speechCacheKey(text);
  try {
    const audio = await loadSpeechAudio(hash, () => synthesizeEdgeSpeech(text), () => takeSpeechCredit(session.userId));
    return new NextResponse(Buffer.from(audio), {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(audio.byteLength),
        "Cache-Control": `private, max-age=${SPEECH_BROWSER_MAX_AGE_SECONDS}`,
        "CDN-Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof SpeechRateLimited) {
      return noStore({ error: "rate limited" }, 429, { "Retry-After": String(error.retryAfterSeconds) });
    }
    console.warn("Speech synthesis failed", { name: error instanceof Error ? error.name : "error" });
    return noStore({ error: "speech unavailable" }, 502);
  }
}
