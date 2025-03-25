// background.js
const MATCH_THRESHOLD = 75;
const TITLE_MATCH_THRESHOLD = 60;
const CONTENT_MATCH_THRESHOLD = 50;
const MAX_HISTORY_ITEMS = 3;
const NOTIFICATION_TIMEOUT = 15000;
const MAX_CACHE_PER_TAB = 3; // Maximum number of pages to cache per tab

let pendingDownloads = new Map();
let downloadNotifications = new Map();
let suggestCallbacks = new Map();
let keywordCache = {}; // Store keyword analysis results

chrome.runtime.onInstalled.addListener(() => {
    console.log("Download Organizer Extension installed");
    // Initialize empty cache
    chrome.storage.local.set({ keywordCache: {} });
});

// Listen for keyword analysis results from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "keywordAnalysis") {
        console.log("Received keyword analysis from tab:", sender.tab ? sender.tab.id : "no tab");
        
        // Get the current cache
        chrome.storage.local.get('keywordCache', function(data) {
            let cache = data.keywordCache || {};
            const tabId = sender.tab ? String(sender.tab.id) : message.tabId;
            
            // Initialize cache for this tab if it doesn't exist
            if (!cache[tabId]) {
                cache[tabId] = [];
            }
            
            // Add new results to the cache
            cache[tabId].unshift({
                url: message.url,
                title: message.title,
                results: message.results,
                timestamp: Date.now()
            });
            
            // Keep only MAX_CACHE_PER_TAB entries per tab (FIFO)
            if (cache[tabId].length > MAX_CACHE_PER_TAB) {
                cache[tabId] = cache[tabId].slice(0, MAX_CACHE_PER_TAB);
            }
            
            // Clean up any tabs that haven't been accessed in 24 hours
            const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
            for (const [cachedTabId, entries] of Object.entries(cache)) {
                if (entries.length > 0 && entries[0].timestamp < oneDayAgo) {
                    delete cache[cachedTabId];
                }
            }
            
            // Save updated cache
            chrome.storage.local.set({ keywordCache: cache });
            console.log("Updated keyword cache for tab:", tabId);
        });
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
    if (bestMatch.filenameMatchPercentage >= MATCH_THRESHOLD || 
        bestMatch.urlMatchPercentage >= MATCH_THRESHOLD || 
        bestMatch.titleMatchPercentage >= TITLE_MATCH_THRESHOLD || 
        bestMatch.contentMatchPercentage >= CONTENT_MATCH_THRESHOLD) {
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
    let tabCacheData = [];
    
    if (downloadItem.initiator) {
        try {
            tabInfo = await getTabInfo(downloadItem.initiator);
            console.log("Tab Info:", tabInfo);
            
            // Get cached data for this tab
            if (tabInfo && tabInfo.id) {
                const cache = await chrome.storage.local.get('keywordCache');
                tabCacheData = (cache.keywordCache && cache.keywordCache[String(tabInfo.id)]) || [];
                console.log(`Found ${tabCacheData.length} cached entries for tab ${tabInfo.id}`);
            }
        } catch (error) {
            console.error("Error getting tab info:", error);
            // We'll handle fallback logic below
        }
    }

    // --- 3. If no tab cache data, try to find relevant cache data ---
    if (tabCacheData.length === 0) {
        try {
            const cache = await chrome.storage.local.get('keywordCache');
            // Collect all cached entries from all tabs
            const allTabData = [];
            if (cache.keywordCache) {
                Object.values(cache.keywordCache).forEach(tabEntries => {
                    tabEntries.forEach(entry => {
                        allTabData.push(entry);
                    });
                });
                
                // Sort by timestamp (newest first) and take the most recent MAX_HISTORY_ITEMS
                allTabData.sort((a, b) => b.timestamp - a.timestamp);
                tabCacheData = allTabData.slice(0, MAX_HISTORY_ITEMS);
                console.log(`Using ${tabCacheData.length} most recent entries from all tabs`);
            }
        } catch (error) {
            console.error("Error accessing keyword cache:", error);
        }
    }

    // --- 4. Analyze URLs and Titles from tab cache ---
    // Only fall back to browser history if we have no tab cache data
    let historyItems = [];
    if (tabCacheData.length === 0 && !tabInfo) {
        historyItems = await getRecentHistory(MAX_HISTORY_ITEMS);
        console.log("Using browser history items:", historyItems);
    }
    
    // Use tab cache data for URL and title analysis if available
    const urlResults = await analyzeUrls(
        downloadItem.url, 
        downloadItem.referrer, 
        tabInfo, 
        historyItems,
        tabCacheData,
        parsedConfigs
    );
    
    // --- 5. Analyze Cached Keyword Data ---
    const contentResults = analyzeKeywordData(tabCacheData, parsedConfigs);
    
    // --- 6. Combine Results ---
    let combinedResults = combineResults(filenameResults, urlResults);
    combinedResults = combineResults(combinedResults, contentResults);

    combinedResults.sort((a, b) => b.matchPercentage - a.matchPercentage);
    return combinedResults;
}

