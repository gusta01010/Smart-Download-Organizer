// background.js
const MATCH_THRESHOLD = 75;
const TITLE_MATCH_THRESHOLD = 60;
const CONTENT_MATCH_THRESHOLD = 50;
const MAX_HISTORY_ITEMS = 3;
const NOTIFICATION_TIMEOUT = 15000;

let pendingDownloads = new Map();
let downloadNotifications = new Map();
let suggestCallbacks = new Map();
let contentAnalysisResults = new Map(); // Store content analysis results

chrome.runtime.onInstalled.addListener(() => {
    console.log("Download Organizer Extension installed");
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "contentAnalysis") {
        // Store content analysis result, keyed by tab ID (or initiator for downloads)
        console.log("Received content analysis from tab:", sender.tab ? sender.tab.id : "no tab");
        contentAnalysisResults.set(sender.tab ? sender.tab.id : message.initiator, message.content);
    }
});

chrome.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => {
    console.log("Download started:", downloadItem.filename, downloadItem.url);

    pendingDownloads.set(downloadItem.id, { downloadItem, suggest });
    suggestCallbacks.set(downloadItem.id, suggest);

    processDownload(downloadItem).catch(error => {
        console.error("Error processing download:", error);
        callSuggestSafely(downloadItem.id, {});
    });

    return true;
});

async function processDownload(downloadItem) {
    const { gameConfigs } = await chrome.storage.sync.get('gameConfigs');
    if (!gameConfigs) {
        callSuggestSafely(downloadItem.id, {});
        return;
    }

    const matchResults = await analyzeDownload(downloadItem, gameConfigs);

    if (matchResults.every(result => result.matchPercentage === 0)) {
        console.log("No matches found (0%), using default location");
        callSuggestSafely(downloadItem.id, {});
        return;
    }

    const bestMatch = matchResults[0];
    // Check filename, url, title, and content
    if (bestMatch.filenameMatchPercentage >= MATCH_THRESHOLD || bestMatch.urlMatchPercentage >= MATCH_THRESHOLD || bestMatch.titleMatchPercentage >= TITLE_MATCH_THRESHOLD || bestMatch.contentMatchPercentage >= CONTENT_MATCH_THRESHOLD) {
        console.log(`Using best match automatically: ${bestMatch.name} (Filename: ${Math.round(bestMatch.filenameMatchPercentage)}%, URL: ${Math.round(bestMatch.urlMatchPercentage)}%, Title: ${Math.round(bestMatch.titleMatchPercentage)}%, Content: ${Math.round(bestMatch.contentMatchPercentage)}%, Overall: ${Math.round(bestMatch.matchPercentage)}%)`);
        const suggestedFilename = getSuggestedFilename(downloadItem, bestMatch);
        callSuggestSafely(downloadItem.id, { filename: suggestedFilename, conflictAction: 'uniquify' });
        return;
    }

    showDownloadPathNotification(downloadItem, matchResults.slice(0, 2));
}

function getSuggestedFilename(downloadItem, match) {
    const baseFilename = downloadItem.filename.split('/').pop();
    const relativePath = match.downloadPath.replace(/^[A-Z]:[\\/]/, '').replace(/\\/g, '/');
    const normalizedPath = relativePath.endsWith('/') ? relativePath : relativePath + '/';
    return normalizedPath + baseFilename;
}

function callSuggestSafely(downloadId, suggestion) {
    const suggest = suggestCallbacks.get(downloadId);
    if (suggest) {
        if (!suggestion.filename) {
            console.warn("Suggesting with an empty filename. Using default behavior.");
            suggestion = {}; // Ensure default behavior
        }
        suggest(suggestion);
        suggestCallbacks.delete(downloadId);
    } else {
        console.warn(`No suggest callback found for download ID ${downloadId}`);
    }
}



