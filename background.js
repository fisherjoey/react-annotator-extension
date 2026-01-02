/**
 * React Annotator for Claude - Background Script
 *
 * Handles message passing between content scripts and the popup.
 * Manages annotation storage using browser.storage.local.
 *
 * Storage structure:
 * {
 *   "annotations": {
 *     "https://example.com/page1": [
 *       { id: "...", selector: "...", text: "...", timestamp: ... },
 *       ...
 *     ],
 *     "https://example.com/page2": [...],
 *     ...
 *   }
 * }
 */

// Listen for messages from content scripts and popup
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Handle different message types
  switch (message.type) {
    case "saveAnnotation":
      return handleSaveAnnotation(message.data);

    case "getAnnotations":
      return handleGetAnnotations(message.url);

    case "deleteAnnotation":
      return handleDeleteAnnotation(message.url, message.annotationId);

    case "exportAll":
      return handleExportAll();

    default:
      console.warn(`Unknown message type: ${message.type}`);
      return Promise.resolve({ success: false, error: "Unknown message type" });
  }
});

/**
 * Save an annotation for a specific URL
 * @param {Object} data - Annotation data including url, id, selector, text, timestamp
 * @returns {Promise} Resolves with success status
 */
async function handleSaveAnnotation(data) {
  try {
    const { url, annotation } = data;

    // Get current annotations from storage
    const storage = await browser.storage.local.get("annotations");
    const annotations = storage.annotations || {};

    // Initialize array for this URL if it doesn't exist
    if (!annotations[url]) {
      annotations[url] = [];
    }

    // Check if annotation with this ID already exists (update case)
    const existingIndex = annotations[url].findIndex(
      (a) => a.id === annotation.id
    );

    if (existingIndex >= 0) {
      // Update existing annotation
      annotations[url][existingIndex] = {
        ...annotations[url][existingIndex],
        ...annotation,
        updatedAt: Date.now(),
      };
    } else {
      // Add new annotation with timestamp
      annotations[url].push({
        ...annotation,
        createdAt: Date.now(),
      });
    }

    // Save back to storage
    await browser.storage.local.set({ annotations });

    return { success: true, annotation };
  } catch (error) {
    console.error("Error saving annotation:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Get all annotations for a specific URL
 * @param {string} url - The URL to get annotations for
 * @returns {Promise} Resolves with annotations array
 */
async function handleGetAnnotations(url) {
  try {
    const storage = await browser.storage.local.get("annotations");
    const annotations = storage.annotations || {};

    // Return annotations for this URL, or empty array if none exist
    return {
      success: true,
      annotations: annotations[url] || [],
    };
  } catch (error) {
    console.error("Error getting annotations:", error);
    return { success: false, error: error.message, annotations: [] };
  }
}

/**
 * Delete a specific annotation by ID from a URL
 * @param {string} url - The URL the annotation belongs to
 * @param {string} annotationId - The ID of the annotation to delete
 * @returns {Promise} Resolves with success status
 */
async function handleDeleteAnnotation(url, annotationId) {
  try {
    const storage = await browser.storage.local.get("annotations");
    const annotations = storage.annotations || {};

    // Check if URL has annotations
    if (!annotations[url]) {
      return { success: false, error: "No annotations found for this URL" };
    }

    // Filter out the annotation to delete
    const originalLength = annotations[url].length;
    annotations[url] = annotations[url].filter((a) => a.id !== annotationId);

    // Check if annotation was actually deleted
    if (annotations[url].length === originalLength) {
      return { success: false, error: "Annotation not found" };
    }

    // Clean up empty URL entries
    if (annotations[url].length === 0) {
      delete annotations[url];
    }

    // Save back to storage
    await browser.storage.local.set({ annotations });

    return { success: true };
  } catch (error) {
    console.error("Error deleting annotation:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Export all annotations across all URLs
 * @returns {Promise} Resolves with all annotations organized by URL
 */
async function handleExportAll() {
  try {
    const storage = await browser.storage.local.get("annotations");
    const annotations = storage.annotations || {};

    // Calculate summary statistics
    const urlCount = Object.keys(annotations).length;
    const totalAnnotations = Object.values(annotations).reduce(
      (sum, arr) => sum + arr.length,
      0
    );

    return {
      success: true,
      data: {
        exportedAt: new Date().toISOString(),
        summary: {
          urlCount,
          totalAnnotations,
        },
        annotations,
      },
    };
  } catch (error) {
    console.error("Error exporting annotations:", error);
    return { success: false, error: error.message };
  }
}

// Log when background script is loaded
console.log("React Annotator for Claude - Background script loaded");
