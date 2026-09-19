# jev update

Check npm for a newer `jevctl` release and install it globally.

```bash
jev update
jev update --check
```

| Flag | Does |
| --- | --- |
| (none) | Check the npm registry; if a newer version exists, run `npm install -g jevctl@latest` |
| `--check` | Report whether an update is available without installing it |

Already up to date prints a short confirmation and exits 0; so does a completed install. A registry lookup failure (no network, npm missing) is exit 1.

Uses the `npm` binary on `PATH`, so it follows whatever registry, proxy, or `.npmrc` settings you already have configured.
