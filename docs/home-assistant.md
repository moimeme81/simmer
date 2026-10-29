# Home Assistant

The Simmer integration (installed with HACS) puts the whole app in Home Assistant's sidebar and adds to-do lists, a meal-plan calendar, sensors and actions you can use in automations and voice assistants.

## Set up

1. In Simmer: **Account → API tokens → Create token** and copy it (shown once).
2. In HACS: ⋮ → **Custom repositories** → add `https://github.com/moimeme81/simmer` as type *Integration*, then install **Simmer**
   and restart Home Assistant.
3. Settings → Devices & services → **Add integration → Simmer**, enter your Simmer address (for example `https://simmer.example.com`) and the token.

It works like the Mealie integration: you get the app itself, not just lists.

## What you get

**Simmer in the sidebar.** A *Simmer* entry opens the whole app inside Home Assistant (recipes, cooking mode, lists, meal plan).
You sign in once inside it. It needs the address to work in the browser you use Home Assistant from: if Home Assistant is on
`https`, give Simmer an `https` address too (the browser blocks `http` inside an `https` page). Change or hide it in the
integration's **Configure** button. If the panel stays blank, your reverse proxy may be sending an `X-Frame-Options` or
`frame-ancestors` header for Simmer; remove it for the Simmer host.

**Entities.** A to-do list per shopping list (works with `todo.add_item` and voice assistants: "add milk to the groceries"),
a **Meal plan** calendar, a "to buy" count per list, *Today's dinner / lunch*, *Tomorrow's dinner*, a *Recipes* count with the size of
each collection, and a *Today's dinner photo* image for dashboards and notifications. Set `TZ` on the container so "today" matches yours.

**Services** (Developer tools → Actions; each can return its result to a script or automation). Anything that takes a recipe accepts words from its name.

| Action | What it does |
|---|---|
| `simmer.search_recipes` | Find recipes by name, ingredient or collection |
| `simmer.get_recipe` / `simmer.random_recipe` | Return a recipe with its ingredients and steps |
| `simmer.import_recipe` | Add a recipe from a web page address |
| `simmer.add_to_meal_plan` | Plan a recipe (or a free-text meal such as "Leftovers") on a day and meal, with servings |
| `simmer.set_random_meal` | Fill a meal with a random recipe, optionally from one collection |
| `simmer.get_meal_plan` / `simmer.remove_meal` | Read the plan between two days / take a meal off it |
| `simmer.add_recipe_to_list` | Put a recipe's ingredients on a list, scaled to the servings you want |

```yaml
# Every Sunday morning, plan a random dinner for each of the next five days
automation:
  - alias: Plan the week
    triggers:
      - trigger: time
        at: "09:00:00"
    conditions:
      - condition: time
        weekday: [sun]
    actions:
      - repeat:
          count: 5
          sequence:
            - action: simmer.set_random_meal
              data:
                collection: Dinners
                date: "{{ (now() + timedelta(days=repeat.index)).date() }}"
```

The same token works for scripts: `GET /api/ha/summary` and `GET /api/ha/recipes?q=…` with `Authorization: Bearer smr_…`.
If the token is ever deleted in Simmer, Home Assistant asks for a new one instead of failing silently.



If you use the HA companion app, the *Simmer* sidebar panel shows up there too and signs in the same way. Revoke the sign-in anytime under **Account → API tokens** (“Embedded app”).
