# Import and export

Open **Import & export** from the top bar (or from Account). Your recipes are yours to take anywhere, and to bring in from elsewhere.

## Export

| Export | Format | Opens in |
| --- | --- | --- |
| Simmer backup | `.zip` (recipes, photos, collections, lists, meal plan) | Simmer (Import a file) |
| Paprika file | `.paprikarecipes` | Paprika, Mealie, Tandoor, RecipeSage |
| Recipe folders | `.zip`, one folder per recipe (schema.org JSON + photo) | Mealie, Tandoor, Nextcloud Cookbook |
| Shopping lists | `.csv` | any spreadsheet |
| Meal plan | `.ics` | Apple, Google and Home Assistant calendars |

Exports cover your own recipes (not ones other people shared with you).

## Import a file

Choose a Simmer backup, a Paprika file, a Mealie export zip, a recipe-folders zip, or a recipe `.json` (schema.org). Importing the same file again updates recipes instead of duplicating them.

## Mealie, live

Enter your Mealie address and an API token (in Mealie: your profile, then API tokens) to copy recipes either way:

- **Import from Mealie** brings every recipe over with its photo, notes, times, rating, categories and tags (as collections).
- **Send to Mealie** creates your recipes in Mealie. Recipes whose name already exists there are skipped.

The token is used for that transfer only and is never stored. Admins may use a LAN address like `http://192.168.1.20:9925`; other accounts can only reach public addresses (unless `ALLOW_PRIVATE_URLS=true`).

## From AnyList

Enter your AnyList email and password on the same page. Recipes (with photo, notes, rating, times, source and collections) and shopping lists are copied, with a live progress bar. Your login is used only for that import and is never saved. It is safe to run again: items are matched by their AnyList id and updated, not duplicated.

AnyList has no public API or export, so this uses the unofficial [`anylist`](https://www.npmjs.com/package/anylist) client and could break if AnyList changes its sign-in. Not copied: the AnyList meal plan. Prefer the command line? `tools/anylist-export` does the same from your own computer and pushes to Simmer with an API token (`SIMMER_TOKEN`).
