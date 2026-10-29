import pytest
from homeassistant.components import frontend
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ServiceValidationError
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.simmer.const import DOMAIN

from .conftest import call


async def setup(hass: HomeAssistant, simmer, options=None):
    entry = MockConfigEntry(domain=DOMAIN, data={"url": simmer["url"], "token": simmer["token"]}, options=options or {}, unique_id="t")
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry


async def run(hass, name, data, response=True):
    return await hass.services.async_call(DOMAIN, name, data, blocking=True, return_response=response)


async def test_entities_panel_and_options(hass: HomeAssistant, simmer):
    entry = await setup(hass, simmer)
    assert hass.states.get("sensor.simmer_recipes").state == "2"
    assert hass.states.get("sensor.simmer_recipes").attributes["collections"] == {"Desserts": 1, "Souper": 1}
    assert hass.states.get("sensor.simmer_today_s_dinner").state == "none"
    assert hass.states.get("sensor.simmer_tomorrow_s_dinner") is not None
    assert hass.states.get("image.simmer_today_s_dinner_photo") is not None
    assert "simmer" in hass.data["frontend_panels"], "sidebar panel is registered"
    assert hass.data["frontend_panels"]["simmer"].config["url"] == simmer["url"]
    # turning the panel off in options removes it again
    hass.config_entries.async_update_entry(entry, options={"show_panel": False})
    await hass.async_block_till_done()
    assert "simmer" not in hass.data["frontend_panels"]
    # and a different address can be opened in the panel
    hass.config_entries.async_update_entry(entry, options={"show_panel": True, "panel_url": "https://simmer.example.org"})
    await hass.async_block_till_done()
    assert hass.data["frontend_panels"]["simmer"].config["url"] == "https://simmer.example.org"
    assert await hass.config_entries.async_unload(entry.entry_id)
    assert "simmer" not in hass.data["frontend_panels"]


async def test_search_get_and_random(hass: HomeAssistant, simmer):
    await setup(hass, simmer)
    found = await run(hass, "search_recipes", {"query": "osso"})
    assert found["total"] == 1 and found["recipes"][0]["title"] == "Pork Osso Buco"
    assert found["recipes"][0]["url"].endswith("/#/r/" + found["recipes"][0]["id"])
    assert (await run(hass, "search_recipes", {"collection": "desserts"}))["recipes"][0]["title"] == "Lemon Brûlé"
    full = await run(hass, "get_recipe", {"recipe": "brule"})
    assert full["title"] == "Lemon Brûlé" and full["ingredients"] == ["2 lemons"] and full["steps"] == ["Torch."]
    rnd = await run(hass, "random_recipe", {"collection": "Souper"})
    assert rnd["title"] == "Pork Osso Buco"
    with pytest.raises(ServiceValidationError):
        await run(hass, "get_recipe", {"recipe": "nothing like this"})


async def test_meal_plan_services_and_sensors(hass: HomeAssistant, simmer):
    await setup(hass, simmer)
    today = dt_util.now().date().isoformat()
    res = await run(hass, "add_to_meal_plan", {"recipe": "osso buco", "servings": 8})
    meal = res["meal"]
    assert meal["date"] == today and meal["slot"] == "dinner" and meal["servings"] == 8 and meal["title"]
    await hass.async_block_till_done()
    assert "Osso Buco" in hass.states.get("sensor.simmer_today_s_dinner").state
    free = await run(hass, "add_to_meal_plan", {"title": "Leftovers", "slot": "lunch"})
    assert free["meal"]["title"] == "Leftovers"
    plan = await run(hass, "get_meal_plan", {})
    assert [m["slot"] for m in plan["meals"]] == ["lunch", "dinner"]
    random_meal = await run(hass, "set_random_meal", {"slot": "snack", "collection": "Desserts"})
    assert random_meal["recipe"]["title"] == "Lemon Brûlé"
    await run(hass, "remove_meal", {"meal_id": free["meal"]["id"]})
    assert len((await run(hass, "get_meal_plan", {}))["meals"]) == 2
    assert hass.states.get("calendar.simmer_meal_plan") is not None


async def test_recipe_to_list_scales_servings(hass: HomeAssistant, simmer):
    await setup(hass, simmer)
    lists = call("GET", "/api/lists", headers={"cookie": simmer["cookie"]})[0]
    name = lists[0]["name"]
    res = await run(hass, "add_recipe_to_list", {"recipe": "osso buco", "list": name, "servings": 12})
    assert res["list"] == name and res["open_items"] >= 2
    items = call("GET", "/api/lists", headers={"cookie": simmer["cookie"]})[0][0]["items"]
    assert any(i["name"] == "Pork shanks" and i["quantity"] == "12" for i in items), items   # 6 servings -> 12, so doubled
    with pytest.raises(ServiceValidationError):
        await run(hass, "add_recipe_to_list", {"recipe": "osso buco", "list": "No such list"})


async def test_bad_token_asks_to_sign_in_again(hass: HomeAssistant, simmer):
    entry = MockConfigEntry(domain=DOMAIN, data={"url": simmer["url"], "token": "smr_wrong"}, unique_id="bad")
    entry.add_to_hass(hass)
    assert not await hass.config_entries.async_setup(entry.entry_id)
    assert any(f["context"]["source"] == "reauth" for f in hass.config_entries.flow.async_progress())


async def test_setup_screen_and_new_token(hass: HomeAssistant, simmer):
    from homeassistant.data_entry_flow import FlowResultType
    res = await hass.config_entries.flow.async_init(DOMAIN, context={"source": "user"})
    bad = await hass.config_entries.flow.async_configure(res["flow_id"], {"url": simmer["url"], "token": "smr_nope"})
    assert bad["type"] == FlowResultType.FORM and bad["errors"] == {"base": "invalid_auth"}
    ok = await hass.config_entries.flow.async_configure(res["flow_id"], {"url": simmer["url"] + "/", "token": simmer["token"]})
    assert ok["type"] == FlowResultType.CREATE_ENTRY and ok["data"]["url"] == simmer["url"]
    entry = ok["result"]
    await hass.async_block_till_done()
    # the token stops working: Home Assistant asks for a new one, and it can be replaced
    entry.async_start_reauth(hass)
    await hass.async_block_till_done()
    reauth = next(f for f in hass.config_entries.flow.async_progress() if f["context"]["source"] == "reauth")
    reauth = await hass.config_entries.flow.async_configure(reauth["flow_id"])
    assert reauth["step_id"] == "reauth_confirm"
    done = await hass.config_entries.flow.async_configure(reauth["flow_id"], {"token": simmer["token"]})
    assert done["type"] == FlowResultType.ABORT and done["reason"] == "reauth_successful"
    # options form offers the sidebar panel
    opts = await hass.config_entries.options.async_init(entry.entry_id)
    assert opts["type"] == FlowResultType.FORM and opts["step_id"] == "init"
    saved = await hass.config_entries.options.async_configure(opts["flow_id"], {"show_panel": False, "panel_url": ""})
    assert saved["type"] == FlowResultType.CREATE_ENTRY and saved["data"]["show_panel"] is False
