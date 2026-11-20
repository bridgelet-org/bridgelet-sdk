import { femaleotaku1014ValidateWebhookUrl } from './femaleotaku-1014-webhook-url-ssrf.validator.js';

describe('femaleotaku-1014 webhook URL SSRF validation (standalone)', () => {
  it('accepts public https webhook targets', () => {
    const res = femaleotaku1014ValidateWebhookUrl('https://api.example.com/hooks/bridgelet');
    expect(res.ok).toBe(true);
  });

  it('rejects localhost and local hostnames', () => {
    expect(femaleotaku1014ValidateWebhookUrl('http://localhost:3000/hook').ok).toBe(false);
    expect(femaleotaku1014ValidateWebhookUrl('https://service.local/hook').ok).toBe(false);
  });

  it('rejects cloud metadata and link-local/private IPv4 targets', () => {
    expect(femaleotaku1014ValidateWebhookUrl('http://169.254.169.254/latest/meta-data/').ok).toBe(false);
    expect(femaleotaku1014ValidateWebhookUrl('http://10.0.0.5/hook').ok).toBe(false);
    expect(femaleotaku1014ValidateWebhookUrl('http://192.168.1.10/hook').ok).toBe(false);
    expect(femaleotaku1014ValidateWebhookUrl('http://127.0.0.1/hook').ok).toBe(false);
  });

  it('rejects loopback/link-local IPv6 targets', () => {
    expect(femaleotaku1014ValidateWebhookUrl('http://[::1]/hook').ok).toBe(false);
    expect(femaleotaku1014ValidateWebhookUrl('http://[fe80::1]/hook').ok).toBe(false);
  });
});
