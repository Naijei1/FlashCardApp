/**
 * Sec-MS-GEC v2 token for the unofficial Edge read-aloud socket.
 * Port of edge-tts 7.3.1 `drm.py`. Node's SHA-256 does not match this digest:
 * the service uses a modified IV, schedule, and round constant.
 */

const WIN_EPOCH = 11_644_473_600;
const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const U32 = BigInt("4294967295");

const SHA256_INITIAL = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
];
const SHA256_STATE = [
  0xfd9fbea2, 0x91243ce7, 0xbe499094, 0xcd2e1e0a, 0x6c006f49, 0x04bd35ab, 0xfeb0a7e4, 0x03effbd2,
];
const SHA256_SCHEDULE = [
  0xeb24bf9e, 0x1558691f, 0xa0c09ee2, 0x0cfa32ba, 0xa622ee8c, 0xd1dd9491, 0xc0dd25a0, 0xf9e70ab6,
  0xf0c31573, 0x7058ce4e, 0x7188e606, 0x00e5ab33, 0xd258b060, 0x72766564,
];
const SHA256_ROUND_CONSTANTS = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];
const SHA256_ADJUSTMENT = 0xc9dc06a7;
const SHA256_BLOCK_CONSTANTS = SHA256_ROUND_CONSTANTS.slice();
SHA256_BLOCK_CONSTANTS[14] = SHA256_ADJUSTMENT;
const SHA256_SIGMA0_ADJUSTMENT = 0x059c0b80;
const SHA256_SIGMA1_ADJUSTMENT = 0x000b92c0;

const CS64_COEFFICIENTS: ReadonlyArray<readonly [number, number]> = [
  [0xe82e91b1, 0xb32700d0],
  [0x44de24c6, 0x88dff51d],
  [0x3beb65bc, 0x29514038],
  [0xc89c5933, 0xb328cbdf],
  [0x8d1ec211, 0xd405b4d5],
  [0x314ef5d5, 0x26e55f3c],
  [0xe92491b1, 0x607801c6],
  [0xf0a5b9d5, 0x82b2c1fb],
  [0x06064cf3, 0xfa51a3da],
  [0xda79fa60, 0x207cc464],
  [0xbed20560, 0x3c3c74f3],
  [0x89f9c9f8, 0xd2d14b61],
  [0x35fa38c6, 0xbb04a2c1],
  [0xcb49e3c6, 0xc5626167],
];
const CS64_FACTOR = 0x82893933;
const CS64_ADJUSTMENT0 = 0xf2f90b1a;
const CS64_ADJUSTMENT1 = 0x0b1a0000;

let clockSkewSeconds = 0;

function rotr(value: number, bits: number): number {
  const v = value >>> 0;
  return ((v >>> bits) | (v << (32 - bits))) >>> 0;
}

function rol16(value: number): number {
  const v = value >>> 0;
  return ((v << 16) | (v >>> 16)) >>> 0;
}

function sigma0(value: number): number {
  const v = value >>> 0;
  return ((v >>> 7) ^ (v << 25) ^ (v >>> 18) ^ (v << 14) ^ (v >>> 3)) >>> 0;
}

function sigma1(value: number): number {
  const v = value >>> 0;
  return ((v >>> 17) ^ (v << 15) ^ (v >>> 19) ^ (v << 13) ^ (v >>> 10)) >>> 0;
}

function mul32(left: number, right: number): number {
  return Number((BigInt(left >>> 0) * BigInt(right >>> 0)) & U32);
}

function sha256Rounds(state: number[], words: number[], firstRound = 0): number[] {
  let a = state[0] >>> 0;
  let b = state[1] >>> 0;
  let c = state[2] >>> 0;
  let d = state[3] >>> 0;
  let e = state[4] >>> 0;
  let f = state[5] >>> 0;
  let g = state[6] >>> 0;
  let h = state[7] >>> 0;
  const constants = firstRound === 14 ? SHA256_BLOCK_CONSTANTS : SHA256_ROUND_CONSTANTS;
  for (let index = firstRound; index < 64; index += 1) {
    const s1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
    const ch = (g ^ (e & (f ^ g))) >>> 0;
    const t1 = (h + s1 + ch + constants[index] + words[index]) >>> 0;
    const s0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
    const maj = ((a & b) | (c & (a | b))) >>> 0;
    const t2 = (s0 + maj) >>> 0;
    h = g;
    g = f;
    f = e;
    e = (d + t1) >>> 0;
    d = c;
    c = b;
    b = a;
    a = (t1 + t2) >>> 0;
  }
  return [a, b, c, d, e, f, g, h];
}