function analyzeFilename(filename, parsedConfigs) {
    const normalizedFilename = filename.toLowerCase();
    const results = [];
    for (const config of parsedConfigs) {
        let matchCount = 0;
        for (const keyword of config.keywordList) {
            if (normalizedFilename.includes(keyword)) {
                console.debug(`Match found: Keyword "${keyword}" found in filename: ${filename} (direct match)`);
                matchCount++;
            }
        }
        const filenameMatchPercentage = config.keywordList.length > 0 ? Math.min(100, (matchCount / config.keywordList.length) * 100) : 0;
        results.push({
            name: config.name,
            downloadPath: config.downloadPath,
            filenameMatchPercentage,
            matchPercentage: filenameMatchPercentage,
            urlMatchPercentage: 0,
            titleMatchPercentage: 0,
            contentMatchPercentage: 0
        });
    }
    return results;
}

// New function to analyze cached keyword data
function analyzeKeywordData(keywordData, parsedConfigs) {
    const results = [];
    const totalMatchesPerConfig = {};
    const zeroMatchCounts = {}; // Track how many pages have zero matches for each config

    // Initialize data structures
    for (const config of parsedConfigs) {
        totalMatchesPerConfig[config.name] = 0;
        zeroMatchCounts[config.name] = 0;
    }

    // 1. Aggregate Total Matches and Count Zero Matches
    for (const page of keywordData) {
        for (const config of parsedConfigs) {
            const configResult = page.results[config.name];
            if (configResult) {
                totalMatchesPerConfig[config.name] += configResult.totalMatches;
                if (configResult.totalMatches === 0) {
                    zeroMatchCounts[config.name]++;
                }
            } else {
                // If configResult is undefined (config not found on this page), count as a zero match
                zeroMatchCounts[config.name]++;
            }
        }
    }

    // 2. Calculate Grand Total
    let grandTotalMatches = 0;
    for (const configName in totalMatchesPerConfig) {
        grandTotalMatches += totalMatchesPerConfig[configName];
    }

    // 3. Calculate and Apply Penalty
    for (const config of parsedConfigs) {
        const configTotalMatches = totalMatchesPerConfig[config.name];
        let contentMatchPercentage = grandTotalMatches > 0
            ? (configTotalMatches / grandTotalMatches) * 100
            : 0;

        // Apply the penalty for zero matches
        const penaltyFactor = Math.pow(1.5, zeroMatchCounts[config.name]);
        contentMatchPercentage /= penaltyFactor;


        results.push({
            name: config.name,
            downloadPath: config.downloadPath,
            contentMatchPercentage,
            contentMatchCount: configTotalMatches,
            matchPercentage: contentMatchPercentage,
            urlMatchPercentage: 0,
            titleMatchPercentage: 0,
            filenameMatchPercentage: 0,
            zeroMatchPages: zeroMatchCounts[config.name] // For debugging/info
        });
    }

    return results;
}

