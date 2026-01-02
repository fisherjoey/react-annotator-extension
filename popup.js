/**
 * React Annotator - Popup Script
 * Handles all popup UI logic and communication with background/content scripts
 */

// Browser API compatibility (Firefox uses 'browser', Chrome uses 'chrome')
const browserAPI = typeof browser !== 'undefined' ? browser : chrome;


// DOM Elements
const toggleBtn = document.getElementById('toggle-btn');
const toggleText = document.getElementById('toggle-text');
const annotationCount = document.getElementById('annotation-count');
const annotationsList = document.getElementById('annotations-list');
const emptyState = document.getElementById('empty-state');
const copyClaudeBtn = document.getElementById('copy-claude-btn');
const exportAllBtn = document.getElementById('export-all-btn');
const toast = document.getElementById('toast');

// State
let currentTabId = null;
let currentUrl = null;
let isActive = false;
let annotations = [];

/**
 * Initialize popup on load
 */
async function init() {
  try {
    // Get current tab
    const [tab] = await browserAPI.tabs.query({ active: true, currentWindow: true });
    currentTabId = tab.id;
    currentUrl = tab.url;

    // Check if we can run on this page
    if (!canAnnotatePage(currentUrl)) {
      showUnavailableState();
      return;
    }

    // Get current annotation mode state
    await checkAnnotationMode();

    // Load annotations for current page
    await loadAnnotations();

  } catch (error) {
    console.error('Failed to initialize popup:', error);
    showToast('Failed to initialize', 'error');
  }
}

/**
 * Check if the page can be annotated (not chrome://, etc.)
 */
function canAnnotatePage(url) {
  if (!url) return false;
  const restrictedPrefixes = ['chrome://', 'chrome-extension://', 'about:', 'edge://', 'brave://'];
  return !restrictedPrefixes.some(prefix => url.startsWith(prefix));
}

/**
 * Show unavailable state for restricted pages
 */
function showUnavailableState() {
  toggleBtn.disabled = true;
  toggleBtn.textContent = 'Not available on this page';
  toggleBtn.style.opacity = '0.5';
  toggleBtn.style.cursor = 'not-allowed';
  copyClaudeBtn.disabled = true;
  exportAllBtn.disabled = true;
}

/**
 * Check current annotation mode from content script
 */
async function checkAnnotationMode() {
  try {
    const response = await browserAPI.tabs.sendMessage(currentTabId, { type: 'GET_SELECTION_MODE' });
    isActive = response?.isActive || false;
    updateToggleButton();
  } catch (error) {
    // Content script might not be injected yet
    isActive = false;
    updateToggleButton();
  }
}

/**
 * Load annotations for the current page
 */
async function loadAnnotations() {
  try {
    const response = await browserAPI.runtime.sendMessage({
      type: 'GET_ANNOTATIONS',
      url: currentUrl
    });

    annotations = response?.annotations || [];
    renderAnnotations();
  } catch (error) {
    console.error('Failed to load annotations:', error);
    annotations = [];
    renderAnnotations();
  }
}

/**
 * Render the annotations list
 */
function renderAnnotations() {
  // Update count badge
  annotationCount.textContent = annotations.length;
  annotationCount.classList.toggle('empty', annotations.length === 0);

  // Clear list
  annotationsList.innerHTML = '';

  if (annotations.length === 0) {
    // Show empty state
    annotationsList.appendChild(createEmptyState());
    return;
  }

  // Render each annotation
  annotations.forEach((annotation, index) => {
    const item = createAnnotationItem(annotation, index);
    annotationsList.appendChild(item);
  });
}

/**
 * Create empty state element
 */
function createEmptyState() {
  const div = document.createElement('div');
  div.className = 'empty-state';
  div.innerHTML = `
    <p>No annotations yet.</p>
    <p class="empty-hint">Click 'Start Annotating' to begin.</p>
  `;
  return div;
}

/**
 * Create an annotation list item
 */
