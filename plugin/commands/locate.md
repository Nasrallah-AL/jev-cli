---
description: Find where something is in an image or screenshot, with a box and an is-it-there probability (jev locate)
argument-hint: <image path> <what to find>[, <another thing>]
allowed-tools: Bash(jev:*), Bash(npx jevctl:*), Bash(sips:*), Read, Glob
---

Use the `jev` skill's `locate` command for: $ARGUMENTS

1. Identify the image path and the targets. Split several targets on commas; describe each so only
   one thing fits ("the Submit button in the footer", not "the button").
2. Run `jev locate <image> "<target>" [-t "<target>"]... --json --fail-on none`.
   If it fails with a size or format error, make a resized or converted copy in a temp directory
   (macOS: `sips -Z 1568 <file> --out <tmp>.jpg`, or `sips -s format jpeg <file.heic> --out <tmp>.jpg`)
   and locate on that copy; its `pixels` are then in the copy's size, so scale them back by the
   original's width and height if the user needs original coordinates.
3. For each result, report `status`:
   - `found`: give the pixel box (`x`, `y`, `width`, `height`) and its center.
   - `low`: give the box but say it may be loose.
   - `absent`: say it is not in the image; do not report the box.
4. Mention `present` and `confidence` briefly. If the user wants a crop or a click, use `pixels`.