async function analyzeDownload(downloadItem, gameConfigs) {
    const parsedConfigs = gameConfigs.map(config => ({
        ...config,
        keywordList: config.keywords.split(',').map(k => k.trim().toLowerCase())
    }));

    // --- 1. Analyze Filename FIRST ---
    const filenameResults = analyzeFilename(downloadItem.filename, parsedConfigs);
    const highFilenameMatch = filenameResults.find(r => r.filenameMatchPercentage >= MATCH_THRESHOLD);
    if (highFilenameMatch) {
        console.log(`High filename match detected for ${highFilenameMatch.name} (${Math.round(highFilenameMatch.filenameMatchPercentage)}%), skipping further analysis.`);
        filenameResults.sort((a, b) => b.filenameMatchPercentage - a.filenameMatchPercentage);
        return filenameResults; // Return immediately if high filename match
    }


    // --- 2. Try to get tab information ---
    let tabInfo = null;
    if (downloadItem.initiator) {
        try {
            tabInfo = await getTabInfo(downloadItem.initiator);
            console.log("Tab Info:", tabInfo);
        } catch (error) {
            console.error("Error getting tab info:", error);
            // Fallback to history
        }
    }

    // --- 3. Analyze based on tab info or history ---
    let historyItems = [];
    if (!tabInfo) {
        historyItems = await getRecentHistory(MAX_HISTORY_ITEMS);
    }

    // --- 4. Analyze URLs and Titles ---
    const urlResults = await analyzeUrls(downloadItem.url, downloadItem.referrer, tabInfo, historyItems, parsedConfigs);
    const highTitleMatchResult = urlResults.find(r => r.titleMatchPercentage >= TITLE_MATCH_THRESHOLD);
    if (highTitleMatchResult) {
        console.log(`High title match detected for ${highTitleMatchResult.name} (${Math.round(highTitleMatchResult.titleMatchPercentage)}%), skipping content analysis if content threshold not also met.`);
        // DON'T return yet, we need to check content and combine results
    }


    // --- 5. Analyze Page Content (Always, but give priority to tabInfo) ---
    let contentResults = [];
    if (tabInfo) {
        // Use content analysis result if available, otherwise, request it
        if (contentAnalysisResults.has(tabInfo.id)) {
          const content = contentAnalysisResults.get(tabInfo.id);
          contentResults = await analyzePageContent([{title: tabInfo.title, url: tabInfo.url, content}], parsedConfigs);
          contentAnalysisResults.delete(tabInfo.id);  //consume it
        } else {
           // Inject content script to get the content (if not already retrieved)
            try{
                await injectContentScript(tabInfo.id, downloadItem.initiator); // Inject and wait
            } catch (error){
                console.error("Failed to inject content script:", error);
            }
            if(contentAnalysisResults.has(tabInfo.id)){
                const content = contentAnalysisResults.get(tabInfo.id);
                contentResults = await analyzePageContent([{ title: tabInfo.title, url: tabInfo.url, content }], parsedConfigs);
                contentAnalysisResults.delete(tabInfo.id);
            } else {
              console.warn("Content analysis not available for tab:", tabInfo.id);
              contentResults = await analyzePageContent([], parsedConfigs); // Use empty array as fallback
            }
        }
    } else {
        // Use history and content analysis results
        const itemsToAnalyze = [];
        for (const item of historyItems) {
            if (contentAnalysisResults.has(item.id)) {
                itemsToAnalyze.push({...item, content: contentAnalysisResults.get(item.id)});
                contentAnalysisResults.delete(item.id);
            } else {
                itemsToAnalyze.push(item); //If no content, use the item.  analyzePageContent will handle.
            }
        }
      contentResults = await analyzePageContent(itemsToAnalyze, parsedConfigs);

    }
    const highContentMatchResult = contentResults.find(r => r.contentMatchPercentage >= CONTENT_MATCH_THRESHOLD);

    // --- 6. Combine Results ---
    let combinedResults = combineResults(filenameResults, urlResults); // Combine filename and URL/Title
    combinedResults = combineResults(combinedResults, contentResults);   // Combine with content results

    if (highContentMatchResult) {
        console.log(`High content match detected for ${highContentMatchResult.name} (${Math.round(highContentMatchResult.contentMatchPercentage)}%).`);
    }

    combinedResults.sort((a, b) => b.matchPercentage - a.matchPercentage);
    return combinedResults;

}

