"""Open-item counts per list, and what is planned for today."""
from __future__ import annotations

from homeassistant.components.sensor import SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity
from homeassistant.util import dt as dt_util

from .const import DOMAIN
from .coordinator import SimmerCoordinator

SLOT_ORDER = ["breakfast", "lunch", "dinner", "snack"]


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback) -> None:
    coordinator: SimmerCoordinator = hass.data[DOMAIN][entry.entry_id]
    known: set[str] = set()

    def add_new() -> None:
        fresh = [SimmerListCount(coordinator, lid) for lid in coordinator.data["lists"] if lid not in known]
        known.update(e.list_id for e in fresh)
        if fresh:
            async_add_entities(fresh)

    async_add_entities([SimmerToday(coordinator, entry.entry_id, "dinner"), SimmerToday(coordinator, entry.entry_id, "lunch")])
    add_new()
    entry.async_on_unload(coordinator.async_add_listener(add_new))


class SimmerListCount(CoordinatorEntity[SimmerCoordinator], SensorEntity):
    _attr_has_entity_name = True
    _attr_native_unit_of_measurement = "items"
    _attr_icon = "mdi:cart"

    def __init__(self, coordinator: SimmerCoordinator, list_id: str) -> None:
        super().__init__(coordinator)
        self.list_id = list_id
        self._attr_unique_id = f"{DOMAIN}_count_{list_id}"

    @property
    def _list(self) -> dict | None:
        return self.coordinator.data["lists"].get(self.list_id)

    @property
    def name(self) -> str:
        return f"{self._list['name']} to buy" if self._list else "Simmer list"

    @property
    def native_value(self) -> int | None:
        return sum(1 for i in self._list["items"] if not i["checked"]) if self._list else None

    @property
    def extra_state_attributes(self) -> dict:
        if not self._list:
            return {}
        return {"items": [i["name"] for i in self._list["items"] if not i["checked"]]}


class SimmerToday(CoordinatorEntity[SimmerCoordinator], SensorEntity):
    """What is planned for a given meal slot today. State is the meal's name, or 'none'."""

    _attr_has_entity_name = True
    _attr_icon = "mdi:silverware-fork-knife"

    def __init__(self, coordinator: SimmerCoordinator, entry_id: str, slot: str) -> None:
        super().__init__(coordinator)
        self._slot = slot
        self._attr_unique_id = f"{DOMAIN}_{entry_id}_today_{slot}"
        self._attr_name = f"Today's {slot}"

    def _meals(self) -> list[dict]:
        today = dt_util.now().date().isoformat()
        return [m for m in self.coordinator.data["meals"] if m["date"] == today and m["slot"] == self._slot]

    @property
    def native_value(self) -> str:
        meals = self._meals()
        return ", ".join(m["title"] for m in meals) if meals else "none"

    @property
    def extra_state_attributes(self) -> dict:
        return {"meals": [{"title": m["title"], "servings": m.get("servings"), "from": m.get("ownerName")} for m in self._meals()]}
