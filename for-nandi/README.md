# For Nandi — Manxumalo

A pink, mobile-friendly keepsake site for Nandi Nxumalo. She just opens the link — no coding needed.

## How to use

1. **Add her photos**
   - Two supplied standalone photos are included as `photos/photo1.jpg` and `photos/photo2.jpg`.
   - The earlier WhatsApp screenshot is excluded. Two later screenshots explicitly requested by the user are included as `photos/chat1.jpg` and `photos/chat2.jpg`. Location/EXIF metadata was removed from all four copies.
   - Replace those files to change the photos, or add another `<figure>` inside `.gallery` in `index.html`.
   - The supplied gallery is visible immediately, including without JavaScript. Missing image frames are hidden when scripting is enabled.
   - Ask her permission before adding photos. This static site has no access controls; anyone who obtains the URL can view or share it.

2. **Set your countdown date**
   - No date is assumed: the timer stays hidden until you configure it.
   - Open `script.js`
   - Change `NEXT_MEET` to your next call/visit date, e.g. `"2026-12-10T19:00:00"`

3. **Add your song**
   - In `script.js`, set `SONG_URL` to your actual HTTPS playlist/song URL.
   - The playlist section stays hidden until you configure it.

4. **Preview locally**
   ```bash
   cd for-nandi
   python3 -m http.server 8000
   # open http://localhost:8000
   ```

5. **Send it to her**
   - Deploy free on Netlify / Vercel / GitHub Pages:
     - Drag the `for-nandi` folder into Netlify Drop, OR push to GitHub and enable Pages.
   - Send her the link on a video call and open it together.

## Edit the letter
Open `index.html` and edit the text in the `#letter` section to sound like you.

Made with love for Manxumalo.

## Design and motion
- Self-hosted Cormorant Garamond and DM Sans fonts (licenses in `fonts/`); no CDN required.
- Tap the keepsake envelope to lift the note and navigate to the full letter.
- Six message envelopes, local-only hug counter, subtle floating hearts and staggered reveals.
- Gallery images open in a lightbox, with a full-size link for reading/zooming into screenshots. Screenshot previews use a single column on phones; full-width screenshots scroll inside the dialog. Close and full-size controls stay visible.
- “Misa animations” pauses motion, including in-flight heart effects. With OS reduced motion enabled, animations stay off and the toggle explains that the system setting is active.
- Animation drawing pauses in background tabs; nothing is sent to a server.

## Checks
Run `node --test test/nandi.test.js` from the repository root.

### Browser layout regression suite
From the repository root:
```bash
npm --prefix for-nandi/checks ci
npm --prefix for-nandi/checks run install-browser
npm --prefix for-nandi/checks test
```
The optional check tools are isolated from the Zonke app. The suite starts and stops its own local test server. It checks 13 desktop/tablet/phone viewports (including landscape), 200% text size, 44px touch targets, photo/chat viewing, dialog scrolling and focus, hover/reveal compatibility, reduced motion, no-JavaScript reading, and automated WCAG A/AA checks at three sizes. Automated checks do not replace a manual accessibility review.

Set `SCREENSHOT_DIR` to a temporary directory to save viewport/section screenshots. These screenshots contain the supplied private photos/chats; do not commit them. `BROWSER_EXECUTABLE_PATH` and optional JSON `BROWSER_ARGS` support a preinstalled Chromium.

### CSS maintenance
`style.css` is grouped into theme, navigation, keepsake, letter, cards, gallery, hugs, dialogs, motion, and responsive sections. Breakpoint rules are consolidated rather than appended as patches. Reveals animate the separate `translate` property so they do not cancel card rotations or hover transforms. The reduced-motion overrides are last in the cascade.
