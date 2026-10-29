"""Constants for the Simmer integration."""
from datetime import timedelta

DOMAIN = "simmer"
CONF_URL = "url"
CONF_TOKEN = "token"
SCAN_INTERVAL = timedelta(seconds=60)
# Days of meal plan fetched for the calendar's "next event" and the sensors.
LOOKAHEAD_DAYS = 14

CONF_SHOW_PANEL = "show_panel"
CONF_PANEL_URL = "panel_url"
SLOTS = ["breakfast", "lunch", "dinner", "snack"]