// NEW FUNCTION: Analyze the filename
function analyzeFilename(filename, parsedConfigs) {
    const normalizedFilename = filename.toLowerCase();
    const results = [];

    for (const config of parsedConfigs) {
        let matchCount = 0;
        for (const keyword of config.keywordList) {
            if (isKeywordInText(normalizedFilename, keyword)) {
                matchCount++;
            }
        }

        // Calculate percentage based on the number of matched keywords relative to total keywords
        const filenameMatchPercentage = config.keywordList.length > 0 ? Math.min(100, (matchCount / config.keywordList.length) * 100) : 0;

        results.push({
            name: config.name,
            downloadPath: config.downloadPath,
            filenameMatchPercentage,
            matchPercentage: filenameMatchPercentage, // Initially, overall match is filename match
            urlMatchPercentage: 0, // Initialize to 0
            titleMatchPercentage: 0, // Initialize to 0,
            contentMatchPercentage: 0 // Initialize content percentage as well, even if not calculated here.
        });
    }
    return results;
}

//Combine Filename and Other results
function combineResults(filenameResults, otherResults) {
    const combined = [...filenameResults]; // Start with filename results

    // Merge other results, updating matchPercentage if necessary
    for (const otherResult of otherResults) {
        const existing = combined.find(r => r.name === otherResult.name);
        if (existing) {
            // Update URL and title percentages, and recalculate overall matchPercentage
            existing.urlMatchPercentage = Math.max(existing.urlMatchPercentage, otherResult.urlMatchPercentage || 0); // Ensure 0 if undefined
            existing.titleMatchPercentage = Math.max(existing.titleMatchPercentage, otherResult.titleMatchPercentage || 0);
            existing.contentMatchPercentage = Math.max(existing.contentMatchPercentage, otherResult.contentMatchPercentage || 0); // Take max of content percentages
            existing.matchPercentage = Math.max(existing.filenameMatchPercentage, existing.urlMatchPercentage, existing.titleMatchPercentage, existing.contentMatchPercentage); // Include content in overall max

        } else {
            //This part should never happen as filename should contain every name
            combined.push(otherResult);
        }
    }
    return combined;
}



async function getTabInfo(initiator) {
    return new Promise((resolve, reject) => {
        // Try to find the tab based on the initiator URL
        chrome.tabs.query({}, (tabs) => { // Query ALL tabs
            const matchedTab = tabs.find(tab => tab.url && initiator && tab.url.startsWith(initiator.split('?')[0]));  //Basic URL Matching

            if (!matchedTab) {
                reject(new Error("No matching tab found."));
                return;
            }

            // Inject content script to get the title
            chrome.scripting.executeScript({
                target: { tabId: matchedTab.id },
                func: () => document.title, // Get the title directly
            }, (results) => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                    return;
                }
                if (results && results[0] && results[0].result) {
                    resolve({ title: results[0].result, url: matchedTab.url, id: matchedTab.id });
                } else {
                    reject(new Error("Failed to get tab title."));
                }
            });
        });
    });
}

async function injectContentScript(tabId, initiator) {
    return new Promise((resolve, reject) => {
      chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ['content-script.js']
      }, () => {
          if(chrome.runtime.lastError){
              reject(chrome.runtime.lastError);
          } else {
            // Send initiator information to content script
            chrome.tabs.sendMessage(tabId, {action: "setInitiator", initiator: initiator}).catch(err => {
                console.warn("Tab might have closed before message could be sent:", err); //This is not critical
            });
                resolve();  //Resolve after injection, not after analysis
          }
      });
    });
}



async function getRecentHistory(count) {
    return new Promise((resolve) => {
        chrome.history.search({
            text: '',
            maxResults: count * 3,
            startTime: Date.now() - (7 * 24 * 60 * 60 * 1000)
        }, (historyItems) => {
            const filteredItems = historyItems
                .filter(item => !item.url.startsWith('chrome://') &&
                    !item.url.startsWith('edge://') &&
                    !item.url.startsWith('about:') &&
                    item.url !== 'about:blank')
                .slice(0, count);

            // Add tab ID for content analysis lookup
            const itemsWithIds = filteredItems.map(item => ({...item, id: `history-${item.visitId}`})); //Unique ID
            resolve(itemsWithIds);

        });
    });
}

