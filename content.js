/**
 * React Annotator - Content Script
 *
 * A Firefox extension content script for annotating React components.
 * Provides element selection, React component detection, annotation popups,
 * and persistent comment icons.
 */

// Browser API compatibility
const browserAPI = typeof browser !== 'undefined' ? browser : chrome;

// ============================================================================
// State Management
// ============================================================================

const state = {
  isSelectionMode: false,
  annotations: new Map(), // id -> annotation
  hoveredElement: null,
  selectedElement: null,
  popupElement: null,
  highlightOverlay: null,
  commentIcons: new Map(), // id -> icon element
  mutationObserver: null,
};

// ============================================================================
// Constants
// ============================================================================

const STYLES = {
  highlightColor: 'rgba(66, 135, 245, 0.3)',
  highlightBorder: '2px solid rgba(66, 135, 245, 0.8)',
  popupZIndex: 2147483647,
  iconZIndex: 2147483646,
};

const SELECTORS_TO_IGNORE = [
  '.react-annotator-popup',
  '.react-annotator-icon',
  '.react-annotator-overlay',
];

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Generate a unique ID for annotations
 * @returns {string} Unique identifier
 */
function generateId() {
  return `ra-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Generate a unique CSS selector for an element
 * @param {Element} element - DOM element
 * @returns {string} CSS selector
 */
function generateSelector(element) {
  if (!element || element === document.body) return 'body';

  // Try ID first (most unique)
  if (element.id) {
    return `#${CSS.escape(element.id)}`;
  }

  // Build selector with classes and nth-child
  const parts = [];
  let current = element;

  while (current && current !== document.body && parts.length < 5) {
    let selector = current.tagName.toLowerCase();

    // Add meaningful classes (skip utility classes)
    const meaningfulClasses = Array.from(current.classList)
      .filter(c => !c.match(/^(w-|h-|p-|m-|flex|grid|text-|bg-|border-)/))
      .slice(0, 2);

    if (meaningfulClasses.length > 0) {
      selector += meaningfulClasses.map(c => `.${CSS.escape(c)}`).join('');
    }

    // Add data attributes if present
    const dataComponent = current.getAttribute('data-component') ||
                          current.getAttribute('data-testid');
    if (dataComponent) {
      selector += `[data-component="${CSS.escape(dataComponent)}"]`;
    }

    // Add nth-child for disambiguation
    const parent = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(
        child => child.tagName === current.tagName
      );
      if (siblings.length > 1) {
        const index = siblings.indexOf(current) + 1;
        selector += `:nth-of-type(${index})`;
      }
    }

    parts.unshift(selector);
    current = current.parentElement;
  }

  return parts.join(' > ');
}

/**
 * Generate XPath for an element (backup selector)
 * @param {Element} element - DOM element
 * @returns {string} XPath expression
 */
function generateXPath(element) {
  if (!element) return '';

  if (element.id) {
    return `//*[@id="${element.id}"]`;
  }

  const parts = [];
  let current = element;

  while (current && current.nodeType === Node.ELEMENT_NODE) {
    let index = 1;
    let sibling = current.previousElementSibling;

    while (sibling) {
      if (sibling.tagName === current.tagName) {
        index++;
      }
      sibling = sibling.previousElementSibling;
    }

    const tagName = current.tagName.toLowerCase();
    parts.unshift(`${tagName}[${index}]`);
    current = current.parentElement;
  }

  return '/' + parts.join('/');
}

/**
 * Find element by selector with XPath fallback
 * @param {Object} annotation - Annotation object with selector and xpath
 * @returns {Element|null} Found element or null
 */
function findElement(annotation) {
  // Try CSS selector first
  try {
    const element = document.querySelector(annotation.selector);
    if (element) return element;
  } catch (e) {
    console.warn('Invalid CSS selector:', annotation.selector);
  }

  // Fallback to XPath
  try {
    const result = document.evaluate(
      annotation.xpath,
      document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null
    );
    return result.singleNodeValue;
  } catch (e) {
    console.warn('Invalid XPath:', annotation.xpath);
  }

  return null;
}

/**
 * Check if element should be ignored (is part of our UI)
 * @param {Element} element - DOM element to check
 * @returns {boolean} True if should be ignored
 */
