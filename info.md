<p align="center">
  <img src="https://github.com/KenWeTech/Chorecast/blob/main/logo.png?raw=true" alt="Chorecast Logo" width="200"/>
</p>

# Chorecast Integration

Welcome to the Chorecast integration for Home Assistant\! This guide will help you bring all your chore tracking data from your Chorecast application directly into your Home Assistant dashboard.

Chorecast allows you to manage household chores using NFC tags with a Chorecast Reader.

Chorecast is designed for a streamlined, automated chore management experience.

This integration creates dedicated sensors in Home Assistant that provide information and summaries about chores. You can:

Track chore completion.

View a clear summary of completed and missed chores.

Create automations using the created sensors.

## There are two methods:

  * **Path A (Recommended):** Use the **Custom Integration**. This method is easier to manage, automatically creates all necessary sensors for you, and is the recommended approach for most users.
  * **Path B (YAML Method):** Use **Trigger-based Template Sensors**. This method involves adding configuration directly to your `configuration.yaml` file and is for users who prefer manual YAML management and do not wish to use a custom component.

-----

## Webhook Configuration

Both methods require you to configure your Chorecast application to send a "Daily Summary" webhook to Home Assistant. This ensures that Home Assistant always has the most up-to-date chore information.

### Webhook URL

In your Chorecast application, set the webhook URL to:
`http://[YOUR_HA_IP]:8123/api/webhook/[YOUR_WEBHOOK_ID]`

  * Replace `[YOUR_HA_IP]` with the IP address of your Home Assistant instance.
  * Replace `[YOUR_WEBHOOK_ID]` with a unique ID you will use in your Home Assistant configuration (e.g., `chorecast_daily_summary`).

### Webhook Payload

Your Chorecast application should send a `POST` request with a JSON payload in the following format. This payload provides a complete overview of the day's chore status. Here is an example:

```json
{
    "event_type": "chorecast_daily_summary",
    "data": {
        "current_date": "2025-07-22",
        "total_chores_due_today": 8,
        "total_chores_completed_today": 3,
        "total_chores_missed_today": 1,
        "last_completed_chore": {
            "chore_id": 123,
            "chore_name": "Take out the trash",
            "user_id": 4,
            "username": "Geoff",
            "completion_time": "2025-07-22T14:35:00.000-04:00"
        },
        "next_due_chore": {
            "chore_id": 999,
            "chore_name": "Prepare dinner",
            "user_id": 5,
            "username": "Charlie",
            "due_time": "2025-07-22T19:00:00.000-04:00"
        },
        "completed_chores_list_today": [
            { "chore_id": 123, "chore_name": "Take out the trash", "username": "Geoff", "completion_time": "2025-07-22T14:35:00.000-04:00" },
            { "chore_id": 124, "chore_name": "Walk the dog", "username": "Jeff", "completion_time": "2025-07-22T10:00:00.000-04:00" }
        ],
        "missed_chores_list_today": [
            { "chore_id": 456, "chore_name": "Water plants", "username": "Jeff", "due_time": "2025-07-22T10:00:00.000-04:00" }
        ],
        "user_stats_today": {
            "Geoff": { "completed": 2, "missed": 0, "next_due": { ... }, "last_completed": { ... } },
            "Jeff": { "completed": 1, "missed": 1, "next_due": { ... }, "last_completed": { ... } }
        }
    }
}
```

-----

## Path A: Custom Integration (Recommended)

This method uses a custom component that you install once. It will automatically create and update all sensors whenever a webhook is received.

### Provided Sensors

The integration will create several global sensors and will **dynamically create sensors for each user** found in the `user_stats_today` part of the webhook payload.

**Global Sensors:**

  * `sensor.chorecast_total_due_today`
  * `sensor.chorecast_total_completed_today`
  * `sensor.chorecast_total_missed_today`
  * `sensor.chorecast_next_due`
  * `sensor.chorecast_last_completed`

**Per-User Sensors (example for user "Geoff"):**

  * `sensor.chorecast_geoff_completed`
  * `sensor.chorecast_geoff_missed`
  * `sensor.chorecast_geoff_next_due`
  * `sensor.chorecast_geoff_last_completed`

### Lovelace Card Examples for Path A

Because this method creates individual sensors, you can build cards very easily.

#### Per-User Status Card

This card shows a clean summary for a specific user. Repeat the card for each user.

```yaml
type: entities
title: Geoff's Chores
entities:
  - entity: sensor.chorecast_geoff_completed
    name: Completed Today
  - entity: sensor.chorecast_geoff_missed
    name: Missed Today
  - entity: sensor.chorecast_geoff_next_due
    name: Next Due Chore
  - entity: sensor.chorecast_geoff_last_completed
    name: Last Completed

```

