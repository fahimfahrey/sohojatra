# Splash Screen Background Fix

## Problem

The `sohojatra.png` logo has a transparent background, which doesn't look good on the splash screen.

## Solutions

### Option 1: Use Manifest Background Color (Current)

The manifest is already set to white background:

```typescript
background_color: "#ffffff";
```

However, this might not work consistently across all platforms.

### Option 2: Create Logo with White Background (Recommended)

Create a new version of the logo with a white background:

**Steps:**

1. Open `public/sohojatra.png` in an image editor
2. Add a white background layer
3. Save as `public/sohojatra-splash.png`
4. Update manifest to use the new file

**Or use ImageMagick:**

```bash
# Add white background to existing logo
convert public/sohojatra.png -background white -alpha remove -alpha off public/sohojatra-splash.png
```

### Option 3: Add White Circle/Square Background

Create a logo with a white circle or rounded square background:

```bash
# Create logo with white circle background
convert public/sohojatra.png \
  -background white \
  -gravity center \
  -extent 240x240 \
  public/sohojatra-splash.png
```

### Option 4: Match App Theme (Blue Background)

Use your app's blue theme color for consistency:

```typescript
background_color: "#3b82f6"; // Blue theme
```

Then create a logo that works well on blue:

```bash
# Create logo with blue background
convert public/sohojatra.png \
  -background "#3b82f6" \
  -alpha remove \
  public/sohojatra-splash.png
```

## Recommended Approach

**Best Solution**: Provide a logo with a white background (or white circle/rounded square).

This ensures:

- ✅ Consistent appearance across all platforms
- ✅ Professional look
- ✅ No transparency issues
- ✅ Works on all devices

## Implementation

Once you have the logo with white background, update `vite.config.ts`:

```typescript
icons: [
  {
    src: "/sohojatra-splash.png", // Logo with white background
    sizes: "200x200",
    type: "image/png",
    purpose: "any",
  },
  {
    src: "/sohojatra-splash.png",
    sizes: "200x200",
    type: "image/png",
    purpose: "maskable",
  },
];
```

## Quick Fix (If You Want to Try)

I can create a version with a white background using ImageMagick if you have it installed, or you can:

1. **Provide a new logo** with white background
2. **Use an online tool** like:
   - https://www.remove.bg/ (remove bg, then add white)
   - https://www.canva.com/ (add white background)
   - https://www.photopea.com/ (free Photoshop alternative)

## What Would You Like?

Please choose:

1. **Provide a white-backgrounded logo** (I'll update the config)
2. **Let me try to add white background** using ImageMagick
3. **Use blue background** to match your theme
4. **Create a white circle/square** behind the logo

Let me know your preference!
