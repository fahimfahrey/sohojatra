# PWA Deployment Checklist

Use this checklist to ensure your PWA is properly deployed and working.

## Pre-Deployment

- [x] PWA plugin installed (`vite-plugin-pwa`)
- [x] Manifest configured in `vite.config.ts`
- [x] Service worker setup complete
- [x] PWA components added to App
- [x] Build succeeds without errors
- [x] Icons are in place (192x192 and 512x512)

## Deployment Steps

### 1. Build the App

```bash
npm run build
```

- [ ] Build completes successfully
- [ ] No TypeScript errors
- [ ] PWA files generated in `dist/`:
  - [ ] `sw.js`
  - [ ] `manifest.webmanifest`
  - [ ] `registerSW.js`
  - [ ] `workbox-*.js`

### 2. Test Locally

```bash
npm run preview
```

- [ ] App loads correctly
- [ ] Install prompt appears after 3 seconds
- [ ] Can install the app
- [ ] Offline mode works (DevTools → Network → Offline)
- [ ] Service worker registers (DevTools → Application → Service Workers)

### 3. Deploy to Production

```bash
# For Vercel
vercel --prod

# For Netlify
netlify deploy --prod

# Or use your preferred hosting
```

- [ ] Deployment succeeds
- [ ] HTTPS is enabled (required for PWA)
- [ ] All assets are accessible

## Post-Deployment Testing

### On Mobile (Android)

- [ ] Visit the deployed URL in Chrome
- [ ] Install prompt appears
- [ ] Can install the app
- [ ] App opens in standalone mode
- [ ] Icon appears on home screen
- [ ] Offline mode works
- [ ] Push notifications work

### On Mobile (iOS)

- [ ] Visit the deployed URL in Safari
- [ ] Can add to home screen (Share → Add to Home Screen)
- [ ] App opens in standalone mode
- [ ] Icon appears on home screen
- [ ] Offline mode works

### On Desktop

- [ ] Visit the deployed URL in Chrome/Edge
- [ ] Install icon appears in address bar
- [ ] Can install the app
- [ ] App opens in its own window
- [ ] Offline mode works

## Verification

### Lighthouse Audit

- [ ] Open Chrome DevTools
- [ ] Go to Lighthouse tab
- [ ] Run PWA audit
- [ ] Score is 90+ for PWA category
- [ ] All PWA checks pass:
  - [ ] Installable
  - [ ] PWA optimized
  - [ ] Works offline
  - [ ] Has icons
  - [ ] Has manifest

### Service Worker Check

- [ ] Open DevTools → Application → Service Workers
- [ ] Service worker is registered and activated
- [ ] Status shows "activated and is running"
- [ ] No errors in console

### Manifest Check

- [ ] Open DevTools → Application → Manifest
- [ ] Manifest loads correctly
- [ ] All fields are populated:
  - [ ] Name: "Sohojatra - Ride Sharing"
  - [ ] Short name: "Sohojatra"
  - [ ] Theme color: #3b82f6
  - [ ] Icons: 192x192 and 512x512
  - [ ] Display: standalone
  - [ ] Start URL: /

### Cache Check

- [ ] Open DevTools → Application → Cache Storage
- [ ] Workbox caches are created:
  - [ ] workbox-precache-\*
  - [ ] openstreetmap-tiles
  - [ ] opentopomap-tiles
  - [ ] google-fonts-cache
  - [ ] gstatic-fonts-cache

## User Testing

### Installation Flow

- [ ] Install prompt appears automatically
- [ ] "Install" button works
- [ ] "Not now" button dismisses prompt
- [ ] Dismissed state persists (doesn't show again)
- [ ] Can still install via browser menu

### Offline Experience

- [ ] App loads while offline
- [ ] Cached pages are accessible
- [ ] Map tiles load from cache
- [ ] Status indicator shows offline state
- [ ] Graceful error handling for API calls

### Update Flow

- [ ] Deploy a new version
- [ ] App updates automatically
- [ ] No manual refresh needed
- [ ] User sees updated content

## Performance Metrics

### Load Times

- [ ] First load: < 3 seconds
- [ ] Subsequent loads: < 1 second
- [ ] Offline load: < 500ms

### Lighthouse Scores

- [ ] Performance: 90+
- [ ] Accessibility: 90+
- [ ] Best Practices: 90+
- [ ] SEO: 90+
- [ ] PWA: 90+

## Common Issues

### Install Prompt Not Showing

- Check HTTPS is enabled
- Clear browser cache
- Check browser console for errors
- Verify manifest is valid

### Offline Not Working

- Build and preview (not dev mode)
- Open app while online first
- Check service worker is registered
- Verify cache storage has entries

### Updates Not Applying

- Clear service worker cache
- Unregister service worker
- Hard refresh (Ctrl+Shift+R)

## Documentation

- [ ] Share `HOW_TO_INSTALL_PWA.md` with users
- [ ] Update README with PWA information
- [ ] Add PWA badge to website
- [ ] Document any custom configurations

## Monitoring

### Analytics

- [ ] Track PWA installs
- [ ] Monitor offline usage
- [ ] Track service worker errors
- [ ] Monitor cache hit rates

### User Feedback

- [ ] Collect feedback on installation
- [ ] Monitor support requests
- [ ] Track uninstall reasons
- [ ] Gather feature requests

## Maintenance

### Regular Tasks

- [ ] Monitor service worker errors
- [ ] Update cache strategies as needed
- [ ] Test on new browser versions
- [ ] Update icons if branding changes
- [ ] Review and optimize cache sizes

### Updates

- [ ] Test PWA features after each deployment
- [ ] Verify service worker updates correctly
- [ ] Check manifest changes are applied
- [ ] Monitor for breaking changes

---

## Quick Test Commands

```bash
# Build
npm run build

# Preview
npm run preview

# Check for errors
npm run lint

# Test on mobile (using ngrok or similar)
npx ngrok http 4173
```

## Support Resources

- [PWA Documentation](https://web.dev/progressive-web-apps/)
- [Vite PWA Plugin](https://vite-pwa-org.netlify.app/)
- [Workbox Documentation](https://developers.google.com/web/tools/workbox)
- [Chrome DevTools PWA Guide](https://developer.chrome.com/docs/devtools/progressive-web-apps/)

---

**Once all items are checked, your PWA is ready for production! 🚀**
