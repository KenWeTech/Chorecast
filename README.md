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
    
    -   **Interested in getting a pre-built Chorecast Reader?**  [**Find out more here!**](https://ishortn.ink/AGzp7CWKm)
        
-   **Chore Tags:** These are inexpensive NFC tags that you can stick on or near the location of a chore. You can use any standard NFC sticker, coin, card, or keychain. Once registered in Chorecast, a simple tap is all it takes!
    

## 🚀 Getting Started

Chorecast is designed to be self-hosted on your own network. You can get it running in minutes.

### Option 1: Using An Installer (Easiest)

This section provides instructions for installing Chorecast using native installers for various operating systems.

----------

#### Windows (exe)

For the simplest setup on Windows, use the Chorecast installer:

1.  **Download and Run**  
    Download the latest **`Chorecast_Setup_vX.X.X.exe`** from the [Releases](https://github.com/kenwetech/chorecast/releases) page and run the installer.
    
2.  **Allow Firewall Access**  
    The first time you launch Chorecast, Windows Defender or other firewall software may prompt you to allow network access. **Be sure to allow access** so Chorecast can communicate with readers and be accessible across your network.
    
3.  **Runs in the Background**  
    Chorecast runs quietly in your system tray. Closing the window won’t stop the server — readers and dashboards will stay connected. To reopen the main window, just click the Chorecast tray icon.
    
4.  **Access the Web Interface**  
    Once running, you can access Chorecast not only through the main window, but also from any device on your local network using one of the following URLs:
    
    -   **[http://chorecast.local:3737](http://chorecast.local:3737/)** – if your device supports `.local` resolution
        
    -   **[http://localhost:3737](http://localhost:3737/)** – from the machine running Chorecast
        
    -   **http://[your-machine-ip]:3737** – replace `[your-machine-ip]` with your computer’s IP address for access from other devices on the same network
  
----------

#### macOS (dmg)

On macOS, you'll use the **`.dmg`** installer. Since we don't have an Apple Developer License, macOS will flag the application as from an unidentified developer.

1.  Download and Open
    
    Download the correct .dmg file for your system (either Chorecast_vX.X.X.dmg for Intel or Chorecast_vX.X.X_arm64.dmg for Apple Silicon) from the Releases page. Open the file to mount it.
    
2.  Move to Applications
    
    Drag the Chorecast application into your Applications folder.
    
3.  Allow the App
    
    The first time you launch it, you'll need to bypass security warnings. Go to System Settings > Privacy & Security and look for a message about Chorecast being blocked. Click Open Anyway and confirm the action. You may need to repeat this if a warning appears again.
    
4.  Allow Network Access
    
    The application will likely request permission to access your local network. You must allow this for Chorecast to function correctly. If your firewall blocks the application, you'll need to manually add an exception in your System Settings to allow incoming connections.
    
5.  Runs in the Background
    
    Chorecast runs quietly in your menu bar. Closing the window won’t stop the server — readers and dashboards will stay connected. To reopen the main window, click the Chorecast icon in your menu bar.
    
6.  Access the Web Interface
    
    Once running, you can access Chorecast from any device on your local network using one of the following URLs:
    
    -   **[http://chorecast.local:3737](https://www.google.com/search?q=http://chorecast.local:3737/)** – if your device supports `.local` resolution
        
    -   **[http://localhost:3737](https://www.google.com/search?q=http://localhost:3737/)** – from the machine running Chorecast
        
    -   **http://[your-machine-ip]:3737** – replace `[your-machine-ip]` with your computer’s IP address for access from other devices on the same network
        

----------

#### Linux (.deb or AppImage)

On Linux, you have two options: a **`.deb`** package for Debian-based distributions or a universal **AppImage**.

##### For Debian/Ubuntu (.deb)

1.  Download and Install
    
    Download the correct .deb file (either chorecast_vX.X.X_amd64.deb for 64-bit Intel/AMD or chorecast_vX.X.X_arm64.deb for ARM-based systems) from the Releases page. You can install it using your system's package manager or from the command line:
    
    `sudo dpkg -i chorecast_vX.X.X_amd64.deb`
    
2.  Allow Network Access
    
    You may need to manually configure your firewall (e.g., ufw) to allow incoming connections on port 3737 for Chorecast to be accessible across your network.
    
3.  Access the Web Interface
    
    Once running, you can access Chorecast from any device on your local network using one of the following URLs:
    
    -   **[http://chorecast.local:3737](https://www.google.com/search?q=http://chorecast.local:3737/)** – if your device supports `.local` resolution
        
    -   **[http://localhost:3737](https://www.google.com/search?q=http://localhost:3737/)** – from the machine running Chorecast
        
    -   **http://[your-machine-ip]:3737** – replace `[your-machine-ip]` with your computer’s IP address for access from other devices on the same network
        

##### For AppImage

1.  Download and Make Executable
    
    Download the correct .AppImage file (either Chorecast_vX.X.X.AppImage for 64-bit Intel/AMD or Chorecast_vX.X.X_arm64.AppImage for ARM) from the Releases page. Then, make it executable from the terminal:
    
    `chmod +x Chorecast_vX.X.X.AppImage`
    
2.  Run the AppImage
    
    Launch the application by double-clicking it or from the terminal:
    
    `./Chorecast_vX.X.X.AppImage`
    
3.  Allow Network Access
    
    You may need to manually configure your firewall (e.g., ufw) to allow incoming connections on port 3737 for Chorecast to be accessible across your network.
    
4.  Access the Web Interface
    
    Once running, you can access Chorecast from any device on your local network using one of the following URLs:
    
    -   **[http://chorecast.local:3737](https://www.google.com/search?q=http://chorecast.local:3737/)** – if your device supports `.local` resolution
        
    -   **[http://localhost:3737](https://www.google.com/search?q=http://localhost:3737/)** – from the machine running Chorecast
        
    -   **http://[your-machine-ip]:3737** – replace `[your-machine-ip]` with your computer’s IP address for access from other devices on the same network

### Option 2: Docker (Recommended)

If you're not using Windows, the easy way to run Chorecast is with Docker. A `docker-compose.yml` file is the simplest approach:

```
version: '3.8'
services:
  chorecast:
    container_name: chorecast
    image: ghcr.io/kenwetech/chorecast:latest # Replace with your Docker Hub image
    restart: unless-stopped
    # To enable mDNS discovery, uncomment the 'network_mode: "host"' line below.
    # When using host mode, you must also comment out the 'ports' section below.
    # network_mode: "host"
    ports:
      - "3737:3737"    # Web UI Port
      - "1887:1887"    # MQTT TCP Port
      - "8887:8887"    # MQTT WebSocket Port
    volumes:
      - ./chorecast_data:/app/data
      - ./ssl:/app/data
    environment:
      - TZ=America/New_York # Set your timezone
      - JWT_SECRET=a_very_secret_and_long_random_string # CHANGE THIS!

```

1.  Save the content above as `docker-compose.yml`.
    
2.  Create a directory named `chorecast_data` next to your compose file.
    
3.  Create a directory named `ssl` next to your compose file.

4.  Run `docker-compose up -d`.
    

### Option 3: Manual Installation

You can also run Chorecast directly with Node.js.

#### Prerequisites

-   **Node.js** (v18.x or later)
    
-   **NPM**

### Steps: 

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
    
