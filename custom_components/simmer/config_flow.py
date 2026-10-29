"""Ask for the Simmer address and an API token (Account page in Simmer)."""
from __future__ import annotations

from typing import Any

import voluptuous as vol
from homeassistant.config_entries import ConfigFlow, ConfigFlowResult
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .api import SimmerAuthError, SimmerClient, SimmerError
from .const import CONF_TOKEN, CONF_URL, DOMAIN


class SimmerConfigFlow(ConfigFlow, domain=DOMAIN):
    VERSION = 1

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
