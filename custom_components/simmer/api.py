"""Small async client for the Simmer HTTP API."""
from __future__ import annotations

from typing import Any
from urllib.parse import quote, urlencode

from aiohttp import ClientError, ClientSession, ClientTimeout


class SimmerError(Exception):
    """Simmer could not be reached or returned an error."""


class SimmerAuthError(SimmerError):
    """The API token was refused."""


class SimmerClient:
    def __init__(self, session: ClientSession, url: str, token: str) -> None:
        self._session = session
        self._base = url.rstrip("/")
        self._headers = {"Authorization": f"Bearer {token}"}

    @property
    def base_url(self) -> str:
        return self._base

    async def _request(self, method: str, path: str, json: Any = None) -> Any:
        try:
            async with self._session.request(
                method, f"{self._base}{path}", headers=self._headers, json=json, timeout=ClientTimeout(total=15)
            ) as resp:
                if resp.status == 401:
                    raise SimmerAuthError("Token refused")
                if resp.status >= 400:
                    try:
                        detail = (await resp.json()).get("error", resp.reason)
                    except Exception:  # noqa: BLE001 - body is not JSON
                        detail = resp.reason
                    raise SimmerError(f"{resp.status}: {detail}")
                return await resp.json()
        except ClientError as err:
            raise SimmerError(str(err)) from err

    async def summary(self) -> dict[str, Any]:
        return await self._request("GET", "/api/ha/summary")

    async def lists(self) -> list[dict[str, Any]]:
        return await self._request("GET", "/api/lists")

    async def meals(self, start: str, end: str) -> list[dict[str, Any]]:
        return await self._request("GET", f"/api/meals?from={start}&to={end}")

    async def add_item(self, list_id: str, name: str) -> dict[str, Any]:
        return await self._request("POST", f"/api/lists/{list_id}/items", {"name": name})

    async def update_item(self, list_id: str, item_id: str, patch: dict[str, Any]) -> dict[str, Any]:
        return await self._request("PATCH", f"/api/lists/{list_id}/items/{item_id}", patch)

    async def delete_item(self, list_id: str, item_id: str) -> None:
        await self._request("DELETE", f"/api/lists/{list_id}/items/{item_id}")

    async def recipes(self, query: str = "", collection: str = "", limit: int = 25, random: bool = False) -> dict[str, Any]:
        params = {"q": query, "collection": collection, "limit": str(limit)}
        if random:
            params["random"] = "1"
        return await self._request("GET", "/api/ha/recipes?" + urlencode({k: v for k, v in params.items() if v}))

    async def recipe(self, recipe_id: str) -> dict[str, Any]:
        return await self._request("GET", f"/api/recipes/{quote(recipe_id)}")

    async def import_recipe(self, url: str) -> dict[str, Any]:
        return await self._request("POST", "/api/import", {"url": url})

    async def create_meal(self, body: dict[str, Any]) -> dict[str, Any]:
        return await self._request("POST", "/api/meals", body)

    async def delete_meal(self, meal_id: str) -> None:
        await self._request("DELETE", f"/api/meals/{quote(meal_id)}")

    async def recipe_to_list(self, recipe_id: str, list_id: str | None, servings: float | None) -> dict[str, Any]:
        body: dict[str, Any] = {}
        if list_id:
            body["listId"] = list_id
        if servings:
            body["servings"] = servings
        return await self._request("POST", f"/api/recipes/{quote(recipe_id)}/to-list", body)

    async def image(self, path: str) -> bytes | None:
        """A recipe photo (the path Simmer gives, such as /images/abc.jpg)."""
        try:
            async with self._session.get(f"{self._base}{path}", headers=self._headers, timeout=ClientTimeout(total=20)) as resp:
                return await resp.read() if resp.status == 200 else None
        except ClientError:
            return None