function shouldIgnoreElement(element) {
  if (!element) return true;

  for (const selector of SELECTORS_TO_IGNORE) {
    if (element.closest(selector)) return true;
  }

  return false;
}

// ============================================================================
// React Component Detection
// ============================================================================

/**
 * Detect React component name for an element
 * Uses multiple methods in order of reliability
 * @param {Element} element - DOM element
 * @returns {string|null} Component name or null
 */
function getReactComponentName(element) {
  if (!element) return null;

/**
 * Find React fiber key on an element
 * @param {Element} el - DOM element
 * @returns {string|null} The fiber key or null
 */
function findFiberKey(el) {
  if (!el) return null;
  return Object.keys(el).find(k =>
    k.startsWith('__reactFiber$') ||
    k.startsWith('__reactInternalInstance$') ||
    k.startsWith('__reactProps$')
  ) || null;
}

/**
 * Get component name from fiber
 * @param {Object} fiber - React fiber
 * @returns {string|null} Component name or null
 */
function nameFromFiber(fiber) {
  if (!fiber || !fiber.type) return null;

  if (typeof fiber.type === 'function') {
    const name = fiber.type.displayName || fiber.type.name;
    if (name && name !== 'Anonymous' && !name.startsWith('_')) return name;
  }

  if (typeof fiber.type === 'object' && fiber.type !== null) {
    if (fiber.type.displayName) return fiber.type.displayName;
    if (fiber.type.render) {
      const n = fiber.type.render.displayName || fiber.type.render.name;
      if (n && n !== 'Anonymous') return n;
    }
    if (fiber.type.type && typeof fiber.type.type === 'function') {
      const n = fiber.type.type.displayName || fiber.type.type.name;
      if (n && n !== 'Anonymous') return n;
    }
  }
  return null;
}

/**
 * Detect React component name for an element
 * Uses multiple methods - works WITHOUT React DevTools!
 * @param {Element} element - DOM element
 * @returns {string|null} Component name or null
 */
function getReactComponentName(element) {
  if (!element) return null;

  // Method 1: Find React fiber (works without DevTools!)
  let el = element;
  for (let i = 0; i < 10 && el; i++) {
    const fiberKey = findFiberKey(el);
    if (fiberKey) {
      let fiber = el[fiberKey];
      for (let j = 0; j < 20 && fiber; j++) {
        const name = nameFromFiber(fiber);
        if (name) {
          console.log('[React Annotator] Found component:', name);
          return name;
        }
        fiber = fiber.return;
      }
    }
    el = el.parentElement;
  }

  // Method 2: Check data attributes on element and parents
  el = element;
  for (let i = 0; i < 5 && el; i++) {
    const attrs = ['data-component', 'data-testid', 'data-cy', 'data-test'];
    for (const attr of attrs) {
      const val = el.getAttribute(attr);
      if (val) {
        console.log('[React Annotator] Found via data attr:', val);
        return val;
      }
    }
    el = el.parentElement;
  }

  // Method 3: PascalCase class names
  const cls = Array.from(element.classList).find(c => /^[A-Z][a-zA-Z0-9]+$/.test(c));
  if (cls) {
    console.log('[React Annotator] Found via class:', cls);
    return cls;
  }

  console.log('[React Annotator] No component found for:', element.tagName);
  return null;
}


// ============================================================================
// Highlight Functions
// ============================================================================

/**
 * Create the highlight overlay element
 * @returns {HTMLElement} Overlay element
 */
function createHighlightOverlay() {
  const overlay = document.createElement('div');
  overlay.className = 'react-annotator-overlay';
  overlay.style.cssText = `
    position: fixed;
    pointer-events: none;
    background: ${STYLES.highlightColor};
    border: ${STYLES.highlightBorder};
    border-radius: 4px;
    z-index: ${STYLES.iconZIndex};
    transition: all 0.1s ease-out;
    display: none;
  `;
  document.body.appendChild(overlay);
  return overlay;
}

/**
 * Highlight an element with overlay
 * @param {Element} element - Element to highlight
 */
function highlightElement(element) {
  if (!element || shouldIgnoreElement(element)) return;

  if (!state.highlightOverlay) {
    state.highlightOverlay = createHighlightOverlay();
  }

  const rect = element.getBoundingClientRect();
  const overlay = state.highlightOverlay;

  overlay.style.left = `${rect.left}px`;
  overlay.style.top = `${rect.top}px`;
  overlay.style.width = `${rect.width}px`;
  overlay.style.height = `${rect.height}px`;
  overlay.style.display = 'block';

  state.hoveredElement = element;
}

/**
 * Remove highlight from element
 */
function unhighlightElement() {
  if (state.highlightOverlay) {
    state.highlightOverlay.style.display = 'none';
  }
  state.hoveredElement = null;
}

// ============================================================================
// Annotation Popup
// ============================================================================

/**
 * Create and display the annotation popup
 * @param {Element} element - Element being annotated
 * @param {Object|null} existingAnnotation - Existing annotation to edit
 */
function createAnnotationPopup(element, existingAnnotation = null) {
  // Remove existing popup if any
  removeAnnotationPopup();

  const rect = element.getBoundingClientRect();
  const componentName = existingAnnotation?.reactComponent || getReactComponentName(element);

  // Create popup container
  const popup = document.createElement('div');
  popup.className = 'react-annotator-popup';
  popup.style.cssText = `
    position: fixed;
    z-index: ${STYLES.popupZIndex};
    background: #ffffff;
    border: 1px solid #e0e0e0;
    border-radius: 8px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
    padding: 16px;
    width: 320px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    color: #333;
  `;

  // Position popup (prefer right of element, fallback to left or below)
  let left = rect.right + 10;
  let top = rect.top;

  if (left + 340 > window.innerWidth) {
    left = rect.left - 330;
    if (left < 0) {
      left = Math.max(10, rect.left);
      top = rect.bottom + 10;
    }
  }

  if (top + 300 > window.innerHeight) {
    top = Math.max(10, window.innerHeight - 310);
  }

  popup.style.left = `${left}px`;
  popup.style.top = `${top}px`;

  // Create popup content
  popup.innerHTML = `
    <div style="margin-bottom: 12px;">
      <label style="display: block; font-weight: 600; margin-bottom: 4px; color: #555;">
        React Component
      </label>
      <input
        type="text"
        id="ra-component-name"
        value="${componentName || ''}"
        placeholder="${componentName ? '' : 'Component not detected - enter manually'}"
        style="
          width: 100%;
          padding: 8px 10px;
          border: 1px solid #ddd;
          border-radius: 4px;
          font-size: 14px;
          box-sizing: border-box;
          outline: none;
        "
      >
      ${componentName ? '<span style="font-size: 11px; color: #888; margin-top: 2px; display: block;">Auto-detected</span>' : ''}
    </div>

    <div style="margin-bottom: 12px;">
      <label style="display: block; font-weight: 600; margin-bottom: 4px; color: #555;">
        File Path (optional)
      </label>
      <input
        type="text"
        id="ra-file-path"
        value="${existingAnnotation?.filePath || ''}"
        placeholder="e.g., src/components/Button.tsx"
        style="
          width: 100%;
          padding: 8px 10px;
          border: 1px solid #ddd;
          border-radius: 4px;
          font-size: 14px;
          box-sizing: border-box;
          outline: none;
        "
      >
    </div>

    <div style="margin-bottom: 16px;">
      <label style="display: block; font-weight: 600; margin-bottom: 4px; color: #555;">
        Comment
      </label>
      <textarea
        id="ra-comment"
        placeholder="Describe what you want to change..."
        style="
          width: 100%;
          height: 80px;
          padding: 8px 10px;
          border: 1px solid #ddd;
          border-radius: 4px;
          font-size: 14px;
          box-sizing: border-box;
          resize: vertical;
          outline: none;
          font-family: inherit;
        "
      >${existingAnnotation?.comment || ''}</textarea>
    </div>

    <div style="display: flex; gap: 8px; justify-content: flex-end;">
      ${existingAnnotation ? `
        <button
          id="ra-delete-btn"
          style="
            padding: 8px 16px;
            background: #dc3545;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
            margin-right: auto;
          "
        >Delete</button>
      ` : ''}
      <button
        id="ra-cancel-btn"
        style="
          padding: 8px 16px;
          background: #f5f5f5;
          color: #333;
          border: 1px solid #ddd;
          border-radius: 4px;
          cursor: pointer;
          font-size: 14px;
        "
      >Cancel</button>
      <button
        id="ra-save-btn"
        style="
          padding: 8px 16px;
          background: #4287f5;
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 14px;
        "
      >Save</button>
    </div>
  `;

  document.body.appendChild(popup);
  state.popupElement = popup;
  state.selectedElement = element;

  // Focus on comment textarea
  setTimeout(() => {
    popup.querySelector('#ra-comment').focus();
  }, 50);

  // Add event listeners
  popup.querySelector('#ra-cancel-btn').addEventListener('click', () => {
    removeAnnotationPopup();
  });

  popup.querySelector('#ra-save-btn').addEventListener('click', () => {
    saveAnnotation(element, existingAnnotation);
  });

  const deleteBtn = popup.querySelector('#ra-delete-btn');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', () => {
      deleteAnnotation(existingAnnotation.id);
    });
  }

  // Add hover effects
  const buttons = popup.querySelectorAll('button');
  buttons.forEach(btn => {
    btn.addEventListener('mouseenter', () => {
      btn.style.opacity = '0.9';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.opacity = '1';
    });
  });

  // Close on Escape key
  const escHandler = (e) => {
    if (e.key === 'Escape') {
      removeAnnotationPopup();
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);
}

