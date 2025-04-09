# Domain Normalization in PrivacyGuard

## Overview

This document describes the implementation of domain normalization in PrivacyGuard. Domain normalization ensures that subdomains (e.g., "legal.yahoo.com") are treated as part of their parent domain (e.g., "yahoo.com") for assessment purposes.

## Motivation

Previously, PrivacyGuard treated each subdomain as a separate entity, resulting in:

1. Duplicate assessments for the same organization (e.g., "mail.google.com" and "drive.google.com" would have separate assessments)
2. Inefficient use of resources as the same privacy policy was evaluated multiple times
3. Inconsistent user experience as different subdomains of the same site might show different assessment results

By normalizing domains, we ensure that:

1. All subdomains of a website share the same privacy assessment
2. Resources are used efficiently by evaluating each organization's privacy policy only once
3. Users get a consistent experience across all subdomains of a website

## Implementation Details

### Domain Normalization Function

We've implemented a `getNormalizedDomain` function that extracts the effective top-level domain plus one level (eTLD+1) from a hostname:

```javascript
function getNormalizedDomain(hostname) {
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
```

This function handles:

- IP addresses (returned as-is)
- Standard domains (e.g., "example.com")
- Subdomains (e.g., "blog.example.com" → "example.com")
- Special multi-part TLDs (e.g., "example.co.uk" → "example.co.uk")

### Changes to Backend

1. Created a utility module (`domainUtils.js`) with domain normalization functions
2. Updated database functions to normalize URLs before storage and retrieval
3. Modified controllers to use normalized domains for assessments

### Changes to Chrome Plugin

1. Added a utility module (`utils.js`) with domain normalization functions
2. Updated background script to normalize domains before API requests
3. Modified popup script to use normalized domains for displaying assessments

### Data Migration

A migration script (`migrate-to-normalized-domains.js`) was created to:

1. Fetch all records from the websites table
2. Normalize each URL
3. Group assessments by normalized URL
4. Keep the most recent assessment for each normalized URL
5. Update the database with the normalized URLs

Similarly, it updates the unassessed_urls table to use normalized URLs and removes duplicates.

## Usage

### Running the Migration Script

```bash
cd privacy-guard/backend
node scripts/migrate-to-normalized-domains.js
```

### Testing Domain Normalization

You can test the domain normalization by visiting different subdomains of the same website (e.g., "mail.google.com" and "drive.google.com") and verifying that they show the same privacy assessment.

## Future Improvements

1. Enhance the domain normalization function to handle more complex cases
2. Add support for custom domain mappings (e.g., mapping "github.io" subdomains to their respective repositories)
3. Implement a more sophisticated TLD detection algorithm using the Public Suffix List