async function analyzeUrls(url, referrer, tabInfo, historyItems, parsedConfigs) {
    const urls = [url, referrer];
    if (tabInfo) {
        urls.push(tabInfo.url);  // Add tab URL if available
    } else {
        urls.push(...historyItems.map(item => item.url)); // Add history URLs
    }
    const filteredUrls = urls.filter(Boolean);

    const titles = [];
    if (tabInfo) {
        titles.push(tabInfo.title); // Add the tab title
    } else {
        titles.push(...historyItems.map(item => item.title)); // Add history titles
    }
    const filteredTitles = titles.filter(Boolean);

    const results = [];

    for (const config of parsedConfigs) {
        let urlMatchCount = 0;
        let titleMatchCount = 0;

        for (const urlToCheck of filteredUrls) {
            const normalizedUrl = urlToCheck.toLowerCase();
            for (const keyword of config.keywordList) {
                if (isKeywordInText(normalizedUrl, keyword)) {
                    urlMatchCount++;
                    break; // Important: Only count each URL once per config
                }
            }
        }

        for (const titleToCheck of filteredTitles) {
            const normalizedTitle = titleToCheck?.toLowerCase() || '';
            for (const keyword of config.keywordList) {
                if (isKeywordInText(normalizedTitle, keyword)) {
                    titleMatchCount++;
                    // Don't break here; count all title matches
                }
            }
        }

        const urlMatchPercentage = filteredUrls.length > 0 ? Math.min(100, (urlMatchCount / filteredUrls.length) * 100) : 0; // Changed logic
        const titleMatchPercentage = filteredTitles.length > 0 ? Math.min(100, (titleMatchCount / (filteredTitles.length * config.keywordList.length)) * 100) : 0;


        console.log(`Match Percentage for ${config.name} - URLs: ${urlMatchPercentage}% (Match Count: ${urlMatchCount}, URLs Checked: ${filteredUrls.length}), Titles: ${titleMatchPercentage}% (Match Count: ${titleMatchCount}, Titles Checked: ${filteredTitles.length})`);

        results.push({
            name: config.name,
            downloadPath: config.downloadPath,
            urlMatchPercentage,
            urlMatchCount,
            titleMatchPercentage,
            titleMatchCount,
            matchPercentage: Math.max(urlMatchPercentage, titleMatchPercentage), //Max of URL and Title,
            contentMatchPercentage: 0 //Initialize content percentage here as well.
        });
    }

    return results;
}

function isKeywordInText(text, keyword) {
    if (text.includes(keyword)) { return true; }
    const variations = [
        keyword.replace(/\s+/g, '-'), keyword.replace(/\s+/g, '_'),
        keyword.replace(/\s+/g, '+'), keyword.replace(/\s+/g, '%20'),
        keyword.replace(/-/g, ' '), keyword.replace(/_/g, ' '),
        keyword.replace(/\+/g, ' ')
    ];
    for (const variation of variations) { if (text.includes(variation)) { return true; } }
    return false;
}

async function analyzePageContent(items, parsedConfigs) {
    const results = [];

    for (const config of parsedConfigs) {
        let totalContentMatches = 0;
        let matchingItemsCount = 0;

        for (const item of items) {
            let itemMatched = false; // Track if the item matched any keyword
            const content = item.content || ''; // Use empty string if content is not available
            const combinedText = (item.title || '') + ' ' + content; //Combine title and content
            const normalizedContent = combinedText.toLowerCase();

            for (const keyword of config.keywordList) {
                if (isKeywordInText(normalizedContent, keyword)) {
                    totalContentMatches++;
                    itemMatched = true; // Mark the item as matched
                }
            }
            if(itemMatched){
              matchingItemsCount++;
            }
        }
        // Calculate contentMatchPercentage based on *items* that matched, not total matches.
        const contentMatchPercentage = items.length > 0 ? Math.min(100, (matchingItemsCount / items.length) * 100) : 0;

        results.push({
            name: config.name,
            downloadPath: config.downloadPath,
            contentMatchPercentage,
            contentMatchCount: totalContentMatches, // Still track total matches for debugging
            matchPercentage: contentMatchPercentage, // Initialize overall match with content match
            urlMatchPercentage: 0,  // Ensure these are initialized
            titleMatchPercentage: 0,
            filenameMatchPercentage: 0
        });
    }
    return results;
}


