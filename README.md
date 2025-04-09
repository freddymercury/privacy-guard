# PrivacyGuard

A comprehensive privacy assessment system for user agreements of popular websites, consisting of a Chrome plugin and a backend service with admin dashboard.

## Overview

PrivacyGuard helps users understand the privacy implications of websites they visit by:

1. Automatically detecting when a user visits a website
2. Checking if a privacy assessment exists for that website
3. Displaying badge indicators ("H" for High, "M" for Medium, "L" for Low, "?" for Unknown) to show the privacy risk level
4. Providing detailed information about specific privacy concerns

The system uses LLM technology to analyze privacy policies and user agreements, evaluating them across multiple privacy risk categories.

## System Architecture

The PrivacyGuard system consists of two main components:

### 1. Chrome Plugin

- Detects URLs as users browse the web
- Queries the backend service for privacy assessments
- Displays privacy risk indicators to users
- Reports unassessed URLs to the backend for future evaluation

[Detailed Chrome Plugin Documentation](./chrome-plugin/README.md)

### 2. Backend Service + Admin Dashboard

- Provides API endpoints for the Chrome plugin
- Stores and manages privacy assessments in a Supabase database
- Integrates with LLM (via llamaindex) for automated privacy policy assessment
- Includes an admin dashboard for managing assessments, viewing analytics, and handling unassessed URLs

[Detailed Backend Documentation](./backend/README.md)

## Privacy Risk Categories

PrivacyGuard evaluates privacy policies across these key categories:

- **Data Collection & Use**: What personal data is collected and how it's used
- **Third-Party Sharing & Selling**: Whether and how data is shared with third parties
- **Data Storage & Security**: How data is stored, secured, and for how long
- **User Rights & Control**: What control users have over their data
- **AI & Automated Decision-Making**: How AI might be used with user data
- **Policy Changes & Updates**: How users are notified of privacy policy changes

## Risk Levels

- **High Risk (H)**: Severe privacy concerns (e.g., selling personal data, minimal user control)
- **Medium Risk (M)**: Moderate concerns with potential opt-outs
- **Low Risk (L)**: User-friendly and privacy-conscious policies
- **Unknown Risk (?)**: Not explicitly mentioned or uncertain

## Installation

### Prerequisites

- Node.js v20.x or newer
- npm
- Chrome browser
- Supabase account
- OpenAI API key (or other LLM provider supported by llamaindex)

### Setup Instructions

1. Clone this repository
2. Set up the backend service:
   ```bash
   cd privacy-guard/backend
   npm install
   # Configure environment variables (see backend README)
   npm run dev
   ```
3. Set up the Chrome plugin:
   ```bash
   cd privacy-guard/chrome-plugin
   npm install
   # Load the extension in Chrome (see Chrome plugin README)
   ```

## Development

See the individual README files in each component directory for detailed development instructions:

- [Chrome Plugin Development](./chrome-plugin/README.md)
- [Backend Development](./backend/README.md)

## License

MIT
