# Anime VA Mobile

This repo contains the **source code for the Anime VA mobile web app / PWA**.

The public, user-facing version of the app is hosted from the **`anime-va-updates`** repo
(via GitHub Pages), under the `web/` folder:

- Private source: `C:\anime-va-mobile\web`
- Public deployment: `C:\anime-va-updates\web`

When I make changes to the mobile app, I do them here (in this repo), test locally, then
deploy them to the public repo.

---

## Repo structure

```text
anime-va-mobile/
  web/
    index.html            # main entry point
    app.js                # main app logic
    manifest.webmanifest  # PWA manifest
    service-worker.js     # PWA offline / caching logic
    assets/               # icons, images, etc.
    ...other files...