#### Sample Dashboard

The two custom:auto-entities cards require the Auto-Entities card (HACS). If you don’t use it, you can still add regular Entities cards manually.

```yaml
title: Chorecast
path: chorecast
icon: mdi:clipboard-text
cards:
  - type: entities
    title: Daily Overview
    entities:
      - sensor.chorecast_total_due_today
      - sensor.chorecast_total_completed_today
      - sensor.chorecast_total_missed_today
      - sensor.chorecast_next_due
      - sensor.chorecast_last_completed

  - type: custom:auto-entities
    card:
      type: entities
      title: User Progress (Completed/Missed)
    filter:
      include:
        - entity_id: sensor.chorecast_*_completed
        - entity_id: sensor.chorecast_*_missed
      sort:
        method: name

  - type: custom:auto-entities
    card:
      type: entities
      title: Next Due by User
    filter:
      include:
        - entity_id: sensor.chorecast_*_next_due
      sort:
        method: name

  - type: custom:auto-entities
    card:
      type: entities
      title: Last Completed by User
    filter:
      include:
        - entity_id: sensor.chorecast_*_last_completed
      sort:
        method: name

```

#### Compact Markdown Card with Times

This card provides a more human-readable summary.

```yaml
type: markdown
title: Geoff's Chore Status
content: |
  **Completed Today:** {{ states('sensor.chorecast_geoff_completed') }}
  **Missed Today:** {{ states('sensor.chorecast_geoff_missed') }}

  **Next Due:** {% set due_time = state_attr('sensor.chorecast_geoff_next_due', 'due_time') %}
  {{ states('sensor.chorecast_geoff_next_due') }} 
  {% if due_time and due_time != 'N/A' %}
    (Due: {{ as_timestamp(due_time) | timestamp_custom('%I:%M %p', true) }})
  {% endif %}

  **Last Completed:** {% set last_time = state_attr('sensor.chorecast_geoff_last_completed', 'completion_time') %}
  {{ states('sensor.chorecast_geoff_last_completed') }}
  {% if last_time and last_time != 'N/A' %}
    ({{ relative_time(as_datetime(last_time)) }} ago)
  {% endif %}

```

#### Glance card for quick view

Good for seeing multiple users at a glance:

```yaml
type: glance
title: Geoff's Chores
entities:
  - entity: sensor.chorecast_geoff_completed
    name: ✅ Completed
  - entity: sensor.chorecast_geoff_missed
    name: ❌ Missed
  - entity: sensor.chorecast_geoff_next_due
    name: ⏰ Next Due
  - entity: sensor.chorecast_geoff_last_completed
    name: 🕒 Last Done

```

#### All-in-One Dynamic Dashboard

This card uses Markdown to dynamically display stats for all users, plus lists of completed and missed chores.

```yaml
type: vertical-stack
cards:
  - type: markdown
    content: |
      ## Chorecast Daily Overview
      ### Today's Tally
  - type: entities
    entities:
      - entity: sensor.chorecast_total_completed_today
      - entity: sensor.chorecast_total_missed_today
  - type: markdown
    content: |
      ### Current Status
  - type: entities
    entities:
      - entity: sensor.chorecast_next_due
      - entity: sensor.chorecast_last_completed
  - type: markdown
    content: >
      ### User Progress

      {% set users = states.sensor | selectattr('entity_id', 'search',
      'sensor.chorecast_') | list %}

      {% for s in users if '_completed' in s.entity_id or '_missed' in
      s.entity_id %}
        **{{ s.name }}:** {{ s.state }} {{ state_attr(s.entity_id, 'unit_of_measurement') or '' }}<br>
      {% endfor %}
  - type: markdown
    content: |
      ### Next Due Per User
      {% for s in states.sensor if s.entity_id.endswith('_next_due') %}
        - **{{ s.name }}:** {{ s.state }}{% if 'due_time' in s.attributes and s.attributes['due_time'] not in [None, 'N/A'] %} ({{ as_timestamp(s.attributes['due_time']) | timestamp_custom('%I:%M %p', true) }}){% endif %}<br>
      {% endfor %}
  - type: markdown
    content: |
      ### Last Completed Per User
      {% for s in states.sensor if s.entity_id.endswith('_last_completed') %}
        - **{{ s.name }}:** {{ s.state }}{% if 'completion_time' in s.attributes and s.attributes['completion_time'] not in [None, 'N/A'] %} ({{ relative_time(as_datetime(s.attributes['completion_time'])) }} ago){% endif %}<br>
      {% endfor %}

```

-----

## For Path B or more information, check out the [repo](https://github.com/KenWeTech/Chorecast/blob/main/HA/README.md).
