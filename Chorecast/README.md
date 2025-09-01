## Chorecast: General Usage Guide

This guide covers the initial setup, configuration, and day-to-day use of the Chorecast application and its companion NFC readers.

### 1. First-Time Login and Setup

On the very first launch, Chorecast automatically sets up the database and creates a default administrator account to get you started.

* **Username:** `admin` 
* **Password:** `adminpassword` 

**To get started:**

1.  Navigate to the Chorecast web interface in your browser.
2.  You will be greeted by the login screen. Enter the default credentials above to sign in.
3.  **Security First:** Your first step should be to change the default password. Navigate to the **Users** page from the sidebar, click the "Edit" button next to the `admin` user, and set a new, secure password.

---

### 2. The Settings Page: Configuring Chorecast

The Settings page is the control center for tailoring Chorecast to your household's needs. Here’s a breakdown of each option:

#### Reader Behavior

* **Authentication Method**: This setting defines how users interact with the physical Chorecast Readers.
    * **Assigned Reader Mode:** Each user is assigned to one specific reader in the **Users** menu. Only the assigned user can complete chores on that reader. This is a simple, fixed setup.
    * **Tag Sign-In Mode:** Readers are shared. A user must first scan their personal "User" type NFC tag to sign in to a reader. Once signed in, they can scan chore tags to complete them. This is ideal for households with multiple users and fewer readers.
* **Sign-Out Tag**: When using "Tag Sign-In Mode," you can designate a specific NFC tag (which must have its type set to `sign_out` on the Tags page) as a universal sign-out tag. Scanning this tag will sign out any currently active user on that reader.

#### My Nudgr Settings (Optional)

This section allows you to integrate with "My Nudgr," an external notification service, to receive reminders about chores.

* **My Nudgr Webhook URL & API Key**: Enter the URL and API key for your My Nudgr instance.
* **Send notification on missed chores** : If enabled, Chorecast will send a notification via My Nudgr when a chore with a set time is more than one hour past due.
* **Send notification for important chores** : If enabled, Chorecast will send a reminder just before a chore marked as "Important" is scheduled to begin.
* **Reminder Lead Time** : For important chores, this determines how far in advance the notification webhook is sent to My Nudgr.
* **Relentless Nudge** : This enables the "Relentless Nudge" feature in My Nudgr for important chore notifications, ensuring the reminder is more persistent.

#### Home Assistant Webhook (Optional)

* **Home Assistant Webhook URL**: Enter the full webhook URL from your Home Assistant instance. Chorecast will send a comprehensive daily summary to this URL whenever a chore is completed, missed, or at the start of a new day, allowing for rich integrations and dashboards in Home Assistant.

#### General Settings

* **Use 24-Hour Time (Military Time)** : When checked, all times throughout the Chorecast interface will be displayed in a 24-hour format (e.g., 14:30) instead of a 12-hour AM/PM format (e.g., 02:30 PM).

#### Advanced Settings

* **Clear Statistics**: This tool allows you to permanently delete historical chore data from the database. You can choose to clear data for all users or a specific user, and select a time period (e.g., All Time, Older than 90 Days).
* **Clear Banned Readers** : This button will clear the list of all reader MAC addresses that have been temporarily banned due to repeated failed connection or registration attempts.

---

### 3. Chorecast Reader: Setup and Usage

The Chorecast Reader is a physical device that uses NFC to log chore completions.

#### Initial Setup: The Configuration Portal

When you power on a new or factory-reset reader for the first time, it won't know how to connect to your network. It will automatically enter **Configuration Portal Mode**.

1.  **Connect to the Reader:** The reader will create its own Wi-Fi Access Point (AP). The network name will be `Chorecast-Reader-Setup-XXXXXX`, where XXXXXX is based on the reader's unique MAC address. Connect to this network with your phone or computer.
2.  **Open the Portal:** Once connected, a captive portal page should automatically open in your browser. If it doesn't, open a browser and navigate to `192.168.4.1`.
3.  **Enter Credentials:** The portal page will prompt you for your home Wi-Fi network name (SSID) and password, as well as the Chorecast Server's IP address and MQTT Port (default is 1887).
4.  **Save & Restart:** Click "Save & Connect." The reader will save the settings, restart, and automatically attempt to connect to your Wi-Fi and the Chorecast server.

#### Understanding the Reader's LED and Sounds

The reader uses its LED and a buzzer to communicate its status.

| LED Signal | Sound | Meaning |
| :--- | :--- | :--- |
| Rainbow Pulse  | Startup Melody  | The reader is powered on and trying to connect to Wi-Fi. |
| Solid Blue  | (None) | The reader is connected and idle, waiting for a tag to be scanned. This is its normal "ready" state. |
| White Flash  | Two rising tones  | An NFC tag has just been successfully scanned and its data is being sent to the server. |
| Bright Green  | Success Melody  | The chore was successfully marked as complete. |
| Red  | Error Melody  | A system error occurred, or the tag is disabled. |
| Red  | "No Go" Melody  | The action was denied (e.g., wrong user, unsupported tag type). |
| Cyan  | Online Melody  | The reader successfully registered with the Chorecast server after connecting. |
| Yellow  | "Not Due" Melody  | The scanned chore is not scheduled to be done at this time. |
| Orange  | "No User" Melody  | A chore tag was scanned, but no user is currently signed in to the reader. |
| Pink  | "Already Done" Melody  | The scanned chore has already been completed for the day. |
| Red (during connection) | (None) | A connection attempt to the Chorecast server (MQTT) failed. |

#### Troubleshooting and Advanced Functions

* **Re-entering the Configuration Portal:** If the reader cannot connect to the Chorecast server after 12 repeated attempts, it will assume the server settings are incorrect. It will automatically stop trying to connect and will re-launch the Configuration Portal. The Wi-Fi AP name will be `Chorecast-Reader-XXXXXX` (without "-Setup").
* **Power Cycling:** If the reader is powered off and on, it will always first attempt to reconnect using its last saved settings. It will only enter the portal if these connection attempts repeatedly fail.
* **Factory Reset:** This erases all saved settings (Wi-Fi and server info) from the reader's memory. It can be triggered in two ways:
    1.  **From the Config Portal:** When connected to the reader's Wi-Fi AP, there is a "Factory Reset" button on the configuration page.
    2.  **From the Server:** An administrator can send a factory reset command to an online reader by deleting it from the **Readers** page in the Chorecast web interface.