function combineResults(filenameResults, otherResults) {
    const combined = [...filenameResults]; // Start with filename results

    // Merge other results, updating matchPercentage if necessary
    for (const otherResult of otherResults) {
        const existing = combined.find(r => r.name === otherResult.name);
        if (existing) {
            // Update percentages and take the max for each metric
            existing.urlMatchPercentage = Math.max(existing.urlMatchPercentage, otherResult.urlMatchPercentage || 0);
            existing.titleMatchPercentage = Math.max(existing.titleMatchPercentage, otherResult.titleMatchPercentage || 0);
            existing.contentMatchPercentage = Math.max(existing.contentMatchPercentage, otherResult.contentMatchPercentage || 0);
            existing.matchPercentage = Math.max(
                existing.filenameMatchPercentage,
                existing.urlMatchPercentage,
                existing.titleMatchPercentage,
                existing.contentMatchPercentage
            );
        } else {
            combined.push(otherResult);
        }
    }
    return combined;
}

async function getTabInfo(initiator) {
    return new Promise((resolve, reject) => {
        // Try to find the tab based on the initiator URL
        chrome.tabs.query({}, (tabs) => {
            const matchedTab = tabs.find(tab => tab.url && initiator && tab.url.startsWith(initiator.split('?')[0]));

            if (!matchedTab) {
                reject(new Error("No matching tab found."));
                return;
            }

            // Get the title
            chrome.scripting.executeScript({
                target: { tabId: matchedTab.id },
                func: () => document.title,
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
            if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError);
            } else {
                // Send initiator information to content script
                chrome.tabs.sendMessage(tabId, { action: "setInitiator", initiator: initiator }).catch(err => {
                    console.warn("Tab might have closed before message could be sent:", err);
                });
                resolve();
            }
        });
    });
}

async function getRecentHistory(count) {
    return new Promise((resolve) => {
        chrome.history.search({
            text: '',
            maxResults: count * 3,
            startTime: Date.now() - (7 * 24 * 60 * 60 * 1000) // Last 7 days
        }, (historyItems) => {
            const filteredItems = historyItems
                .filter(item => !item.url.startsWith('chrome://') &&
                    !item.url.startsWith('edge://') &&
                    !item.url.startsWith('about:') &&
                    item.url !== 'about:blank')
                .slice(0, count);

            // Add tab ID for content analysis lookup
            const itemsWithIds = filteredItems.map(item => ({ ...item, id: `history-${String(item.visitId)}` }));
            resolve(itemsWithIds);
        });
    });
}

