# FlashShare - P2P File Transfer

FlashShare is a serverless, browser-based file sharing application designed for high-speed local area network (LAN) transfers. It uses WebRTC for peer-to-peer communication and StreamSaver.js for handling large file streams.

## 🚀 Key Features
* **Zero-Install:** Runs entirely in the web browser.
* **High Performance:** Tuned for 10MB/s+ speeds on 5GHz WiFi using 256KB chunking and backpressure control.
* **Secure:** End-to-end encrypted via WebRTC. No data touches a central server.
* **Queue System:** Supports queuing multiple files with synchronized cancellation logic.

## 🛠️ How to Deploy

### Option A: VS Code Live Server
1.  Open the project folder in **VS Code**.
2.  Install the **Live Server** extension.
3.  Click the **"Go Live"** button in the bottom right corner.
4.  Open the provided localhost URL on your phone and laptop (ensure they are on the same WiFi).

### Option B: Static Hosting
Upload the `index.html` and `script.js` file to any static hosting provider.
* **GitHub Pages**
* **Vercel**
* **Netlify**


## ⚠️ Troubleshooting Connectivity

**"Connection Failed" or Slow Speed:**
1.  **Same Network:** Ensure both devices are connected to the exact same WiFi.
2.  **Mobile Hotspots:** If using a phone hotspot, turn OFF Mobile Data on the host phone. This forces the phones to use the local LAN path instead of trying to route through the cellular internet.
3.  **VPNs:** Disconnect any VPNs or Proxies, as they block local peer discovery.
