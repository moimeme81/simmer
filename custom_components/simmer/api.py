"""Small async client for the Simmer HTTP API."""
from __future__ import annotations

from typing import Any

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
