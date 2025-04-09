// Domain utility functions for PrivacyGuard

/**
 * Extract the effective top-level domain plus one level from a hostname
 * @param {string} hostname - The hostname to normalize (e.g., "legal.yahoo.com")
 * @returns {string} - The normalized domain (e.g., "yahoo.com")
 */
function getNormalizedDomain(hostname) {
  // If hostname is null or undefined, return empty string
  if (!hostname) {
    return "";
  }

  // Handle IP addresses
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(hostname)) {
    return hostname;
  }

  // Split the hostname by dots
  const parts = hostname.split(".");

  // If we have 2 or fewer parts, return as is (already a TLD or TLD+1)
  if (parts.length <= 2) {
    return hostname;
  }

  // Handle special cases for known multi-part TLDs
  const knownTLDs = [
    "co.uk",
    "com.au",
    "co.jp",
    "org.uk",
    "gov.uk",
    "ac.uk",
    "net.au",
    "org.au",
    "edu.au",
  ];
  for (const tld of knownTLDs) {
    if (hostname.endsWith("." + tld)) {
      // Extract the part before the known TLD
      const domainPart = parts[parts.length - 3];
      return `${domainPart}.${tld}`;
    }
  }

  // Default case: return the last two parts
  return parts.slice(-2).join(".");
}

/**
 * Normalize a full URL to its base domain
 * @param {string} url - The URL to normalize (e.g., "https://legal.yahoo.com/privacy")
 * @returns {string} - The normalized domain (e.g., "yahoo.com")
 */
function normalizeUrl(url) {
  try {
    // Handle null, undefined, or empty strings
    if (!url) {
      return '';
    }

    // Remove any whitespace
    let normalizedUrl = url.trim();

    // Remove any trailing slashes
    normalizedUrl = normalizedUrl.replace(/\/+$/, '');

    // If the URL doesn't start with http:// or https://, add https://
    if (!normalizedUrl.match(/^https?:\/\//i)) {
      normalizedUrl = "https://" + normalizedUrl;
    }

    // Handle special cases where URL might contain email addresses or other invalid formats
    if (normalizedUrl.includes('@')) {
      normalizedUrl = normalizedUrl.split('@')[1];
      if (!normalizedUrl.match(/^https?:\/\//i)) {
        normalizedUrl = "https://" + normalizedUrl;
      }
    }

    // Extract the hostname from the URL and remove 'www.' if present
    const hostname = new URL(normalizedUrl).hostname.replace(/^www\./, '');

    // Get the normalized domain
    return getNormalizedDomain(hostname);
  } catch (error) {
    console.error(`Error normalizing URL ${url}:`, error);
    // If URL is invalid, try to extract domain-like pattern
    try {
      const domainMatch = url.match(/[a-zA-Z0-9][a-zA-Z0-9-]*\.[a-zA-Z]{2,}/);
      if (domainMatch) {
        return getNormalizedDomain(domainMatch[0]);
      }
    } catch (e) {
      // Ignore secondary error
    }
    return ''; // Return empty string for invalid URLs
  }
}

/**
 * Checks if a given domain is a Google domain
 * @param {string} url - The URL or domain to check
 * @returns {boolean} - True if the domain is a Google domain, false otherwise
 */
function isGoogleDomain(url) {
  if (!url) return false;
  
  const normalizedDomain = normalizeUrl(url);
  const googleDomains = [
    'google.com',
    'youtube.com',
    'gmail.com',
    'google.co.uk',
    'google.ca',
    'google.fr',
    'google.de',
    'google.es',
    'google.it',
    'google.nl',
    'google.pl',
    'google.ru',
    'google.com.au',
    'google.co.jp',
    'google.co.in',
    'google.com.br',
    'google.com.mx'
  ];

  return googleDomains.some(domain => normalizedDomain === domain || normalizedDomain.endsWith('.' + domain));
}

module.exports = {
  getNormalizedDomain,
  normalizeUrl,
  isGoogleDomain
};