function showDownloadPathNotification(downloadItem, options) {
    if (options.length > 0 && (options[0].matchPercentage >= MATCH_THRESHOLD)) {
        // No notification if a high match.
        processDownloadChoice(downloadItem.id, 0);
        return;
    }


    try {
        chrome.notifications.create({
            type: 'basic',
            iconUrl: 'icons/icon48.png',
            title: 'Choose Download Location',
            message: `Where would you like to save "${downloadItem.filename.split('/').pop()}"?`,
            buttons: [
                ...(options.length > 0 ? [{ title: `${options[0].name} (${Math.round(options[0].matchPercentage)}%)` }] : []), // Use overall matchPercentage in notification buttons
                ...(options.length > 1 ? [{ title: `${options[1].name} (${Math.round(options[1].matchPercentage)}%)` }] : []),
                { title: 'Use Default Folder' }
            ],
            requireInteraction: true
        }, (notificationId) => {
            if (chrome.runtime.lastError) {
                console.error("Error creating notification:", chrome.runtime.lastError.message);
                processDownloadChoice(downloadItem.id, null); // Fallback
                return;
            }
            downloadNotifications.set(notificationId, { downloadId: downloadItem.id, options });
            setTimeout(() => {
                try {
                    chrome.notifications.clear(notificationId, () => {
                        if (chrome.runtime.lastError) { console.log("Notification already closed:", chrome.runtime.lastError.message); }
                        const notificationInfo = downloadNotifications.get(notificationId);
                        if (notificationInfo) { processDownloadChoice(notificationInfo.downloadId, null); downloadNotifications.delete(notificationId); }
                    });
                } catch (error) { console.error("Error clearing notification:", error); }
            }, NOTIFICATION_TIMEOUT);
        });
    } catch (error) {
        console.error("Error showing notification:", error);
        processDownloadChoice(downloadItem.id, null); // Fallback to default
    }
}

async function processDownloadChoice(downloadId, chosenIndex) {
    const pendingDownload = pendingDownloads.get(downloadId);
    if (!pendingDownload) {
        console.log(`Pending download with ID ${downloadId} not found.`);
        return;
    }

    const { downloadItem, suggest } = pendingDownload;
    const matchResults = (await analyzeDownload(downloadItem, (await chrome.storage.sync.get('gameConfigs')).gameConfigs));
    pendingDownloads.delete(downloadId); // Moved up here

    if (chosenIndex === null || chosenIndex === undefined || !matchResults) {
        console.log(`ProcessDownloadChoice: Default location chosen.`);
        callSuggestSafely(downloadId, {});
    } else if (matchResults[chosenIndex]) {
        const chosen = matchResults[chosenIndex];
        console.log(`ProcessDownloadChoice: User chose option ${chosenIndex}: ${chosen.name}`);
        const suggestedFilename = getSuggestedFilename(downloadItem, chosen);
        callSuggestSafely(downloadId, { filename: suggestedFilename, conflictAction: 'uniquify' });
    } else {
        console.log(`ProcessDownloadChoice: Invalid chosenIndex ${chosenIndex} or matchResults missing.`);
        callSuggestSafely(downloadId, {});
    }
}

chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
    const notificationInfo = downloadNotifications.get(notificationId);
    if (!notificationInfo) { return; }

    // Handle button clicks: 0 and 1 are custom options, 2 is "Use Default"
    if (buttonIndex === 2) {
        processDownloadChoice(notificationInfo.downloadId, null); // Default
    } else {
        processDownloadChoice(notificationInfo.downloadId, buttonIndex); // Custom choice
    }

    try {
        chrome.notifications.clear(notificationId, () => {
            if (chrome.runtime.lastError) { console.log("Notification already closed:", chrome.runtime.lastError.message); }
            downloadNotifications.delete(notificationId); // Clean up
        });
    } catch (error) { console.error("Error clearing notification:", error); }
});

chrome.notifications.onClicked.addListener((notificationId) => {
    const notificationInfo = downloadNotifications.get(notificationId);
    if (!notificationInfo) { return; }
    processDownloadChoice(notificationInfo.downloadId, null); // Treat click as "Use Default"
    chrome.notifications.clear(notificationId, () => {
        if (chrome.runtime.lastError) { console.log("Notification already closed:", chrome.runtime.lastError.message); }
        downloadNotifications.delete(notificationId);
    });
});

chrome.notifications.onClosed.addListener((notificationId) => {
    const notificationInfo = downloadNotifications.get(notificationId);
    if (!notificationInfo) { return; }
    processDownloadChoice(notificationInfo.downloadId, null);
    downloadNotifications.delete(notificationId);
});