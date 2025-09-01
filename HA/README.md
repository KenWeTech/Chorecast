# Chorecast Integration for Home Assistant

Welcome to the Chorecast integration for Home Assistant\! This guide will help you bring all your chore tracking data from your Chorecast application directly into your Home Assistant dashboard.

There are two methods to set up this integration. Please choose the one that best fits your needs.

  * **Path A (Recommended):** Use the **Custom Integration**. This method is easier to manage, automatically creates all necessary sensors for you, and is the recommended approach for most users.
  * **Path B (YAML Method):** Use **Trigger-based Template Sensors**. This method involves adding configuration directly to your `configuration.yaml` file and is for users who prefer manual YAML management and do not wish to use a custom component.

## Prerequisites

  * A working Home Assistant instance.
  * A Chorecast application instance capable of sending webhook notifications.
  * **HACS** (Home Assistant Community Store) is recommended for easy installation of the Custom Integration (Path A).

-----

## Webhook Configuration (Required for Both Paths)

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

### Installation

#### HACS (Home Assistant Community Store)

1.  Navigate to HACS in your Home Assistant UI.
2.  Go to **Integrations** and click the three dots in the top right corner, then select **Custom repositories**.
3.  Add the URL to this GitHub repository and select the **Integration** category. Click **Add**.
4.  The "Chorecast" integration will now appear. Click **Install**.
5.  Restart Home Assistant.

#### Manual Installation

1.  Download the latest release from this repository.
2.  Copy the `chorecast` directory (located in `custom_components/`) into the `custom_components` directory of your Home Assistant configuration folder.
3.  Restart Home Assistant.

### Configuration

1.  Navigate to **Settings \> Devices & Services**.
2.  Click **Add Integration** and search for **Chorecast**.
3.  In the configuration dialog, enter the **Webhook ID** you chose in the "Webhook Configuration" step (e.g., `chorecast_daily_summary`).
4.  The integration will be added and will automatically create sensors.

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

## Path B: YAML Configuration (Alternative)

This method does not use the custom component. Instead, you add all configuration directly into your Home Assistant YAML files. It relies on `trigger-based template sensors`.

### YAML Setup

Add the following code to your `configuration.yaml` file (or a dedicated package file). You must create a sensor for each user you want to track.

