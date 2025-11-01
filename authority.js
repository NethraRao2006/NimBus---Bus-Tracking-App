// --- HELPER FUNCTIONS ---

function getStatusClass(status) {
    switch (status) {
        case 'Ontime': return 'status-Ontime';
        case 'Delayed': return 'status-Delayed';
        default: return ''; 
    }
}

function formatTimestampToTime(timestamp) {
    if (!timestamp || !timestamp.toDate) return 'N/A';
    const date = timestamp.toDate(); 
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
}

// --- DATA FETCHING & RENDERING (Real-Time Listener) ---

async function startLiveMonitoring() {
    // 1. Get initial data for routes, users (drivers), and vehicles (for lookup)
    const [routesSnapshot, usersSnapshot, vehiclesSnapshot] = await Promise.all([
        db.collection('routes').get(),
        db.collection('users').where('role', '==', 'Driver').get(), 
        db.collection('vehicles').get()
    ]);

    // Convert snapshots to lookup maps
    const routes = routesSnapshot.docs.reduce((acc, doc) => { acc[doc.id] = doc.data(); return acc; }, {});
    const vehicles = vehiclesSnapshot.docs.reduce((acc, doc) => { acc[doc.id] = doc.data(); return acc; }, {});
    const drivers = usersSnapshot.docs.reduce((acc, doc) => { 
        acc[doc.id] = { username: doc.data().username || doc.data().email || doc.id, ...doc.data() }; 
        return acc; 
    }, {});


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
                const uniqueTripKey = `${driverId}_${routeId}`; 

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
                
                // --- Trip Details Lookup ---
                const driverId = trip.driver_id;
                const vehicleId = trip.vehicle_id;
                const routeId = trip.route_id;

                const driverData = drivers[driverId] || { username: 'N/A (Driver Not Found)' }; 
                const vehicleData = vehicles[vehicleId] || { display_name: 'N/A', license_plate: 'N/A' };
                const routeData = routes[routeId] || { routename: 'N/A' }; 

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
    tableBody.innerHTML = '';

    trips.sort((a, b) => {
        if (a.status === 'Delayed' && b.status !== 'Delayed') return -1;
        if (a.status !== 'Delayed' && b.status === 'Delayed') return 1;
        return a.scheduledTime.localeCompare(b.scheduledTime);
    });

    if (trips.length === 0) {
         tableBody.innerHTML = '<tr><td colspan="7" style="text-align: center;">No active trips found.</td></tr>';
         return;
    }

    trips.forEach(trip => {
        const statusClass = getStatusClass(trip.status);
        
        const row = `
            <tr>
                <td>**${trip.driverUsername}**</td>
                <td>${trip.busName}</td>
                <td>${trip.plateNumber}</td>
                <td>${trip.routeName}</td>
                <td>${trip.scheduledTime}</td>
                <td>**${trip.actualTime}**</td>
                <td><span class="status-badge ${statusClass}">${trip.status}</span></td>
            </tr>
        `;
        tableBody.innerHTML += row;
    });
}


// --- MAIN EXECUTION ---
document.addEventListener('DOMContentLoaded', () => {
    // Assuming Firebase config and db object are initialized
    startLiveMonitoring();
});
async function authorityLogout() {
    
    // Check if the Firebase Auth object is available
    if (typeof firebase === 'undefined' || typeof firebase.auth === 'undefined') {
        console.error("Firebase Auth service is unavailable. Cannot log out.");
        // Fallback redirect for safety
        window.location.replace('index.html'); 
        return;
    }

    // 2. Perform the sign-out action
    firebase.auth().signOut().then(() => {
        console.log("Authority sign-out successful. Redirecting to login.");
        // Use replace() to prevent back button issues
        window.location.replace('index.html'); 
    }).catch((error) => {
        console.error("Authority Logout Error:", error);
        alert(Authority Logout failed: ${error.message});
    });
}