function createAnnotationItem(annotation, index) {
  const item = document.createElement('div');
  item.className = 'annotation-item';
  item.setAttribute('data-index', index);

  const componentName = annotation.reactComponent || annotation.componentName || 'Unknown component';
  const comment = annotation.comment || 'No comment';
  const truncatedComment = comment.length > 80 ? comment.substring(0, 80) + '...' : comment;
  const thumbnailHtml = annotation.screenshot
    ? '<img src="' + annotation.screenshot + '" class="annotation-thumbnail" alt="Screenshot">'
    : '';

  item.innerHTML = `
    ${thumbnailHtml}
    <div class="annotation-content">
      <div class="annotation-component">${escapeHtml(componentName)}</div>
      <div class="annotation-comment">${escapeHtml(truncatedComment)}</div>
    </div>
    <button class="annotation-delete" title="Delete annotation" data-index="${index}">&times;</button>
  `;

  // Click to scroll to element
  item.querySelector('.annotation-content').addEventListener('click', () => scrollToAnnotation(annotation));

  // Delete button
  item.querySelector('.annotation-delete').addEventListener('click', (e) => {
    e.stopPropagation();
    deleteAnnotation(index);
  });

  return item;
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Update toggle button state
 */
function updateToggleButton() {
  toggleBtn.classList.toggle('active', isActive);
  toggleText.textContent = isActive ? 'Stop Annotating' : 'Start Annotating';
}

/**
 * Toggle annotation mode
 */
async function toggleAnnotationMode() {
  try {
    const response = await browserAPI.tabs.sendMessage(currentTabId, { type: 'TOGGLE_SELECTION_MODE' });
    isActive = response?.isActive || false;
    updateToggleButton();

    if (isActive) {
      showToast('Annotation mode enabled', 'success');
    }
  } catch (error) {
    console.error('Failed to toggle annotation mode:', error);
    showToast('Failed to toggle mode', 'error');
  }
}

/**
 * Scroll to an annotation on the page
 */
async function scrollToAnnotation(annotation) {
  try {
    await browserAPI.tabs.sendMessage(currentTabId, {
      type: 'SCROLL_TO_ANNOTATION',
      annotation
    });
    // Close popup after scrolling
    window.close();
  } catch (error) {
    console.error('Failed to scroll to annotation:', error);
    showToast('Element not found on page', 'error');
  }
}

/**
 * Delete an annotation
 */
async function deleteAnnotation(index) {
  try {
    const annotationId = annotations[index]?.id;
    if (!annotationId) return;

    await browserAPI.runtime.sendMessage({
      type: 'DELETE_ANNOTATION',
      id: annotationId,
      url: currentUrl
    });

    // Reload annotations
    await loadAnnotations();
    showToast('Annotation deleted', 'success');
  } catch (error) {
    console.error('Failed to delete annotation:', error);
    showToast('Failed to delete', 'error');
  }
}

/**
 * Copy annotations in Claude-friendly format
 */
async function copyForClaude() {
  if (annotations.length === 0) {
    showToast('No annotations to copy', 'error');
    return;
  }

  const markdown = formatAnnotationsForClaude(currentUrl, annotations);

  try {
    await navigator.clipboard.writeText(markdown);
    showToast('Copied to clipboard!', 'success');
  } catch (error) {
    console.error('Failed to copy:', error);
    showToast('Failed to copy', 'error');
  }
}

/**
 * Format annotations as Claude-friendly markdown
 */
function formatAnnotationsForClaude(url, annotations) {
  let markdown = `## UI Annotations for ${url}\n\n`;

  annotations.forEach((annotation, index) => {
    const componentName = annotation.reactComponent || annotation.componentName || 'Unknown Component';
    markdown += `### ${index + 1}. ${componentName}\n`;

    if (annotation.filePath) {
      // Mark as suggested if pathGuessed flag is set or path looks auto-generated
      const isSuggested = annotation.pathGuessed ||
        (annotation.filePath.startsWith('components/') && annotation.filePath.endsWith('.tsx'));
      if (isSuggested) {
        markdown += `- **File (suggested):** \`${annotation.filePath}\` ⚠️ *search for "${componentName}" to verify*\n`;
      } else {
        markdown += `- **File:** \`${annotation.filePath}\`\n`;
      }
    }

    if (annotation.elementHTML) {
      // Extract useful info from element HTML
      const classMatch = annotation.elementHTML.match(/class="([^"]+)"/);
      if (classMatch) {
        markdown += `- **Classes:** \`${classMatch[1]}\`\n`;
      }
    }

    markdown += `- **Comment:** ${annotation.comment || 'No comment'}\n`;

    // Add element HTML in a collapsible details block
    if (annotation.elementHTML) {
      markdown += `\n<details>\n<summary>Element HTML</summary>\n\n\`\`\`html\n${annotation.elementHTML}\n\`\`\`\n</details>\n`;
    }

    markdown += `\n`;
  });

  return markdown;
}