```yaml
template:
  # This first sensor receives the webhook and stores all data in attributes.
  - trigger:
      - platform: webhook
        webhook_id: chorecast_daily_summary # Must match the ID from the Webhook Configuration step
    sensor:
      - name: "Chorecast Daily Summary"
        unique_id: chorecast_daily_summary_sensor
        state: "{{ now().isoformat() }}" # State is the last update time
        attributes:
          total_chores_due_today: "{{ trigger.json.data.total_chores_due_today }}"
          total_chores_completed_today: "{{ trigger.json.data.total_chores_completed_today }}"
          total_chores_missed_today: "{{ trigger.json.data.total_chores_missed_today }}"
          last_completed_chore: "{{ trigger.json.data.last_completed_chore }}"
          next_due_chore: "{{ trigger.json.data.next_due_chore }}"
          completed_chores_list: "{{ trigger.json.data.completed_chores_list_today }}"
          missed_chores_list: "{{ trigger.json.data.missed_chores_list_today }}"
          user_stats_today: "{{ trigger.json.data.user_stats_today }}"

  # These sensors extract data from the main summary sensor above for easy display.
  - sensor:
      - name: "Chorecast Total Completed Today"
        unique_id: chorecast_total_completed_today
        state: "{{ state_attr('sensor.chorecast_daily_summary', 'total_chores_completed_today') }}"
        unit_of_measurement: "chores"
        icon: mdi:check-circle-outline

      - name: "Chorecast Total Missed Today"
        unique_id: chorecast_total_missed_today
        state: "{{ state_attr('sensor.chorecast_daily_summary', 'total_chores_missed_today') }}"
        unit_of_measurement: "chores"
        icon: mdi:alert-circle-outline

      - name: "Chorecast Next Due"
        unique_id: chorecast_next_due_display
        state: >
          {% set chore_name = state_attr('sensor.chorecast_daily_summary', 'next_due_chore_name') %}
          {% set assigned_to = state_attr('sensor.chorecast_daily_summary', 'next_due_chore_assigned_to') %}
          {% set due_time = state_attr('sensor.chorecast_daily_summary', 'next_due_chore_due_time') %}
          {% if chore_name != 'N/A' %}
            {{ chore_name }} ({{ assigned_to }} at {{ as_timestamp(due_time) | timestamp_custom('%I:%M %p', true) }})
          {% else %}
            No chores due soon
          {% endif %}
        icon: mdi:calendar-clock-outline

      - name: "Chorecast Last Completed"
        unique_id: chorecast_last_completed_display
        state: >
          {% set chore_name = state_attr('sensor.chorecast_daily_summary', 'last_completed_chore_name') %}
          {% set completed_by = state_attr('sensor.chorecast_daily_summary', 'last_completed_chore_by') %}
          {% set completion_time = state_attr('sensor.chorecast_daily_summary', 'last_completed_chore_time') %}
          {% if chore_name != 'N/A' %}
            {{ chore_name }} ({{ completed_by }} {{ relative_time(as_datetime(completion_time)) }} ago)
          {% else %}
            No chores completed yet today
          {% endif %}
        icon: mdi:check-all

      # Add individual sensors for each user you want to track.
      # --- Geoff ---
      - name: "Geoff Completed Chores Today"
        unique_id: chorecast_geoff_completed_today
        state: >
          {% set stats = state_attr('sensor.chorecast_daily_summary', 'user_stats_today') %}
          {{ stats['Geoff']['completed'] if stats and 'Geoff' in stats else 0 }}
        unit_of_measurement: "chores"
        icon: mdi:account-check

      - name: "Geoff Last Completed Chore"
        unique_id: chorecast_geoff_last_completed
        state: >
          {% set stats = state_attr('sensor.chorecast_daily_summary', 'user_stats_today') %}
          {{ stats['Geoff']['last_completed'].chore_name
             if stats and 'Geoff' in stats and stats['Geoff']['last_completed'] else 'None' }}
        attributes:
          completion_time: >
            {% set stats = state_attr('sensor.chorecast_daily_summary', 'user_stats_today') %}
            {{ stats['Geoff']['last_completed'].completion_time
               if stats and 'Geoff' in stats and stats['Geoff']['last_completed'] else 'N/A' }}
        icon: mdi:history

      - name: "Geoff Next Due Chore"
        unique_id: chorecast_geoff_next_due
        state: >
          {% set stats = state_attr('sensor.chorecast_daily_summary', 'user_stats_today') %}
          {{ stats['Geoff']['next_due'].chore_name
             if stats and 'Geoff' in stats and stats['Geoff']['next_due'] else 'None' }}
        attributes:
          due_time: >
            {% set stats = state_attr('sensor.chorecast_daily_summary', 'user_stats_today') %}
            {{ stats['Geoff']['next_due'].due_time
               if stats and 'Geoff' in stats and stats['Geoff']['next_due'] else 'N/A' }}

      # --- Jeff ---
      - name: "Jeff Completed Chores Today"
        unique_id: chorecast_jeff_completed_today
        state: >
          {% set stats = state_attr('sensor.chorecast_daily_summary', 'user_stats_today') %}
          {{ stats['Jeff']['completed'] if stats and 'Jeff' in stats else 0 }}
        unit_of_measurement: "chores"
        icon: mdi:account-check

      - name: "Jeff Last Completed Chore"
        unique_id: chorecast_jeff_last_completed
        state: >
          {% set stats = state_attr('sensor.chorecast_daily_summary', 'user_stats_today') %}
          {{ stats['Jeff']['last_completed'].chore_name
             if stats and 'Jeff' in stats and stats['Jeff']['last_completed'] else 'None' }}
        attributes:
          completion_time: >
            {% set stats = state_attr('sensor.chorecast_daily_summary', 'user_stats_today') %}
            {{ stats['Jeff']['last_completed'].completion_time
               if stats and 'Jeff' in stats and stats['Jeff']['last_completed'] else 'N/A' }}
        icon: mdi:history
      
      # ... repeat for Jeff's "Next Due" and any other users ...

```

