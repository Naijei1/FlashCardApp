import { randomBytes } from "node:crypto";
import { generateSecMsGecV2, noteEdgeServerDate } from "./edge-drm";
import { NEURAL_RATE, NEURAL_VOICE } from "./speech-request";

const WSS_URL =
  "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const SEC_MS_GEC_VERSION = "2-143.0.3650.75";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0";
const SYNTH_TIMEOUT_MS = 12_000;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Javascript `Date` string, the form Edge's read-aloud socket expects. */
export function edgeTimestamp(now = new Date()): string {
  return (
    `${WEEKDAYS[now.getUTCDay()]} ${MONTHS[now.getUTCMonth()]} ${pad(now.getUTCDate())} ` +
    `${now.getUTCFullYear()} ${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())} ` +
    "GMT+0000 (Coordinated Universal Time)"
  );
}

function cleanSpeechText(text: string): string {
  let cleaned = "";
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    const blocked = (code >= 0 && code <= 8) || (code >= 11 && code <= 12) || (code >= 14 && code <= 31);
    cleaned += blocked ? " " : char;
  }
  return cleaned
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function speechSsml(text: string, voice = NEURAL_VOICE, rate = NEURAL_RATE): string {
  return (
    "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>" +
    `<voice name='${voice}'>` +
    `<prosody pitch='+0Hz' rate='${rate}' volume='+0%'>` +
    `${cleanSpeechText(text)}` +
    "</prosody></voice></speak>"
  );
}

function speechConfigMessage(): string {
  return (
    `X-Timestamp:${edgeTimestamp()}\r\n` +
    "Content-Type:application/json; charset=utf-8\r\n" +
    "Path:speech.config\r\n\r\n" +
    '{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"true","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n'
  );
}

function ssmlMessage(text: string): string {
  const requestId = randomBytes(16).toString("hex");
  return (
    `X-RequestId:${requestId}\r\n` +
    "Content-Type:application/ssml+xml\r\n" +
    `X-Timestamp:${edgeTimestamp()}Z\r\n` +
    "Path:ssml\r\n\r\n" +
    speechSsml(text)
  );
}

function headerMap(block: string): Map<string, string> {
  const headers = new Map<string, string>();
  for (const line of block.split("\r\n")) {
    if (!line) continue;
    const splitAt = line.indexOf(":");
    if (splitAt === -1) continue;
    headers.set(line.slice(0, splitAt), line.slice(splitAt + 1));
  }
  return headers;
}

/**
 * Pull MPEG bytes out of one Edge binary frame.
 * Returns null for the empty terminator frame (no Content-Type, no payload).
 */
export function readAudioFrame(frame: Uint8Array): Uint8Array | null {
  if (frame.length < 2) throw new Error("short speech frame");
  const headerLength = (frame[0] << 8) | frame[1];
  const classicEnd = 2 + headerLength;
  if (classicEnd <= frame.length) {
    const headers = headerMap(Buffer.from(frame.subarray(2, classicEnd)).toString("latin1"));
    if (headers.get("Path") === "audio") return readDeclaredAudio(headers, frame.subarray(classicEnd));
  }
  if (headerLength <= frame.length) {
    const headers = headerMap(Buffer.from(frame.subarray(0, headerLength)).toString("latin1"));
    if (headers.get("Path") === "audio") return readDeclaredAudio(headers, frame.subarray(headerLength + 2));
  }
  throw new Error("speech frame is not audio");
}

function readDeclaredAudio(headers: Map<string, string>, body: Uint8Array): Uint8Array | null {
  const contentType = headers.get("Content-Type") ?? null;
  if (contentType !== "audio/mpeg" && contentType !== null) throw new Error("unexpected speech content type");
  if (contentType === null) {
    if (body.length === 0) return null;
    throw new Error("speech frame missing content type");
  }
  if (body.length === 0) throw new Error("speech frame missing audio");
  return body;
}

