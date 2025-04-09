// Utility functions for PrivacyGuard Chrome Plugin

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
    // If the URL doesn't start with http:// or https://, add https://
    let normalizedUrl = url;
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      normalizedUrl = "https://" + url;
    }

    // Extract the hostname from the URL
    const hostname = new URL(normalizedUrl).hostname;

    // Get the normalized domain
    return getNormalizedDomain(hostname);
  } catch (error) {
    console.error(`Error normalizing URL ${url}:`, error);
    return url; // Return original URL if there's an error
  }
}

// Export functions for use in other files
export { getNormalizedDomain, normalizeUrl };
