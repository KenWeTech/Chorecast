from __future__ import annotations

import voluptuous as vol
from homeassistant import config_entries
from homeassistant.core import callback

from .const import DOMAIN, DEFAULT_WEBHOOK_ID


class ChorecastConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a config flow for Chorecast."""

    VERSION = 1

    async def async_step_user(self, user_input=None):
        if self._async_current_entries():
            return self.async_abort(reason="single_instance_allowed")

        if user_input is not None:
            # Create the entry; we store webhook_id in data for simplicity
            return self.async_create_entry(title="Chorecast", data={"webhook_id": user_input["webhook_id"]})

        schema = vol.Schema(
            {
                vol.Required("webhook_id", default=DEFAULT_WEBHOOK_ID): str,
            }
        )
        return self.async_show_form(step_id="user", data_schema=schema)

    @staticmethod
    @callback
    def async_get_options_flow(config_entry):
        return ChorecastOptionsFlowHandler(config_entry)


class ChorecastOptionsFlowHandler(config_entries.OptionsFlow):
    """Handle options for an existing entry."""

    def __init__(self, config_entry):
        self.config_entry = config_entry

    async def async_step_init(self, user_input=None):
        if user_input is not None:
            return self.async_create_entry(title="", data=user_input)

        current = self.config_entry.options.get("webhook_id") or self.config_entry.data.get("webhook_id") or DEFAULT_WEBHOOK_ID
        schema = vol.Schema(
            {
                vol.Required("webhook_id", default=current): str,
            }
        )
        return self.async_show_form(step_id="init", data_schema=schema)
