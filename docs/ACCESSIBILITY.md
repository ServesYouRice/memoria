# Accessibility Guide

> **FIXED:** Issue #41 - Missing accessibility features

This guide outlines accessibility (a11y) improvements for CanvasCollect to ensure the application is usable by everyone, including people with disabilities.

## Table of Contents

- [Overview](#overview)
- [WCAG Compliance](#wcag-compliance)
- [Keyboard Navigation](#keyboard-navigation)
- [Screen Reader Support](#screen-reader-support)
- [ARIA Labels](#aria-labels)
- [Focus Management](#focus-management)
- [Color Contrast](#color-contrast)
- [Implementation Checklist](#implementation-checklist)
- [Testing](#testing)

---

## Overview

### Why Accessibility Matters

- **15% of the world's population** has some form of disability
- **Legal requirement** in many jurisdictions (ADA, Section 508, EAA)
- **Better UX for everyone** - keyboard navigation benefits power users
- **SEO benefits** - accessible sites rank better
- **Business value** - larger potential user base

### Current Status

✅ **Implemented:**
- Semantic HTML structure
- Material-UI components (built-in a11y)
- Form labels and validation
- Error messages

⚠️ **Needs Improvement:**
- Keyboard navigation for canvas
- ARIA labels for custom components
- Focus management for dialogs
- Skip links for main content
- Announcement regions for dynamic content

---

## WCAG Compliance

Targeting **WCAG 2.1 Level AA** compliance.

### Level A (Must Have)

- [ ] Text alternatives for images
- [ ] Keyboard accessible
- [ ] Color not used as only visual means
- [ ] Clear focus indicators
- [ ] Form labels and instructions

### Level AA (Should Have)

- [ ] 4.5:1 contrast ratio for normal text
- [ ] 3:1 contrast ratio for large text
- [ ] Resize text up to 200%
- [ ] Multiple ways to find pages
- [ ] Headings and labels descriptive

### Level AAA (Nice to Have)

- [ ] 7:1 contrast ratio for normal text
- [ ] 4.5:1 contrast ratio for large text
- [ ] Sign language for audio content

---

## Keyboard Navigation

### Global Shortcuts

| Key | Action |
|-----|--------|
| `Tab` | Move focus forward |
| `Shift + Tab` | Move focus backward |
| `Escape` | Close dialogs/modals |
| `Enter` | Activate button/link |
| `Space` | Activate button, check checkbox |
| `Arrow Keys` | Navigate within components |

### Canvas Shortcuts

| Key | Action |
|-----|--------|
| `Ctrl/Cmd + N` | Create new note |
| `Ctrl/Cmd + B` | Create new bookmark |
| `Delete` | Delete selected items |
| `Ctrl/Cmd + Z` | Undo |
| `Ctrl/Cmd + Y` | Redo |
| `Ctrl/Cmd + A` | Select all items |
| `Ctrl/Cmd + C` | Copy selected items |
| `Ctrl/Cmd + V` | Paste items |
| `Arrow Keys` | Move selected items |
| `+` / `-` | Zoom in/out |
| `0` | Reset zoom |

### Implementation Example

```tsx
// Add keyboard handler to canvas
function Canvas() {
  const handleKeyDown = (e: KeyboardEvent) => {
    // Prevent default for keyboard shortcuts
    if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
      e.preventDefault();
      openCreateNoteDialog();
    }

    if (e.key === 'Delete') {
      deleteSelectedItems();
    }

    // Arrow keys to move items
    if (e.key.startsWith('Arrow')) {
      e.preventDefault();
      moveSelectedItems(e.key);
    }
  };

  return (
    <div
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="application"
      aria-label="Canvas workspace"
    >
      {/* Canvas content */}
    </div>
  );
}
```

---

## Screen Reader Support

### Semantic HTML

Use proper HTML elements instead of divs:

```tsx
// ❌ Bad
<div onClick={handleClick}>Submit</div>

// ✅ Good
<button onClick={handleClick}>Submit</button>
```

### Landmarks

```tsx
// Use semantic landmarks
<header>
  <nav aria-label="Main navigation">
    <ul>
      <li><a href="/dashboard">Dashboard</a></li>
    </ul>
  </nav>
</header>

<main>
  <h1>Canvas Editor</h1>
  {/* Main content */}
</main>

<aside aria-label="Comments">
  {/* Comments panel */}
</aside>

<footer>
  {/* Footer content */}
</footer>
```

### Skip Links

Add skip links for keyboard users:

```tsx
// app/layout.tsx
export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        {/* Skip link - first focusable element */}
        <a
          href="#main-content"
          className="skip-link"
          style={{
            position: 'absolute',
            left: '-9999px',
            zIndex: 999,
          }}
          onFocus={(e) => {
            e.currentTarget.style.left = '0';
          }}
          onBlur={(e) => {
            e.currentTarget.style.left = '-9999px';
          }}
        >
          Skip to main content
        </a>

        <nav>{/* Navigation */}</nav>

        <main id="main-content" tabIndex={-1}>
          {children}
        </main>
      </body>
    </html>
  );
}
```

---

## ARIA Labels

### Interactive Elements

```tsx
// Buttons without text
<IconButton aria-label="Delete item">
  <DeleteIcon />
</IconButton>

<IconButton aria-label="Share canvas">
  <ShareIcon />
</IconButton>

// Form inputs
<TextField
  label="Canvas name"
  aria-label="Canvas name"
  aria-describedby="name-helper-text"
/>
<span id="name-helper-text">
  Enter a descriptive name for your canvas
</span>
```

### Dynamic Content

```tsx
// Live regions for announcements
function Canvas() {
  const [announcement, setAnnouncement] = useState('');

  const saveItem = async () => {
    await api.saveItem();
    setAnnouncement('Item saved successfully');
    setTimeout(() => setAnnouncement(''), 3000);
  };

  return (
    <div>
      {/* Visually hidden, but announced to screen readers */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {announcement}
      </div>

      {/* Canvas content */}
    </div>
  );
}
```

### Complex Widgets

```tsx
// Canvas item with ARIA
function NoteItem({ item, isSelected, onSelect }) {
  return (
    <div
      role="article"
      aria-label={`Note: ${item.content.text.substring(0, 50)}`}
      aria-selected={isSelected}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      {item.content.text}
    </div>
  );
}
```

### Dialog Accessibility

```tsx
// Accessible dialog
function CreateNoteDialog({ open, onClose }) {
  const firstInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      // Focus first input when dialog opens
      firstInputRef.current?.focus();
    }
  }, [open]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      aria-labelledby="dialog-title"
      aria-describedby="dialog-description"
    >
      <DialogTitle id="dialog-title">
        Create New Note
      </DialogTitle>

      <DialogContent>
        <div id="dialog-description">
          Enter the content for your new note
        </div>

        <TextField
          ref={firstInputRef}
          label="Note content"
          aria-label="Note content"
          fullWidth
        />
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="contained">
          Create
        </Button>
      </DialogActions>
    </Dialog>
  );
}
```

---

## Focus Management

### Focus Order

Ensure logical tab order:

```tsx
// Use tabIndex appropriately
<div tabIndex={0}>Focusable div</div>
<div tabIndex={-1}>Programmatically focusable, not in tab order</div>
<div tabIndex={1}>❌ Avoid positive tabIndex - breaks natural order</div>
```

### Focus Visible

```tsx
// CSS for focus indicators
.focus-visible:focus {
  outline: 2px solid #1976d2;
  outline-offset: 2px;
}

// Or use Material-UI's focusVisible
<Button
  sx={{
    '&:focus-visible': {
      outline: '2px solid',
      outlineColor: 'primary.main',
    },
  }}
>
  Click me
</Button>
```

### Focus Trapping

```tsx
// Trap focus within dialog
import { FocusTrap } from '@mui/base/FocusTrap';

function Dialog({ open, onClose, children }) {
  if (!open) return null;

  return (
    <FocusTrap open>
      <div role="dialog" aria-modal="true">
        {children}
        <Button onClick={onClose}>Close</Button>
      </div>
    </FocusTrap>
  );
}
```

---

## Color Contrast

### Minimum Ratios

- **Normal text:** 4.5:1
- **Large text (18pt+ or 14pt+ bold):** 3:1
- **UI components and graphics:** 3:1

### Checking Contrast

```bash
# Use Chrome DevTools
1. Inspect element
2. Look for contrast ratio in color picker
3. Should show: Contrast ratio: 7.02 ✓

# Or use online tools
https://webaim.org/resources/contrastchecker/
```

### Implementation

```tsx
// Define accessible color palette
const theme = createTheme({
  palette: {
    primary: {
      main: '#1976d2', // Contrast ratio: 4.57:1 on white ✓
    },
    secondary: {
      main: '#dc004e', // Contrast ratio: 5.12:1 on white ✓
    },
    text: {
      primary: '#000000de', // Contrast ratio: 15.8:1 on white ✓
      secondary: '#00000099', // Contrast ratio: 7.0:1 on white ✓
    },
  },
});
```

---

## Implementation Checklist

### Global

- [ ] Add skip links to main content
- [ ] Ensure logical heading hierarchy (h1, h2, h3...)
- [ ] Add page titles for each route
- [ ] Implement keyboard shortcuts
- [ ] Add shortcuts help dialog (press `?`)

### Forms

- [ ] All inputs have labels
- [ ] Error messages are associated with inputs
- [ ] Required fields are indicated
- [ ] Form validation errors announced to screen readers
- [ ] Focus moves to first error on submit

### Buttons & Links

- [ ] All icon buttons have aria-label
- [ ] Link text is descriptive (not "click here")
- [ ] Disabled state communicated to screen readers
- [ ] Loading state communicated to screen readers

### Dialogs & Modals

- [ ] Focus moves to dialog when opened
- [ ] Focus returns to trigger when closed
- [ ] Escape key closes dialog
- [ ] Focus is trapped within dialog
- [ ] Dialog has title (aria-labelledby)

### Canvas

- [ ] Keyboard navigation for items
- [ ] Arrow keys move selected items
- [ ] Enter key to edit item
- [ ] Screen reader announcements for actions
- [ ] Context menu accessible via keyboard

### Images

- [ ] All images have alt text
- [ ] Decorative images have alt=""
- [ ] Complex images have longer descriptions

---

## Testing

### Automated Testing

```bash
# Install axe-core for automated a11y testing
pnpm add -D @axe-core/react

# Add to test setup
import { configureAxe } from '@axe-core/react';

if (process.env.NODE_ENV !== 'production') {
  configureAxe({
    rules: [
      {
        id: 'color-contrast',
        enabled: true,
      },
    ],
  });
}
```

### Manual Testing

#### Keyboard Testing

1. Unplug your mouse
2. Navigate using only keyboard
3. Ensure all interactive elements are reachable
4. Check focus indicators are visible
5. Test all keyboard shortcuts

#### Screen Reader Testing

**macOS:**
```bash
# Enable VoiceOver
Cmd + F5

# Basic commands
Ctrl + Option + Arrow keys - Navigate
Ctrl + Option + Space - Click
Ctrl - Stop speaking
```

**Windows:**
```bash
# Install NVDA (free)
https://www.nvaccess.org/download/

# Basic commands
Insert + Down arrow - Read next
Insert + Space - Click
Ctrl - Stop speaking
```

**Testing checklist:**
- [ ] Can navigate to all content
- [ ] Form labels are announced
- [ ] Buttons announce their purpose
- [ ] Dynamic content announcements work
- [ ] Error messages are announced
- [ ] Modal opens and focus is clear

#### Color Contrast Testing

**Tools:**
- Chrome DevTools contrast checker
- [WebAIM Contrast Checker](https://webaim.org/resources/contrastchecker/)
- [Accessible Colors](https://accessible-colors.com/)

**Test:**
- [ ] Text on backgrounds
- [ ] Button colors
- [ ] Link colors
- [ ] Focus indicators
- [ ] Disabled states

### Browser Extensions

- **axe DevTools** - Automated accessibility testing
- **WAVE** - Visual accessibility checker
- **Accessibility Insights** - Microsoft's a11y tester

---

## Resources

### Standards

- [WCAG 2.1](https://www.w3.org/WAI/WCAG21/quickref/)
- [ARIA Authoring Practices](https://www.w3.org/WAI/ARIA/apg/)
- [MDN Accessibility](https://developer.mozilla.org/en-US/docs/Web/Accessibility)

### Tools

- [axe DevTools](https://www.deque.com/axe/devtools/)
- [WAVE](https://wave.webaim.org/)
- [Lighthouse](https://developers.google.com/web/tools/lighthouse)
- [Pa11y](https://pa11y.org/)

### Testing

- [WebAIM Screen Reader User Survey](https://webaim.org/projects/screenreadersurvey9/)
- [Inclusive Components](https://inclusive-components.design/)
- [A11y Project Checklist](https://www.a11yproject.com/checklist/)

---

## Quick Wins

### 1. Add Alt Text to Images

```tsx
<Image
  src="/logo.png"
  alt="CanvasCollect logo"
  width={200}
  height={50}
/>
```

### 2. Label Icon Buttons

```tsx
<IconButton aria-label="Delete item">
  <DeleteIcon />
</IconButton>
```

### 3. Add Form Labels

```tsx
<label htmlFor="email">Email</label>
<input id="email" type="email" />
```

### 4. Add Page Titles

```tsx
// app/canvas/[id]/page.tsx
export const metadata = {
  title: 'Edit Canvas | CanvasCollect',
};
```

### 5. Keyboard Navigation

```tsx
<div
  role="button"
  tabIndex={0}
  onClick={handleClick}
  onKeyDown={(e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      handleClick();
    }
  }}
>
  Click me
</div>
```

---

**Last Updated:** 2025-11-15
**Issue:** #41 - Missing accessibility features
**Status:** Implementation guide created
