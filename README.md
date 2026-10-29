# Simmer

Self-hosted recipes, shopping lists and meal plan for your family. Paste a link and get a clean, ad-free recipe with
checkable ingredients, numbered steps, a full-screen cook mode (screen stays awake) and kitchen timers. English and Quebec
French, switchable in one tap.

- **Recipes** from any site with standard schema.org markup (most recipe blogs), no API key needed. Optional `ANTHROPIC_API_KEY`
  extracts recipes from pages without markup.
- **Scaling** that handles two measurement systems at once: `1 tasse (250 ml)` ×2 becomes `2 tasses (500 ml)`, in French or English.
- **Cook mode with timers**: times in a step ("cuire 10 minutes") become one-tap timers. Several at once, alarm with sound and vibration.
- **Accounts for the whole family.** The first account is the admin and invites everyone else with a one-time link.
- **Households, or not.** Make as many households as you like (or none). Recipes and lists can be shared with a household or with
  individual people, and any single meal can be shared with a specific person so it appears in both meal plans.
- **Shopping lists that recognize ingredients.** "Brocoli", "broccoli" and "3 gousses d'ail" are sorted into aisles (fruits and
  vegetables, meat, dairy…). Reorder the aisles to match your store's layout, and assign aisles or single items to different stores
  and filter the list by store.
- **Meal plan** by week, with "add this week to a list" scaled to the servings you planned.
- **Home Assistant** integration (HACS): your lists as to-do lists, the meal plan as a calendar, plus sensors.
- Data is plain JSON files in `/data`. No database.

## Install on Unraid
No Docker Hub or GHCR needed: the image is built on your server from this repo.
1. In the Unraid web terminal run (public repo):
   `curl -fsSL https://raw.githubusercontent.com/moimeme81/simmer/main/unraid/build.sh | sh`
   For a private repo, `export GITHUB_TOKEN=<read token>` first and see the header of `unraid/build.sh`.
2. Add the container: copy `unraid/simmer.xml` to `/boot/config/plugins/dockerMan/templates-user/my-simmer.xml`,
   then Docker tab → Add Container → Template: Simmer → Apply. (Or add it by hand: repository `simmer:local`,
   port 3000, path `/data` → `/mnt/user/appdata/simmer`, `PUID=99`, `PGID=100`.)
3. Open `http://SERVER-IP:3000` and create the first account (it becomes the admin). Invite family from **Account → Invite someone**.
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
| `TZ` | `UTC` | Timezone, used for “today” in the Home Assistant summary (for example `America/Toronto`) |
| `ALLOW_PRIVATE_URLS` | false | Allow importing from LAN addresses |

## Accounts, households and sharing
- **Account → Invite someone** makes a one-time link (valid 7 days). Optionally it also adds the person to one of your households.
- A **household** shares its recipes and lists with every member. You can belong to several, or none. **Share what I add with**
  (Account page) sets which households receive your new recipes and lists by default.
- Anything can also be shared with individual people (Share button). A **meal** can be shared with specific people: it appears in their
  plan too, and sharing a meal also lets them open its recipe.
- Only the owner can delete or re-share something. Guests can tick items, add to lists and write notes.
- Passwords are stored with scrypt. Everyone on the instance can see each other's names (for sharing), so invite only people you trust.
- Simmer does not do HTTPS itself. Put it behind a reverse proxy before exposing it to the internet.
- Upgrading from a version without accounts: the first account you create becomes the owner of the existing recipes and lists.
  The old `AUTH_USER`/`AUTH_PASS` variables are ignored.

## Home Assistant
1. In Simmer: **Account → API tokens → Create token** and copy it (shown once).
2. In HACS: ⋮ → **Custom repositories** → add `https://github.com/moimeme81/simmer` as type *Integration*, then install **Simmer**
   and restart Home Assistant.
3. Settings → Devices & services → **Add integration → Simmer**, enter your Simmer address (for example `http://192.168.1.10:3000`) and the token.

You get a to-do list per shopping list (works with `todo.add_item` and voice assistants: "add milk to the groceries"), a
**Meal plan** calendar, a "to buy" count per list, and "Today's dinner / lunch" sensors. Set `TZ` on the container so "today" matches yours.
The same token works for scripts: `GET /api/ha/summary` with `Authorization: Bearer smr_…`.

## Moving over from AnyList
Open Simmer → **Import**, enter your AnyList email and password, and click **Start import**. Recipes (with photo, notes,
rating, times, source) and shopping lists are copied, with a live progress bar. Your login is used only for that import and is never
saved. It is safe to run again: items are matched by their AnyList id and updated, not duplicated.

AnyList has no public API or export button, so this uses the unofficial [`anylist`](https://www.npmjs.com/package/anylist)
client and could break if AnyList changes its sign-in. Not copied: meal plan calendar, recipe collections/tags. Imported items are sorted into aisles automatically.

Prefer the command line? `tools/anylist-export` does the same from your own computer and pushes to Simmer over HTTP, using an API token (`SIMMER_TOKEN`).

## Updating on Unraid
1. Run the build command again (it always builds the latest `main`):
   `curl -fsSL https://raw.githubusercontent.com/moimeme81/simmer/main/unraid/build.sh | sh`
2. Docker tab → Simmer → **Edit** → **Apply** (this recreates the container on the new image).
Your recipes and lists live in `/mnt/user/appdata/simmer` and are untouched.