### Lovelace Card Examples for Path B

These cards are designed to pull data from the single `sensor.chorecast_daily_summary` and its attributes.

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
      ### User Progress
      {% set user_stats = state_attr('sensor.chorecast_daily_summary', 'user_stats_today') %}
      {% if user_stats %}
        {% for user, stats in user_stats.items() %}
          **{{ user }}:** {{ stats.completed }} Completed, {{ stats.missed }} Missed
        {% endfor %}
      {% else %}
        No user stats available yet.
      {% endif %}
  - type: markdown
    content: |
      ### Completed Chores Today
      {% set completed_list = state_attr('sensor.chorecast_daily_summary', 'completed_chores_list') %}
      {% if completed_list %}
        {% for chore in completed_list %}
          - {{ chore.chore_name }} by {{ chore.username }} ({{ as_timestamp(chore.completion_time) | timestamp_custom('%I:%M %p', true) }})
        {% endfor %}
      {% endif %}

```

#### Per-user summary card (entities)

Shows completed/missed counts, plus next due and last completed chore:

```yaml
type: entities
title: Geoff's Chores
entities:
  - entity: sensor.chorecast_geoff_completed_today
    name: Completed Today
  - entity: sensor.chorecast_geoff_missed_today
    name: Missed Today
  - entity: sensor.chorecast_geoff_next_due
    name: Next Due Chore
  - entity: sensor.chorecast_geoff_last_completed
    name: Last Completed

```

Repeat for Jeff, etc.

----------

#### Compact Markdown card

Shows a human-friendly summary with times:

```yaml
type: markdown
title: Geoff's Chore Status
content: |
  **Completed Today:** {{ states('sensor.chorecast_geoff_completed_today') }}

  **Missed Today:** {{ states('sensor.chorecast_geoff_missed_today') }}

  **Next Due:** 
  {% set due = state_attr('sensor.chorecast_geoff_next_due', 'due_time') %}
  {{ states('sensor.chorecast_geoff_next_due') }} 
  {% if due and due != 'N/A' %}
    (Due: {{ as_timestamp(due) | timestamp_custom('%I:%M %p', true) }})
  {% endif %}

  **Last Completed:** 
  {% set last = state_attr('sensor.chorecast_geoff_last_completed',
  'completion_time') %}
  {{ states('sensor.chorecast_geoff_last_completed') }}
  {% if last and last != 'N/A' %}
    (at {{ as_timestamp(last) | timestamp_custom('%I:%M %p', true) }})
  {% endif %}

```

----------

#### Glance card for quick view

Good for seeing multiple users at a glance:

```yaml
type: glance
title: Chore Status Overview
entities:
  - entity: sensor.chorecast_geoff_next_due
    name: Geoff Next
  - entity: sensor.chorecast_jeff_next_due
    name: Jeff Next

```

----------

#### Grid of user “status cards”

If you use the  **[custom:stack-in-card](https://github.com/custom-cards/stack-in-card)**  or just plain vertical stacks:

```yaml
type: vertical-stack
cards:
  - type: entities
    title: Geoff
    entities:
      - sensor.chorecast_geoff_completed_today
      - sensor.chorecast_geoff_missed_today
      - sensor.chorecast_geoff_next_due
      - sensor.chorecast_geoff_last_completed
  - type: entities
    title: Jeff
    entities:
      - sensor.chorecast_jeff_completed_today
      - sensor.chorecast_jeff_missed_today
      - sensor.chorecast_jeff_next_due
      - sensor.chorecast_jeff_last_completed

```