async function analyzeUrls(url, referrer, tabInfo, historyItems, tabCacheData, parsedConfigs) {
    // Start with base URLs
    const urls = [url, referrer];
    
    // Add tab URL if available
    if (tabInfo) {
        urls.push(tabInfo.url);
    }
    
    // Add URLs from tab cache data
    if (tabCacheData && tabCacheData.length > 0) {
        tabCacheData.forEach(cacheItem => {
            if (cacheItem.url) {
                urls.push(cacheItem.url);
            }
        });
    } 
    // Only fallback to history items if we don't have any tab cache data
    else if (historyItems && historyItems.length > 0) {
        urls.push(...historyItems.slice(0, MAX_HISTORY_ITEMS).map(item => item.url));
    }
    
    // Filter out empty values and limit to MAX_HISTORY_ITEMS
    const filteredUrls = urls.filter(Boolean).slice(0, MAX_HISTORY_ITEMS);
    
    // Initialize titles array
    const titles = [];
    
    // Add tab title if available
    if (tabInfo) {
        titles.push(tabInfo.title);
    }
    
    // Add titles from tab cache data
    if (tabCacheData && tabCacheData.length > 0) {
        tabCacheData.forEach(cacheItem => {
            if (cacheItem.title) {
                titles.push(cacheItem.title);
            }
        });
    } 
    // Only fallback to history items if we don't have any tab cache data
    else if (historyItems && historyItems.length > 0) {
        titles.push(...historyItems.slice(0, MAX_HISTORY_ITEMS).map(item => item.title));
    }
    
    // Filter out empty values and limit to MAX_HISTORY_ITEMS
    const filteredTitles = titles.filter(Boolean).slice(0, MAX_HISTORY_ITEMS);
    
    console.log("Analyzing URLs:", filteredUrls);
    console.log("Analyzing titles:", filteredTitles);
    
    const results = [];
    for (const config of parsedConfigs) {
        let urlMatchCount = 0;
        let titleMatchCount = 0;
        for (const urlToCheck of filteredUrls) {
            const normalizedUrl = urlToCheck.toLowerCase();
            for (const keyword of config.keywordList) {
                if (normalizedUrl.includes(keyword)) {
                    console.debug(`Match found: Keyword "${keyword}" found in url: ${urlToCheck} (direct match)`);
                    urlMatchCount++;
                    break; // Only count each URL once per config
                }
            }
        }
        for (const titleToCheck of filteredTitles) {
            const normalizedTitle = titleToCheck.toLowerCase();
            for (const keyword of config.keywordList) {
                if (normalizedTitle.includes(keyword)) {
                    console.debug(`Match found: Keyword "${keyword}" found in title: ${titleToCheck} (direct match)`);
                    titleMatchCount++;
                    // Count all title matches per keyword
                }
            }
        }
        const urlMatchPercentage = filteredUrls.length > 0 ? Math.min(100, (urlMatchCount / filteredUrls.length) * 100) : 0;
        const titleMatchPercentage = filteredTitles.length > 0 ? Math.min(100, (titleMatchCount / (filteredTitles.length * config.keywordList.length)) * 100) : 0;
        
        results.push({
            name: config.name,
            downloadPath: config.downloadPath,
            urlMatchPercentage,
            urlMatchCount,
            titleMatchPercentage,
            titleMatchCount,
            matchPercentage: Math.max(urlMatchPercentage, titleMatchPercentage),
            contentMatchPercentage: 0
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
                ...(options.length > 0 ? [{ title: `${options[0].name} (${Math.round(options[0].matchPercentage)}%)` }] : []),
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
                        if (notificationInfo) { 
                            processDownloadChoice(notificationInfo.downloadId, null); 
                            downloadNotifications.delete(notificationId); 
                        }
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

    const { downloadItem } = pendingDownload;
    const { gameConfigs } = await chrome.storage.sync.get('gameConfigs');
    const matchResults = await analyzeDownload(downloadItem, gameConfigs);
    pendingDownloads.delete(downloadId);

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

// Inject the content script into tabs when they are updated
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url && 
        !tab.url.startsWith('chrome://') && 
        !tab.url.startsWith('edge://') && 
        !tab.url.startsWith('about:') && 
        tab.url !== 'about:blank') {
        
        chrome.scripting.executeScript({
            target: { tabId: tabId },
            files: ['content-script.js']
        }).catch(error => {
            console.warn(`Could not inject content script into tab ${tabId}:`, error);
        });
    }
});

// Remove cache from tab when it's closed
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
    chrome.storage.local.get('keywordCache', (data) => {
        let cache = data.keywordCache || {};
        if (cache[String(tabId)]) {
            delete cache[String(tabId)];
            chrome.storage.local.set({ keywordCache: cache }, () => {
                console.log("Cleaned cache for tab:", tabId);
            });
        }
    });
});

// Clean all cache when the extension is terminated (when the browser is closed)
chrome.runtime.onSuspend.addListener(() => {
    chrome.storage.local.remove('keywordCache', () => {
        console.log("Cleaned.");
    });
});