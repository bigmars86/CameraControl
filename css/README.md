# CSS Module Structure

This folder contains modular CSS files for the Camera Control Interface.

## File Organization

### main.css

**Entry point** - Import this file in your HTML. It loads all other CSS modules in the correct order.

### base.css

**Foundation styles**

- CSS reset
- CSS variables (colors, shadows)
- Body and typography
- Loading/error states
- Animations

### layout.css

**Page structure**

- Container and grid layout
- Header styling
- Camera preview section
- Video container
- Status indicators

### controls.css

**Camera controls**

- PTZ button grid
- Zoom buttons
- Speed sliders
- Button states and hover effects
- Keyboard active states

### presets.css

**Preset system**

- Preset grid layout
- Preset items with golden ratio (1.618:1)
- Preset numbers/badges
- Keyboard help section
- Preset messages

### modal.css

**Configuration modal**

- Modal overlay
- Modal content
- Form groups
- Input fields
- Select dropdowns
- Buttons

### responsive.css

**Media queries**

- Mobile layout (max-width: 768px)
- Small mobile (max-width: 480px)
- Landscape orientation handling
- Button sizing consistency

## Importing in HTML

```html
<link rel="stylesheet" href="css/main.css" />
```

The `main.css` file automatically imports all modules in the correct order.

## Modifying Styles

### To change colors

Edit `base.css` → `:root` variables

### To adjust layout

Edit `layout.css` → `.main-grid` or `.container`

### To modify button behavior

Edit `controls.css` → `.ptz-btn` or `.zoom-btn`

### To change preset appearance

Edit `presets.css` → `.preset-item`

### To update mobile behavior

Edit `responsive.css` → Media queries

## CSS Variable Reference

```css
--primary-color: #2c3e50; /* Dark blue-gray */
--secondary-color: #3498db; /* Blue */
--accent-color: #e74c3c; /* Red */
--success-color: #27ae60; /* Green */
--warning-color: #f39c12; /* Orange */
--background-color: #ecf0f1; /* Light gray */
--card-background: #ffffff; /* White */
--text-color: #2c3e50; /* Dark blue-gray */
--border-color: #bdc3c7; /* Gray */
--shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
```

## Benefits of This Structure

✅ **Modular** - Each file has a single responsibility
✅ **Maintainable** - Easy to find and edit specific styles
✅ **Scalable** - Add new modules without affecting existing ones
✅ **Organized** - Clear separation of concerns
✅ **Efficient** - Only edit what you need
✅ **Documented** - Each file has clear comments

## Order of Import (Important!)

The order in `main.css` matters:

1. **base.css** - Must load first (defines variables)
2. **layout.css** - Uses base variables
3. **controls.css** - Uses base variables
4. **presets.css** - Uses base variables
5. **modal.css** - Uses base variables
6. **responsive.css** - Must load last (overrides previous styles)

## File Size Comparison

| File           | Lines    | Purpose         |
| -------------- | -------- | --------------- |
| base.css       | ~75      | Foundation      |
| layout.css     | ~105     | Structure       |
| controls.css   | ~225     | Interactions    |
| presets.css    | ~135     | Presets         |
| modal.css      | ~100     | Forms           |
| responsive.css | ~110     | Mobile          |
| **Total**      | **~750** | Complete system |

Previously: Single `style.css` with 682 lines - now organized into logical modules!
