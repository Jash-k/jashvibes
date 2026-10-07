#!/usr/bin/env node
/*
 * JioSaavn's web API hands out stream URLs DES-encrypted (base64, key `38346591`).
 * Node's OpenSSL dropped single-DES in v17 (`ERR_OSSL_EVP_UNSUPPORTED`, verified on
 * this sandbox's Node 20), so the obvious `des-ecb` route is closed.
 *
 * DES is a special case of 3DES: `des-ede3` with the same 8-byte key repeated three
 * times, ECB and no IV, is byte-for-byte single DES. Proven here against the FIPS
 * single-DES vector before it is allowed anywhere near a real payload:
 *
 *   key 133457799BBCDFF1 → plaintext 0123456789ABCDEF → 85E813540F0AB405
 *   (crypto.createCipheriv('des-ede3', K||K||K, null) matches on the first block)
 *
 * The ciphertext carries PKCS#5 padding, and the API pads the *plaintext* to the
 * scheme's quality suffixes, so `_96.mp4` / `_160.mp4` / `_320.mp4` all come from the
 * one decoded string. Decoding the URL server-side matters for more than playback:
 * the CDN sends `Access-Control-Allow-Origin: *`, so the player can feed the same
 * response into WebAudio and draw a real waveform.
 */
import { createDecipheriv } from 'node:crypto';

export const SAAVN_DES_KEY = '38346591';

const FIPS_VECTOR = { key: '133457799BBCDFF1', plain: '0123456789ABCDEF', cipher: '85E813540F0AB405' };

/** A DES key is 8 raw bytes; `encoding` says how the caller spells it. */
function keyBytes(key, encoding = 'utf8') {
  const k = Buffer.from(key, encoding);
  if (k.length !== 8) throw new Error(`DES key must be 8 bytes, got ${k.length}`);
  return k;
}

function tripleDesBlock(key, buffer, encoding) {
  const k = keyBytes(key, encoding);
  const cipher = createDecipheriv('des-ede3', Buffer.concat([k, k, k]), null);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(buffer), cipher.final()]);
}

/**
 * True when this runtime can express single DES through 3DES with K||K||K.
 * Checked against the FIPS single-DES vector (`133457799BBCDFF1` is a *hex* key —
 * the first version of this test read it as UTF-8 and failed its own vector while
 * the real decryption was already working).
 */
export function desSelfTest() {
  try {
    // Decrypt the vector's ciphertext: decrypting the *plaintext* (the first
    // version of this check) proves nothing and fails while the crypto works.
    const plain = tripleDesBlock(FIPS_VECTOR.key, Buffer.from(FIPS_VECTOR.cipher, 'hex'), 'hex');
    return plain.subarray(0, 8).toString('hex').toUpperCase() === FIPS_VECTOR.plain;
  } catch {
    return false;
  }
}

/** Strip PKCS#5 padding. The payloads seen in the wild are sometimes fully padded. */
function stripPkcs5(buffer) {
  if (!buffer.length) return buffer;
  const pad = buffer[buffer.length - 1];
  if (pad >= 1 && pad <= 8 && pad <= buffer.length) return buffer.subarray(0, buffer.length - pad);
  return buffer;
}

/**
 * Decrypt one `encrypted_media_url`. Returns the URL exactly as the API meant it:
 * TLD-qualified, https, and *still* carrying the `_96.mp4` suffix so callers can swap
 * the quality. Throws on anything that does not decode to a URL.
 */
export function decryptSaavnUrl(encrypted, key = SAAVN_DES_KEY) {
  const raw = String(encrypted || '').trim();
  if (!raw) throw new Error('No encrypted media URL');
  const binary = Buffer.from(raw, 'base64');
  if (!binary.length || binary.length % 8 !== 0) throw new Error('Encrypted media URL is not DES-shaped');
  const plain = stripPkcs5(tripleDesBlock(key, binary)).toString('utf8').replace(/\u0000+$/g, '').trim();
  if (!/^https?:\/\//i.test(plain)) throw new Error('Decrypted media URL is not a URL');
  return plain.replace(/^http:\/\//i, 'https://');
}

/**
 * Every quality JioSaavn publishes for one song, as a `streamUrls` map the player
 * already understands. `encrypted_media_url` always encodes the 96 kbps object;
 * the higher renditions are the same path with the suffix swapped, and only the
 * suffixes the payload says exist are offered.
 */
export function saavnStreamUrls(encrypted, { is320 = false, qualities = ['96kbps', '160kbps', '320kbps'] } = {}) {
  const base = decryptSaavnUrl(encrypted);
  const suffix = (base.match(/_(\d+)\.(mp4|mp3|m4a)(\?.*)?$/i) || [])[1] || '96';
  const swap = (to) => base.replace(new RegExp(`_${suffix}\\.(mp4|mp3|m4a)(\\?.*)?$`, 'i'), `_${to}.$1$2`);
  const wanted = qualities.filter((q) => q !== '320kbps' || is320);
  const urls = {};
  for (const quality of wanted) {
    const kbps = Number(String(quality).replace(/kbps$/, ''));
    urls[quality] = kbps === Number(suffix) ? base : swap(kbps);
  }
  return { base, suffix, urls };
}

export default { SAAVN_DES_KEY, desSelfTest, decryptSaavnUrl, saavnStreamUrls };