function textPath(payload: string): string | null {
  const splitAt = payload.indexOf("\r\n\r\n");
  const head = splitAt === -1 ? payload : payload.slice(0, splitAt);
  return headerMap(head).get("Path") ?? null;
}

type SocketResult = { audio: Uint8Array } | { error: Error };

function synthesizeOnce(text: string): Promise<Uint8Array> {
  const connectionId = randomBytes(16).toString("hex");
  const token = generateSecMsGecV2();
  const url =
    `${WSS_URL}&ConnectionId=${connectionId}` +
    `&Sec-MS-GEC=${encodeURIComponent(token)}` +
    `&Sec-MS-GEC-Version=${encodeURIComponent(SEC_MS_GEC_VERSION)}`;
  const headers = {
    Pragma: "no-cache",
    "Cache-Control": "no-cache",
    Origin: "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
    "User-Agent": USER_AGENT,
    "Accept-Encoding": "gzip, deflate, br, zstd",
    "Accept-Language": "en-US,en;q=0.9",
    Cookie: `muid=${randomBytes(16).toString("hex").toUpperCase()};`,
  };

  return new Promise((resolve, reject) => {
    const Socket = WebSocket as unknown as new (
      address: string,
      options?: { headers?: Record<string, string> },
    ) => WebSocket;
    const ws = new Socket(url, { headers });
    const chunks: Uint8Array[] = [];
    let settled = false;
    let failure = "speech socket failed";
    const finish = (result: SocketResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        // The handshake may already be closed.
      }
      if ("error" in result) reject(result.error);
      else resolve(result.audio);
    };
    const timer = setTimeout(() => finish({ error: new Error("speech timed out") }), SYNTH_TIMEOUT_MS);

    ws.binaryType = "arraybuffer";
    ws.addEventListener("open", () => {
      ws.send(speechConfigMessage());
      ws.send(ssmlMessage(text));
    });
    ws.addEventListener("message", (event) => {
      try {
        if (typeof event.data === "string") {
          const path = textPath(event.data);
          if (path === "turn.end") {
            if (chunks.length === 0) finish({ error: new Error("no audio") });
            else finish({ audio: concatBytes(chunks) });
          }
          return;
        }
        const bytes =
          event.data instanceof ArrayBuffer
            ? new Uint8Array(event.data)
            : event.data instanceof Uint8Array
              ? event.data
              : null;
        if (!bytes) return;
        const audio = readAudioFrame(bytes);
        if (audio && audio.length > 0) chunks.push(audio);
      } catch (error) {
        finish({ error: error instanceof Error ? error : new Error("bad speech frame") });
      }
    });
    ws.addEventListener("error", (event) => {
      const message = "message" in event && typeof event.message === "string" ? event.message : "";
      if (message) failure = message;
    });
    ws.addEventListener("close", () => {
      if (chunks.length > 0) finish({ audio: concatBytes(chunks) });
      else finish({ error: new Error(failure) });
    });
  });
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

async function alignClockFromHandshake(): Promise<void> {
  try {
    const response = await fetch("https://speech.platform.bing.com/", { method: "HEAD" });
    const date = response.headers.get("date");
    if (date) noteEdgeServerDate(date);
  } catch {
    // The retry still runs; a clock that is already close often succeeds.
  }
}

function looksForbidden(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return message.includes("403") || message.toLowerCase().includes("forbidden");
}

/**
 * Synthesize one short line with Xiaoxiao at -10%.
 * A 403 retries once after shifting the token clock to the server Date.
 * This endpoint is unofficial and can change or reject clients without notice.
 */
export async function synthesizeEdgeSpeech(text: string): Promise<Uint8Array> {
  try {
    return await synthesizeOnce(text);
  } catch (error) {
    if (!looksForbidden(error)) throw error;
    await alignClockFromHandshake();
    return synthesizeOnce(text);
  }
}
