import {
  MXLLV_1007_SECRET_MIN_LENGTH,
  mxllv1007ValidateWebhookSecret,
} from './mxllv-1007-webhook-secret-strength.validator.js';

describe('mxllv-1007 webhook secret strength/format validation (standalone)', () => {
  it('accepts secrets meeting minimum length and allowed charset', () => {
    expect(mxllv1007ValidateWebhookSecret('abcdefghijklmnop')).toEqual({ ok: true });
    expect(mxllv1007ValidateWebhookSecret('A1b2_C3d4-E5f6_G7')).toEqual({ ok: true });
  });

  it('rejects too-short secrets', () => {
    expect(mxllv1007ValidateWebhookSecret('short-secret')).toEqual({ ok: false, reason: 'too_short' });
    expect(mxllv1007ValidateWebhookSecret('a'.repeat(MXLLV_1007_SECRET_MIN_LENGTH - 1)).ok).toBe(false);
  });

  it('rejects invalid characters and overly long secrets', () => {
    expect(mxllv1007ValidateWebhookSecret('validlengthbut space')).toEqual({ ok: false, reason: 'invalid_chars' });
    expect(mxllv1007ValidateWebhookSecret('validlengthbut!bang!!')).toEqual({ ok: false, reason: 'invalid_chars' });
    expect(mxllv1007ValidateWebhookSecret('a'.repeat(257))).toEqual({ ok: false, reason: 'too_long' });
  });
});
