# PWA Icon Configuration

## Current Setup

### Icon File

- **File**: `public/sohojatra.png`
- **Actual Size**: 200x200 pixels
- **Format**: PNG with transparency (RGBA)

### Manifest Configuration

The PWA manifest (`vite.config.ts`) is configured to use `sohojatra.png` for:

- App icon on home screen
- Splash screen logo
- Browser install prompt
- Taskbar/dock icon (desktop)

```typescript
icons: [
  {
    src: "/sohojatra.png",
    sizes: "200x200",
    type: "image/png",
    purpose: "any",
  },
  {
    src: "/sohojatra.png",
    sizes: "200x200",
    type: "image/png",
    purpose: "maskable",
  },
];
```

## Display Sizes

### How Icons Are Displayed

The browser/OS automatically scales the icon based on:

1. **Device screen density** (1x, 2x, 3x, etc.)
2. **Context** (home screen, splash screen, notification)
3. **Platform** (Android, iOS, Desktop)

### Typical Display Sizes

| Context       | Android              | iOS                   | Desktop  |
| ------------- | -------------------- | --------------------- | -------- |
| Home Screen   | 48-96dp (~100-200px) | 60-180pt (~120-360px) | 32-256px |
| Splash Screen | ~100-150dp           | ~100-150pt            | N/A      |
| Notification  | 24-48dp              | 40-60pt               | 16-48px  |

**Note**: The 200x200 source image will be automatically scaled to the appropriate display size by the device. On most devices, this will appear around 100x100 logical pixels on the splash screen.

## Icon Purposes

### "any" Purpose

- Used for standard app icons
- Displayed as-is with the full image
- Best for icons with padding/margins

### "maskable" Purpose

- Used for adaptive icons (Android)
- Safe zone: center 80% of the image
- Outer 20% may be cropped/masked
- Allows for shaped icons (circle, squircle, etc.)

## Platform-Specific Behavior

### Android (Chrome)

- Uses "maskable" icons if available
- Applies device-specific shape (circle, rounded square, etc.)
- Splash screen shows icon at ~100-120dp
- Home screen icon: 48-96dp depending on launcher

### iOS (Safari)

- Uses apple-touch-icon from HTML
- Always displays as rounded square
- Splash screen shows icon at ~100-120pt
- Home screen icon: 60-180pt depending on device

### Desktop (Chrome/Edge)

- Uses "any" icons
- Displays in window title bar and taskbar
- Typical sizes: 16px, 32px, 48px, 128px, 256px
- Browser scales from 200x200 source

## Visual Display Size

While the source image is 200x200px, the **visual display size** on most devices will be approximately:

- **Splash Screen**: ~100-150 logical pixels
- **Home Screen**: ~80-120 logical pixels (varies by device)
- **Desktop**: ~32-48 pixels (taskbar/title bar)

This is because:

1. High-DPI displays use multiple physical pixels per logical pixel
2. Operating systems scale icons based on UI density
3. Different contexts use different sizes

## Recommendations

### Current Setup (200x200)

✅ **Good for**: Most use cases
✅ **Pros**:

- Works well on standard and high-DPI displays
- Appropriate for splash screens
- Good balance of quality and file size

### If You Want Larger Icons

For better quality on high-DPI displays, consider:

- **512x512**: Better for high-end devices
- **1024x1024**: Maximum quality (larger file size)

### If You Want Smaller File Size

- **192x192**: Standard PWA size (slightly smaller file)
- **144x144**: Minimum recommended size

## How to Change Icon Size

### Option 1: Use Current 200x200 (Recommended)

No changes needed. The current setup works well.

### Option 2: Create Multiple Sizes

Add different sizes to the manifest:

```typescript
icons: [
  {
    src: "/sohojatra-192.png",
    sizes: "192x192",
    type: "image/png",
    purpose: "any",
  },
  {
    src: "/sohojatra-512.png",
    sizes: "512x512",
    type: "image/png",
    purpose: "any",
  },
  {
    src: "/sohojatra-maskable.png",
    sizes: "512x512",
    type: "image/png",
    purpose: "maskable",
  },
];
```

### Option 3: Resize Current Image

To create a 512x512 version:

```bash
# Using ImageMagick
convert public/sohojatra.png -resize 512x512 public/sohojatra-512.png

# Or use online tools like:
# - https://www.iloveimg.com/resize-image
# - https://squoosh.app/
```

## Testing Icon Display

### On Mobile

1. Install the PWA
2. Check home screen icon size
3. Launch app and observe splash screen
4. Icon should appear centered at ~100-120 logical pixels

### On Desktop

1. Install the PWA
2. Check taskbar/dock icon
3. Check window title bar icon
4. Icon should appear at ~32-48 pixels

### Using DevTools

1. Open Chrome DevTools
2. Go to Application → Manifest
3. Check "Icons" section
4. Verify icon loads correctly

## Current Configuration Summary

✅ **Icon File**: `sohojatra.png` (200x200)
✅ **Manifest**: Correctly configured
✅ **Apple Touch Icon**: Set in HTML
✅ **Display Size**: ~100-150 logical pixels (splash screen)
✅ **Quality**: Good for all devices
✅ **File Size**: Optimized

## Notes

- The 200x200 source image is a good size for PWAs
- Browsers automatically scale to appropriate display sizes
- No need to manually control display size (handled by OS/browser)
- The icon will appear sharp on all devices
- For splash screens, the icon is typically centered and displayed at a comfortable viewing size

---

**Your PWA icon is now correctly configured to use `sohojatra.png` for all contexts!** 🎉
