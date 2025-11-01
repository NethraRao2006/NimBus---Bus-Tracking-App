# 🚌 NimBus – Real-Time Bus Tracking Website

NimBus is a real-time **bus tracking web application** designed to make passenger journeys smoother and more reliable.  
It connects **passengers**, **drivers**, and **transport authorities** through a unified platform that provides accurate bus location, status updates, and live notifications.

---

## 🌐 Project Overview

**NimBus** simplifies public transportation by allowing:
- **Passengers** to track live bus locations and receive alerts before the bus arrives.
- **Drivers** to record and update their trip details and share real-time location.
- **Authorities** to monitor all active trips, delays, and bus activities.

---

## 👥 Team Members
- **Vishritha**
- **T Keerthana**
- **Rashi Rai**
- **Nethra D**

---

## 🚏 Portals Overview

### 🧍 Passenger Portal
- Select **route** and **stop** to get bus updates.  
- Option to use **Live GPS** — the website automatically detects the passenger’s location.  
- Displays a **table of available buses** with details:
  - Departure time & Actual departure time  
  - Days active  
  - Bus type (Government / Private)  
  - Service type (Express / Normal / Non-stop)  
  - Vehicle name, license number, and current status (Scheduled / On-time / Delayed / Cancelled)
- Shows **active buses** currently running on the selected route.
- Passengers can **view the bus on a live map** using **Leaflet API** and **OpenStreetMap**.
- **Pop-up notifications** appear:
  - When the bus is about 2 km away from the selected stop.
  - When the bus has passed the stop.

---

### 🧍‍♂️ Driver Portal
- Driver logs in using **Firebase Authentication**.  
- Selects **route**, **vehicle**, and **scheduled time** from dropdown lists.  
- On clicking **“Record Actual Departure Time”**, the current time is auto-filled.  
- Click **“Start Trip”** to begin live tracking.  
- The tracking page shows:
  - Trip ID  
  - Vehicle and route details  
  - Live tracking status  
  - Latitude & longitude values  
  - Current bus status (default: *On-time*, can be updated to *Delayed* or *Cancelled*)
- Drivers can update status reasons and end the trip with **“End Trip”** button.
- Option to **logout** after completing the trip.

---

### 🏢 Authority Portal
- Authorities log in using Firebase Authentication.  
- Dashboard displays:
  - Number of **active** and **delayed** trips  
  - List of **drivers** currently logged in  
  - **Bus details**: Name, plate number, route, scheduled & actual departure time, and status  
- Enables authorities to **monitor all bus operations** efficiently.

---

## 💻 Tech Stack
| Technology | Purpose |
|-------------|----------|
| **HTML, CSS, JavaScript** | Frontend development |
| **Firebase Authentication** | User login & access control |
| **Firestore Database** | Real-time storage of trip & bus data |
| **Geolocation API** | To fetch live location coordinates |
| **Leaflet.js** | For rendering interactive maps |
| **OpenStreetMap API** | Free map data source |

---

## 🚀 Features
✅ Real-time bus tracking  
✅ Role-based login (Passenger, Driver, Authority)  
✅ Live location updates  
✅ Pop-up alerts for approaching or passed buses  
✅ Driver status management (On-time / Delayed / Cancelled)  
✅ Authority dashboard for monitoring bus operations  

---

Thank you for exploring NimBus — making every journey smarter and easier. 🚌
