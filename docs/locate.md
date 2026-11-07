# jev locate

Find where things are in an image. Each target gets a bounding box, and the probability it is in the image at all.

```bash
jev locate <image> [targets...] [-t <target>]... [options]
```

## When to use

Point at something in a screenshot, scan, or photo: the Submit button an agent should click, the signature on a form, the product on a shelf. A Box answer is always four edges, even for something that is not there, so `locate` pairs every Box with a yes/no "is it visible" question in the same request ([TypeSafe's recommended pattern](https://docs.typesafe.ai/primitives/box#writing-box-questions)) and reports `absent` instead of a made-up box.

Needs Jev 1.14 (`jev-latest` today) and TypeSafe direct; images and Box are an experimental ("dreamer-ready") TypeSafe feature, so accuracy and limits may change between releases. `jev` sends the `TypeSafe-Danger-Zone-Images` header for you.

## Options

| Option | Meaning | Default |
| --- | --- | --- |
| `<image>` | PNG or JPEG, 280 to 1568 px per side, at most 16 MiB. Checked locally before any request | required |
| `[targets...]`, `-t, --target <text>` | What to find, e.g. `"the coffee mug"`. Repeatable; one box per target. Describe the one you want when there may be several: `"the mug nearest the sink"` | |
| `-c, --context <text>` | Text sent with the image, e.g. what the screen is. `@file` allowed | |
| `--present-at <p>` | Presence probability at or above which a target counts as there | `0.5` |
| `--min-confidence <p>` | Box confidence below which a present target is `low` | `0.5` |
| `--no-presence` | Skip the presence question (cheaper; every target counts as present) | |
| `--fail-on <list>` | Exit 2 when any target is `absent` or `low` | `none` |

## Output

`image` (`path`, `format`, `width`, `height`, `bytes`) and `results[]` with `target`, `status` (`found`, `low`, `absent`), `present`, `confidence`, `box` (`top`, `bottom`, `left`, `right` as fractions of the image), and `pixels` (`x`, `y`, `width`, `height` in pixels of the file you sent). `thresholds`, `usage`.

To crop or click, use `pixels`. If the file you send is a resized copy, scale `box` by the original's size instead.

## Example

```bash
jev locate checkout.png "the Place order button" --fail-on absent --pluck results[0].pixels
```

```text
/tmp/parrot.jpg (800×800)

Target             Status  Present  Conf  Box px (x,y w×h)  Edges (l,t,r,b)
-----------------  ------  -------  ----  ----------------  -----------------------
the parrot's beak  found   0.98     0.55  448,288 224×464   0.560,0.360,0.840,0.940
a cat              absent  0.01     0.32  0,24 688×768      0.000,0.030,0.860,0.990
2139 in / 74 out tokens · jev-1.14.0 via typesafe
```

Over a folder: `ls frames/*.jpg | jev batch locate -i - -- -t "a bird at the feeder" --fail-on absent`.

Too large or too small? macOS: `sips -Z 1568 photo.jpg`. Phone photos: rotate the pixels upright first; the API ignores EXIF orientation. See [Preparing images](https://docs.typesafe.ai/images#preparing-images).

Pattern: [Box](https://docs.typesafe.ai/primitives/box), [companion Noul](https://docs.typesafe.ai/patterns/companion-noul), [OCR bounding boxes cookbook](https://docs.typesafe.ai/cookbooks/ocr_confidence_bounding_boxes).