/**
 * Remove the annotation popup
 */
function removeAnnotationPopup() {
  if (state.popupElement) {
    state.popupElement.remove();
    state.popupElement = null;
  }
  state.selectedElement = null;
}

/**
 * Capture and crop screenshot of an element
 */
async function captureElementScreenshot(element) {
  try {
    const rect = element.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const response = await browserAPI.runtime.sendMessage({ type: 'CAPTURE_SCREENSHOT' });
    if (!response?.success) return null;

    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = response.screenshot; });

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.drawImage(img, rect.left * dpr, rect.top * dpr, rect.width * dpr, rect.height * dpr, 0, 0, canvas.width, canvas.height);

    return canvas.toDataURL('image/jpeg', 0.8);
  } catch (e) {
    console.error('[React Annotator] Screenshot error:', e);
    return null;
  }
}

/**
 * Save annotation from popup inputs
 */
async function saveAnnotation(element, existingAnnotation) {
  const popup = state.popupElement;
  if (!popup) return;

  const componentName = popup.querySelector('#ra-component-name').value.trim();
  const filePath = popup.querySelector('#ra-file-path').value.trim();
  const comment = popup.querySelector('#ra-comment').value.trim();

  if (!comment) {
    alert('Please enter a comment');
    return;
  }

  // Show saving state
  const saveBtn = popup.querySelector('#ra-save-btn');
  if (saveBtn) { saveBtn.textContent = 'Capturing...'; saveBtn.disabled = true; }

  // Capture screenshot
  const screenshot = await captureElementScreenshot(element);

  const annotation = {
    id: existingAnnotation?.id || generateId(),
    selector: generateSelector(element),
    xpath: generateXPath(element),
    reactComponent: componentName || null,
    filePath: filePath || null,
    comment: comment,
    elementHTML: element.outerHTML.substring(0, 200),
    screenshot: screenshot,
    timestamp: Date.now(),
    url: window.location.href,
  };

  state.annotations.set(annotation.id, annotation);
  createCommentIcon(element, annotation);
  saveAnnotationsToStorage();
  removeAnnotationPopup();

  console.log('[React Annotator] Saved with screenshot:', annotation.id);
}

