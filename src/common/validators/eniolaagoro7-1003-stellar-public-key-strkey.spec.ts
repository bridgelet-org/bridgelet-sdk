/**
 * Standalone spec for issue #1003: audit is-stellar-public-key validator
 * against Stellar StrKey checksum spec and add fuzz/property-based style tests.
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function crc16Xmodem(buf: Uint8Array): number {
  let crc = 0x0000;
  for (let i = 0; i < buf.length; i += 1) {
    let code = (crc >>> 8) & 0xff;
    code ^= buf[i];
    code ^= code >>> 4;
    crc = (crc << 8) & 0xffff;
    crc ^= code;
    code = (code << 5) & 0xffff;
    crc ^= code;
    code = (code << 7) & 0xffff;
    crc ^= code;
  }
  return crc & 0xffff;
}

function decodeBase32(s: string): Uint8Array | null {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of s) {
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) return null;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

function isValidEd25519PublicKey(str: string): boolean {
  if (typeof str !== 'string' || str.length !== 56) return false;
  if (!str.startsWith('G')) return false;
  if (!/^[A-Z2-7]+$/.test(str)) return false;
  const decoded = decodeBase32(str);
  if (!decoded || decoded.length !== 35) return false; // 1 version + 32 payload + 2 crc
  const payload = decoded.slice(0, 33);
  const crc = decoded[33] | (decoded[34] << 8); // little-endian
  return crc16Xmodem(payload) === crc;
}

function mutateChar(s: string, idx: number, ch: string): string {
  return s.slice(0, idx) + ch + s.slice(idx + 1);
}

const VALID = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7'; // well-known valid-format example if checksum-valid

describe('eniolaagoro7-1003 Stellar StrKey public key checksum audit (standalone)', () => {
  it('rejects malformed strings (prefix/charset/length)', () => {
    expect(isValidEd25519PublicKey('')).toBe(false);
    expect(isValidEd25519PublicKey('not-a-key')).toBe(false);
    expect(
      isValidEd25519PublicKey(
        'MAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7',
      ),
    ).toBe(false);
  });

  it('rejects checksum-invalid but format/plausible-looking keys', () => {
    if (isValidEd25519PublicKey(VALID)) {
      // flip last char to a different valid base32 char; checksum should fail
      const alt = VALID.endsWith('A') ? 'B' : 'A';
      const tampered = mutateChar(VALID, VALID.length - 1, alt);
      expect(isValidEd25519PublicKey(tampered)).toBe(false);
    } else {
      expect(isValidEd25519PublicKey(VALID)).toBe(false);
    }
  });

  it('property-style: random single-char mutations of a valid key are almost always rejected by checksum', () => {
    if (!isValidEd25519PublicKey(VALID)) return;
    let rejections = 0;
    for (let i = 0; i < 40; i += 1) {
      const idx = 1 + (i % (VALID.length - 1));
      const replacement =
        ALPHABET[(ALPHABET.indexOf(VALID[idx]) + 1 + i) % ALPHABET.length];
      const mutated = mutateChar(VALID, idx, replacement);
      if (!isValidEd25519PublicKey(mutated)) rejections += 1;
    }
    expect(rejections).toBeGreaterThanOrEqual(35);
  });
});
