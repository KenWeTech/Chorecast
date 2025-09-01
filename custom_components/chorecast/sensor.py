from __future__ import annotations

import json
import logging
from typing import Any, Dict, Optional, List

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity import DeviceInfo
from homeassistant.components.sensor import SensorEntity
from homeassistant.config_entries import ConfigEntry

from .const import (
    DOMAIN,
    KEY_USER_STATS, KEY_TOTAL_COMPLETED, KEY_TOTAL_MISSED, KEY_TOTAL_DUE,
    KEY_NEXT_DUE, KEY_LAST_COMPLETED
)

_LOGGER = logging.getLogger(__name__)

# --- helpers -----------------------------------------------------------------

def _slug(text: str) -> str:
    """Simple slug: lowercase + underscores."""
    return "".join(ch if ch.isalnum() else "_" for ch in text.lower()).strip("_")

def _uid_global(suffix: str) -> str:
    return f"{DOMAIN}_{suffix}"

def _uid_user(user: str, metric: str) -> str:
    return f"{DOMAIN}_{_slug(user)}_{metric}"

def _maybe_json(val: Any) -> Any:
    """If val is a JSON string, parse it; otherwise return unchanged."""
    if isinstance(val, str):
        try:
            return json.loads(val)
        except Exception:
            return val
    return val

# --- base sensor ------------------------------------------------------------

class _ChorecastBaseSensor(SensorEntity):
    """Common base for Chorecast sensors."""

    _attr_has_entity_name = False
    _attr_should_poll = False

    def __init__(
        self,
        entry_id: str,
        unique_id: str,
        name: str,
        icon: Optional[str] = None,
        unit: Optional[str] = None,
    ) -> None:
        self._entry_id = entry_id
        # unique_id passed in should be stable across restarts
        self._attr_unique_id = unique_id
        self._attr_name = name
        self._attr_icon = icon
        self._attr_native_unit_of_measurement = unit
        self._state: Any = None
        self._attrs: Dict[str, Any] = {}

    @property
    def native_value(self) -> Any:
        return self._state

    @property
    def extra_state_attributes(self) -> Dict[str, Any]:
        return self._attrs

    @property
    def device_info(self) -> DeviceInfo:
        return DeviceInfo(
            identifiers={(DOMAIN, self._entry_id)},
            name="Chorecast",
            manufacturer="Chorecast",
            model="Webhook",
        )

    @callback
    def _write(self, state: Any, attrs: Optional[Dict[str, Any]] = None) -> None:
        """Update entity state and attributes and write to HA."""
        self._state = state
        self._attrs = attrs or {}
        try:
            self.async_write_ha_state()
        except Exception as e:
            _LOGGER.exception("Failed to write state for %s: %s", self.entity_id if hasattr(self, "entity_id") else self._attr_name, e)

# --- setup entry ------------------------------------------------------------

