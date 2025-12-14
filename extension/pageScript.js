// This script runs in the page context for potential future needs
// Currently not used but kept for extensibility
(function() {
  console.log('[FactCheck] Page script loaded');
  
  // Listen for messages from content script
  window.addEventListener('message', async function(event) {
    if (event.data && event.data.type === '__factcheck_request') {
      // Future: Handle any page-context specific operations
      console.log('[FactCheck] Page script received request');
    }
  });
})();