/**
 * Delete an annotation
 * @param {string} id - Annotation ID
 */
function deleteAnnotation(id) {
  state.annotations.delete(id);

  // Remove comment icon
  const icon = state.commentIcons.get(id);
  if (icon) {
    icon.remove();
    state.commentIcons.delete(id);
  }

  saveAnnotationsToStorage();
  removeAnnotationPopup();

  console.log('[React Annotator] Annotation deleted:', id);
}

// ============================================================================
// Comment Icons
// ============================================================================

/**
 * Create or update a comment icon for an annotation
 * @param {Element} element - Annotated element
 * @param {Object} annotation - Annotation data
 */
function createCommentIcon(element, annotation) {
  // Remove existing icon if any
  const existingIcon = state.commentIcons.get(annotation.id);
  if (existingIcon) {
    existingIcon.remove();
  }

  const icon = document.createElement('div');
  icon.className = 'react-annotator-icon';
  icon.dataset.annotationId = annotation.id;
  icon.innerHTML = `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M21 15C21 15.5304 20.7893 16.0391 20.4142 16.4142C20.0391 16.7893 19.5304 17 19 17H7L3 21V5C3 4.46957 3.21071 3.96086 3.58579 3.58579C3.96086 3.21071 4.46957 3 5 3H19C19.5304 3 20.0391 3.21071 20.4142 3.58579C20.7893 3.96086 21 4.46957 21 5V15Z" fill="#4287f5" stroke="#2a6dd9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `;
  icon.style.cssText = `
    position: absolute;
    z-index: ${STYLES.iconZIndex};
    cursor: pointer;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: white;
    border-radius: 50%;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    transition: transform 0.15s ease;
  `;

  icon.addEventListener('mouseenter', () => {
    icon.style.transform = 'scale(1.1)';
  });

  icon.addEventListener('mouseleave', () => {
    icon.style.transform = 'scale(1)';
  });

  icon.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    createAnnotationPopup(element, annotation);
  });

  document.body.appendChild(icon);
  state.commentIcons.set(annotation.id, icon);

  // Position the icon
  positionCommentIcon(icon, element);
}

