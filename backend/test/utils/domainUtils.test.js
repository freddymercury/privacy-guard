const { normalizeUrl, isGoogleDomain } = require('../../src/utils/domainUtils');

describe('Domain Utilities', () => {
  describe('normalizeUrl', () => {
    it('should normalize URLs with protocol', () => {
      expect(normalizeUrl('https://example.com')).toBe('example.com');
      expect(normalizeUrl('http://example.com')).toBe('example.com');
      expect(normalizeUrl('https://www.example.com')).toBe('example.com');
    });

    it('should normalize URLs without protocol', () => {
      expect(normalizeUrl('example.com')).toBe('example.com');
      expect(normalizeUrl('www.example.com')).toBe('example.com');
    });

    it('should handle URLs with paths', () => {
      expect(normalizeUrl('https://example.com/path')).toBe('example.com');
      expect(normalizeUrl('example.com/path')).toBe('example.com');
    });

    it('should handle URLs with query parameters', () => {
      expect(normalizeUrl('https://example.com?param=value')).toBe('example.com');
      expect(normalizeUrl('example.com?param=value')).toBe('example.com');
    });

    it('should handle URLs with fragments', () => {
      expect(normalizeUrl('https://example.com#fragment')).toBe('example.com');
      expect(normalizeUrl('example.com#fragment')).toBe('example.com');
    });

    it('should handle invalid URLs', () => {
      expect(normalizeUrl('')).toBe('');
      expect(normalizeUrl(null)).toBe('');
      expect(normalizeUrl(undefined)).toBe('');
    });
  });

  describe('isGoogleDomain', () => {
    it('should identify Google domains', () => {
      expect(isGoogleDomain('google.com')).toBe(true);
      expect(isGoogleDomain('www.google.com')).toBe(true);
      expect(isGoogleDomain('https://google.com')).toBe(true);
      expect(isGoogleDomain('https://www.google.com')).toBe(true);
      expect(isGoogleDomain('youtube.com')).toBe(true);
      expect(isGoogleDomain('gmail.com')).toBe(true);
      expect(isGoogleDomain('google.co.uk')).toBe(true);
    });

    it('should not identify non-Google domains', () => {
      expect(isGoogleDomain('example.com')).toBe(false);
      expect(isGoogleDomain('microsoft.com')).toBe(false);
      expect(isGoogleDomain('apple.com')).toBe(false);
      expect(isGoogleDomain('facebook.com')).toBe(false);
    });

    it('should handle invalid domains', () => {
      expect(isGoogleDomain('')).toBe(false);
      expect(isGoogleDomain(null)).toBe(false);
      expect(isGoogleDomain(undefined)).toBe(false);
    });
  });
}); 