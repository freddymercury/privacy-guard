# PrivacyGuard Chrome Plugin

A Chrome extension that assesses privacy risks of user agreements for popular websites.

## Features

- Automatically detects and analyzes privacy policies of websites you visit
- Displays privacy risk level using badge indicators:
  - "H" (Red): High Risk - Severe privacy concerns (e.g., selling data)
  - "M" (Yellow): Medium Risk - Moderate concerns with potential opt-outs
  - "L" (Green): Low Risk - User-friendly and privacy-conscious
  - "?" (Gray): Unknown Risk - Not explicitly mentioned or uncertain
- Provides detailed breakdown of privacy risks by category
- Reports unassessed websites to the backend for future evaluation

## Installation

### Development Mode

1. Clone this repository
2. Navigate to `chrome://extensions/` in your Chrome browser
3. Enable "Developer mode" (toggle in the top-right corner)
4. Click "Load unpacked" and select the `privacy-guard/chrome-plugin` directory
5. The PrivacyGuard extension should now be installed and visible in your extensions list

### Build for Distribution

```bash
npm install
npm run build
```

The built extension will be available in the `dist` directory.

## Usage

1. Click on the PrivacyGuard icon in your browser toolbar to see the privacy assessment for the current website
2. The badge indicator shows the overall privacy risk level
3. Detailed information about specific privacy categories is displayed below
4. Use the "Refresh Assessment" button to check for updated assessments
5. Toggle the "Plugin Active" switch to enable/disable the extension

## Configuration

The extension connects to a backend service for privacy assessments. By default, it connects to `http://localhost:3000/api`. To change this:

1. Edit the `API_BASE_URL` variable in `background.js` and `popup.js`
2. Reload the extension

## Development

### Project Structure

- `manifest.json`: Chrome extension configuration
- `background.js`: Background script for URL detection and API communication
- `popup.html/css/js`: UI for the extension popup
- `icons/`: Extension icons and indicators

### Testing

```bash
npm test
```

## License

MIT
