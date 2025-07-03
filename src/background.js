// background.js
const MATCH_THRESHOLD = 75;
const TITLE_MATCH_THRESHOLD = 60;
const CONTENT_MATCH_THRESHOLD = 69;
const MAX_HISTORY_ITEMS = 3;
const NOTIFICATION_TIMEOUT = 15000;
const MAX_CACHE_PER_TAB = 3; // Maximum number of pages to cache per tab
const tabRelationships = new Map();

let pendingDownloads = new Map();
let downloadNotifications = new Map();
let suggestCallbacks = new Map();
let keywordCache = {}; // Store keyword analysis results

// =================================================================
// START: LLM Integration Code
// =================================================================

/**
 * Creates the system and user prompts for the LLM based on the download context.
 * This function is provided by the user.
 */
function createLLMMessages(downloadItem, context, enabledConfigs) {
    const systemPrompt = `1. If file is between two conflicting rules: {RULE_NAME_A || RULE_NAME_B}
2. If file does not apply any rule AND has a possibility of matching one rule: {NULL || RULE_NAME_A}
3. If confident about a specific rule that matches criteria: {RULE_NAME_A}
4. If it clearly does not match any rule, use not found rule: {NULL}`;

    const rulesDescription = enabledConfigs.length > 0
        ? enabledConfigs.map(config => {
            const keywords = config.keywords.split(',').map(k => k.trim()).filter(Boolean);
            return `Name: ['${config.name}']:\n- Looks for: [${keywords.join(', ')}]`;
        }).join('\n')
        : "No routing rules provided.";

    const userPrompt = `You are an expert file organizer. Your task is to analyze the following download and decide where it should be saved based on a set of rules that must match the File purpose.

[File]
Downloaded Filename: "${downloadItem.filename}"
Download Origin URLs: ${JSON.stringify(context.urls)}
Download Origin Page Titles: ${JSON.stringify(context.titles)}

[Routing rules]
${rulesDescription}

Questioning possibility: Does the file content really matches the content/purpose of a rule name?

[Your Task]
Based on all the given information above about the download context and routing rules purpose, make a decision. Your response only MUST be in one of the following decision, without any placeholder text:`;

    return { systemPrompt, userPrompt };
}

/**
 * Placeholder function for making an API call to an LLM.
 * @param {string} systemPrompt The system prompt for the LLM.
 * @param {string} userPrompt The user prompt for the LLM.
 * @returns {Promise<string>} The raw text response from the LLM.
 */
