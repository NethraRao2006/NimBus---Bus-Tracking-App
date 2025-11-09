// authority.js
const firebaseConfig = {
    apiKey: "AIzaSyAF8Vq1SX1vnb3nJfszWDYYZQ1MbJVwMXQ",
    authDomain: "nimbus-27588.firebaseapp.com",
    projectId: "nimbus-27588",
    storageBucket: "nimbus-27588.firebasestorage.app",
    messagingSenderId: "582331828095",
    appId: "1:582331828095:web:62b276f03f25e9ba937c4a",
    measurementId: "G-73M7E8ZF4N"
};

// Initialize Firebase
const app = firebase.initializeApp(firebaseConfig);
const auth = app.auth();
const db = firebase.firestore();

// Get references to HTML elements globally
const logoutButton = document.querySelector('.logout-btn');
const activeTripsCountEl = document.getElementById('activeTripsCount');
const delayedTripsCountEl = document.getElementById('delayedTripsCount');
const cancelledTripsCountEl = document.getElementById('cancelledTripsCount');
const liveActivityBodyEl = document.getElementById('liveActivityBody');


document.addEventListener('DOMContentLoaded', () => {
    // Start listening for all trip updates immediately
    if (typeof db !== 'undefined') {
        fetchAllTripData();
    } else {
        console.error("Firebase Firestore 'db' object is not defined.");
        document.getElementById('liveActivityBody').innerHTML = 
            '<tr><td colspan="7" style="text-align:center; color: red;">Error: Firebase not loaded.</td></tr>';
    }
    

    // Firebase Logout Logic
    if (logoutButton && typeof auth !== 'undefined') {
        logoutButton.addEventListener('click', (event) => {
            event.preventDefault(); 
            auth.signOut().then(() => {
                console.log("Logout successful. Redirecting...");
                window.location.href = 'index.html'; 
            }).catch((error) => {
                console.error("Firebase Logout Error:", error);
                alert("Logout failed: " + error.message);
            });
        });
    }
});


// -----------------------------------------------------------------
// --- Metadata Fetching (Includes Driver/User Lookup) ---
// -----------------------------------------------------------------

/**
 * Fetches all necessary metadata (Routes, Vehicles, Drivers/Users) once 
 */
async function fetchMetadata() {
    // Fetching from routes, vehicles, and the 'users' collection for driver details
    const [routesSnapshot, vehiclesSnapshot, usersSnapshot] = await Promise.all([
        db.collection('routes').get(),
        db.collection('vehicles').get(),
        db.collection('users').get(), // Fetch user/driver data
    ]);

    const metadata = { routes: {}, vehicles: {}, drivers: {} };

    routesSnapshot.forEach(doc => {
        metadata.routes[doc.id] = doc.data().routename || 'Unknown Route';
    });

    vehiclesSnapshot.forEach(doc => {
        const data = doc.data();
        metadata.vehicles[doc.id] = {
            plate: data.license_plate || 'N/A',
            display: data.display_name || 'Unknown Bus',
        };
    });

    // Map User ID (Doc ID) to Username
    usersSnapshot.forEach(doc => {
        // Assuming the user document ID matches trip.driver_id, and the field is 'username'
        metadata.drivers[doc.id] = doc.data().username || 'Unknown Driver'; 
    });

    return metadata;
}

// -----------------------------------------------------------------
// --- Real-time Data Listener ---
// -----------------------------------------------------------------

/**
 * Subscribes to real-time updates for ALL tracked trip statuses.
 */
