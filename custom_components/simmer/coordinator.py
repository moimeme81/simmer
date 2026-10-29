"""One poll for the whole integration: all lists and the next two weeks of meals."""
from __future__ import annotations

import logging
from datetime import timedelta
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryAuthFailed
from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed
from homeassistant.util import dt as dt_util

from .api import SimmerAuthError, SimmerClient, SimmerError
from .const import DOMAIN, LOOKAHEAD_DAYS, SCAN_INTERVAL

_LOGGER = logging.getLogger(__name__)


class SimmerCoordinator(DataUpdateCoordinator[dict[str, Any]]):
    def __init__(self, hass: HomeAssistant, client: SimmerClient) -> None:
        super().__init__(hass, _LOGGER, name=DOMAIN, update_interval=SCAN_INTERVAL)
        self.client = client

    async def _async_update_data(self) -> dict[str, Any]:
        today = dt_util.now().date()
        try:
            summary = await self.client.summary()
            lists = await self.client.lists()
            meals = await self.client.meals(
                (today - timedelta(days=1)).isoformat(), (today + timedelta(days=LOOKAHEAD_DAYS)).isoformat()
            )
        except SimmerAuthError as err:
            raise ConfigEntryAuthFailed(str(err)) from err
        except SimmerError as err:
            raise UpdateFailed(str(err)) from err
        return {"lists": {lst["id"]: lst for lst in lists}, "meals": meals, "recipes": summary.get("recipes", {"total": 0, "collections": []})}


def device_info(coordinator: SimmerCoordinator) -> DeviceInfo:
    """One "Simmer" device that groups every entity of a connected account."""
    entry = coordinator.config_entry
    return DeviceInfo(
        identifiers={(DOMAIN, entry.entry_id)}, name="Simmer", manufacturer="Simmer", entry_type=DeviceEntryType.SERVICE,
        configuration_url=coordinator.client.base_url,
    )
