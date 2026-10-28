# Simmer

Self-hosted recipe saver. Paste a link, get a clean, ad-free recipe with checkable ingredients,
numbered steps, notes and a full-screen cook mode (screen stays awake).

- Works on any site that publishes standard schema.org recipe markup (most recipe blogs), no API key needed.
- Optional: set `ANTHROPIC_API_KEY` to extract recipes from pages without markup, including video page descriptions.
- Shopping lists (several, check-off, "add ingredients to list" from any recipe) that refresh across devices.
- Data is plain JSON files in `/data`. No database.

## Install on Unraid
No Docker Hub or GHCR needed: the image is built on your server from this repo.
1. In the Unraid web terminal run (public repo):
   `curl -fsSL https://raw.githubusercontent.com/moimeme81/simmer/main/unraid/build.sh | sh`
   For a private repo, `export GITHUB_TOKEN=<read token>` first and see the header of `unraid/build.sh`.
2. Add the container: copy `unraid/simmer.xml` to `/boot/config/plugins/dockerMan/templates-user/my-simmer.xml`,
   then Docker tab → Add Container → Template: Simmer → Apply. (Or add it by hand: repository `simmer:local`,
   port 3000, path `/data` → `/mnt/user/appdata/simmer`, `PUID=99`, `PGID=100`.)
3. Open `http://SERVER-IP:3000`.
To update: run step 1 again, then edit the Simmer container and click Apply.

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