/**
 * Position a comment icon relative to its element
 * @param {HTMLElement} icon - Icon element
 * @param {Element} element - Target element
 */
function positionCommentIcon(icon, element) {
  const rect = element.getBoundingClientRect();
  const scrollX = window.scrollX || window.pageXOffset;
  const scrollY = window.scrollY || window.pageYOffset;

  icon.style.left = `${rect.right + scrollX - 12}px`;
  icon.style.top = `${rect.top + scrollY - 12}px`;
}

/**
 * Reposition all comment icons (called on scroll/resize)
 */
function repositionAllIcons() {
  for (const [id, icon] of state.commentIcons) {
    const annotation = state.annotations.get(id);
    if (!annotation) continue;

    const element = findElement(annotation);
    if (element) {
      positionCommentIcon(icon, element);
    } else {
      // Element no longer exists, hide icon
      icon.style.display = 'none';
    }
  }
}

/**
 * Restore comment icons for all annotations
 */
function restoreCommentIcons() {
  for (const [id, annotation] of state.annotations) {
    const element = findElement(annotation);
    if (element) {
      createCommentIcon(element, annotation);
    }
  }
}

// ============================================================================
// Selection Mode
// ============================================================================

/**
 * Toggle selection mode on/off
 */
function toggleSelectionMode() {
  state.isSelectionMode = !state.isSelectionMode;

  if (state.isSelectionMode) {
    document.body.style.cursor = 'crosshair';
    console.log('[React Annotator] Selection mode ENABLED');
  } else {
    document.body.style.cursor = '';
    unhighlightElement();
    console.log('[React Annotator] Selection mode DISABLED');
  }

  // Notify popup of state change
  browserAPI.runtime.sendMessage({
    type: 'SELECTION_MODE_CHANGED',
    isActive: state.isSelectionMode,
  });
}

/**
 * Enable selection mode
 */
function enableSelectionMode() {
  if (!state.isSelectionMode) {
    toggleSelectionMode();
  }
}

/**
 * Disable selection mode
 */
function disableSelectionMode() {
  if (state.isSelectionMode) {
    toggleSelectionMode();
  }
}

// ============================================================================
// Event Handlers
// ============================================================================

/**
 * Handle mouse move events during selection mode
 * @param {MouseEvent} event
 */
function handleMouseMove(event) {
  if (!state.isSelectionMode) return;

  const element = document.elementFromPoint(event.clientX, event.clientY);

  if (element && !shouldIgnoreElement(element)) {
    highlightElement(element);
  } else {
    unhighlightElement();
  }
}

/**
 * Handle click events during selection mode
 * @param {MouseEvent} event
 */
