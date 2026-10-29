"""Each Simmer shopping list is a Home Assistant to-do list (works with voice assistants and the todo.* services)."""
from __future__ import annotations

from homeassistant.components.todo import TodoItem, TodoItemStatus, TodoListEntity, TodoListEntityFeature
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN
from .coordinator import SimmerCoordinator, device_info


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback) -> None:
    coordinator: SimmerCoordinator = hass.data[DOMAIN][entry.entry_id]
    known: set[str] = set()

    def add_new() -> None:
        fresh = [SimmerTodoList(coordinator, lid) for lid in coordinator.data["lists"] if lid not in known]
        known.update(e.list_id for e in fresh)
        if fresh:
            async_add_entities(fresh)

    add_new()
    entry.async_on_unload(coordinator.async_add_listener(add_new))


def _summary(item: dict) -> str:
    qty = (item.get("quantity") or "").strip()
    return f"{item['name']} ({qty})" if qty else item["name"]


class SimmerTodoList(CoordinatorEntity[SimmerCoordinator], TodoListEntity):
    _attr_has_entity_name = True
    _attr_supported_features = (
        TodoListEntityFeature.CREATE_TODO_ITEM
        | TodoListEntityFeature.UPDATE_TODO_ITEM
        | TodoListEntityFeature.DELETE_TODO_ITEM
    )

    def __init__(self, coordinator: SimmerCoordinator, list_id: str) -> None:
        super().__init__(coordinator)
        self._attr_device_info = device_info(coordinator)
        self.list_id = list_id
        self._attr_unique_id = f"{DOMAIN}_list_{list_id}"

    @property
    def _list(self) -> dict | None:
        return self.coordinator.data["lists"].get(self.list_id)

    @property
    def available(self) -> bool:
        return super().available and self._list is not None

    @property
    def name(self) -> str:
        return self._list["name"] if self._list else "Simmer list"

    @property
    def todo_items(self) -> list[TodoItem] | None:
        if not self._list:
            return None
        return [
            TodoItem(
                uid=i["id"],
                summary=_summary(i),
                status=TodoItemStatus.COMPLETED if i["checked"] else TodoItemStatus.NEEDS_ACTION,
                description=i.get("details") or None,
            )
            for i in self._list["items"]
        ]

    async def async_create_todo_item(self, item: TodoItem) -> None:
        # Simmer recognizes the item: "2 lait" becomes Lait, quantity 2, in its aisle.
        await self.coordinator.client.add_item(self.list_id, item.summary or "")
        await self.coordinator.async_request_refresh()

    async def async_update_todo_item(self, item: TodoItem) -> None:
        current = next((i for i in self._list["items"] if i["id"] == item.uid), None) if self._list else None
        patch: dict = {"checked": item.status == TodoItemStatus.COMPLETED}
        if current and item.summary and item.summary != _summary(current):
            patch["name"] = item.summary
            patch["quantity"] = ""
        await self.coordinator.client.update_item(self.list_id, item.uid, patch)
        await self.coordinator.async_request_refresh()

    async def async_delete_todo_items(self, uids: list[str]) -> None:
        for uid in uids:
            await self.coordinator.client.delete_item(self.list_id, uid)
        await self.coordinator.async_request_refresh()