function expandSchedule(words: number[], firstWord = 16): void {
  for (let index = firstWord; index < 64; index += 1) {
    const x = words[index - 2] >>> 0;
    const y = words[index - 15] >>> 0;
    words.push((sigma1(x) + words[index - 7] + sigma0(y) + words[index - 16]) >>> 0);
  }
}

function sha256Init(prefix: Buffer): number[] {
  const words = Array.from({ length: 14 }, () => 0);
  words.push(prefix.subarray(0, 3).readUIntBE(0, 3));
  words.push(prefix.readUInt32BE(3));
  for (let index = 16; index < 30; index += 1) {
    let value = SHA256_SCHEDULE[index - 16];
    if (index - 2 >= 14) {
      const mixed = sigma1(words[index - 2]);
      value += index === 16 ? (mixed ^ SHA256_SIGMA1_ADJUSTMENT) >>> 0 : mixed;
    }
    if (index - 7 >= 14) value += words[index - 7];
    if (index - 15 >= 14) {
      const mixed = sigma0(words[index - 15]);
      value += index === 29 ? (mixed ^ SHA256_SIGMA0_ADJUSTMENT) >>> 0 : mixed;
    }
    words.push(value >>> 0);
  }
  words.push(
    Number(
      (BigInt(sigma1(words[28])) +
        BigInt(words[23] >>> 0) +
        BigInt(sigma0(words[15])) +
        BigInt(words[14] >>> 0) +
        BigInt(SHA256_ADJUSTMENT) -
        BigInt(SHA256_ROUND_CONSTANTS[14])) &
        U32,
    ),
  );
  expandSchedule(words, 31);
  const working = sha256Rounds(SHA256_STATE, words, 14);
  return SHA256_INITIAL.map((value, index) => (value + working[index]) >>> 0);
}

function sha256Digest(data: Buffer): Buffer {
  if (data.length < 7) throw new Error("Token salt must contain at least seven bytes");
  const length = 57 + data.length;
  const zeroCount = ((55 - length) % 64 + 64) % 64;
  const padded = Buffer.concat([
    data.subarray(7),
    Buffer.from([0x80]),
    Buffer.alloc(zeroCount),
    (() => {
      const bits = Buffer.alloc(8);
      bits.writeBigUInt64BE(BigInt(length) * BigInt(8));
      return bits;
    })(),
  ]);
  let state = sha256Init(data.subarray(0, 7));
  for (let offset = 0; offset < padded.length; offset += 64) {
    const words: number[] = [];
    for (let index = 0; index < 16; index += 1) words.push(padded.readUInt32BE(offset + index * 4));
    expandSchedule(words);
    const working = sha256Rounds(state, words);
    state = state.map((value, index) => (value + working[index]) >>> 0);
  }
  const out = Buffer.alloc(32);
  state.forEach((value, index) => out.writeUInt32BE(value, index * 4));
  return out;
}

function wordsLe4Even(data: Buffer): number[] {
  const paddedLength = data.length + ((4 - (data.length % 4)) % 4);
  const padded = Buffer.alloc(paddedLength);
  data.copy(padded);
  const words: number[] = [];
  for (let offset = 0; offset < padded.length; offset += 4) words.push(padded.readUInt32LE(offset));
  if (words.length % 2) words.push(0);
  return words;
}

