import logging
from typing import Any, Dict

from homeassistant.core import HomeAssistant, callback
from homeassistant.config_entries import ConfigEntry
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.components import webhook

from .const import (
    DOMAIN, DEFAULT_WEBHOOK_ID, PLATFORMS
)

_LOGGER = logging.getLogger(__name__)


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    """Set up the Chorecast base (nothing to do here)."""
    if DOMAIN not in hass.data:
        hass.data[DOMAIN] = {}
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Chorecast from a config entry."""
    # Per-entry storage
    webhook_id: str = entry.options.get("webhook_id") or entry.data.get("webhook_id") or DEFAULT_WEBHOOK_ID
    signal = f"{DOMAIN}_{entry.entry_id}_new_data"

    hass.data[DOMAIN][entry.entry_id] = {
        "latest": None,
        "entities": {},     # unique_id -> entity
        "signal": signal,
        "webhook_id": webhook_id,
    }

    @callback
    async def _handle_webhook(hass: HomeAssistant, wid: str, request):
        """Handle incoming webhook payloads from Chorecast."""
        try:
            data = await request.json()
        except Exception as err:  # pragma: no cover (safety)
            _LOGGER.warning("Chorecast webhook: invalid JSON (%s)", err)
            return "invalid json", 400

        # Accept both flat payloads and {"data": {...}}
        payload: Dict[str, Any] = data.get("data") if isinstance(data, dict) and "data" in data else data
        if not isinstance(payload, dict):
            _LOGGER.warning("Chorecast webhook: payload not a dict: %s", payload)
            return "invalid payload", 400

        hass.data[DOMAIN][entry.entry_id]["latest"] = payload
        _LOGGER.debug("Chorecast payload received: %s", payload)

        async_dispatcher_send(hass, signal, payload)
        return "ok", 200

    # Register webhook for this entry
    webhook.async_register(
        hass,
        DOMAIN,
        "Chorecast Webhook",
        webhook_id,
        _handle_webhook,
    )
    _LOGGER.info("Chorecast: webhook registered with id '%s'", webhook_id)

    # Forward to platforms
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    # Reload on options change (e.g., webhook id)
    entry.async_on_unload(entry.add_update_listener(_update_listener))
    return True


async def _update_listener(hass: HomeAssistant, entry: ConfigEntry):
    """Handle options updates by reloading the entry."""
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload Chorecast entry."""
    data = hass.data[DOMAIN].get(entry.entry_id)
    if data:
        wid = data.get("webhook_id")
        if wid:
            try:
                webhook.async_unregister(hass, wid)
                _LOGGER.info("Chorecast: webhook '%s' unregistered", wid)
            except Exception:  # pragma: no cover
                _LOGGER.debug("Chorecast: webhook '%s' already unregistered", wid)

    unloaded = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unloaded:
        hass.data[DOMAIN].pop(entry.entry_id, None)
    return unloaded
