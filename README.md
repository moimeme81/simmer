# Simmer

Self-hosted recipe saver. Paste a link, get a clean, ad-free recipe with checkable ingredients,
numbered steps, notes and a full-screen cook mode (screen stays awake).

- Works on any site that publishes standard schema.org recipe markup (most recipe blogs), no API key needed.
- Optional: set `ANTHROPIC_API_KEY` to extract recipes from pages without markup, including video page descriptions.
- Shopping lists (several, check-off, "add ingredients to list" from any recipe) that refresh across devices.
- Data is plain JSON files in `/data`. No database.

## Install on Unraid
1. In the GitHub repo add the secrets `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` (Settings → Secrets and variables → Actions;
   the token is a Docker Hub access token with read/write). Each push to `main` then publishes `<username>/simmer:latest`
   to Docker Hub (Actions tab → "Build and publish image" → Run workflow also works).
2. Unraid → Docker → Add Container → Template: paste
   `https://raw.githubusercontent.com/moimeme81/simmer/main/unraid/simmer.xml`
   (or copy `unraid/simmer.xml` to `/boot/config/plugins/dockerMan/templates-user/`).
3. Apply. Open `http://SERVER-IP:3000`.

## Docker / Compose
```
docker compose up -d --build
```

## Environment
| Variable | Default | Purpose |
|---|---|---|
| `PORT` | 3000 | Listen port |
| `PUID` / `PGID` | 99 / 100 | Owner of files in `/data` |
| `ANTHROPIC_API_KEY` | – | Enables AI extraction fallback |
| `LLM_MODEL` | claude-haiku-5-5 | Model for the fallback |
| `AUTH_USER` / `AUTH_PASS` | – | Optional basic auth |
| `ALLOW_PRIVATE_URLS` | false | Allow importing from LAN addresses |

## Moving over from AnyList
AnyList has no export button or public API, so `tools/anylist-export` uses the unofficial
[`anylist`](https://www.npmjs.com/package/anylist) client to read your account and push it into Simmer.
It runs on **your computer**, so your AnyList password never reaches the server.

```
cd tools/anylist-export && npm install
ANYLIST_EMAIL=you@example.com ANYLIST_PASSWORD='…' \
  node export.js --to http://UNRAID-IP:3000 --backup anylist-backup.json
```
Add `--user`/`--pass` if you enabled basic auth, or `--dry-run` to only fetch and write the backup.
Recipes (with photo, notes, rating, times, source) and shopping lists are copied. It is safe to re-run:
items are matched by their AnyList id and updated, not duplicated.

Not copied yet: meal plan calendar, recipe collections/tags, list categories.
