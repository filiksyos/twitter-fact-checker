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
        processTweets(); // This now only adds buttons, doesn't auto-check
      }, 500);
    } else {
      removeAllMarkups();
      // Remove all buttons
      document.querySelectorAll('.factcheck-button').forEach(btn => btn.remove());
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
  const requestId = Math.random().toString(36).substring(7);
  console.log(`[FactCheck] [${requestId}] 🚀 Starting API call to ${BACKEND_URL}/api/checktweet`);
  console.log(`[FactCheck] [${requestId}] 📝 Tweet text length: ${tweetText.length} characters`);
  console.log(`[FactCheck] [${requestId}] 📝 Tweet preview: ${tweetText.substring(0, 100)}...`);
  
  try {
    console.log(`[FactCheck] [${requestId}] 📡 Making fetch request...`);
    const response = await fetch(`${BACKEND_URL}/api/checktweet`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: tweetText }),
    });

    console.log(`[FactCheck] [${requestId}] 📥 Response received. Status: ${response.status} ${response.statusText}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[FactCheck] [${requestId}] ❌ Response not OK. Status: ${response.status}`);
      console.error(`[FactCheck] [${requestId}] ❌ Error body:`, errorText);
      
      let error;
      try {
        error = JSON.parse(errorText);
      } catch (e) {
        error = { error: errorText || 'Failed to check tweet' };
      }
      
      throw new Error(error.error || `HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();
    console.log(`[FactCheck] [${requestId}] ✅ Successfully received result:`, {
      hasIssues: result.hasIssues,
      incorrectCount: result.incorrect?.length || 0,
      correctionsCount: result.corrections?.length || 0,
    });
    
    return result;
  } catch (error) {
    console.error(`[FactCheck] [${requestId}] ❌ Error checking tweet:`, error);
    console.error(`[FactCheck] [${requestId}] ❌ Error name:`, error.name);
    console.error(`[FactCheck] [${requestId}] ❌ Error message:`, error.message);
    console.error(`[FactCheck] [${requestId}] ❌ Error stack:`, error.stack);
    
    // Check if it's a network error
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      console.error(`[FactCheck] [${requestId}] ❌ Network error - is the server running at ${BACKEND_URL}?`);
    }
    
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
  console.log('[FactCheck] 🔄 processRequestQueue called. isProcessing:', isProcessingQueue, 'queueLength:', requestQueue.length);
  
  if (isProcessingQueue || requestQueue.length === 0) {
    console.log('[FactCheck] ⏭️ Skipping - already processing or queue empty');
    return;
  }
  
  isProcessingQueue = true;
  console.log('[FactCheck] ✅ Started processing queue');
  
  while (requestQueue.length > 0 && activeRequests < MAX_CONCURRENT_REQUESTS) {
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;
    
    if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
      const waitTime = MIN_REQUEST_INTERVAL - timeSinceLastRequest;
      console.log(`[FactCheck] ⏳ Rate limiting: waiting ${waitTime}ms`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    const { tweetElement, tweetText, tweetId, resolve } = requestQueue.shift();
    activeRequests++;
    lastRequestTime = Date.now();
    
    console.log(`[FactCheck] 🚀 Processing tweet from queue. Active requests: ${activeRequests}`);
    
    checkTweet(tweetText)
      .then(result => {
        console.log('[FactCheck] ✅ checkTweet completed');
        if (result) {
          console.log('[FactCheck] 💾 Saving to cache and applying markup');
          saveCacheEntry(tweetId, result);
          applyMarkup(tweetElement, result);
        } else {
          console.log('[FactCheck] ⚠️ No result returned from checkTweet');
          // Reset loading state if no result
          delete tweetElement.dataset.factChecked;
          const button = tweetElement.querySelector('.factcheck-button');
          if (button) {
            button.disabled = false;
            button.innerHTML = '🔍 Check Fact';
            button.style.display = '';
          }
        }
        resolve();
      })
      .catch(error => {
        console.error('[FactCheck] ❌ Error processing tweet:', error);
        // Reset loading state on error
        delete tweetElement.dataset.factChecked;
        const button = tweetElement.querySelector('.factcheck-button');
        if (button) {
          button.disabled = false;
          button.innerHTML = '🔍 Check Fact';
          button.style.display = '';
        }
        resolve();
      })
      .finally(() => {
        activeRequests--;
        console.log(`[FactCheck] 🏁 Request completed. Active requests: ${activeRequests}`);
        setTimeout(processRequestQueue, 200);
      });
  }
  
  isProcessingQueue = false;
  console.log('[FactCheck] ✅ Finished processing queue');
}

// Process a single tweet
async function processTweet(tweetElement) {
  console.log('[FactCheck] 🔄 processTweet called');
  
  if (!extensionEnabled) {
    console.log('[FactCheck] ⚠️ Extension disabled, aborting');
    return;
  }
  
  if (tweetElement.dataset.factChecked) {
    console.log('[FactCheck] ⚠️ Tweet already processed, status:', tweetElement.dataset.factChecked);
    return;
  }
  
  const tweetText = extractTweetText(tweetElement);
  if (!tweetText || tweetText.length < 50) {
    console.log('[FactCheck] ⚠️ Tweet too short or no text found. Length:', tweetText?.length || 0);
    return; // Skip short tweets
  }
  
  const tweetId = generateTweetId(tweetText);
  console.log('[FactCheck] 📋 Tweet ID:', tweetId);
  
  // Check cache first
  if (tweetCache.has(tweetId)) {
    console.log('[FactCheck] 💾 Using cached result');
    const cachedResult = tweetCache.get(tweetId);
    applyMarkup(tweetElement, cachedResult);
    return;
  }
  
  // Check if already being processed
  if (processingTweets.has(tweetId)) {
    console.log('[FactCheck] ⚠️ Tweet already being processed');
    return;
  }
  
  processingTweets.add(tweetId);
  console.log('[FactCheck] ✅ Added to processing set');
  
  // Add loading indicator
  tweetElement.dataset.factChecked = 'loading';
  console.log('[FactCheck] 🔄 Set loading state');
  
  // Update button to show loading state
  const button = tweetElement.querySelector('.factcheck-button');
  if (button) {
    button.disabled = true;
    button.innerHTML = '🔍 Checking...';
    console.log('[FactCheck] 🔘 Updated button to loading state');
  } else {
    console.log('[FactCheck] ⚠️ Button not found!');
  }
  
  // Queue the request
  console.log('[FactCheck] 📤 Queuing request...');
  return new Promise((resolve) => {
    requestQueue.push({ tweetElement, tweetText, tweetId, resolve });
    console.log('[FactCheck] 📊 Queue length:', requestQueue.length);
    processRequestQueue();
  }).finally(() => {
    processingTweets.delete(tweetId);
    console.log('[FactCheck] 🧹 Cleaned up processing set');
    // Remove or update button after check
    if (button) {
      button.style.display = 'none';
      console.log('[FactCheck] 🔘 Hid button');
    }
  });
}

// Process all tweets on the page (only adds buttons, doesn't auto-check)
async function processTweets() {
  if (!extensionEnabled) {
    console.log('[FactCheck] Extension disabled, skipping button addition');
    return;
  }
  
  const tweets = document.querySelectorAll('article[data-testid="tweet"]');
  console.log(`[FactCheck] Found ${tweets.length} tweets to add buttons to`);
  
  if (tweets.length === 0) {
    console.log('[FactCheck] No tweets found on page');
    return;
  }
  
  for (const tweet of tweets) {
    addCheckButton(tweet);
  }
  
  console.log(`[FactCheck] Finished processing ${tweets.length} tweets`);
}

// Remove all markups
function removeAllMarkups() {
  document.querySelectorAll('[data-factcheck-markup]').forEach(el => el.remove());
  document.querySelectorAll('[data-factcheck-badge]').forEach(el => el.remove());
  document.querySelectorAll('.factcheck-button').forEach(btn => btn.remove());
  document.querySelectorAll('[data-fact-checked]').forEach(el => {
    delete el.dataset.factChecked;
    delete el.dataset.factcheckResult;
  });
  console.log('[FactCheck] Removed all markups and buttons');
}

// Add check button to tweet
function addCheckButton(tweetElement) {
  // Skip if button already exists or tweet is already checked
  if (tweetElement.querySelector('.factcheck-button')) {
    console.log('[FactCheck] Button already exists for tweet');
    return;
  }
  if (tweetElement.dataset.factChecked === 'true') {
    console.log('[FactCheck] Tweet already checked, skipping button');
    return;
  }
  
  const tweetTextElement = tweetElement.querySelector('[data-testid="tweetText"]');
  if (!tweetTextElement) {
    console.log('[FactCheck] No tweet text element found');
    return;
  }
  
  const tweetText = extractTweetText(tweetElement);
  if (!tweetText || tweetText.length < 50) {
    console.log('[FactCheck] Tweet too short or no text, skipping');
    return;
  }
  
  console.log('[FactCheck] Adding button to tweet:', tweetText.substring(0, 50) + '...');
  
  // Create button container
  const buttonContainer = document.createElement('div');
  buttonContainer.style.marginTop = '12px';
  buttonContainer.style.marginBottom = '8px';
  buttonContainer.style.display = 'flex';
  buttonContainer.style.alignItems = 'center';
  buttonContainer.style.width = '100%';
  buttonContainer.setAttribute('data-factcheck-button-container', 'true');
  
  // Create button with inline styles as fallback
  const button = document.createElement('button');
  button.className = 'factcheck-button';
  button.innerHTML = '🔍 Check Fact';
  button.setAttribute('data-factcheck-button', 'true');
  // Inline styles as fallback in case CSS doesn't load
  button.style.cssText = `
    background: #1d9bf0 !important;
    color: white !important;
    border: none !important;
    padding: 8px 16px !important;
    border-radius: 20px !important;
    font-size: 14px !important;
    font-weight: 600 !important;
    cursor: pointer !important;
    transition: all 0.2s !important;
    display: inline-flex !important;
    align-items: center !important;
    gap: 4px !important;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important;
  `;
  
  // Add click handler
  button.addEventListener('click', async (e) => {
    e.stopPropagation();
    e.preventDefault();
    
    console.log('[FactCheck] 🔘 Button clicked!');
    
    if (tweetElement.dataset.factChecked === 'loading') {
      console.log('[FactCheck] ⚠️ Tweet is already being processed, ignoring click');
      return;
    }
    
    if (tweetElement.dataset.factChecked === 'true') {
      console.log('[FactCheck] ⚠️ Tweet already checked, ignoring click');
      return;
    }
    
    console.log('[FactCheck] ✅ Processing tweet...');
    await processTweet(tweetElement);
  });
  
  buttonContainer.appendChild(button);
  
  // Strategy 1: Insert right after the tweet text element (most reliable)
  if (tweetTextElement.nextSibling) {
    tweetTextElement.parentElement.insertBefore(buttonContainer, tweetTextElement.nextSibling);
    console.log('[FactCheck] Button inserted after tweet text element');
    return;
  }
  
  // Strategy 2: Append to tweet text parent
  const tweetTextParent = tweetTextElement.parentElement;
  if (tweetTextParent) {
    tweetTextParent.appendChild(buttonContainer);
    console.log('[FactCheck] Button appended to tweet text parent');
    return;
  }
  
  // Strategy 3: Try to insert near tweet actions
  const replyButton = tweetElement.querySelector('[data-testid="reply"]');
  if (replyButton && replyButton.parentElement) {
    const actionsContainer = replyButton.parentElement.parentElement;
    if (actionsContainer) {
      actionsContainer.insertBefore(buttonContainer, actionsContainer.firstChild);
      console.log('[FactCheck] Button inserted near tweet actions');
      return;
    }
  }
  
  console.error('[FactCheck] Could not find insertion point for button');
}

// Initialize observer (only adds buttons, doesn't auto-check)
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
  console.log('[FactCheck] Current URL:', window.location.href);
  
  await loadEnabledState();
  await loadCache();
  
  console.log('[FactCheck] Extension enabled state:', extensionEnabled);
  
  if (!extensionEnabled) {
    console.log('[FactCheck] Extension is disabled - enable it in the popup to see buttons');
    return;
  }
  
  injectPageScript();
  
  console.log('[FactCheck] Waiting 2 seconds before adding buttons...');
  setTimeout(() => {
    console.log('[FactCheck] Starting to add buttons to tweets');
    processTweets(); // This now only adds buttons, doesn't auto-check
  }, 2000);
  
  initObserver();
  
  // Handle SPA navigation
  let lastUrl = location.href;
  new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
      lastUrl = url;
      console.log('[FactCheck] Page navigation detected, URL:', url);
      setTimeout(() => {
        console.log('[FactCheck] Adding buttons after navigation');
        processTweets(); // This now only adds buttons, doesn't auto-check
      }, 2000);
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