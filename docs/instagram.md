# Syncing photos from Instagram

The `/photos/` page can pull from Instagram automatically. This is the
one-time setup. Budget about twenty minutes, most of it waiting for Meta's
dashboard to load.

## How it works, in one paragraph

GitHub Pages is a static host, so there is nowhere to keep an API token at
runtime — calling Instagram from the browser would publish your token to
anyone who opened DevTools. Instead a scheduled GitHub Action calls the API,
**downloads** the files into the repo, writes `_data/instagram.yml`, and
commits. Pages rebuilds and the gallery fills up. The token never leaves
repository Secrets, no third-party script touches the site, and the page
keeps working if Instagram is down.

The files have to be downloaded rather than linked because Instagram's
`media_url` values are signed CDN links that expire. A gallery of hotlinked
Instagram URLs goes blank within days.

## What you need

- An Instagram **Business or Creator** account. Personal accounts cannot use
  this API — the old Basic Display API that allowed them
  [shut down in December 2024](https://developers.facebook.com/docs/instagram-platform/).
- A Meta developer account (free).
- No Facebook Page. The newer API does not require one.

## 1. Convert the account to Creator

In the Instagram app: **Settings → Account type and tools → Switch to
professional account → Creator**.

It stays public, keeps your followers, and looks the same to them. You can
switch back whenever you like.

## 2. Create a Meta app

1. Go to <https://developers.facebook.com/apps> → **Create app**
2. Use case: **Other** → type: **Business**
3. On the app dashboard: **Add product → Instagram → Set up**
4. Choose **API setup with Instagram login**

## 3. Connect the account and get a token

Still under Instagram → **API setup with Instagram login**:

1. **Add account** — log in as `@montoyawanders` and authorise it
2. Under **Generate access token**, click generate
3. Copy the token. It is long-lived: good for 60 days

Keep this tab open until step 5 confirms it works.

## 4. Test it locally before wiring up CI

Worth doing — it catches a wrong account type or a mis-scoped token in ten
seconds instead of after a failed workflow run.

```bash
export IG_ACCESS_TOKEN='paste-the-token-here'
python scripts/sync_instagram.py --dry-run
```

You should see your posts listed. Nothing is written.

If it complains about the token or the account type, fix that before going
further. Then do a real run:

```bash
pip install Pillow
python scripts/sync_instagram.py
```

That downloads the media, resizes it, and writes `_data/instagram.yml`.
Preview with `Ctrl+Shift+B` and look at `/photos/`.

## 5. Put the token in the repo

**Settings → Secrets and variables → Actions → New repository secret**

| Name | Value |
| --- | --- |
| `IG_ACCESS_TOKEN` | the token from step 3 |

Then run it once by hand: **Actions → Sync Instagram → Run workflow**.

## 6. Keep the token alive (optional but recommended)

A long-lived token expires after 60 days. Refreshing it resets the clock to
60 days, so a daily refresh keeps it alive indefinitely — but the workflow
has to write the new value back into Secrets, and that needs its own
credential.

1. <https://github.com/settings/personal-access-tokens/new>
2. Fine-grained token, **Only select repositories** → this repo
3. Repository permissions → **Secrets: Read and write**
4. Save it as a second repository secret named `GH_PAT`

Without this the sync keeps working until the token expires, then starts
failing. The workflow summary tells you which situation you are in.

## Day-to-day

Nothing. It runs daily at 05:17 UTC and commits when something changed.

To pull more posts, or to include videos:

**Actions → Sync Instagram → Run workflow**, then set the inputs. Videos are
off by default because they are large and this repo is also your website —
GitHub Pages has a soft 1 GB limit.

## Mixing in your own photographs

`_data/instagram.yml` is generated and will be overwritten. Hand-picked
photographs go in `_data/photos.yml`, which the sync never touches. The
gallery shows those first, then the Instagram ones.

This is worth using. Instagram re-compresses hard and caps at about 1080px;
a print-quality export you place yourself will always look better than the
same frame pulled back out of Instagram.

## When it breaks

| Symptom | Cause |
| --- | --- |
| `Instagram rejected the request` | Token expired, or the account is not Business/Creator |
| Workflow runs, nothing changes | No new posts. This is normal |
| Some posts missing | Media flagged or copyrighted comes back without a URL, and is skipped |
| Images look soft | Instagram's own compression. Use `_data/photos.yml` for work you care about |

To start over, delete `_data/instagram.yml` and
`assets/images/photos/instagram/`, then run the workflow again.
