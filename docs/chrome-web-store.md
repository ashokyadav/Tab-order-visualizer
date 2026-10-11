# Submitting to the Chrome Web Store

Everything you upload is in this repo:

| What | File |
|---|---|
| Extension package | `dist/tab-order-visualizer-extension.zip` (run `npm run build` after any change) |
| Store icon (128×128) | inside the package, `icons/128.png` |
| Small promo tile (required, 440×280) | `store/small-promo-tile-440x280.png` |
| Marquee promo tile (optional, 1400×560) | `store/marquee-promo-tile-1400x560.png` |
| Screenshots (1280×800, upload in this order) | `store/screenshot-1-tab-path.png` … `store/screenshot-5-clean.png` |
| Privacy policy | `https://ashokyadav.github.io/Tab-order-visualizer/privacy` (live once GitHub Pages is on) |

## Steps

1. Go to the Chrome Web Store Developer Dashboard (chrome.google.com/webstore/devconsole) and sign in with the Google account you want as the publisher. Turn on 2-Step Verification for that account if it isn't already on.
2. Pay the one-time $5 registration fee and set your publisher display name to **Ashok Kumar Yadav**. Verify your contact email.
3. Click **New item** and upload `dist/tab-order-visualizer-extension.zip`.
4. Fill in the **Store listing** tab with the text below, and upload the promo tiles and screenshots.
5. Fill in the **Privacy** tab with the answers below.
6. On the **Distribution** tab, choose Free, Public, and all regions.
7. Click **Submit for review**. Small extensions with narrow permissions like this one are usually reviewed within a few days; you'll get an email when it's live.

To ship an update later, raise `version` in `extension/manifest.json` (for example 1.0.1), run `npm run build`, and upload the new zip on the item's **Package** tab.

## Store listing

**Name:** Tab Order Visualizer

**Summary (from the manifest, 132 characters max):**
By Ashok Kumar Yadav. See the keyboard tab order on any page and spot focus jumps, hidden focus and missing focus styles.

**Category:** Developer Tools

**Language:** English

**Description:**

Tab Order Visualizer draws the keyboard path through any web page. Every element you can reach with Tab gets a numbered marker, and lines show where focus goes next.

It flags the problems keyboard users run into:

• Focus that jumps backwards or across the page
• Elements you can focus but can't see: closed menus, off-screen slides, invisible links
• Elements that look clickable but can't be reached with Tab
• No visible change when an element is focused
• Focusable elements hidden from screen readers with aria-hidden

Each finding is mapped to its WCAG success criterion.

How to use it:
• Click the toolbar icon or press Alt+Shift+T to open it on the current page
• Press P to play the path with real focus, and watch what a keyboard user sees
• Click a finding to jump to that element
• Download a report as HTML (to read or print), CSV (for Excel or Jira) or Markdown (for GitHub). Every row includes a CSS selector that finds the element
• Press R to re-scan after the page changes, and Esc to close

It's a testing aid for designers, developers and accessibility testers. It shows you the path so you can judge it; it doesn't claim to replace testing with a keyboard.

Private by design: it only runs on the tab where you start it, and it never collects or sends any data.

Results are a testing aid. They don't certify conformance with WCAG, the ADA or any other standard or law. Not affiliated with W3C.

Free and open source (MIT). Made by Ashok Kumar Yadav.

**Official URL / homepage:** `https://github.com/ashokyadav/tab-order-visualizer`

**Support URL:** `https://github.com/ashokyadav/tab-order-visualizer/issues`

## Privacy tab

**Single purpose:**
Show the keyboard focus order of the current page and highlight focus-related accessibility problems.

**Permission justifications:**

- `activeTab`: lets the extension run only on the tab where the user clicks the toolbar button or presses the shortcut, and only at that moment.
- `scripting`: injects the visualizer script, which is packaged inside the extension, into that tab.

**Are you using remote code?** No. All code is included in the package.

**Data usage:** Tick nothing. The extension does not collect or transmit any user data.

**Certifications:** tick all three (no selling of data, no use unrelated to the single purpose, no use for creditworthiness or lending).

**Privacy policy URL:** `https://ashokyadav.github.io/Tab-order-visualizer/privacy`
