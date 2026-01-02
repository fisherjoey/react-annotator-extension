/**
 * React Annotator for Claude - Background Script
 * Handles storage, messaging, and screenshot capture
 */

const browserAPI = typeof browser !== 'undefined' ? browser : chrome;

// Listen for messages
browserAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'GET_ANNOTATIONS':
      handleGetAnnotations(message.url).then(sendResponse);
      return true;

    case 'DELETE_ANNOTATION':
      handleDeleteAnnotation(message.url, message.id).then(sendResponse);
      return true;

    case 'GET_ALL_ANNOTATIONS':
      handleGetAllAnnotations().then(sendResponse);
      return true;

    case 'SAVE_ANNOTATIONS':
      handleSaveAnnotations(message.url, message.annotations).then(sendResponse);
      return true;

    case 'LOAD_ANNOTATIONS':
      handleGetAnnotations(message.url).then(sendResponse);
      return true;

    case 'CAPTURE_SCREENSHOT':
      handleCaptureScreenshot(sender.tab.id).then(sendResponse);
      return true;

    default:
      console.warn('[React Annotator] Unknown message:', message.type);
      return false;
  }
});

/**
 * Capture visible tab screenshot
 */
async function handleCaptureScreenshot(tabId) {
  try {
    const dataUrl = await browserAPI.tabs.captureVisibleTab(null, {
      format: 'png'
    });
    return { success: true, screenshot: dataUrl };
  } catch (error) {
    console.error('[React Annotator] Screenshot error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Save annotations for a URL
 */
async function handleSaveAnnotations(url, annotations) {
  try {
    const storage = await browserAPI.storage.local.get('annotations');
    const all = storage.annotations || {};
    all[url] = annotations;
    if (!annotations || annotations.length === 0) delete all[url];
    await browserAPI.storage.local.set({ annotations: all });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Get annotations for a URL
 */
async function handleGetAnnotations(url) {
  try {
    const storage = await browserAPI.storage.local.get('annotations');
    const all = storage.annotations || {};
    return { success: true, annotations: all[url] || [] };
  } catch (error) {
    return { success: false, error: error.message, annotations: [] };
  }
}

/**
 * Get all annotations
 */
async function handleGetAllAnnotations() {
  try {
    const storage = await browserAPI.storage.local.get('annotations');
    return { success: true, annotations: storage.annotations || {} };
  } catch (error) {
    return { success: false, error: error.message, annotations: {} };
  }
}

/**
 * Delete an annotation
 */
async function handleDeleteAnnotation(url, annotationId) {
  try {
    const storage = await browserAPI.storage.local.get('annotations');
    const all = storage.annotations || {};
    if (!all[url]) return { success: false, error: 'No annotations for URL' };
    all[url] = all[url].filter(a => a.id !== annotationId);
    if (all[url].length === 0) delete all[url];
    await browserAPI.storage.local.set({ annotations: all });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

console.log('[React Annotator] Background script loaded');
