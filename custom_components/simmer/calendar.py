"""The meal plan as a Home Assistant calendar (meals shared with you appear too)."""
from __future__ import annotations

from datetime import date, datetime, time, timedelta

from homeassistant.components.calendar import CalendarEntity, CalendarEvent
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity
from homeassistant.util import dt as dt_util

from .const import DOMAIN
from .coordinator import SimmerCoordinator

# Meals have a slot, not a time. These are the hours they take on the calendar.
SLOT_TIMES = {
    "breakfast": (time(8, 0), time(9, 0)),
    "lunch": (time(12, 0), time(13, 0)),
    "snack": (time(15, 0), time(15, 30)),
    "dinner": (time(18, 0), time(19, 0)),
}


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback) -> None:
    async_add_entities([SimmerMealCalendar(hass.data[DOMAIN][entry.entry_id], entry.entry_id)])


def to_event(meal: dict) -> CalendarEvent:
    start_t, end_t = SLOT_TIMES.get(meal["slot"], SLOT_TIMES["dinner"])
    day = date.fromisoformat(meal["date"])
    tz = dt_util.DEFAULT_TIME_ZONE
    bits = []
    if meal.get("servings"):
        bits.append(f"{meal['servings']} servings")
    if not meal.get("mine"):
        bits.append(f"From {meal.get('ownerName', '?')}")
    if meal.get("note"):
        bits.append(meal["note"])
    return CalendarEvent(
        start=datetime.combine(day, start_t, tzinfo=tz),
        end=datetime.combine(day, end_t, tzinfo=tz),
        summary=meal["title"] or "Meal",
        description="\n".join(bits) or None,
        uid=meal["id"],
    )


class SimmerMealCalendar(CoordinatorEntity[SimmerCoordinator], CalendarEntity):
    _attr_has_entity_name = True
    _attr_name = "Meal plan"

    def __init__(self, coordinator: SimmerCoordinator, entry_id: str) -> None:
        super().__init__(coordinator)
        self._attr_unique_id = f"{DOMAIN}_{entry_id}_meal_plan"

    @property
    def event(self) -> CalendarEvent | None:
        now = dt_util.now()
        upcoming = sorted((to_event(m) for m in self.coordinator.data["meals"]), key=lambda e: e.start)
        return next((e for e in upcoming if e.end > now), None)

    async def async_get_events(self, hass: HomeAssistant, start_date: datetime, end_date: datetime) -> list[CalendarEvent]:
        meals = await self.coordinator.client.meals(
            (start_date.date() - timedelta(days=1)).isoformat(), end_date.date().isoformat()
        )
        return [e for e in (to_event(m) for m in meals) if e.end > start_date and e.start < end_date]
