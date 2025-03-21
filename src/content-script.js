// content-script.js
// Content script to analyze page content for game-related keywords

(function() {
  // Extract text content from the page
  function extractPageContent() {
      // Get all text from relevant elements, avoiding scripts and styles
      const elements = document.querySelectorAll('p, h1, h2, h3, h4, h5, h6, a, li, span, div, td, th'); // Added table elements
      let textContent = '';

      elements.forEach(element => {
          // Skip hidden elements
          if (element.offsetParent === null) return;

          // Get text and remove extra whitespace
          const text = element.textContent.trim();
          if (text) {
              textContent += ' ' + text;
          }
      });

      // Clean up the text (remove excessive whitespace)
      textContent = textContent.replace(/\s+/g, ' ').trim();

      // Get page title as well
      const pageTitle = document.title;

      return {
          text: textContent,
          title: pageTitle
      };
  }

  // Receive initiator and send content analysis
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === "setInitiator") {
          const pageContent = extractPageContent();
          chrome.runtime.sendMessage({
              action: "contentAnalysis",
              content: pageContent.title + ' ' + pageContent.text,
              initiator: message.initiator // Pass initiator for identification
          });
      }
  });
})();