async function fetchAllTripData() {
    // 1. Fetch static metadata first
    const metadata = await fetchMetadata().catch(e => {
        console.error("Failed to load metadata:", e);
        // Ensure drivers object is included in the fallback metadata
        return { routes: {}, vehicles: {}, drivers: {} };
    });

    // 2. Listener for 'trips' collection.
    // NOTE: Update the 'in' array if you want to include 'Scheduled' trips.
    db.collection('trips')
        .where('current_status', 'in', ['Ontime', 'Delayed', 'Cancelled']) 
        .onSnapshot(snapshot => {
            const allTrips = [];
            snapshot.forEach(doc => {
                allTrips.push({ id: doc.id, ...doc.data() });
            });
            // 3. Render all retrieved trips
            renderTripData(allTrips, metadata); 
        }, error => {
            console.error("Error listening to all trip updates:", error);
            document.getElementById('liveActivityBody').innerHTML = 
                '<tr><td colspan="7" style="text-align:center; color: red;">Failed to load live data from Firestore.</td></tr>';
        });
}

// -----------------------------------------------------------------
// --- Utility Functions ---
// -----------------------------------------------------------------

/**
 * Converts Firebase Timestamp objects to a readable time string.
 */
function formatTime(timestamp) {
    if (!timestamp || typeof timestamp.toDate !== 'function') {
        return 'N/A';
    }
    const date = timestamp.toDate();
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
}

// -----------------------------------------------------------------
// --- Data Rendering ---
// -----------------------------------------------------------------

/**
 * Renders the trip data into the HTML table and updates the card counts.
 */
function renderTripData(trips, metadata) {
    const tbody = document.getElementById('liveActivityBody');
    tbody.innerHTML = ''; // Clear previous data

    let activeCount = 0;
    let delayedCount = 0;
    let cancelledCount = 0;

    if (trips.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;">No trips found.</td></tr>';
    }

    // Define table headers for the data-label attribute (mobile)
    const headers = [
        "Driver Username", 
        "Bus Name", 
        "Plate Number", 
        "Route Name", 
        "Scheduled Departure Time", 
        "Actual Departure Time", 
        "Status"
    ];

    trips.forEach(trip => {
        const status = trip.current_status || 'Ontime';
        
        // --- 1. Update Counters ---
        if (status === "Delayed") {
            delayedCount++;
            activeCount++;
        } else if (status === "Ontime") {
            activeCount++;
        } else if (status === "Cancelled") {
            cancelledCount++;
        }

        // --- 2. Determine Styling ---
        let rowClass = '';
        let statusClass = status;
        
        if (status === "Delayed") {
            rowClass = 'delayed-row';
        } else if (status === "Cancelled") {
            rowClass = 'cancelled-row';
        }

        // --- 3. Resolve IDs to Names & Format Data (cellData calculation) ---
        const vehicleInfo = metadata.vehicles[trip.vehicle_id] || { plate: 'N/A', display: 'Unknown Bus' };
        const routeName = metadata.routes[trip.route_id] || 'Unknown Route';
        
        // Use metadata.drivers (populated from 'users' collection) to get the username
        const driverUsername = metadata.drivers[trip.driver_id] || 'Unknown Driver';
        
        const cellData = [
            driverUsername, // Resolved username
            vehicleInfo.display, 
            vehicleInfo.plate,  
            routeName,          
            formatTime(trip.scheduled_departure_time),
            formatTime(trip.actual_departure_time),
            `<span class="status-badge ${statusClass}">${status}</span>`
        ];

        // --- 4. Render Row and Cells ---
        const row = tbody.insertRow();
        
        // FIX: Only add class if rowClass is not empty (prevents DOMTokenList error)
        if (rowClass) {
            row.classList.add(rowClass);
        }
        
        cellData.forEach((data, index) => {
            const cell = row.insertCell();
            
            // Add the data-label attribute for mobile styling
            cell.setAttribute('data-label', headers[index]); 
            
            cell.innerHTML = data;
        });
    });

    // --- 5. Update Card Displays ---
    document.getElementById('activeTripsCount').textContent = activeCount;
    document.getElementById('delayedTripsCount').textContent = delayedCount;
    document.getElementById('cancelledTripsCount').textContent = cancelledCount;
}