function handleClick(event) {
  if (!state.isSelectionMode) return;
  if (shouldIgnoreElement(event.target)) return;

  event.preventDefault();
  event.stopPropagation();

  const element = state.hoveredElement || event.target;

  // Check if element already has an annotation
  let existingAnnotation = null;
  for (const [id, annotation] of state.annotations) {
    const annotatedElement = findElement(annotation);
    if (annotatedElement === element) {
      existingAnnotation = annotation;
      break;
    }
  }

  unhighlightElement();
  createAnnotationPopup(element, existingAnnotation);
}

/**
 * Handle keyboard shortcuts
 * @param {KeyboardEvent} event
 */
function handleKeyDown(event) {
  // Alt+Shift+R to toggle selection mode
  if (event.altKey && event.shiftKey && event.key === 'R') {
    event.preventDefault();
    toggleSelectionMode();
  }
}

// ============================================================================
// Storage Functions
// ============================================================================

/**
 * Save annotations to extension storage
 */
function saveAnnotationsToStorage() {
  const annotationsArray = Array.from(state.annotations.values());

  browserAPI.runtime.sendMessage({
    type: 'SAVE_ANNOTATIONS',
    url: window.location.href,
    annotations: annotationsArray,
  });
}

/**
 * Load annotations from extension storage
 */
function loadAnnotationsFromStorage() {
  browserAPI.runtime.sendMessage({
    type: 'LOAD_ANNOTATIONS',
    url: window.location.href,
  }, (response) => {
    if (response && response.annotations) {
      state.annotations.clear();

      for (const annotation of response.annotations) {
        state.annotations.set(annotation.id, annotation);
      }

      restoreCommentIcons();
      console.log('[React Annotator] Loaded', state.annotations.size, 'annotations');
    }
  });
}

// ============================================================================
// Message Handling
// ============================================================================

/**
 * Handle messages from popup or background script
 */
browserAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'TOGGLE_SELECTION_MODE':
      toggleSelectionMode();
      sendResponse({ isActive: state.isSelectionMode });
      break;

    case 'ENABLE_SELECTION_MODE':
      enableSelectionMode();
      sendResponse({ isActive: state.isSelectionMode });
      break;

    case 'DISABLE_SELECTION_MODE':
      disableSelectionMode();
      sendResponse({ isActive: state.isSelectionMode });
      break;

    case 'GET_SELECTION_MODE':
      sendResponse({ isActive: state.isSelectionMode });
      break;

    case 'GET_ANNOTATIONS':
      sendResponse({
        annotations: Array.from(state.annotations.values()),
      });
      break;

    case 'EXPORT_ANNOTATIONS':
      const exportData = {
        url: window.location.href,
        title: document.title,
        exportedAt: new Date().toISOString(),
        annotations: Array.from(state.annotations.values()),
      };
      sendResponse({ exportData });
      break;

    case 'CLEAR_ANNOTATIONS':
      // Remove all icons
      for (const icon of state.commentIcons.values()) {
        icon.remove();
      }
      state.commentIcons.clear();
      state.annotations.clear();
      saveAnnotationsToStorage();
      sendResponse({ success: true });
      break;

    case 'PING':
      sendResponse({ pong: true });
      break;

    default:
      console.log('[React Annotator] Unknown message type:', message.type);
  }

  return true; // Keep message channel open for async response
});

// ============================================================================
// Mutation Observer
// ============================================================================

/**
 * Set up MutationObserver to handle DOM changes
 */
function setupMutationObserver() {
  state.mutationObserver = new MutationObserver((mutations) => {
    // Debounce repositioning
    requestAnimationFrame(() => {
      repositionAllIcons();
    });
  });

  state.mutationObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['style', 'class'],
  });
}

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initialize the content script
 */
function initialize() {
  console.log('[React Annotator] Initializing...');

  // Add event listeners
  document.addEventListener('mousemove', handleMouseMove, true);
  document.addEventListener('click', handleClick, true);
  document.addEventListener('keydown', handleKeyDown, true);

  // Handle scroll and resize
  window.addEventListener('scroll', () => {
    requestAnimationFrame(repositionAllIcons);
  }, { passive: true });

  window.addEventListener('resize', () => {
    requestAnimationFrame(repositionAllIcons);
  }, { passive: true });

  // Set up mutation observer
  setupMutationObserver();

  // Load saved annotations
  loadAnnotationsFromStorage();

  console.log('[React Annotator] Initialized successfully');
}

// Start when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  initialize();
}
