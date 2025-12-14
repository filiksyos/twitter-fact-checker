// Cache for checked tweets - persistent storage
let tweetCache = new Map();
const CACHE_KEY = 'twitter_factcheck_cache';
const CACHE_EXPIRY_DAYS = 7; // Cache for 7 days

// Rate limiting
const requestQueue = [];
let isProcessingQueue = false;
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 3000; // 3 seconds between requests
let activeRequests = 0;
const MAX_CONCURRENT_REQUESTS = 1; // Process one at a time for accuracy

// Observer for dynamically loaded content
let observer = null;

// Extension enabled state
let extensionEnabled = true;
const TOGGLE_KEY = 'extension_enabled';
const DEFAULT_ENABLED = true;

// Track tweets currently being processed
const processingTweets = new Set();

// Backend URL
const BACKEND_URL = 'http://localhost:3000';

// Load enabled state
async function loadEnabledState() {
  try {
    const result = await chrome.storage.local.get([TOGGLE_KEY]);
    extensionEnabled = result[TOGGLE_KEY] !== undefined ? result[TOGGLE_KEY] : DEFAULT_ENABLED;
    console.log('[FactCheck] Extension enabled:', extensionEnabled);
  } catch (error) {
    console.error('[FactCheck] Error loading enabled state:', error);
    extensionEnabled = DEFAULT_ENABLED;
  }
}

// Listen for toggle changes from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'extensionToggle') {
    extensionEnabled = request.enabled;
    console.log('[FactCheck] Extension toggled:', extensionEnabled);
    
    if (extensionEnabled) {
      setTimeout(() => {
        processTweets();
      }, 500);
    } else {
      removeAllMarkups();
    }
  }
});

// Load cache from persistent storage
async function loadCache() {
  try {
    if (!chrome.runtime?.id) {
      console.log('[FactCheck] Extension context invalidated, skipping cache load');
      return;
    }
    
    const result = await chrome.storage.local.get(CACHE_KEY);
    if (result[CACHE_KEY]) {
      const cached = result[CACHE_KEY];
      const now = Date.now();
      
      for (const [tweetId, data] of Object.entries(cached)) {
        if (data.expiry && data.expiry > now) {
          tweetCache.set(tweetId, data.result);
        }
      }
      console.log(`[FactCheck] Loaded ${tweetCache.size} cached results`);
    }
  } catch (error) {
    if (error.message?.includes('Extension context invalidated')) {
      console.log('[FactCheck] Extension context invalidated, cache load skipped');
    } else {
      console.error('[FactCheck] Error loading cache:', error);
    }
  }
}

// Save cache to persistent storage
async function saveCache() {
  try {
    if (!chrome.runtime?.id) return;
    
    const cacheObj = {};
    const now = Date.now();
    const expiry = now + (CACHE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
    
    for (const [tweetId, result] of tweetCache.entries()) {
      cacheObj[tweetId] = {
        result: result,
        expiry: expiry,
        cachedAt: now
      };
    }
    
    await chrome.storage.local.set({ [CACHE_KEY]: cacheObj });
  } catch (error) {
    if (!error.message?.includes('Extension context invalidated')) {
      console.error('[FactCheck] Error saving cache:', error);
    }
  }
}

// Save a single entry to cache
async function saveCacheEntry(tweetId, result) {
  if (!chrome.runtime?.id) return;
  
  tweetCache.set(tweetId, result);
  if (!saveCache.timeout) {
    saveCache.timeout = setTimeout(async () => {
      await saveCache();
      saveCache.timeout = null;
    }, 5000);
  }
}

// Inject script into page context
function injectPageScript() {
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('pageScript.js');
  script.onload = function() {
    this.remove();
  };
  (document.head || document.documentElement).appendChild(script);
}

// Extract tweet text from tweet element
function extractTweetText(tweetElement) {
  const tweetTextElement = tweetElement.querySelector('[data-testid="tweetText"]');
  if (!tweetTextElement) return null;
  return tweetTextElement.textContent?.trim();
}

// Generate tweet ID from text (simple hash)
function generateTweetId(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString();
}

// Check tweet with backend
async function checkTweet(tweetText) {
  try {
    const response = await fetch(`${BACKEND_URL}/api/checktweet`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: tweetText }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to check tweet');
    }

    return await response.json();
  } catch (error) {
    console.error('[FactCheck] Error checking tweet:', error);
    return null;
  }
}

