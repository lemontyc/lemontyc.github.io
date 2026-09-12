# lemontyc.com

A hand-rolled Jekyll site. No theme gem, no framework, no jQuery — about a
dozen small files that you can read end to end in one sitting.

## Where things live

```
_config.yml          name, bio, nav-adjacent settings, social links
_data/nav.yml        the top navigation
_data/photos.yml     the photo gallery
_layouts/            default, home, post, page, archive, gallery, taxonomy
_includes/           head, nav, footer, post-item, terminal
_sass/_tokens.scss   every colour and size, in one place — start here
_sass/_base.scss     reset, typography, prose styles for posts
_sass/_components.scss  masthead, hero, lists, gallery, footer
_sass/_terminal.scss    the homepage terminal, and scroll reveals
_pages/              about, now, photos, writing, tags, categories, 404
_posts/              the writing
```

## Writing a post

Add a file to `_posts/` named `YYYY-MM-DD-some-title.md`:

```yaml
---
title: "The title"
description: "One sentence. It shows up in post lists and in link previews."
categories:
  - article
tags:
  - anecdote
---
```

`description` is optional — without it the site falls back to the first
paragraph, which is usually worse. URLs are `/:categories/:title/`, unchanged
from the old site, so nothing that was linked before breaks.

## Adding photos

1. Put the images in `assets/images/photos/`
2. Add entries to `_data/photos.yml` (the file explains the fields)

The `/photos/` page shows a polite empty state until you do.

## Running it locally

### From VS Code (easiest)

Press **Ctrl+Shift+B**. That builds the Docker image if needed, starts the site
at <http://localhost:4000>, and rebuilds on every save.

All the tasks live in `.vscode/tasks.json` and are also reachable through
**Ctrl+Shift+P → Tasks: Run Task**:

| Task | What it does |
| --- | --- |
| **Site: Serve** | Serve at localhost:4000, rebuilding as you save. Ctrl+C to stop. |
| **Site: Build preview image** | One-off Docker image build. Re-run only if `docker/Dockerfile` changes. |
| **Site: Build once** | Build into `_site/` without serving — the same build GitHub Pages runs. |
| **Site: Stop** | Kill the server if it is still holding port 4000. |
| **Site: Open in browser** | Opens localhost:4000. |

The first run takes a minute or two while the image builds. After that it
starts in a couple of seconds.

### From a terminal

```bash
docker build -t lemontyc-site docker
docker run --rm -it -p 4000:4000 -p 35729:35729 -v "${PWD}:/site" \
  lemontyc-site jekyll serve --host 0.0.0.0 --livereload --force_polling
```

`--force_polling` is not optional on Windows: file changes on a bind mount do
not reach the container as events, so without it nothing rebuilds.

With Ruby installed locally instead:

```bash
bundle install
bundle exec jekyll serve
```

## Deploying

Push to `master`. GitHub Pages builds it. The only plugins used —
`jekyll-feed` and `jekyll-sitemap` — are both on the GitHub Pages allowlist,
so the local build and the deployed build agree.

## The terminal

The card in the homepage hero is a working toy. Type `help` in it.

Adding a command means adding one entry to `COMMANDS` in
`assets/js/terminal.js`. A command is a function returning an array of lines,
where a line is either a string or `{ href, text }` for a link:

```js
climbing: function () {
  return [
    'mostly indoors lately. the grades are not improving.',
    { href: base + '/now/', text: 'more here' }
  ];
},
```

That is the whole API. Bare section names (`writing`, `photos`, `now`,
`about`) already navigate without being declared.

With JavaScript off, the card degrades to a static panel showing the bio,
so nothing is lost.

## Motion and theme

Light and dark follow the reader's OS by default; the lamp in the corner
overrides that and remembers the choice in `localStorage`.

Sections fade up as they enter view. The classes that do this are added from
JavaScript, never from the markup, so a reader without JS sees everything
immediately rather than a blank page. Anyone with `prefers-reduced-motion`
set skips the animation altogether.

The whole JavaScript budget is two files: `assets/js/site.js` (theme and
reveals, everywhere) and `assets/js/terminal.js` (homepage only).