function cs64Digest(data: Buffer, digest: Buffer): [number, number] {
  let keyA = digest.readUInt32LE(0) | 1;
  let keyB = digest.readUInt32LE(4) | 1;
  keyA >>>= 0;
  keyB >>>= 0;
  const factors = [mul32(keyA, CS64_FACTOR), mul32(keyB, CS64_FACTOR)];
  const terms = CS64_COEFFICIENTS.map(([coefficient], index) => mul32(coefficient, factors[index % 2]));
  const offsets = CS64_COEFFICIENTS.map(([, offset]) => offset >>> 0);
  wordsLe4Even(Buffer.concat([Buffer.from([0]), data])).forEach((word, index) => {
    const key = index % 2 === 0 ? keyA : keyB;
    const factor = index % 2 === 0 ? 0xef0569fb : 0xc31713db;
    let term = BigInt(word >>> 0) * BigInt(key);
    let offset = BigInt(rol16(word)) * BigInt(factor);
    if (index === 0) {
      term += BigInt(CS64_ADJUSTMENT0) * BigInt(factors[0]);
      offset += BigInt(CS64_ADJUSTMENT1);
    }
    terms.push(Number(term & U32));
    offsets.push(Number(offset & U32));
  });

  let swapAcc = 0;
  let swapLast = 0;
  let state = 0;
  let acc = 0;
  for (let index = 0; index < terms.length; index += 2) {
    const x = terms[index];
    const y = terms[index + 1];
    let t = rol16((offsets[index] + x) >>> 0);
    let q = mul32(t, 0x76f50f34);
    swapAcc = (swapAcc + ((mul32(rol16(q), 0xc3efea97) + q) >>> 0)) >>> 0;
    t = rol16((offsets[index + 1] + y) >>> 0);
    q = mul32(t, 0x1881ce3c);
    swapLast = (mul32(rol16(q), 0x35bd1ec9) + q) >>> 0;
    swapAcc = (swapAcc + swapLast) >>> 0;

    state = (mul32(state, keyA) + x) >>> 0;
    state = mul32(rol16(state), 0xcf98b111);
    state = mul32(rol16(state), 0x87085b9f);
    state = mul32(rol16(state), 0x12ceb96d);
    state = mul32(rol16(state), 0x257e1d83);
    acc = (acc + state) >>> 0;
    t = (mul32(state, keyB) + y) >>> 0;
    t = mul32(rol16(t), 0xa27416f5);
    t = mul32(rol16(t), 0xd38396ff);
    state = mul32(rol16(mul32(rol16(t), 0x7c932b89)), 0xbfa49f69);
    acc = (acc + state) >>> 0;
  }
  return [(swapLast ^ state) >>> 0, (swapAcc ^ acc) >>> 0];
}

/** Seconds currently added to the system clock before a token is minted. */
export function edgeClockSkewSeconds(): number {
  return clockSkewSeconds;
}

export function resetEdgeClockSkew(): void {
  clockSkewSeconds = 0;
}

/**
 * Move the token clock toward the Date header from a rejected handshake.
 * Matches edge-tts `DRM.handle_client_response_error`.
 */
export function noteEdgeServerDate(httpDate: string, nowMs = Date.now()): boolean {
  const serverMs = Date.parse(httpDate);
  if (Number.isNaN(serverMs)) return false;
  const clientSeconds = nowMs / 1000 + clockSkewSeconds;
  clockSkewSeconds += serverMs / 1000 - clientSeconds;
  return true;
}

/** `<16 hex>-<64 hex>` token. `unixTimestamp` skips the live clock (tests). */
export function generateSecMsGecV2(unixTimestamp?: number): string {
  let ticks = unixTimestamp ?? Date.now() / 1000 + clockSkewSeconds;
  ticks += WIN_EPOCH;
  ticks -= ticks % 300;
  ticks *= 1e7;
  const material = Buffer.from(`${ticks.toFixed(0)}${TRUSTED_CLIENT_TOKEN}`, "ascii");
  const digest = sha256Digest(material);
  const [first, second] = cs64Digest(material, digest);
  const cs64 = Buffer.alloc(8);
  cs64.writeUInt32LE(first, 0);
  cs64.writeUInt32LE(second, 4);
  return `${cs64.toString("hex").toUpperCase()}-${digest.toString("hex").toUpperCase()}`;
}
