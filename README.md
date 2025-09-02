<p align="center">
  <img src="https://github.com/KenWeTech/Chorecast/blob/main/logo.png?raw=true" alt="Chorecast Logo" width="200"/>
</p>

# Chorecast: A Chore Management System

**A self-hosted chore management system that makes household tasks easy to track and more engaging with the use of NFC.**

**Chorecast makes managing household chores effortless and even a little fun.** With a simple web interface paired with **Chorecast Readers** and **chore tags** (NFC tags), family members can log completed tasks instantly with just a tap. And since it runs as a Progressive Web App (**PWA**), you can easily add it to your phone, tablet, or computer for management convenience. Readers can be used without needing to carry another device to mark chores complete, just give it power. 

### Take a look

Dashboard

<p align="center">
  <img src="https://github.com/KenWeTech/Chorecast/blob/main/Chorecast_Dash.png?raw=true" alt="Dashboard" width="800"/>
</p>

Here is a side-by-side look at scanning. The Chorecast Reader allows you to go about your day scanning chore tags to acknowledge chore completion. The dashboard will show feedback on the scans you performed, offering the choice to carry a device with the app or not.

<p align="center">
  <img src="https://github.com/KenWeTech/Chorecast/blob/main/Chorecast_Reader_scan.gif?raw=true" alt="Dashboard" width="800"/>
</p>


## How It Works: The Chorecast Flow

The core of Chorecast is designed to be simple and portable.

1.  **Grab a Reader:** A user takes a **Chorecast Reader**, which only needs power from a portable battery bank that supplies 5v.
    
2.  **Walk and Tap:** As the user moves through the house, they simply tap the reader on the **chore tag** for each completed task. The reader provides instant feedback with lights and sounds.
    
3.  **Automatic Sync:** The reader automatically communicates with the Chorecast server over Wi-Fi to log the completed chore. That's it!
    

Chorecast intelligently knows who is using the reader based on one of two modes you can set:

-   **Assigned Reader Mode (Simple & Dedicated):** Each user is assigned their own Chorecast Reader. When they power it on, Chorecast instantly knows who is completing chores. This is the "power up and go" option, perfect for younger kids.
    
-   **Tag Sign-In Mode (Flexible & Shared):** Any user can sign in to any reader by tapping their personal User Tag. When they are finished, they tap a designated Sign-Out Tag. This mode is ideal for households where readers are shared.
    

The system is smart, too—a chore tag can only be successfully scanned if the chore is actually due for that user on that day. Chores without a specific time can be completed anytime they are due.
  

## Key Features

-   **Flexible Chore Scheduling:** Set up chores to occur once, daily, or on specific days of the week.
    
-   **Chore Assignment Types:**
    
    -   **Manual:** Assign a specific user to a chore.
        
    -   **Round Robin:** Automatically cycles through a pool of users each time the chore is due.
        
    -   **Shuffle:** Randomly assigns the chore to a user from a pool each time it's due.
        
-   **User Roles:** Full access for **Admins** and a simplified, focused view for **Users** (Dashboard, Reader Status, and personal stats).
    
-   **Tap-to-Complete:** Uses **Chorecast Readers** and  **chore tags** for quick and easy chore logging. No need to carry another device.
    
-   **Detailed Statistics:** Track who did what and when with historical data and visual charts.
    
-   **PWA Ready:** Install Chorecast on your mobile device or desktop for a seamless, app-like experience.
    
-   **Powerful Integrations:** Connect Chorecast to your smart home with optional webhooks for [Home Assistant](https://www.google.com/search?q=%23-home-assistant "null") and [My Nudgr](https://github.com/KenWeTech/my-nudgr).
    

## Hardware: The Physical Connection

Chorecast bridges the gap between digital lists and the real world using two simple components.

-   **Chorecast Readers:** These are small, Wi-Fi-enabled devices that can easily be carried around without needing another device. When a chore tag is tapped, the reader securely communicates with your Chorecast server to log the activity.
    
    -   **Interested in getting a pre-built Chorecast Reader?**  [**Find out more here!**](https://diy.cl0ud.top)
        
-   **Chore Tags:** These are inexpensive NFC tags that you can stick on or near the location of a chore. You can use any standard NFC sticker, coin, card, or keychain. Once registered in Chorecast, a simple tap is all it takes!
    

## 🚀 Getting Started

Chorecast is designed to be self-hosted on your own network. You can get it running in minutes.

### Prerequisites

-   **Node.js** (v18.x or later)
    
-   **NPM**
    

### Option 1: Docker (Recommended)

The easiest way to run Chorecast is with Docker. A `docker-compose.yml` file is the simplest approach:

```
version: '3.8'
services:
  chorecast:
    container_name: chorecast
    image: ghcr.io/kenwetech/chorecast:latest # Replace with your Docker Hub image
    restart: unless-stopped
    ports:
      - "3737:3737"    # Web UI Port
      - "1887:1887"    # MQTT TCP Port
      - "8887:8887"    # MQTT WebSocket Port
    volumes:
      - ./chorecast_data:/usr/src/app
    environment:
      - TZ=America/New_York # Set your timezone
      - JWT_SECRET=a_very_secret_and_long_random_string # CHANGE THIS!

```

1.  Save the content above as `docker-compose.yml`.
    
2.  Create a directory named `chorecast_data` next to your compose file.
    
3.  Run `docker-compose up -d`.
    

### Option 2: Manual Installation

You can also run Chorecast directly with Node.js.

1.  **Download the code:**
    
    -   **Git:**  `git clone https://github.com/KenWeTech/chorecast.git`
        
    -   **ZIP:** Download the latest package from the [**Releases**](https://github.com/kenwetech/chorecast/releases) page.
        
2.  **Navigate into the directory:**
    
    ```
    cd chorecast/chorecast
    
    ```
    
3.  **Install dependencies:**
    
    ```
    npm install
    
    ```
    
4.  **Configure:**
    
    -   Copy the `example.env` file to a new file named `.env`.
        
    -   Open `.env` and change the `JWT_SECRET` to a long, random string.
        
5.  **Start the server:**
    
    ```
    npm start
    
    ```
    

Chorecast will now be running at `http://chorecast.local:3737`.

## Configuration

Chorecast is configured using an `.env` file in the root directory.

```
# Server Configuration
PORT=3737
HTTPS=false
HTTPS_PORT=3443

# MQTT Ports (Recommended: Do not change unless necessary)
MQTT_PORT=1887
MQTT_WS_PORT=8887

# Secret key for session management (change this to a random string)
JWT_SECRET='a_very_secret_and_long_random_string'

# Set Time Zone
TIMEZONE=America/New_York

```

## Integrations

Connect Chorecast to other services for powerful automations and notifications.

### Home Assistant

Send real-time updates and daily summaries from Chorecast directly to Home Assistant using webhooks. This allows you to trigger automations, update dashboards, and create notifications based on chore activity.

-   **For detailed setup instructions, see the** [**Home Assistant Integration Guide**](https://github.com/KenWeTech/Chorecast/blob/main/HA/README.md)**.**
    

### My Nudgr

My Nudgr is a self-hosted, privacy-focused reminder server. Chorecast can integrate with it to send intelligent reminders for important or missed chores, helping to keep everyone on track.

-   **Find out more about My Nudgr at the** [**official repository**](https://github.com/KenWeTech/my-nudgr)**.**
    