/**
 * Export annotations with screenshots as downloadable files
 */
async function exportAllPages() {
  if (annotations.length === 0) {
    showToast('No annotations to export', 'error');
    return;
  }

  try {
    const timestamp = new Date().toISOString().slice(0, 10);
    const pageName = new URL(currentUrl).pathname.replace(/\//g, '-').slice(1) || 'home';
    const folderName = `annotations-${pageName}-${timestamp}`;

    // Generate markdown with image references
    let markdown = `## UI Annotations for ${currentUrl}\n\n`;
    markdown += `*Exported on ${new Date().toLocaleString()}*\n\n`;

    const downloadPromises = [];

    annotations.forEach((annotation, index) => {
      const componentName = annotation.reactComponent || annotation.componentName || 'element';
      const safeComponentName = componentName.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
      const imageFilename = `${index + 1}-${safeComponentName}.jpg`;

      markdown += `### ${index + 1}. ${componentName}\n`;

      if (annotation.filePath) {
        const isSuggested = annotation.pathGuessed ||
          (annotation.filePath.startsWith('components/') && annotation.filePath.endsWith('.tsx'));
        if (isSuggested) {
          markdown += `- **File (suggested):** \`${annotation.filePath}\` ⚠️ *search for "${componentName}" to verify*\n`;
        } else {
          markdown += `- **File:** \`${annotation.filePath}\`\n`;
        }
      }

      if (annotation.elementHTML) {
        const classMatch = annotation.elementHTML.match(/class="([^"]+)"/);
        if (classMatch) {
          markdown += `- **Classes:** \`${classMatch[1]}\`\n`;
        }
      }

      markdown += `- **Comment:** ${annotation.comment || 'No comment'}\n`;

      // Add screenshot reference
      if (annotation.screenshot) {
        markdown += `- **Screenshot:** ![${componentName}](./${imageFilename})\n`;

        // Queue screenshot download
        downloadPromises.push(
          downloadDataUrl(annotation.screenshot, imageFilename)
        );
      }

      if (annotation.elementHTML) {
        markdown += `\n<details>\n<summary>Element HTML</summary>\n\n\`\`\`html\n${annotation.elementHTML}\n\`\`\`\n</details>\n`;
      }

      markdown += `\n`;
    });

    // Download markdown file
    const mdFilename = `${folderName}.md`;
    const mdBlob = new Blob([markdown], { type: 'text/markdown' });
    const mdUrl = URL.createObjectURL(mdBlob);

    const mdLink = document.createElement('a');
    mdLink.href = mdUrl;
    mdLink.download = mdFilename;
    mdLink.click();
    URL.revokeObjectURL(mdUrl);

    // Download all screenshots
    await Promise.all(downloadPromises);

    // Copy filepath hint to clipboard
    const clipboardText = `See downloaded file: ${mdFilename} (with ${downloadPromises.length} screenshots)`;
    await navigator.clipboard.writeText(clipboardText);

    showToast(`Downloaded ${mdFilename} + ${downloadPromises.length} images! Path copied.`, 'success');
  } catch (error) {
    console.error('Failed to export:', error);
    showToast('Failed to export', 'error');
  }
}

/**
 * Download a data URL as a file
 */
function downloadDataUrl(dataUrl, filename) {
  return new Promise((resolve) => {
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = filename;
    link.click();
    // Small delay to avoid overwhelming the browser
    setTimeout(resolve, 100);
  });
}

/**
 * Show toast notification
 */
function showToast(message, type = 'success') {
  toast.textContent = message;
  toast.className = `toast ${type}`;

  // Force reflow
  toast.offsetHeight;

  toast.classList.add('show');

  setTimeout(() => {
    toast.classList.remove('show');
  }, 2000);
}

// Event listeners
toggleBtn.addEventListener('click', toggleAnnotationMode);
copyClaudeBtn.addEventListener('click', copyForClaude);
exportAllBtn.addEventListener('click', exportAllPages);

// Listen for annotation updates from background
browserAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'ANNOTATIONS_UPDATED' && message.url === currentUrl) {
    loadAnnotations();
  }
});

// Initialize on load
document.addEventListener('DOMContentLoaded', init);