// Apply markup to tweet
function applyMarkup(tweetElement, result) {
  const tweetTextElement = tweetElement.querySelector('[data-testid="tweetText"]');
  if (!tweetTextElement) return;

  // Mark as processed
  tweetElement.dataset.factChecked = 'true';

  // If no issues found, mark as verified
  if (!result.hasIssues) {
    const verifiedBadge = document.createElement('span');
    verifiedBadge.className = 'factcheck-verified';
    verifiedBadge.textContent = '✓ Fact-checked';
    verifiedBadge.setAttribute('data-factcheck-badge', 'true');
    tweetTextElement.appendChild(verifiedBadge);
    return;
  }

  // Apply red/green markup
  const originalHTML = tweetTextElement.innerHTML;
  let markedUpHTML = originalHTML;

  // Apply red markup for incorrect phrases
  if (result.incorrect && result.incorrect.length > 0) {
    result.incorrect.forEach(phrase => {
      const escapedPhrase = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`(${escapedPhrase})`, 'gi');
      markedUpHTML = markedUpHTML.replace(regex, '<span class="factcheck-incorrect" data-factcheck-markup="red">$1</span>');
    });
  }

  // Apply green markup for corrections
  if (result.corrections && result.corrections.length > 0) {
    result.corrections.forEach(correction => {
      const correctionSpan = document.createElement('span');
      correctionSpan.className = 'factcheck-correction';
      correctionSpan.textContent = ` [${correction}]`;
      correctionSpan.setAttribute('data-factcheck-markup', 'green');
      markedUpHTML += correctionSpan.outerHTML;
    });
  }

  tweetTextElement.innerHTML = markedUpHTML;

  // Add warning badge
  const warningBadge = document.createElement('div');
  warningBadge.className = 'factcheck-warning';
  warningBadge.textContent = '⚠ Potential inaccuracies detected';
  warningBadge.setAttribute('data-factcheck-badge', 'true');
  tweetTextElement.parentElement?.insertBefore(warningBadge, tweetTextElement);

  // Store result for popup
  tweetElement.dataset.factcheckResult = JSON.stringify(result);
}

// Process request queue
async function processRequestQueue() {
  if (isProcessingQueue || requestQueue.length === 0) return;
  
  isProcessingQueue = true;
  
  while (requestQueue.length > 0 && activeRequests < MAX_CONCURRENT_REQUESTS) {
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;
    
    if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
      await new Promise(resolve => setTimeout(resolve, MIN_REQUEST_INTERVAL - timeSinceLastRequest));
    }
    
    const { tweetElement, tweetText, tweetId, resolve } = requestQueue.shift();
    activeRequests++;
    lastRequestTime = Date.now();
    
    checkTweet(tweetText)
      .then(result => {
        if (result) {
          saveCacheEntry(tweetId, result);
          applyMarkup(tweetElement, result);
        }
        resolve();
      })
      .catch(error => {
        console.error('[FactCheck] Error processing tweet:', error);
        resolve();
      })
      .finally(() => {
        activeRequests--;
        setTimeout(processRequestQueue, 200);
      });
  }
  
  isProcessingQueue = false;
}

// Process a single tweet
async function processTweet(tweetElement) {
  if (!extensionEnabled) return;
  if (tweetElement.dataset.factChecked) return;
  
  const tweetText = extractTweetText(tweetElement);
  if (!tweetText || tweetText.length < 50) return; // Skip short tweets
  
  const tweetId = generateTweetId(tweetText);
  
  // Check cache first
  if (tweetCache.has(tweetId)) {
    const cachedResult = tweetCache.get(tweetId);
    applyMarkup(tweetElement, cachedResult);
    return;
  }
  
  // Check if already being processed
  if (processingTweets.has(tweetId)) return;
  processingTweets.add(tweetId);
  
  // Add loading indicator
  tweetElement.dataset.factChecked = 'loading';
  
  // Queue the request
  return new Promise((resolve) => {
    requestQueue.push({ tweetElement, tweetText, tweetId, resolve });
    processRequestQueue();
  }).finally(() => {
    processingTweets.delete(tweetId);
  });
}

// Process all tweets on the page
async function processTweets() {
  if (!extensionEnabled) return;
  
  const tweets = document.querySelectorAll('article[data-testid="tweet"]');
  console.log(`[FactCheck] Found ${tweets.length} tweets to process`);
  
  for (const tweet of tweets) {
    processTweet(tweet);
  }
}

// Remove all markups
function removeAllMarkups() {
  document.querySelectorAll('[data-factcheck-markup]').forEach(el => el.remove());
  document.querySelectorAll('[data-factcheck-badge]').forEach(el => el.remove());
  document.querySelectorAll('[data-fact-checked]').forEach(el => {
    delete el.dataset.factChecked;
    delete el.dataset.factcheckResult;
  });
  console.log('[FactCheck] Removed all markups');
}

// Initialize observer
function initObserver() {
  if (observer) observer.disconnect();

  observer = new MutationObserver((mutations) => {
    if (!extensionEnabled) return;
    
    let shouldProcess = false;
    for (const mutation of mutations) {
      if (mutation.addedNodes.length > 0) {
        shouldProcess = true;
        break;
      }
    }
    
    if (shouldProcess) {
      setTimeout(processTweets, 500);
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

// Main initialization
async function init() {
  console.log('[FactCheck] Twitter Fact Checker initialized');
  
  await loadEnabledState();
  await loadCache();
  
  if (!extensionEnabled) {
    console.log('[FactCheck] Extension is disabled');
    return;
  }
  
  injectPageScript();
  
  setTimeout(() => {
    processTweets();
  }, 2000);
  
  initObserver();
  
  // Handle SPA navigation
  let lastUrl = location.href;
  new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
      lastUrl = url;
      console.log('[FactCheck] Page navigation detected');
      setTimeout(processTweets, 2000);
    }
  }).observe(document, { subtree: true, childList: true });
  
  // Save cache periodically
  setInterval(saveCache, 30000);
}

// Wait for page to load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}