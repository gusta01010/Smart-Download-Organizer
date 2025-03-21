// content-script.js
(function() {
    console.log("Content script loaded");
    let initiator = null;

    // Listen for the initiator URL
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.action === "setInitiator") {
            initiator = message.initiator;
            console.log("Initiator set:", initiator);
            analyzeContent();
        }
        return true;
    });

    // Function to search for keywords and save to cache
    function analyzeContent() {
        // Get all configs from storage
        chrome.storage.sync.get('gameConfigs', function(data) {
            if (!data.gameConfigs || !data.gameConfigs.length) {
                console.log("No game configs found");
                return;
            }

            // Create keyword sets from game configs
            const keywordSets = data.gameConfigs.map(config => ({
                name: config.name,
                keywords: config.keywords.split(',').map(k => k.trim().toLowerCase())
            }));

            // Get the page content in lowercase
            const pageContent = document.body.innerText.toLowerCase();
            
            // Process each keyword set
            const results = {};
            
            keywordSets.forEach(set => {
                let totalMatches = 0;
                const keywordMatches = {};
                
                // Count matches for each keyword
                set.keywords.forEach(keyword => {
                    const regex = new RegExp(keyword, 'gi');
                    const matches = (pageContent.match(regex) || []).length;
                    keywordMatches[keyword] = matches;
                    totalMatches += matches;
                });
                
                // Store results for this set
                results[set.name] = {
                    totalMatches,
                    keywordMatches,
                    url: window.location.href,
                    title: document.title,
                    timestamp: Date.now()
                };
            });
            
            // Send results to background script
            chrome.runtime.sendMessage({
                action: "keywordAnalysis",
                results: results,
                tabId: initiator || window.location.origin,
                url: window.location.href,
                title: document.title
            });
            
            // Optional: Display results on page for debugging
            if (false) { // Set to true for debugging visualization
                showDebugInfo(results);
            }
        });
    }
    
    // Helper function to display debug information
    function showDebugInfo(results) {
        const resultDiv = document.createElement('div');
        resultDiv.style.position = 'fixed';
        resultDiv.style.top = '10px';
        resultDiv.style.right = '10px';
        resultDiv.style.background = 'white';
        resultDiv.style.padding = '10px';
        resultDiv.style.border = '1px solid black';
        resultDiv.style.zIndex = '9999';
        resultDiv.style.maxHeight = '80vh';
        resultDiv.style.overflow = 'auto';
        
        let htmlContent = '<h3>Keyword Analysis Results:</h3>';
        
        for (const [setName, data] of Object.entries(results)) {
            htmlContent += `<h4>${setName}: ${data.totalMatches} total matches</h4>`;
            htmlContent += '<ul>';
            for (const [keyword, count] of Object.entries(data.keywordMatches)) {
                htmlContent += `<li>${keyword}: ${count}</li>`;
            }
            htmlContent += '</ul>';
        }
        
        resultDiv.innerHTML = htmlContent;
        document.body.appendChild(resultDiv);
    }

    // Run analysis when page is loaded
    if (document.readyState === 'complete') {
        analyzeContent();
    } else {
        window.addEventListener('load', analyzeContent);
    }
})();