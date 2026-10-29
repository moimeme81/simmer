"""Ask for the Simmer address and an API token (Account page in Simmer). Options: the sidebar panel."""
from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import voluptuous as vol
from homeassistant.config_entries import ConfigEntry, ConfigFlow, ConfigFlowResult, OptionsFlow
from homeassistant.core import callback
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .api import SimmerAuthError, SimmerClient, SimmerError
from .const import CONF_PANEL_URL, CONF_SHOW_PANEL, CONF_TOKEN, CONF_URL, DOMAIN


class SimmerConfigFlow(ConfigFlow, domain=DOMAIN):
    VERSION = 1

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> SimmerOptionsFlow:
        return SimmerOptionsFlow()

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            url = user_input[CONF_URL].strip().rstrip("/")
            try:
                summary = await SimmerClient(async_get_clientsession(self.hass), url, user_input[CONF_TOKEN].strip()).summary()
            except SimmerAuthError:
                errors["base"] = "invalid_auth"
            except SimmerError:
                errors["base"] = "cannot_connect"
            else:
                user_id = summary["user"]["id"]
                await self.async_set_unique_id(f"{url}|{user_id}")
                self._abort_if_unique_id_configured()
                return self.async_create_entry(
                    title=f"Simmer ({summary['user']['name']})",
                    data={CONF_URL: url, CONF_TOKEN: user_input[CONF_TOKEN].strip()},
                )
        schema = vol.Schema({vol.Required(CONF_URL, default="http://"): str, vol.Required(CONF_TOKEN): str})
        return self.async_show_form(step_id="user", data_schema=schema, errors=errors)

    async def async_step_reauth(self, entry_data: Mapping[str, Any]) -> ConfigFlowResult:
        return await self.async_step_reauth_confirm()

    async def async_step_reauth_confirm(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """The token stopped working (deleted or replaced in Simmer): ask for a new one."""
        entry = self._get_reauth_entry()
        errors: dict[str, str] = {}
        if user_input is not None:
            token = user_input[CONF_TOKEN].strip()
            try:
                await SimmerClient(async_get_clientsession(self.hass), entry.data[CONF_URL], token).summary()
            except SimmerAuthError:
                errors["base"] = "invalid_auth"
            except SimmerError:
                errors["base"] = "cannot_connect"
            else:
                return self.async_update_reload_and_abort(entry, data_updates={CONF_TOKEN: token})
        return self.async_show_form(step_id="reauth_confirm", data_schema=vol.Schema({vol.Required(CONF_TOKEN): str}), errors=errors)


class SimmerOptionsFlow(OptionsFlow):
    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        if user_input is not None:
            return self.async_create_entry(data={CONF_SHOW_PANEL: user_input[CONF_SHOW_PANEL], CONF_PANEL_URL: (user_input.get(CONF_PANEL_URL) or "").strip()})
        opts = self.config_entry.options
        schema = vol.Schema({
            vol.Required(CONF_SHOW_PANEL, default=opts.get(CONF_SHOW_PANEL, True)): bool,
            vol.Optional(CONF_PANEL_URL, description={"suggested_value": opts.get(CONF_PANEL_URL, "")}): str,
        })
        return self.async_show_form(step_id="init", data_schema=schema)
