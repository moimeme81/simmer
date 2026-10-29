"""The photo of tonight's dinner, for dashboards and notifications."""
from __future__ import annotations

from homeassistant.components.image import ImageEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity
from homeassistant.util import dt as dt_util

from .const import DOMAIN
from .coordinator import SimmerCoordinator, device_info


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback) -> None:
    async_add_entities([SimmerDinnerImage(hass, hass.data[DOMAIN][entry.entry_id], entry.entry_id)])


class SimmerDinnerImage(CoordinatorEntity[SimmerCoordinator], ImageEntity):
    _attr_has_entity_name = True
    _attr_name = "Today's dinner photo"
    _attr_content_type = "image/jpeg"

    def __init__(self, hass: HomeAssistant, coordinator: SimmerCoordinator, entry_id: str) -> None:
        CoordinatorEntity.__init__(self, coordinator)
        self._attr_device_info = device_info(coordinator)
        ImageEntity.__init__(self, hass)
        self._attr_unique_id = f"{DOMAIN}_{entry_id}_dinner_image"
        self._path: str | None = None
        self._update_path()

    def _find_path(self) -> str | None:
        today = dt_util.now().date().isoformat()
        meals = [m for m in self.coordinator.data["meals"] if m["date"] == today and (m.get("recipe") or {}).get("image")]
        meals.sort(key=lambda m: m["slot"] != "dinner")   # dinner first, any other meal with a photo as a fallback
        return meals[0]["recipe"]["image"] if meals else None

    def _update_path(self) -> None:
        path = self._find_path()
        if path != self._path:
            self._path = path
            self._attr_image_last_updated = dt_util.utcnow()

    @callback
    def _handle_coordinator_update(self) -> None:
        self._update_path()
        super()._handle_coordinator_update()

    async def async_image(self) -> bytes | None:
        return await self.coordinator.client.image(self._path) if self._path else None