async function getLLMDecision(systemPrompt, userPrompt) {
    // 1. Read the API Key, Endpoint, AND the Model name from storage.
    const { llmApiKey, llmModelEndpoint, llmModel } = await chrome.storage.sync.get([
        'llmApiKey', 
        'llmModelEndpoint', 
        'llmModel'
    ]);

    if (!llmApiKey) {
        throw new Error("LLM API Key is not set.");
    }
    if (!llmModelEndpoint) {
        throw new Error("LLM Model Endpoint URL is not set.");
    }
    // 2. Add a check to ensure the model name is not empty.
    if (!llmModel) {
        throw new Error("LLM Model name is not set in options.");
    }

    console.log(`Querying LLM at: ${llmModelEndpoint} with model: ${llmModel}`);

    // This is a generic fetch example.
    const response = await fetch(llmModelEndpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${llmApiKey}`
        },
        body: JSON.stringify({
            model: llmModel,

            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt }
            ],
            temperature: 0.1,
        })
    });

    if (!response.ok) {
        const errorBody = await response.text();
        // Log the detailed error from the API for easier debugging.
        console.error("LLM API Error Body:", errorBody);
        throw new Error(`LLM API request failed with status ${response.status}`);
    }

    const data = await response.json();
    
    // The path to the response text depends on the API.
    // For OpenAI/Groq: data.choices[0].message.content
    // For Gemini: data.candidates[0].content.parts[0].text
    // This logic remains robust.
    const llmResponse = data.candidates?.[0]?.content?.parts?.[0]?.text || data.choices?.[0]?.message?.content;
    
    if (!llmResponse) {
        console.error("LLM response format not recognized:", data);
        throw new Error("Could not extract text from LLM response.");
    }
    
    console.log("LLM Raw Response:", llmResponse);
    return llmResponse;
}

/**
 * Parses the LLM's string response to extract the decision.
 * e.g., "{RULE_A || RULE_B}" -> ["RULE_A", "RULE_B"]
 * e.g., "{NULL}" -> ["NULL"]
 * @param {string} responseText The raw response from the LLM.
 * @returns {string[] | null} An array of rule names or NULL, or null if parsing fails.
 */
function parseLLMResponse(responseText) {
    const match = responseText.match(/{([^}]+)}/);
    if (match && match[1]) {
        // Split the content inside the curly braces by the separator
        const parts = match[1].split('||');
        
        // Map over each part to clean it up
        const cleanedParts = parts.map(part => {
            // 1. Trim whitespace from both ends (e.g., "  'My Rule'  " -> "'My Rule'")
            const trimmed = part.trim();
            
            // 2. Remove leading/trailing single or double quotes using a regular expression
            // (e.g., "'My Rule'" -> "My Rule")
            const unquoted = trimmed.replace(/^['"]|['"]$/g, '');
            
            return unquoted;
        });
        
        console.log("Parsed and cleaned LLM decision:", cleanedParts); // Added for better debugging
        return cleanedParts;
    }
    console.warn("Could not parse LLM response:", responseText);
    return null; // Return null if format is incorrect
}

/**
 * Gathers all relevant context (URLs, titles) for a download.
 * Reuses logic from the original `analyzeDownload` and `analyzeUrls` functions.
 * @param {chrome.downloads.DownloadItem} downloadItem
 * @returns {Promise<{urls: string[], titles: string[]}>}
 */
async function gatherDownloadContext(downloadItem) {
    let tabInfo = null;
    let tabCacheData = [];

    // 1. Try to find originating tab
    if (downloadItem.initiator) {
        try {
            tabInfo = await getTabInfo(downloadItem.initiator);
        } catch (error) { /* Ignore error, proceed without tabInfo */ }
    }

    // 2. If no originating tab found, use active tab
    if (!tabInfo) {
        const tabs = await new Promise(resolve => chrome.tabs.query({ active: true, lastFocusedWindow: true }, resolve));
        if (tabs.length > 0) {
            tabInfo = { id: tabs[0].id, url: tabs[0].url, title: tabs[0].title };
        }
    }

    // 3. Get cache data for current tab and parent tab
    if (tabInfo?.id) {
        const cache = await chrome.storage.local.get('keywordCache');
        const keywordCache = cache.keywordCache || {};
        tabCacheData = keywordCache[String(tabInfo.id)] || [];

        if (tabCacheData.length < MAX_CACHE_PER_TAB && tabRelationships.has(tabInfo.id)) {
            const parentTabId = tabRelationships.get(tabInfo.id);
            const parentTabData = keywordCache[String(parentTabId)] || [];
            if (parentTabData.length > 0) {
                tabCacheData = [...tabCacheData, ...parentTabData]
                    .sort((a, b) => b.timestamp - a.timestamp)
                    .slice(0, MAX_CACHE_PER_TAB);
            }
        }
    }
    
    // 4. Consolidate URLs and Titles
    const urls = [downloadItem.url, downloadItem.referrer];
    const titles = [];

    if (tabInfo) {
        urls.push(tabInfo.url);
        titles.push(tabInfo.title);
    }

    if (tabCacheData?.length > 0) {
        tabCacheData.forEach(cacheItem => {
            if (cacheItem.url) urls.push(cacheItem.url);
            if (cacheItem.title) titles.push(cacheItem.title);
        });
    }

    const uniqueUrls = [...new Set(urls.filter(Boolean))];
    const uniqueTitles = [...new Set(titles.filter(Boolean))];

    return { urls: uniqueUrls, titles: uniqueTitles };
}

/**
 * Acts on the parsed decision from the LLM.
 * @param {string[]} decision - Array of rule names or "NULL".
 * @param {chrome.downloads.DownloadItem} downloadItem
 * @param {Array<Object>} enabledConfigs - The user's rule configurations.
 */
async function handleLLMDecision(decision, downloadItem, enabledConfigs) {
    if (!decision || decision.length === 0) {
        console.log("LLM decision was invalid or empty. Using default location.");
        callSuggestSafely(downloadItem.id, {});
        return;
    }

    // Case 1: Confident, single decision (or clear "no match")
    if (decision.length === 1) {
        const ruleName = decision[0];
        if (ruleName === 'NULL') {
            console.log("LLM Decision: No rule applies. Using default location.");
            callSuggestSafely(downloadItem.id, {});
            return;
        }

        const matchedConfig = enabledConfigs.find(c => c.name === ruleName);
        if (matchedConfig) {
            console.log(`LLM Decision: Confident match for "${ruleName}".`);
            const suggestedFilename = getSuggestedFilename(downloadItem, matchedConfig);
            callSuggestSafely(downloadItem.id, { filename: suggestedFilename, conflictAction: 'uniquify' });
        } else {
            console.warn(`LLM returned rule "${ruleName}" but it was not found in configs. Using default.`);
            callSuggestSafely(downloadItem.id, {});
        }
        return;
    }
    
    // Case 2: Ambiguous decision, show notification
    console.log(`LLM Decision: Ambiguous, options are [${decision.join(', ')}]. Showing notification.`);
    const notificationOptions = [];
    
    // Map rule names from LLM decision to full config objects
    decision.forEach(ruleName => {
        if (ruleName === 'NULL') {
            // This will be handled by the default button
            return; 
        }
        const config = enabledConfigs.find(c => c.name === ruleName);
        if (config) {
            // Create a mock match object for the notification system
            notificationOptions.push({
                name: config.name,
                downloadPath: config.downloadPath,
                matchPercentage: 99, // Use a high dummy value to show confidence
                isLLMChoice: true
            });
        }
    });

    if (notificationOptions.length > 0) {
        // Limit to 2 choices for the notification buttons
        showDownloadPathNotification(downloadItem, notificationOptions.slice(0, 2));
    } else {
        // This can happen if the decision was e.g. ["NULL", "NON_EXISTENT_RULE"]
        console.log("LLM provided ambiguous options but none were valid. Using default location.");
        callSuggestSafely(downloadItem.id, {});
    }
}

// =================================================================
// END: LLM Integration Code
// =================================================================


chrome.runtime.onInstalled.addListener(() => {
    console.log("Download Organizer Extension installed");
    chrome.storage.local.set({ keywordCache: {} });
});

chrome.tabs.onCreated.addListener((tab) => {
    if (tab.openerTabId) {
        tabRelationships.set(tab.id, tab.openerTabId);
        console.log(`Tab ${tab.id} opened from tab ${tab.openerTabId}`);
    }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "keywordAnalysis") {
        console.log("Received keyword analysis from tab:", sender.tab ? sender.tab.id : "no tab");
        chrome.storage.local.get('keywordCache', function(data) {
            let cache = data.keywordCache || {};
            const tabId = sender.tab ? String(sender.tab.id) : message.tabId;
            if (!cache[tabId]) {
                cache[tabId] = [];
            }
            cache[tabId].unshift({
                url: message.url,
                title: message.title,
                results: message.results,
                timestamp: Date.now()
            });
            if (cache[tabId].length > MAX_CACHE_PER_TAB) {
                cache[tabId] = cache[tabId].slice(0, MAX_CACHE_PER_TAB);
            }
            const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
            for (const [cachedTabId, entries] of Object.entries(cache)) {
                if (entries.length > 0 && entries[0].timestamp < oneDayAgo) {
                    delete cache[cachedTabId];
                }
            }
            chrome.storage.local.set({ keywordCache: cache });
            console.log("Updated keyword cache for tab:", tabId);
        });
    }
});


// MODIFIED onDeterminingFilename to call the new processDownload orchestrator
chrome.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => {
    console.log("Download started:", downloadItem.filename, downloadItem.url);

    pendingDownloads.set(downloadItem.id, { downloadItem, suggest });
    suggestCallbacks.set(downloadItem.id, suggest);

    // This calls the main orchestrator function
    processDownload(downloadItem).catch(error => {
        console.error("Error processing download:", error);
        // Ensure suggest is always called on error
        callSuggestSafely(downloadItem.id, {});
    });

    return true; // Keep the download in a pending state
});

/**
 * Main orchestrator for processing a download.
 * Decides whether to use the LLM or the original logic.
 */
async function processDownload(downloadItem) {
    const { gameConfigs, useLLM, llmApiKey, llmModelEndpoint } = await chrome.storage.sync.get([
        'gameConfigs', 
        'useLLM', 
        'llmApiKey',
        'llmModelEndpoint'
    ]);
    
    const enabledConfigs = gameConfigs?.filter(c => c.enabled) || [];

    if (!enabledConfigs || enabledConfigs.length === 0) {
        console.log("No enabled routing rules. Using default download location.");
        callSuggestSafely(downloadItem.id, {});
        return;
    }

    // --- LLM PATH ---
    if (useLLM && llmApiKey && llmModelEndpoint) {
        console.log("Using LLM for decision...");
        try {
            const context = await gatherDownloadContext(downloadItem);
            const { systemPrompt, userPrompt } = createLLMMessages(downloadItem, context, enabledConfigs);
            const llmRawResponse = await getLLMDecision(systemPrompt, userPrompt);
            const decision = parseLLMResponse(llmRawResponse);
            await handleLLMDecision(decision, downloadItem, enabledConfigs);
        } catch (error) {
            console.error("LLM decision process failed. Falling back to original logic.", error);
            await processDownloadOriginalLogic(downloadItem, gameConfigs);
        }
    } 
    // --- ORIGINAL LOGIC PATH ---
    else {
        if (useLLM) {
            console.log("LLM is enabled, but API Key or Endpoint is missing. Falling back to original logic.");
        }
        console.log("Using original percentage-based logic for decision...");
        await processDownloadOriginalLogic(downloadItem, gameConfigs);
    }
}

/**
 * Encapsulates the original, percentage-based matching logic.
 */
async function processDownloadOriginalLogic(downloadItem, gameConfigs) {
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
    })).filter(c => c.enabled); // Ensure we only analyze enabled configs

    const filenameResults = analyzeFilename(downloadItem.filename, parsedConfigs);
    const highFilenameMatch = filenameResults.find(r => r.filenameMatchPercentage >= MATCH_THRESHOLD);
    if (highFilenameMatch) {
        return filenameResults.sort((a, b) => b.filenameMatchPercentage - a.filenameMatchPercentage);
    }

    let tabInfo = null;
    let tabCacheData = [];
    
    if (downloadItem.initiator) {
        try {
            tabInfo = await getTabInfo(downloadItem.initiator);
            console.log("Found originating tab:", tabInfo);
        } catch (error) {
            console.error("Error getting tab info:", error);
        }
    }

    if (!tabInfo) {
        const tabs = await new Promise(resolve => chrome.tabs.query({ active: true, lastFocusedWindow: true }, resolve));
        if (tabs.length > 0) {
            tabInfo = { id: tabs[0].id, url: tabs[0].url, title: tabs[0].title };
            console.log("Using active tab as fallback:", tabInfo);
        }
    }

    if (tabInfo?.id) {
        const cache = await chrome.storage.local.get('keywordCache');
        tabCacheData = (cache.keywordCache && cache.keywordCache[String(tabInfo.id)]) || [];
        console.log(`Found ${tabCacheData.length} cached entries for tab ${tabInfo.id}`);

        if (tabCacheData.length < MAX_CACHE_PER_TAB && tabRelationships.has(tabInfo.id)) {
            const parentTabId = tabRelationships.get(tabInfo.id);
            const parentTabData = (cache.keywordCache && cache.keywordCache[String(parentTabId)]) || [];
            
            if (parentTabData.length > 0) {
                console.log(`Adding ${parentTabData.length} entries from parent tab ${parentTabId}`);
                tabCacheData = [...tabCacheData, ...parentTabData]
                    .sort((a, b) => b.timestamp - a.timestamp)
                    .slice(0, MAX_CACHE_PER_TAB);
            }
        }
    }

    const urlResults = await analyzeUrls(
        downloadItem.url, 
        downloadItem.referrer, 
        tabInfo, 
        [], 
        tabCacheData,
        parsedConfigs
    );
    
    const contentResults = analyzeKeywordData(tabCacheData, parsedConfigs);
    
    let combinedResults = combineResults(filenameResults, urlResults);
    combinedResults = combineResults(combinedResults, contentResults);

    return combinedResults.sort((a, b) => b.matchPercentage - a.matchPercentage);
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

function analyzeKeywordData(keywordData, parsedConfigs) {
    const results = [];
    const totalMatchesPerConfig = {};
    const zeroMatchCounts = {}; 

    for (const config of parsedConfigs) {
        totalMatchesPerConfig[config.name] = 0;
        zeroMatchCounts[config.name] = 0;
    }

    for (const page of keywordData) {
        for (const config of parsedConfigs) {
            const configResult = page.results[config.name];
            if (configResult) {
                totalMatchesPerConfig[config.name] += configResult.totalMatches;
                if (configResult.totalMatches === 0) {
                    zeroMatchCounts[config.name]++;
                }
            } else {
                zeroMatchCounts[config.name]++;
            }
        }
    }

    let grandTotalMatches = 0;
    for (const configName in totalMatchesPerConfig) {
        grandTotalMatches += totalMatchesPerConfig[configName];
    }

    for (const config of parsedConfigs) {
        const configTotalMatches = totalMatchesPerConfig[config.name];
        let contentMatchPercentage = grandTotalMatches > 0
            ? (configTotalMatches / grandTotalMatches) * 100
            : 0;

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
            zeroMatchPages: zeroMatchCounts[config.name]
        });
    }

    return results;
}

function combineResults(filenameResults, otherResults) {
    const combined = [...filenameResults]; 

    for (const otherResult of otherResults) {
        const existing = combined.find(r => r.name === otherResult.name);
        if (existing) {
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
        chrome.tabs.query({}, (tabs) => {
            const matchedTab = tabs.find(tab => tab.url && initiator && tab.url.startsWith(initiator.split('?')[0]));

            if (!matchedTab) {
                reject(new Error("No matching tab found."));
                return;
            }

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
}async function analyzeUrls(url, referrer, tabInfo, historyItems, tabCacheData, parsedConfigs) {
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
    try {
        const buttons = [
            ...(options.length > 0 ? [{ title: `${options[0].name} (${Math.round(options[0].matchPercentage)}%)` }] : []),
            ...(options.length > 1 ? [{ title: `${options[1].name} (${Math.round(options[1].matchPercentage)}%)` }] : []),
            { title: 'Use Default Folder' }
        ];

        chrome.notifications.create({
            type: 'basic',
            iconUrl: 'icons/icon48.png',
            title: 'Choose Download Location',
            message: `Where would you like to save "${downloadItem.filename.split('/').pop()}"?`,
            buttons: buttons,
            requireInteraction: true
        }, (notificationId) => {
            if (chrome.runtime.lastError) {
                console.error("Error creating notification:", chrome.runtime.lastError.message);
                processDownloadChoice(downloadItem.id, null, options);
                return;
            }
            downloadNotifications.set(notificationId, { downloadId: downloadItem.id, options });
            
            setTimeout(() => {
                chrome.notifications.clear(notificationId, (wasCleared) => {
                    if (chrome.runtime.lastError) { return; }
                    if (wasCleared) {
                        const notificationInfo = downloadNotifications.get(notificationId);
                        if (notificationInfo) {
                            console.log("Notification timed out. Using default location.");
                            processDownloadChoice(notificationInfo.downloadId, null, notificationInfo.options);
                            downloadNotifications.delete(notificationId);
                        }
                    }
                });
            }, NOTIFICATION_TIMEOUT);
        });
    } catch (error) {
        console.error("Error showing notification:", error);
        processDownloadChoice(downloadItem.id, null, options);
    }
}

async function processDownloadChoice(downloadId, chosenIndex, options) {
    const pendingDownload = pendingDownloads.get(downloadId);
    if (!pendingDownload) {
        console.log(`Pending download with ID ${downloadId} not found.`);
        return;
    }

    pendingDownloads.delete(downloadId);
    const { downloadItem } = pendingDownload;

    if (chosenIndex === null || chosenIndex === undefined || !options) {
        console.log(`ProcessDownloadChoice: Default location chosen.`);
        callSuggestSafely(downloadId, {});
    } else if (options[chosenIndex]) {
        const chosen = options[chosenIndex];
        console.log(`ProcessDownloadChoice: User chose option ${chosenIndex}: ${chosen.name}`);
        const suggestedFilename = getSuggestedFilename(downloadItem, chosen);
        callSuggestSafely(downloadId, { filename: suggestedFilename, conflictAction: 'uniquify' });
    } else {
        console.log(`ProcessDownloadChoice: Invalid chosenIndex ${chosenIndex} or options missing.`);
        callSuggestSafely(downloadId, {});
    }
}

chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
    const notificationInfo = downloadNotifications.get(notificationId);
    if (!notificationInfo) { return; }
    
    const isDefaultButton = buttonIndex >= notificationInfo.options.slice(0, 2).length;
    if (isDefaultButton) {
        processDownloadChoice(notificationInfo.downloadId, null, notificationInfo.options);
    } else {
        processDownloadChoice(notificationInfo.downloadId, buttonIndex, notificationInfo.options);
    }

    chrome.notifications.clear(notificationId, () => {
        if (chrome.runtime.lastError) { /* ignore */ }
        downloadNotifications.delete(notificationId);
    });
});

chrome.notifications.onClicked.addListener((notificationId) => {
    const notificationInfo = downloadNotifications.get(notificationId);
    if (!notificationInfo) { return; }
    processDownloadChoice(notificationInfo.downloadId, null, notificationInfo.options);
    chrome.notifications.clear(notificationId, () => {
        if (chrome.runtime.lastError) { /* ignore */ }
        downloadNotifications.delete(notificationId);
    });
});

chrome.notifications.onClosed.addListener((notificationId, byUser) => {
    if (!byUser) return; 
    const notificationInfo = downloadNotifications.get(notificationId);
    if (!notificationInfo) { return; }
    processDownloadChoice(notificationInfo.downloadId, null, notificationInfo.options);
    downloadNotifications.delete(notificationId);
});

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

chrome.runtime.onSuspend.addListener(() => {
    chrome.storage.local.remove('keywordCache', () => {
        console.log("Cleaned.");
    });
});