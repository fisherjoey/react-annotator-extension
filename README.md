# React Annotator for Claude

A Firefox browser extension for annotating React components on any webpage. Click elements to add comments, automatically detect React component names, and export annotations in a Claude-friendly markdown format.

## Features

- **Click to Annotate** - Select any element on a React page and add comments
- **React Component Detection** - Automatically detects component names from React fiber
- **Smart Path Suggestions** - Suggests file paths based on component names (with uncertainty markers)
- **Screenshot Capture** - Captures element screenshots (stored locally in extension)
- **Dark Theme UI** - Clean, readable popup interface
- **DevTools Integration** - "Inspect" button to help locate components in React DevTools
- **Claude-Friendly Export** - Copy annotations as markdown with classes, HTML, and context

## Installation

1. Open Firefox and go to `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on"
3. Select `manifest.json` from this folder

## Usage

1. **Enable annotation mode**: Press `Alt+Shift+R` or click the extension icon → "Start Annotating"
2. **Click an element**: A popup appears with auto-detected component info
3. **Add your comment**: Describe what you want to change
4. **Save**: The annotation is stored with a comment icon on the page
5. **Export**: Click "Copy for Claude" to get markdown output

## Export Format

```markdown
### 1. WaitlistSection
- **File (suggested):** `components/waitlist-section.tsx` ⚠️ *search for "WaitlistSection" to verify*
- **Classes:** `relative rounded-2xl border p-8 transition-all`
- **Comment:** Change the heading color to blue

<details>
<summary>Element HTML</summary>

html
<div class="relative rounded-2xl border...">...</div>

</details>
```

## How Component Detection Works

The extension injects a script into the page context to access React's internal fiber tree:

1. Finds `__reactFiber$` keys on DOM elements
2. Traverses the fiber tree to find component names or keys
3. Skips library wrappers like `motion.div`, `Suspense`, etc.
4. Falls back to data attributes or PascalCase class names

**Note:** File paths are *suggested* based on kebab-case conversion. Marked with ⚠️ since actual paths require source maps.

## Keyboard Shortcuts

- `Alt+Shift+R` - Toggle annotation mode

## License

MIT
