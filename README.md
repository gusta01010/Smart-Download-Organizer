<!-- Centered SDO -->
<div align="left">
    <h1 style="">Smart Download Organizer</h1>
</div>

<!-- Centered License Shield -->
<div align="center">

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)

</div>

Want to download files directly to custom locations? For example, a Minecraft .jar mod straight to your mods folder? Smart Download Organizer is a browser extension that automatically organizes your downloaded files by moving them to specific folders based on rules you create, saving you time and effort.

## What is Smart Download Organizer?

This extension simplifies how you manage downloaded files. It uses keywords and a matching system to automatically sort downloads into folders you've set up. Think of it as a helper that tidies up your downloads.

## Key Features

*   **Automatic Organization:** Set up rules, and the extension handles the rest. Downloads are automatically moved to the right folders.
*   **Flexible Configuration:** Create rules using a name, keywords (to match filenames, URLs, and page content), and the destination folder.
*   **Smart Matching:** A scoring system ensures downloads are only redirected when the extension is reasonably sure about the match, minimizing errors. The extension prioritizes matches in this order: **filename**, **page title**, **URL**, and finally, **page content**.
*   **Threshold Notifications:** If a match is found but isn't quite certain, you'll get a notification suggesting a folder, letting you decide.
*   **Easy-to-Use Interface:** The popup is straightforward, making it easy to set up and manage your rules.
*   **Open Source:** The code is on GitHub! Feel free to contribute, customize it, or just take a look.

## How it Works (Matching Logic)

The extension analyzes downloads in a specific order, prioritizing certain information for faster and more accurate matching:

1.  **Set Rules:** In the extension's popup, create configurations. Specify a rule name, keywords, and the target folder.

2.  **Download:** When you download something, the extension checks it.

3.  **Matching (Prioritized):**
    *   **Filename:** The extension *first* checks if the filename contains any of your keywords.  If a strong match is found in the filename (above the `MATCH_THRESHOLD`), the download is *immediately* routed to the corresponding folder, and further analysis is skipped. This is the fastest and most reliable check.
    *   **Page Title:** If no strong filename match is found, the extension tries to get the title of the webpage that initiated the download.  It then checks if this title contains your keywords. A strong title match (above `TITLE_MATCH_THRESHOLD`) will trigger redirection.
    *   **URL:** If neither the filename nor the title provides a strong match, the extension examines the download URL, the referrer URL (the page that linked to the download), and URLs from your recent browsing history.  It checks these URLs for your keywords.
    *   **Page Content:** Finally, if no strong matches are found in the filename, title, or URL, the extension analyzes the *content* of the webpage that initiated the download (or pages from your recent history if the initiating page can't be accessed).  This is the most resource-intensive check, so it's done last.

4.  **Scoring:** Each configuration gets a score based on how well it matches the download, considering the filename, title, URL, and content (each with its own threshold).

5.  **Redirection:**
    *   **High Score:** If the best match (considering all criteria) is above a certain level, the download is automatically moved to the specified folder.
    *   **Medium Score:** If it's below that level, you get a notification suggesting the folder. Click to confirm or ignore to save to the default location.
    *   **No Match:** If nothing matches, the file goes to your usual downloads folder.

## Getting Started

1.  **Installation:** (Instructions for after publication. For now, use manual installation):
    *   Clone or download this repository.
    *   In Chrome (or your Chromium-based browser), go to `chrome://extensions/`.
    *   Turn on "Developer mode" (usually a switch in the top right).
    *   Click "Load unpacked".
    *   Choose the folder you downloaded/cloned (the one with `manifest.json`).

2.  **Configuration:** Click the extension's icon in your browser toolbar to open the popup and add your rules.

## Supported Browsers

*   Google Chrome
*   Microsoft Edge
*   Any Chromium-based browser

## Contributing

Contributions are welcome! If you have ideas, bug fixes, or new features:

1.  Fork the repository.
2.  Create a new branch: `git checkout -b feature/your-feature`
3.  Make your changes and commit them.
4.  Push your branch: `git push origin feature/your-feature`
5.  Open a Pull Request.

## Questions or Suggestions?

Open an issue on GitHub or message me on Discord:

*   Discord: @gusta01010

## License

This project is under the [MIT License](./LICENSE) – you can use, modify, and distribute it freely (attribution is appreciated!).
