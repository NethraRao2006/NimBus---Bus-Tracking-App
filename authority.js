// Assuming 'db' (Firestore) and 'firebase' (Auth) objects are initialized elsewhere.
// Note: In a real module-based project, you'd use 'import' instead of global variables.

// --- Global Lookup Caches (Optimization: Data is loaded here once on page load) ---
let routesCache = {};
let vehiclesCache = {};
let driversCache = {};

// --- HELPER FUNCTIONS ---

function getStatusClass(status) {
    switch (status) {
        case 'Ontime': return 'status-Ontime';
        case 'Delayed': return 'status-Delayed';
        default: return ''; 
    }
}

function formatTimestampToTime(timestamp) {
    // Improvement: Add explicit check for the 'seconds' property of a valid Firestore Timestamp
    if (!timestamp || typeof timestamp.toDate !== 'function' || !timestamp.seconds) return 'N/A';
    
    const date = timestamp.toDate(); 
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
}

// --- DATA FETCHING & RENDERING (Real-Time Listener) ---

// Renamed and changed to be synchronous, relying on pre-loaded global caches
function startLiveMonitoring() { 
    // 2. Set up Real-Time Listener on 'trips' collection
    db.collection('trips')
        .where('current_status', 'in', ['Ontime', 'Delayed']) 
        .onSnapshot(snapshot => {
            
            // 🔥 FINAL FIX: Grouping/Filtering logic to handle persistent duplicates
            const latestTripsMap = new Map();
            
            snapshot.forEach(doc => {
                const trip = doc.data();
                const driverId = trip.driver_id;
                const routeId = trip.route_id;

                // Use Driver + Route as the unique key
                const uniqueTripKey = ${driverId}_${routeId}; 

                // Prioritize the LATEST timestamp from status change or location update
                const latestStatusTime = trip.last_status_time || trip.last_updated || trip.trip_start_time;

                if (latestStatusTime && latestStatusTime.seconds) {
                    const existingEntry = latestTripsMap.get(uniqueTripKey);

                    if (existingEntry) {
                        // Keep the document with the latest timestamp
                        if (latestStatusTime.seconds > (existingEntry.timestamp.seconds || 0)) {
                            latestTripsMap.set(uniqueTripKey, { trip: trip, timestamp: latestStatusTime });
                        }
                    } else {
                        // First entry for this key
                        latestTripsMap.set(uniqueTripKey, { trip: trip, timestamp: latestStatusTime });
                    }
                }
            });

            // 3. Process the LATEST trips only
            const activeTripsData = [];
            let delayedCount = 0;
            
            latestTripsMap.forEach(({ trip }) => {
                
                // --- Trip Details Lookup (NOW USING GLOBAL CACHES) ---
                const driverId = trip.driver_id;
                const vehicleId = trip.vehicle_id;
                const routeId = trip.route_id;

                const driverData = driversCache[driverId] || { username: 'N/A (Driver Not Found)' }; 
                const vehicleData = vehiclesCache[vehicleId] || { display_name: 'N/A', license_plate: 'N/A' };
                const routeData = routesCache[routeId] || { routename: 'N/A' }; 

                // --- Time Formatting ---
                const scheduledTime = formatTimestampToTime(trip.scheduled_departure_time);
                const actualTime = formatTimestampToTime(trip.actual_departure_time); 

                // --- Count Delayed Trips ---
                if (trip.current_status === 'Delayed') {
                    delayedCount++;
                }

                // --- Create consolidated data object for the table ---
                activeTripsData.push({
                    driverUsername: driverData.username,
                    busName: vehicleData.display_name,
                    plateNumber: vehicleData.license_plate,
                    routeName: routeData.routename || 'N/A', 
                    scheduledTime: scheduledTime,
                    actualTime: actualTime,
                    status: trip.current_status,
                });
            });

            // --- Update Dashboard Stats & Table ---
            document.getElementById('activeTripsCount').textContent = activeTripsData.length;
            document.getElementById('delayedTripsCount').textContent = delayedCount;
            renderDriverActivityTable(activeTripsData);
        }, error => {
             console.error("Firestore Listen Error:", error);
        });
}


function renderDriverActivityTable(trips) {
    const tableBody = document.getElementById('driverActivityBody');
    // Clear the table body
    tableBody.innerHTML = '';

    // Sort: Delayed first, then by scheduled time
    trips.sort((a, b) => {
        if (a.status === 'Delayed' && b.status !== 'Delayed') return -1;
        if (a.status !== 'Delayed' && b.status === 'Delayed') return 1;
        return a.scheduledTime.localeCompare(b.scheduledTime);
    });

    if (trips.length === 0) {
         tableBody.innerHTML = '<tr><td colspan="7" style="text-align: center;">No active trips found.</td></tr>';
         return;
    }

    // Improvement: Build rows into an array and update the DOM once (performance boost)
    const rows = trips.map(trip => {
        const statusClass = getStatusClass(trip.status);
        
        return `
            <tr>
                <td><strong>${trip.driverUsername}</strong></td>
                <td>${trip.busName}</td>
                <td>${trip.plateNumber}</td>
                <td>${trip.routeName}</td>
                <td>${trip.scheduledTime}</td>
                <td><strong>${trip.actualTime}</strong></td>
                <td><span class="status-badge ${statusClass}">${trip.status}</span></td>
            </tr>
        `;
    });
    
    // Set the innerHTML once
    tableBody.innerHTML = rows.join('');
}


// --- INITIALIZATION & MAIN EXECUTION ---

// New function to fetch initial data and start the monitoring
async function initializeDataAndMonitoring() {
    console.log("1. Fetching initial lookup data (Routes, Drivers, Vehicles)...");

    // 1. Get initial data for routes, users (drivers), and vehicles (for lookup)
    const [routesSnapshot, usersSnapshot, vehiclesSnapshot] = await Promise.all([
        db.collection('routes').get(),
        db.collection('users').where('role', '==', 'Driver').get(), 
        db.collection('vehicles').get()
    ]);

    // Convert snapshots to global lookup maps
    routesCache = routesSnapshot.docs.reduce((acc, doc) => { acc[doc.id] = doc.data(); return acc; }, {});
    vehiclesCache = vehiclesSnapshot.docs.reduce((acc, doc) => { acc[doc.id] = doc.data(); return acc; }, {});
    driversCache = usersSnapshot.docs.reduce((acc, doc) => { 
        acc[doc.id] = { username: doc.data().username || doc.data().email || doc.id, ...doc.data() }; 
        return acc; 
    }, {});
    
    console.log("2. Initial data loaded. Starting live trip monitoring.");
    startLiveMonitoring();
}

document.addEventListener('DOMContentLoaded', () => {
    initializeDataAndMonitoring();
});


// --- LOGOUT FUNCTION ---
async function authorityLogout() {
    // Check if the Firebase Auth object is available
    if (typeof firebase === 'undefined' || typeof firebase.auth === 'undefined') {
        console.error("Firebase Auth service is unavailable. Cannot log out.");
        window.location.replace('index.html'); 
        return;
    }

    // Perform the sign-out action
    firebase.auth().signOut().then(() => {
        console.log("Authority sign-out successful. Redirecting to login.");
        window.location.replace('index.html'); 
    }).catch((error) => {
        console.error("Authority Logout Error:", error);
        alert(Authority Logout failed: ${error.message});
    });
}
