"""Services: use Simmer from automations, scripts, voice assistants and Developer tools, like the app itself.

Every service can return data (call it with "response variable" in an automation or script), and
anything that takes a recipe accepts either its id or words from its name ("recipe: osso buco").
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Any

import voluptuous as vol
from homeassistant.core import HomeAssistant, ServiceCall, SupportsResponse
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers import config_validation as cv
from homeassistant.util import dt as dt_util

from .api import SimmerError
from .const import DOMAIN, SLOTS
from .coordinator import SimmerCoordinator

ENTRY = {vol.Optional("config_entry_id"): cv.string}
SLOT = vol.In(SLOTS)
WHICH_RECIPE = {vol.Optional("recipe_id"): cv.string, vol.Optional("recipe"): cv.string}
NEED_RECIPE = cv.has_at_least_one_key("recipe_id", "recipe")

SCHEMAS: dict[str, vol.Schema] = {
    "search_recipes": vol.Schema({**ENTRY, vol.Optional("query", default=""): cv.string, vol.Optional("collection", default=""): cv.string,
                                  vol.Optional("limit", default=10): vol.All(vol.Coerce(int), vol.Range(min=1, max=100))}),
    "get_recipe": vol.All(vol.Schema({**ENTRY, **WHICH_RECIPE}), NEED_RECIPE),
    "random_recipe": vol.Schema({**ENTRY, vol.Optional("collection", default=""): cv.string}),
    "import_recipe": vol.Schema({**ENTRY, vol.Required("url"): cv.url}),
    "add_to_meal_plan": vol.All(vol.Schema({**ENTRY, **WHICH_RECIPE, vol.Optional("title"): cv.string, vol.Optional("date"): cv.date,
                                            vol.Optional("slot", default="dinner"): SLOT, vol.Optional("servings"): vol.Coerce(float),
                                            vol.Optional("note"): cv.string}), cv.has_at_least_one_key("recipe_id", "recipe", "title")),
    "set_random_meal": vol.Schema({**ENTRY, vol.Optional("date"): cv.date, vol.Optional("slot", default="dinner"): SLOT,
                                   vol.Optional("collection", default=""): cv.string, vol.Optional("servings"): vol.Coerce(float)}),
    "get_meal_plan": vol.Schema({**ENTRY, vol.Optional("start_date"): cv.date, vol.Optional("end_date"): cv.date}),
    "remove_meal": vol.Schema({**ENTRY, vol.Required("meal_id"): cv.string}),
    "add_recipe_to_list": vol.All(vol.Schema({**ENTRY, **WHICH_RECIPE, vol.Optional("list"): cv.string, vol.Optional("servings"): vol.Coerce(float)}), NEED_RECIPE),
}


def _coordinator(hass: HomeAssistant, call: ServiceCall) -> SimmerCoordinator:
    coordinators: dict[str, SimmerCoordinator] = hass.data.get(DOMAIN, {})
    wanted = call.data.get("config_entry_id")
    if wanted:
        if wanted not in coordinators:
            raise ServiceValidationError("That Simmer connection is not loaded.")
        return coordinators[wanted]
    if len(coordinators) == 1:
        return next(iter(coordinators.values()))
    raise ServiceValidationError("Simmer is not set up." if not coordinators else "Several Simmer accounts are connected: pass config_entry_id.")


def _brief(base: str, r: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": r["id"], "title": r["title"], "collections": r.get("collections") or [], "yield": r.get("yield"),
        "prep_minutes": r.get("prepMinutes"), "cook_minutes": r.get("cookMinutes"), "total_minutes": r.get("totalMinutes"),
        "source_url": r.get("sourceUrl"), "url": f"{base}/#/r/{r['id']}",
    }


def _full(base: str, r: dict[str, Any]) -> dict[str, Any]:
    return {**_brief(base, r), "description": r.get("description") or "", "ingredients": r.get("ingredients") or [], "steps": r.get("steps") or []}


def _meal(m: dict[str, Any]) -> dict[str, Any]:
    return {"id": m["id"], "date": m["date"], "slot": m["slot"], "title": m.get("title") or (m.get("recipe") or {}).get("title"),
            "recipe_id": m.get("recipeId"), "servings": m.get("servings"), "note": m.get("note") or "", "from": m.get("ownerName")}


async def _find_recipe(co: SimmerCoordinator, data: dict[str, Any]) -> dict[str, Any]:
    """The recipe named by id, or the best match for the words given."""
    client = co.client
    if data.get("recipe_id"):
        return await client.recipe(data["recipe_id"])
    found = await client.recipes(data["recipe"], limit=1)
    if not found["recipes"]:
        raise ServiceValidationError(f"No recipe matches “{data['recipe']}”.")
    return found["recipes"][0]


async def _random_recipe(co: SimmerCoordinator, collection: str) -> dict[str, Any]:
    found = await co.client.recipes("", collection, 1, random=True)
    if not found["recipes"]:
        raise ServiceValidationError(f"No recipes in “{collection}”." if collection else "There are no recipes yet.")
    return found["recipes"][0]


def async_register_services(hass: HomeAssistant) -> None:
    def register(name: str):
        def deco(fn):
            async def handler(call: ServiceCall) -> dict[str, Any]:
                co = _coordinator(hass, call)
                try:
                    result = await fn(co, call.data)
                except SimmerError as err:
                    raise ServiceValidationError(f"Simmer said: {err}") from err
                if name in {"add_to_meal_plan", "set_random_meal", "remove_meal", "add_recipe_to_list", "import_recipe"}:
                    await co.async_request_refresh()
                return result
            hass.services.async_register(DOMAIN, name, handler, schema=SCHEMAS[name], supports_response=SupportsResponse.OPTIONAL)
            return fn
        return deco

    @register("search_recipes")
    async def _search(co: SimmerCoordinator, d: dict[str, Any]) -> dict[str, Any]:
        found = await co.client.recipes(d["query"], d["collection"], d["limit"])
        return {"total": found["total"], "recipes": [_brief(co.client.base_url, r) for r in found["recipes"]]}

    @register("get_recipe")
    async def _get(co: SimmerCoordinator, d: dict[str, Any]) -> dict[str, Any]:
        found = await _find_recipe(co, d)
        return _full(co.client.base_url, await co.client.recipe(found["id"]))

    @register("random_recipe")
    async def _random(co: SimmerCoordinator, d: dict[str, Any]) -> dict[str, Any]:
        found = await _random_recipe(co, d["collection"])
        return _full(co.client.base_url, await co.client.recipe(found["id"]))

    @register("import_recipe")
    async def _import(co: SimmerCoordinator, d: dict[str, Any]) -> dict[str, Any]:
        return _full(co.client.base_url, await co.client.import_recipe(d["url"]))

    @register("add_to_meal_plan")
    async def _plan(co: SimmerCoordinator, d: dict[str, Any]) -> dict[str, Any]:
        body: dict[str, Any] = {"date": (d.get("date") or dt_util.now().date()).isoformat(), "slot": d["slot"]}
        if d.get("recipe_id") or d.get("recipe"):
            body["recipeId"] = (await _find_recipe(co, d))["id"]
        if d.get("title"):
            body["title"] = d["title"]
        for key in ("servings", "note"):
            if d.get(key):
                body[key] = d[key]
        return {"meal": _meal(await co.client.create_meal(body))}

    @register("set_random_meal")
    async def _random_meal(co: SimmerCoordinator, d: dict[str, Any]) -> dict[str, Any]:
        recipe = await _random_recipe(co, d["collection"])
        body: dict[str, Any] = {"date": (d.get("date") or dt_util.now().date()).isoformat(), "slot": d["slot"], "recipeId": recipe["id"]}
        if d.get("servings"):
            body["servings"] = d["servings"]
        return {"meal": _meal(await co.client.create_meal(body)), "recipe": _brief(co.client.base_url, recipe)}

    @register("get_meal_plan")
    async def _meals(co: SimmerCoordinator, d: dict[str, Any]) -> dict[str, Any]:
        start: date = d.get("start_date") or dt_util.now().date()
        end: date = d.get("end_date") or start + timedelta(days=6)
        meals = await co.client.meals(start.isoformat(), end.isoformat())
        return {"meals": [_meal(m) for m in sorted(meals, key=lambda m: (m["date"], SLOTS.index(m["slot"]) if m["slot"] in SLOTS else 9))]}

    @register("remove_meal")
    async def _remove(co: SimmerCoordinator, d: dict[str, Any]) -> dict[str, Any]:
        await co.client.delete_meal(d["meal_id"])
        return {"removed": d["meal_id"]}

    @register("add_recipe_to_list")
    async def _to_list(co: SimmerCoordinator, d: dict[str, Any]) -> dict[str, Any]:
        recipe = await _find_recipe(co, d)
        target = None
        if d.get("list"):
            want = d["list"].strip().lower()
            target = next((l for l in co.data["lists"].values() if l["id"] == d["list"] or l["name"].strip().lower() == want), None)
            if target is None:
                names = ", ".join(l["name"] for l in co.data["lists"].values())
                raise ServiceValidationError(f"No list called “{d['list']}”. Your lists: {names}")
        result = await co.client.recipe_to_list(recipe["id"], target["id"] if target else None, d.get("servings"))
        return {"recipe": recipe["title"], "list": result.get("name"), "open_items": sum(1 for i in result.get("items", []) if not i.get("checked"))}
