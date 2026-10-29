"""Runs the Home Assistant integration against a real Simmer server (started here on a spare port)."""
import json
import os
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path

import pytest
from pytest_socket import enable_socket, socket_allow_hosts

ROOT = Path(__file__).resolve().parents[2]
PORT = 3951
BASE = f"http://127.0.0.1:{PORT}"


def call(method, path, body=None, headers=None):
    req = urllib.request.Request(BASE + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"content-type": "application/json", "origin": BASE, **(headers or {})})
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read() or b"{}"), resp.headers


@pytest.fixture(scope="session")
def simmer():
    enable_socket()   # Home Assistant's test plugin blocks sockets; this server is on localhost
    data = tempfile.mkdtemp(prefix="simmer-ha-")
    env = {**os.environ, "PORT": str(PORT), "DATA_DIR": data, "AUTO_UPDATE": "false", "PHOTO_CHECK": "false", "TZ": "America/Toronto"}
    proc = subprocess.Popen(["node", "src/server.js"], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(50):
            try:
                call("GET", "/api/auth/me")
                break
            except Exception:  # noqa: BLE001 - not up yet
                time.sleep(0.2)
        call("POST", "/api/auth/setup", {"name": "Chris", "username": "chris", "password": "password123"})
        _, headers = call("POST", "/api/auth/login", {"username": "chris", "password": "password123"})
        cookie = headers["set-cookie"].split(";")[0]
        token = call("POST", "/api/tokens", {"name": "ha"}, {"cookie": cookie})[0]["token"]
        call("POST", "/api/recipes", {"title": "Pork Osso Buco", "yield": "6", "ingredients": ["6 pork shanks", "1 tbsp olive oil"], "steps": ["Sear.", "Braise."], "collections": ["Souper"]}, {"cookie": cookie})
        call("POST", "/api/recipes", {"title": "Lemon Brûlé", "yield": "4", "ingredients": ["2 lemons"], "steps": ["Torch."], "collections": ["Desserts"]}, {"cookie": cookie})
        socket_allow_hosts(["127.0.0.1", "::1"], allow_unix_socket=True)
        yield {"url": BASE, "token": token, "cookie": cookie}
    finally:
        proc.terminate()
        proc.wait(5)


@pytest.fixture(autouse=True)
def _custom(hass, enable_custom_integrations, socket_enabled):
    import custom_components
    mine = str(ROOT / "custom_components")
    if mine not in custom_components.__path__:   # the test plugin ships its own custom_components folder that would shadow ours
        custom_components.__path__.append(mine)
    yield