async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, async_add_entities):
    """Set up sensors and connect to dispatcher for this entry."""
    store = hass.data[DOMAIN][entry.entry_id]
    entities_map: Dict[str, _ChorecastBaseSensor] = store["entities"]
    signal: str = store["signal"]

    # core/global sensors definitions
    core_defs = [
        ("total_due_today", "Chorecast Total Due Today", "mdi:calendar-clock", "chores"),
        ("total_completed_today", "Chorecast Total Completed Today", "mdi:check-circle-outline", "chores"),
        ("total_missed_today", "Chorecast Total Missed Today", "mdi:alert-circle-outline", "chores"),
        ("next_due", "Chorecast Next Due", "mdi:calendar-clock-outline", None),
        ("last_completed", "Chorecast Last Completed", "mdi:check-all", None),
    ]

    initial_entities: List[_ChorecastBaseSensor] = []
    for suffix, name, icon, unit in core_defs:
        uid_key = _uid_global(suffix)
        if uid_key not in entities_map:
            # unique_id for registry: include entry id so multiple instances won't collide
            unique_id = f"{entry.entry_id}_{uid_key}"
            ent = _ChorecastBaseSensor(entry.entry_id, unique_id, name, icon=icon, unit=unit)
            entities_map[uid_key] = ent
            initial_entities.append(ent)
            _LOGGER.debug("Prepared core sensor %s (key=%s, unique_id=%s)", name, uid_key, unique_id)

    if initial_entities:
        _LOGGER.debug("Adding initial core Chorecast entities: %s", [e._attr_name for e in initial_entities])
        async_add_entities(initial_entities, update_before_add=False)

    # callback that will run when new payload arrives; use @callback to ensure it's run in loop
    @callback
    def _handle(payload: Dict[str, Any]):
        """Handle new payload from the webhook and update/create sensors."""
        try:
            _LOGGER.debug("Chorecast payload received by sensor platform: %s", payload)

            # --- global totals ---
            total_completed = payload.get(KEY_TOTAL_COMPLETED)
            total_missed = payload.get(KEY_TOTAL_MISSED)
            total_due = payload.get(KEY_TOTAL_DUE)

            try:
                entities_map[_uid_global("total_completed_today")]._write(total_completed or 0)
            except KeyError:
                _LOGGER.debug("Total completed sensor missing in entities_map")

            try:
                entities_map[_uid_global("total_missed_today")]._write(total_missed or 0)
            except KeyError:
                _LOGGER.debug("Total missed sensor missing in entities_map")

            try:
                entities_map[_uid_global("total_due_today")]._write(total_due or 0)
            except KeyError:
                _LOGGER.debug("Total due sensor missing in entities_map")

            # --- global next_due & last_completed (objects) ---
            next_due = _maybe_json(payload.get(KEY_NEXT_DUE) or {}) or {}
            if not isinstance(next_due, dict):
                next_due = {}
            nd_state = next_due.get("chore_name") or "None"
            try:
                entities_map[_uid_global("next_due")]._write(nd_state, next_due)
            except KeyError:
                _LOGGER.debug("Global next_due sensor missing in entities_map")

            last_completed = _maybe_json(payload.get(KEY_LAST_COMPLETED) or {}) or {}
            if not isinstance(last_completed, dict):
                last_completed = {}
            lc_state = last_completed.get("chore_name") or "None"
            try:
                entities_map[_uid_global("last_completed")]._write(lc_state, last_completed)
            except KeyError:
                _LOGGER.debug("Global last_completed sensor missing in entities_map")

            # --- per-user sensors ---
            user_stats_raw = payload.get(KEY_USER_STATS) or {}
            user_stats_parsed = _maybe_json(user_stats_raw) or {}
            if not isinstance(user_stats_parsed, dict):
                _LOGGER.warning("user_stats_today not a dict after parsing: %s", user_stats_parsed)
                return

            new_entities: List[_ChorecastBaseSensor] = []

            for user_name, stats in user_stats_parsed.items():
                # defensive parsing
                stats = _maybe_json(stats) or {}
                if not isinstance(stats, dict):
                    _LOGGER.debug("Skipping user %s because stats not dict: %s", user_name, stats)
                    continue

                _LOGGER.debug("Processing user %s stats: %s", user_name, stats)

                # metrics to create: completed, missed, next_due, last_completed
                # completed
                uid_key_c = _uid_user(user_name, "completed")
                ent_c = entities_map.get(uid_key_c)
                if ent_c is None:
                    unique_id = f"{entry.entry_id}_{uid_key_c}"
                    ent_c = _ChorecastBaseSensor(entry.entry_id, unique_id, f"Chorecast {user_name} Completed", icon="mdi:account-check", unit="chores")
                    entities_map[uid_key_c] = ent_c
                    new_entities.append(ent_c)
                    _LOGGER.info("Discovered new sensor for user completed: %s (unique_id=%s)", uid_key_c, unique_id)
                ent_c._write(stats.get("completed", 0))

                # missed
                uid_key_m = _uid_user(user_name, "missed")
                ent_m = entities_map.get(uid_key_m)
                if ent_m is None:
                    unique_id = f"{entry.entry_id}_{uid_key_m}"
                    ent_m = _ChorecastBaseSensor(entry.entry_id, unique_id, f"Chorecast {user_name} Missed", icon="mdi:account-alert", unit="chores")
                    entities_map[uid_key_m] = ent_m
                    new_entities.append(ent_m)
                    _LOGGER.info("Discovered new sensor for user missed: %s (unique_id=%s)", uid_key_m, unique_id)
                ent_m._write(stats.get("missed", 0))

                # next_due
                uid_key_nd = _uid_user(user_name, "next_due")
                ent_nd = entities_map.get(uid_key_nd)
                if ent_nd is None:
                    unique_id = f"{entry.entry_id}_{uid_key_nd}"
                    ent_nd = _ChorecastBaseSensor(entry.entry_id, unique_id, f"{user_name} Next Due", icon="mdi:calendar-clock")
                    entities_map[uid_key_nd] = ent_nd
                    new_entities.append(ent_nd)
                    _LOGGER.info("Discovered new sensor for user next_due: %s (unique_id=%s)", uid_key_nd, unique_id)
                nd_obj = _maybe_json(stats.get("next_due") or {}) or {}
                if not isinstance(nd_obj, dict):
                    nd_obj = {}
                ent_nd._write(nd_obj.get("chore_name", "None"), {"user": user_name, **nd_obj})

                # last_completed
                uid_key_lc = _uid_user(user_name, "last_completed")
                ent_lc = entities_map.get(uid_key_lc)
                if ent_lc is None:
                    unique_id = f"{entry.entry_id}_{uid_key_lc}"
                    ent_lc = _ChorecastBaseSensor(entry.entry_id, unique_id, f"Chorecast {user_name} Last Completed", icon="mdi:history")
                    entities_map[uid_key_lc] = ent_lc
                    new_entities.append(ent_lc)
                    _LOGGER.info("Discovered new sensor for user last_completed: %s (unique_id=%s)", uid_key_lc, unique_id)
                lc_obj = _maybe_json(stats.get("last_completed") or {}) or {}
                if not isinstance(lc_obj, dict):
                    lc_obj = {}
                ent_lc._write(lc_obj.get("chore_name", "None"), {"user": user_name, **lc_obj})

            # add any new sensors safely in the event loop
            if new_entities:
                _LOGGER.debug("Adding %d newly discovered Chorecast entities: %s", len(new_entities), [e._attr_name for e in new_entities])
                # schedule actual add on the event loop
                hass.async_create_task(_async_add_entities(async_add_entities, new_entities))

        except Exception:
            _LOGGER.exception("Error processing Chorecast payload in sensor platform")

    # subscribe to the entry-specific signal
    unsub = async_dispatcher_connect(hass, signal, _handle)
    entry.async_on_unload(unsub)

    # if we already have a payload (reload), process it once
    if store.get("latest"):
        _handle(store["latest"])


async def _async_add_entities(async_add_entities_callable, new_entities: List[_ChorecastBaseSensor]) -> None:
    """Coroutine wrapper to call async_add_entities from the event loop."""
    try:
        async_add_entities_callable(new_entities, update_before_add=False)
    except Exception:
        logging.getLogger(__name__).exception("Failed to add new Chorecast entities")

