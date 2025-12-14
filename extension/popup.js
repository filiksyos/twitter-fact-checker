// Popup script for extension toggle and stats
const TOGGLE_KEY = 'extension_enabled';
const DEFAULT_ENABLED = true;
const BACKEND_URL = 'http://localhost:3000';

// Get elements
const toggleSwitch = document.getElementById('toggleSwitch');
const status = document.getElementById('status');
const backendStatus = document.getElementById('backendStatus');
const clearCacheBtn = document.getElementById('clearCache');

// Check backend connection
async function checkBackend() {
  try {
    const response = await fetch(`${BACKEND_URL}/api/health`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });
    
    if (response.ok) {
      backendStatus.className = 'backend-status connected';
      backendStatus.textContent = '✅ Backend: Connected';
      return true;
    }
  } catch (error) {
    backendStatus.className = 'backend-status disconnected';
    backendStatus.textContent = '❌ Backend: Not running (Start server on localhost:3000)';
    return false;
  }
}

// Load current state
chrome.storage.local.get([TOGGLE_KEY], (result) => {
  const isEnabled = result[TOGGLE_KEY] !== undefined ? result[TOGGLE_KEY] : DEFAULT_ENABLED;
  updateToggle(isEnabled);
});

// Check backend on load
checkBackend();

// Toggle click handler
toggleSwitch.addEventListener('click', () => {
  chrome.storage.local.get([TOGGLE_KEY], (result) => {
    const currentState = result[TOGGLE_KEY] !== undefined ? result[TOGGLE_KEY] : DEFAULT_ENABLED;
    const newState = !currentState;
    
    chrome.storage.local.set({ [TOGGLE_KEY]: newState }, () => {
      updateToggle(newState);
      
      // Notify content script
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, {
            type: 'extensionToggle',
            enabled: newState
          }).catch(() => {
            console.log('Tab not ready for message');
          });
        }
      });
    });
  });
});

// Clear cache handler
clearCacheBtn.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.storage.local.remove('twitter_factcheck_cache', () => {
    alert('Cache cleared! Refresh the Twitter page to re-check tweets.');
  });
});

function updateToggle(isEnabled) {
  if (isEnabled) {
    toggleSwitch.classList.add('enabled');
    status.textContent = '✓ Fact checking is enabled';
    status.style.color = '#1d9bf0';
  } else {
    toggleSwitch.classList.remove('enabled');
    status.textContent = '✗ Fact checking is disabled';
    status.style.color = '#536471';
  }
}