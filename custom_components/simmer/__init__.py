"""Simmer: your recipes, shopping lists and meal plan from your self-hosted Simmer server."""
from __future__ import annotations

from homeassistant.components import frontend
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.typing import ConfigType

from .api import SimmerClient
from .const import CONF_PANEL_URL, CONF_SHOW_PANEL, CONF_TOKEN, CONF_URL, DOMAIN
from .coordinator import SimmerCoordinator
from .services import async_register_services

PLATFORMS = [Platform.TODO, Platform.CALENDAR, Platform.SENSOR, Platform.IMAGE]
CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)
PANELS = f"{DOMAIN}_panels"   # entry id -> sidebar path


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    async_register_services(hass)
    return True


def _panel_path(hass: HomeAssistant, entry: ConfigEntry) -> str:
    others = {v for k, v in hass.data.get(PANELS, {}).items() if k != entry.entry_id}
    return "simmer" if "simmer" not in others else f"simmer-{entry.entry_id[:8]}"


def _add_panel(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Simmer itself inside Home Assistant: a sidebar entry that opens the app."""
    if not entry.options.get(CONF_SHOW_PANEL, True):
        return
    path = _panel_path(hass, entry)
    frontend.async_register_built_in_panel(
        hass, "iframe", sidebar_title="Simmer", sidebar_icon="mdi:pot-steam", frontend_url_path=path,
        config={"url": (entry.options.get(CONF_PANEL_URL) or entry.data[CONF_URL]).strip()}, require_admin=False, update=True,
    )
    hass.data.setdefault(PANELS, {})[entry.entry_id] = path


def _remove_panel(hass: HomeAssistant, entry: ConfigEntry) -> None:
    if path := hass.data.get(PANELS, {}).pop(entry.entry_id, None):
        frontend.async_remove_panel(hass, path, warn_if_unknown=False)


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    client = SimmerClient(async_get_clientsession(hass), entry.data[CONF_URL], entry.data[CONF_TOKEN])
    coordinator = SimmerCoordinator(hass, client)
    await coordinator.async_config_entry_first_refresh()
    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = coordinator
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    _add_panel(hass, entry)
    entry.async_on_unload(entry.add_update_listener(_reload))
    return True


async def _reload(hass: HomeAssistant, entry: ConfigEntry) -> None:
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    if unloaded := await hass.config_entries.async_unload_platforms(entry, PLATFORMS):
        hass.data[DOMAIN].pop(entry.entry_id)
        _remove_panel(hass, entry)
    return unloaded
