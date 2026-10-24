// Avatars: a contact's own photo when it has one, otherwise Gravatar.
//
// Pure: no api, no DOM, no network. The URL is built here; the browser does the
// fetching (and the sandbox's content policy may refuse it — the view hides an
// image that fails to load, so a blocked or missing avatar is simply absent).
//
import { emailEntries, mediaUris } from './contacts.js';

// Gravatar identifies an address by a hash of it, which is why MD5 lives here:
// `crypto.subtle` has no MD5, and using it for SHA-256 would be a platform
// dependency the sandbox does not promise. This is the plain algorithm, and it
// is checked against published vectors.

/** The standard MD5 per-round shift amounts. */
const SHIFTS = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

/** The standard MD5 sine constants, `floor(abs(sin(i + 1)) * 2^32)`. */
const CONSTANTS = [
  0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
  0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
  0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
  0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
  0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
  0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
  0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
  0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
];

const rotateLeft = (value, bits) => (value << bits) | (value >>> (32 - bits));

/** One 32-bit word as the four little-endian hex bytes MD5 prints. */
const littleEndianHex = (value) => {
  let out = '';
  for (let i = 0; i < 4; i += 1) out += ((value >>> (i * 8)) & 0xff).toString(16).padStart(2, '0');
  return out;
};

/** UTF-8 bytes of a string, without depending on TextEncoder being there. */
function utf8Bytes(text) {
  const bytes = [];
  for (const char of String(text)) {
    const code = char.codePointAt(0);
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(
        0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f),
      );
    }
  }
  return bytes;
}

/** MD5 of a string, as lowercase hex. */
export function md5(value) {
  const bytes = utf8Bytes(value);
  const length = bytes.length;
  const padded = Math.ceil((length + 9) / 64) * 64;
  const data = new Uint8Array(padded);
  data.set(bytes);
  data[length] = 0x80;

  const bitLength = length * 8;
  const view = new DataView(data.buffer);
  view.setUint32(padded - 8, bitLength >>> 0, true);
  view.setUint32(padded - 4, Math.floor(bitLength / 2 ** 32), true);

  let a = 0x67452301;
  let b = 0xefcdab89;
  let c = 0x98badcfe;
  let d = 0x10325476;

  for (let chunk = 0; chunk < padded; chunk += 64) {
    const words = [];
    for (let i = 0; i < 16; i += 1) words.push(view.getUint32(chunk + i * 4, true));

    let [aa, bb, cc, dd] = [a, b, c, d];
    for (let i = 0; i < 64; i += 1) {
      let f;
      let g;
      if (i < 16) {
        f = (bb & cc) | (~bb & dd);
        g = i;
      } else if (i < 32) {
        f = (dd & bb) | (~dd & cc);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = bb ^ cc ^ dd;
        g = (3 * i + 5) % 16;
      } else {
        f = cc ^ (bb | ~dd);
        g = (7 * i) % 16;
      }
      f = (f + aa + CONSTANTS[i] + words[g]) | 0;
      [aa, bb, cc, dd] = [dd, (bb + rotateLeft(f, SHIFTS[i])) | 0, bb, cc];
    }

    a = (a + aa) | 0;
    b = (b + bb) | 0;
    c = (c + cc) | 0;
    d = (d + dd) | 0;
  }

  return [a, b, c, d].map(littleEndianHex).join('');
}

export const GRAVATAR_BASE = 'https://www.gravatar.com/avatar/';

/**
 * The Gravatar URL for an address — the hash of the trimmed, lower-cased email,
 * which is how Gravatar identifies it. `d=404` asks for a 404 rather than a
 * generic placeholder, so "no avatar" is a failed image the view can hide
 * instead of a stranger's silhouette.
 *
 * Returns '' for an address that cannot produce a URL.
 */
export function gravatarUrl(email, { size = 80, fallback = '404', rating = 'g' } = {}) {
  const address = String(email ?? '').trim().toLowerCase();
  if (!address) return '';
  return `${GRAVATAR_BASE}${md5(address)}?s=${encodeURIComponent(size)}&d=${encodeURIComponent(fallback)}&r=${encodeURIComponent(rating)}`;
}

/**
 * Where a contact's avatar comes from, or `null` when there is none.
 *
 * A photo stored on the contact wins: it is the person's own picture, it lives
 * on the server, and it costs no third-party request. Gravatar is the fallback
 * and only when the user has turned it on, because it sends a hash of the
 * contact's address to gravatar.com.
 *
 * @returns {{url: string, source: 'card'|'gravatar'} | null}
 */
export function avatarFor(card, { gravatar = false, size = 80 } = {}) {
  const own = mediaUris(card)[0];
  if (own) return { url: own, source: 'card' };
  if (!gravatar) return null;
  const email = emailEntries(card)[0]?.address;
  const url = email ? gravatarUrl(email, { size }) : '';
  return url ? { url, source: 'gravatar' } : null;
}
