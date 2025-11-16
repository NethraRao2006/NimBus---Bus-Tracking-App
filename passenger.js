// GLOBAL VARIABLES
let map = null;
let busMarker = null;
let destinationMarker = null; 
let allRoutes = []; 
let allStops = []; 
// Stores the passenger's chosen location (GPS coords or Stop coords)
let passengerLocation = null;
// trackingListener now holds the onSnapshot UNSUBSCRIBE function (either for the trips list or a single trip doc)
let trackingListener = null; 
let mapInitialized = false; 
// Marker to show the passenger their chosen location before starting tracking
let tempPassengerMarker = null;
// passengerWatchId is now unused after switching to getCurrentPosition, but kept for clarity/safety.
let passengerWatchId = null; 
const AVERAGE_BUS_SPEED_KMPH = 25; // Average speed for ETA calculation

// --- HELPER FUNCTIONS ---

// Function to format Firestore Timestamp to HH:MM AM/PM string
function formatTimestampToTime(timestamp) {
    if (!timestamp) return 'N/A';
    // Convert Firestore Timestamp to Date object
    const date = timestamp.toDate(); 
    // Format to HH:MM AM/PM
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function getStatusClass(status) {
    switch (status) {
        case 'Ontime': return 'status-ontime';
        case 'Delayed': return 'status-delayed';
        case 'Cancelled': return 'status-cancelled';
        case 'Scheduled': return 'status-scheduled'; 
        default: return ''; 
    }
}

function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Radius of Earth in kilometers
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
        0.5 - Math.cos(dLat) / 2 + 
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * (1 - Math.cos(dLon)) / 2;
    return R * 2 * Math.asin(Math.sqrt(a)); // Distance in km
}

// For the calculation of ETA
function estimateETA(distanceKm) {
    if (distanceKm < 0.1) return "Arriving Now"; // Within 100 meters
    if (distanceKm > 50) return "> 2 hours"; // Trip is too far for reliable ETA

    // Time in hours = Distance (km) / Speed (km/h)
    const timeInHours = distanceKm / AVERAGE_BUS_SPEED_KMPH;
    
    // Time in minutes
    const timeInMinutes = Math.round(timeInHours * 60);

    if (timeInMinutes < 1) return "Less than 1 min";
    if (timeInMinutes > 60) {
        const hours = Math.floor(timeInMinutes / 60);
        const minutes = timeInMinutes % 60;
        return `${hours} hr ${minutes} min`;
    }
    return `${timeInMinutes} min`;
}

function notifyPassenger(message, notificationKey) {
    const lastAlertKey = localStorage.getItem(notificationKey);
    
    // Only show the alert if the key is not found (meaning it hasn't been shown yet)
    if (!lastAlertKey) {
        alert(message);
        // Store the key to prevent future alerts for this specific threshold on this bus
        localStorage.setItem(notificationKey, 'alerted'); 
    }
}

// --- INITIALIZATION ---

document.addEventListener('DOMContentLoaded', () => {
    // NOTE: 'db' must be defined globally via a <script> tag pointing to Firebase setup
    if (typeof db === 'undefined') {
        console.error("Firebase 'db' object is not defined. Ensure Firebase is initialized.");
        return;
    }

    const mapDiv = document.getElementById('mapContainer');
    if (mapDiv) {
        mapDiv.innerHTML = ''; 
        // Initial map view set near your typical testing area (Puttur/Mangalore region)
        map = L.map('mapContainer').setView([12.87, 74.88], 10); 
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '© OpenStreetMap contributors'
        }).addTo(map);
        mapInitialized = true;
    }
    
    loadRoutesForSelection();
    toggleLocationInput(); // Run on load to set initial input section visibility

    // Attach listeners to radio buttons (must be done after DOMContentLoaded)
    document.querySelectorAll('input[name="locationMethod"]').forEach(radio => {
        radio.addEventListener('change', toggleLocationInput);
    });
});

// --- LOCATION LOGIC ---

function toggleLocationInput() {
    const method = document.querySelector('input[name="locationMethod"]:checked').value;
    document.getElementById('stopInputSection').style.display = (method === 'stop') ? 'block' : 'none';
    document.getElementById('gpsInputSection').style.display = (method === 'gps') ? 'block' : 'none';
}

/**
 * FIX: Use getCurrentPosition for a one-time, high-accuracy location snapshot.
 */
function getLiveLocation() {
    const locationInput = document.getElementById('currentLocationInput');
    locationInput.value = 'Acquiring GPS Lock...';
    
    // Clear the temporary marker if it exists
    if (tempPassengerMarker) {
        map.removeLayer(tempPassengerMarker);
        tempPassengerMarker = null;
    }

    if (!navigator.geolocation) {
        locationInput.value = 'Not supported.';
        alert("Geolocation not supported by this browser.");
        return;
    }

    const successCallback = (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        
        locationInput.value = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
        
        // CRUCIAL: Set the global passengerLocation variable
        passengerLocation = { lat: lat, lng: lng }; 
        
        if (mapInitialized) {
            const latLng = [lat, lng];
            // Create a temporary marker to show the user their chosen location
            tempPassengerMarker = L.circleMarker(latLng, {
                radius: 10,
                color: 'purple',
                fillColor: '#8E44AD', 
                fillOpacity: 1
            }).addTo(map);
            tempPassengerMarker.bindPopup(`High-Accuracy Location`).openPopup();
            map.panTo(latLng);
            map.setZoom(15); 
        }

        alert("High-accuracy GPS coordinates loaded and saved for tracking!");
    };

    const errorCallback = (error) => {
        console.error("Geolocation Error:", error.message);
        locationInput.value = 'GPS BLOCKED/FAILED';
        alert(`Could not get current location: ${error.message}. Please manually enter coordinates.`);
    };

    // Use getCurrentPosition for a one-time request
    navigator.geolocation.getCurrentPosition(
        successCallback, 
        errorCallback, 
        {
            enableHighAccuracy: true,
            timeout: 30000, 
            maximumAge: 0 
        }
    );
}

function getPassengerLocationForTracking() {
    // Remove the temporary marker now that the user is starting the actual search/tracking
    if (tempPassengerMarker) {
        map.removeLayer(tempPassengerMarker);
        tempPassengerMarker = null;
    }
    
    const method = document.querySelector('input[name="locationMethod"]:checked').value;
    
    if (method === 'stop') {
        const stopId = document.getElementById('notificationStopSelect').value;
        if (!stopId) {
            alert("Please select a stop for notification tracking.");
            return false;
        }
        const selectedStop = allStops.find(s => s.id === stopId);
        if (selectedStop) {
            passengerLocation = { lat: selectedStop.latitude, lng: selectedStop.longitude };
        }
    } else if (method === 'gps') {
        // CHECK 1: If passengerLocation is ALREADY set by the 'Get Live GPS' button, use it.
        if (passengerLocation && passengerLocation.lat && passengerLocation.lng) {
            return true;
        }
        
        // CHECK 2: Fall back to parsing the input box (Manual entry)
        const input = document.getElementById('currentLocationInput').value;
        const parts = input.split(',').map(s => parseFloat(s.trim()));

        if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
            passengerLocation = { lat: parts[0], lng: parts[1] };
        } else {
            alert("GPS location is missing or manually entered coordinates are invalid. Please click 'Get Live GPS' or enter valid coordinates (e.g., 35.0000, 75.0000).");
            return false;
        }
    }
    
    if (!passengerLocation || isNaN(passengerLocation.lat) || isNaN(passengerLocation.lng)) {
        alert("Could not determine passenger location for tracking. Please check your input/selection.");
        return false;
    }
    
    return true; 
}


// --- DATA LOADING & SEARCH ---

async function loadRoutesForSelection() {
    const routeSelect = document.getElementById('routeSelect');
    const notifStopSelect = document.getElementById('notificationStopSelect'); 

    try {
        const routesSnapshot = await db.collection('routes').get();
        // Assume route documents have a 'stop_ids' array: { id: 'R1', routename: 'Puttur-Vitla', stop_ids: ['S1', 'S5', 'S10'] }
        allRoutes = routesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        routeSelect.innerHTML = '<option value="">Select Route</option>';
        allRoutes.forEach(route => {
            routeSelect.innerHTML += `<option value="${route.id}">${route.routename}</option>`;
        });
        
        const stopsSnapshot = await db.collection('stops').get();
        // Stop documents: { id: 'S1', name: 'Puttur Bus Stand', latitude: ... }
        allStops = stopsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        // Initial state: empty or 'Select Route First'
        notifStopSelect.innerHTML = '<option value="">Select Route First</option>';

        // Attach the new listener to filter stops when a route is selected
        routeSelect.addEventListener('change', filterStopsForRoute);

    } catch (error) {
        console.error("Error loading routes/stops:", error);
        routeSelect.innerHTML = '<option value="">Failed to load routes</option>';
        notifStopSelect.innerHTML = '<option value="">Failed to load stops</option>';
    }
}

/**
 * Filters the available stops for notification based on the currently selected route.
 * Assumes 'routes' documents have a 'stop_ids' array field.
 */
function filterStopsForRoute() {
    const routeId = document.getElementById('routeSelect').value;
    const notifStopSelect = document.getElementById('notificationStopSelect');
    
    // Clear the current stops dropdown
    notifStopSelect.innerHTML = '';

    if (!routeId) {
        notifStopSelect.innerHTML = '<option value="">Select Route First</option>';
        return;
    }

    // Find the selected route object
    const selectedRoute = allRoutes.find(r => r.id === routeId);

    if (selectedRoute && selectedRoute.stop_ids && selectedRoute.stop_ids.length > 0) {
        // Filter the global allStops array to include only stops whose ID is in the route's stop_ids list
        const filteredStops = allStops.filter(stop => 
            selectedRoute.stop_ids.includes(stop.id)
        );

        notifStopSelect.innerHTML = '<option value="">Select Stop for Notifications</option>';
        filteredStops.forEach(stop => {
            // Populate the dropdown with only the stops for this route
            notifStopSelect.innerHTML += `<option value="${stop.id}">${stop.name}</option>`;
        });
    } else {
        notifStopSelect.innerHTML = '<option value="">No Stops Defined for this Route</option>';
    }
}


/**
 * The core function for fetching and maintaining real-time status of schedules.
 */
async function searchBuses() {
    const routeId = document.getElementById('routeSelect').value;

    if (!routeId) {
        alert("Please select a route.");
        return;
    }
    
    document.getElementById('searchBtn').disabled = true;

    // Clear any existing listener from previous searches
    if (trackingListener) {
        trackingListener(); 
        trackingListener = null;
    }
    
    try {
        // 1. Fetch all schedules for the route (ONE-TIME static fetch for base data)
        const schedulesSnapshot = await db.collection('schedules')
            .where('route_id', '==', routeId)
            .orderBy('time', 'asc') 
            .get();

        const schedulePromises = schedulesSnapshot.docs.map(async doc => {
            const schedule = {
                id: doc.id,
                ...doc.data(),
                current_status: 'Scheduled', // START with default 'Scheduled'
                live_trip_id: null,
                // Default N/A vehicle info
                vehicleName: 'N/A', 
                licensePlate: 'N/A',
                bus_type: 'N/A',
                service_type: 'N/A',
                // Keep 'actual_departure_time' null by default
                actual_departure_time: null
            };
            
            // Fetch and set default vehicle details if available
            if (schedule.default_vehicle_id) {
                const vehicleDoc = await db.collection('vehicles').doc(schedule.default_vehicle_id).get();
                if (vehicleDoc.exists) {
                    const vehicleData = vehicleDoc.data();
                    schedule.vehicleName = vehicleData.display_name || 'N/A';
                    schedule.licensePlate = vehicleData.license_plate || 'N/A';
                    schedule.bus_type = vehicleData.bus_type || 'N/A';
                    schedule.service_type = vehicleData.service_type || 'N/A';
                }
            }
            return schedule;
        });

        // The base schedules array, containing static vehicle defaults
        const baseSchedules = await Promise.all(schedulePromises);
        
        // Create a lookup map for schedules based on their ID (scheduled_slot_id)
        const scheduleLookup = {};
        baseSchedules.forEach(s => scheduleLookup[s.id] = s);

        // 2. Attach a REAL-TIME listener to the 'trips' collection
        // 🚨 IMPORTANT: You may want to add a filter here for 'current_status' != 'Completed'
        trackingListener = db.collection('trips')
            .where('route_id', '==', routeId)
            .onSnapshot(async (liveTripsSnapshot) => { 
                
                // Initialize the trips list using the base schedules. 
                // We clone it to add *all* scheduled entries first.
                let mergedTrips = JSON.parse(JSON.stringify(baseSchedules));
                
                // Keep track of which schedule slots are occupied by a live trip
                const occupiedScheduleIds = new Set();

                const allRecentTrips = liveTripsSnapshot.docs.map(doc => ({ 
                    id: doc.id, // This is the live trip ID
                    ...doc.data()
                }));
                
                // Array to hold the NEW live trip entries (if different from base schedule)
                let activeTripEntries = [];

                // 3. Process and merge the live trip data
                for (const trip of allRecentTrips) { 
                    const scheduledSlotId = trip.scheduled_slot_id;
                    const scheduleEntry = scheduleLookup[scheduledSlotId];

                    // Check if this live trip is actually an active one to display
                    if (['Ontime', 'Delayed', 'Cancelled'].includes(trip.current_status)) {
                        
                        // Create a new object that starts with the scheduled data
                        let displayEntry = scheduleEntry ? JSON.parse(JSON.stringify(scheduleEntry)) : {};
                        
                        // Overwrite schedule data with live trip data
                        displayEntry.current_status = trip.current_status;
                        displayEntry.last_status_reason = trip.last_status_reason || null;
                        displayEntry.actual_departure_time = trip.actual_departure_time || null;
                        displayEntry.live_trip_id = trip.id; 
                        displayEntry.last_known_location = trip.last_known_location || null;
                        
                        // Set the slot as occupied
                        occupiedScheduleIds.add(scheduledSlotId);
                        
                        // Re-fetch vehicle details from the trip document if they differ from default
                        // (We need to re-fetch vehicle details in every listener cycle for the live data)
                        if (trip.vehicle_id) {
                             const vehicleDoc = await db.collection('vehicles').doc(trip.vehicle_id).get();
                             if (vehicleDoc.exists) {
                                 const vehicleData = vehicleDoc.data();
                                 displayEntry.vehicleName = vehicleData.display_name || 'N/A';
                                 displayEntry.licensePlate = vehicleData.license_plate || 'N/A';
                                 displayEntry.bus_type = vehicleData.bus_type || 'N/A';
                                 displayEntry.service_type = vehicleData.service_type || 'N/A';
                             }
                        }
                        
                        // 🚨 CRITICAL FIX: Add the unique live trip entry to the list
                        activeTripEntries.push(displayEntry);

                    }
                }
                
                // 4. Combine: Filter out original base schedules that are now ACTIVE live trips, 
                // and then add the list of active live trips.
                
                // Start with non-occupied (scheduled or completed) base entries
                let finalTrips = mergedTrips.filter(s => !occupiedScheduleIds.has(s.id));
                
                // Add all the active/cancelled live trip entries
                finalTrips = finalTrips.concat(activeTripEntries);
                
                // ⭐ SORTING STEP ⭐
                // Sort by scheduled time primarily, and use license plate as secondary sort (optional, but kept your original logic)
                finalTrips.sort((a, b) => {
                    const timeA = a.time || 'ZZZZ';
                    const timeB = b.time || 'ZZZZ';
                    if (timeA < timeB) { return -1; }
                    if (timeA > timeB) { return 1; }
                    
                    const plateA = a.licensePlate.toUpperCase();
                    const plateB = b.licensePlate.toUpperCase();
                    if (plateA < plateB) { return -1; }
                    if (plateA > plateB) { return 1; }
                    
                    return 0;
                });

                // Render the results with the live updates
                renderResults(finalTrips, routeId);

            }, error => {
                console.error("Error in real-time trips listener:", error);
                // On error, still try to show the base schedules
                renderResults(baseSchedules, routeId);
            });


    } catch (error) {
        console.error("Error searching buses:", error);
        alert("Failed to search buses. Check console.");
        renderResults([], routeId); 
    } finally {
        document.getElementById('searchBtn').disabled = false;
    }
}

// --- RENDERING FUNCTIONS ---

function renderScheduleTable(mergedTrips) {
    const tableBody = document.getElementById('scheduledTripsBody'); 
    tableBody.innerHTML = '';

    if (mergedTrips.length === 0) {
        document.getElementById('noScheduleMsg').style.display = 'block';
        return;
    }
    document.getElementById('noScheduleMsg').style.display = 'none';

    mergedTrips.forEach(trip => {
        
        const scheduledTimeStr = trip.time || 'N/A'; 
            
        let actualTimeStr = '---'; 
        let actualTimeStyle = '';

        if (trip.actual_departure_time) {
            actualTimeStr = formatTimestampToTime(trip.actual_departure_time);
            
            if (trip.current_status === 'Ontime' || trip.current_status === 'Delayed') {
                 actualTimeStyle = 'color: #1e88e5; font-weight: bold;'; 
            }
        }
        
        // Days Active (Uses exact Firestore value)
        const daysActiveStr = trip.days_active || 'N/A'; 
        
        // NEW data points from the merged vehicle data
        const busTypeStr = trip.bus_type || 'N/A'; 
        const serviceTypeStr = trip.service_type || 'N/A'; 
        
        // ONLY display reason if the trip is currently Delayed or Cancelled (not Scheduled or Ontime)
        const reason = (trip.last_status_reason && (trip.current_status === 'Delayed' || trip.current_status === 'Cancelled')) 
                           ? `<br>Reason: ${trip.last_status_reason}` 
                           : ''; 

        const statusClass = getStatusClass(trip.current_status);
        
        // Construct the table row
        const newRow = `
            <tr class="${trip.current_status.toLowerCase()}-row">
                <td data-label="Scheduled Time">${scheduledTimeStr}</td>
                
                <td data-label="Actual Departure">
                    <span style="${actualTimeStyle}">${actualTimeStr}</span>
                </td>
                
                <td data-label="Days">${daysActiveStr}</td>

                <td data-label="Bus Type">${busTypeStr}</td>
                
                <td data-label="Service">${serviceTypeStr}</td>
                
                <td data-label="Vehicle">${trip.vehicleName || 'N/A'} / ${trip.licensePlate || 'N/A'}</td>
                
                <td data-label="Status & Reason">
                    <span class="status-badge ${statusClass}">${trip.current_status}</span>
                    <br><small>${reason}</small>
                </td>
            </tr>
        `;
        tableBody.innerHTML += newRow;
    });
}

function renderResults(mergedTrips, routeId) {
    // 💡 mergedTrips now contains: 
    // 1. All static schedules that haven't started a live trip (current_status: 'Scheduled')
    // 2. All unique active/cancelled live trip records (current_status: 'Ontime', 'Delayed', 'Cancelled')
    const scheduledTrips = mergedTrips; 
    
    // This correctly filters the combined list to find ONLY the live, trackable buses.
    const activeTrips = mergedTrips.filter(t => t.current_status === 'Ontime' || t.current_status === 'Delayed');

    const route = allRoutes.find(r => r.id === routeId);
    document.getElementById('scheduleRouteName').textContent = route ? route.routename : 'Selected Route';
    
    document.getElementById('searchSection').style.display = 'none';
    document.getElementById('resultsSection').style.display = 'block';
    
    // This renders the full table (all scheduled, cancelled, and active trips)
    renderScheduleTable(scheduledTrips);

    const busList = document.getElementById('busList');
    busList.innerHTML = '';
    
    document.getElementById('busCount').textContent = activeTrips.length;

    if (activeTrips.length === 0) {
        document.getElementById('noActiveMsg').style.display = 'block';
    } else {
        document.getElementById('noActiveMsg').style.display = 'none';
        
        // This loop correctly iterates over every uniquely active bus found.
        activeTrips.forEach(trip => {
            const statusClass = getStatusClass(trip.current_status);
            const locationText = trip.last_known_location ? (`${trip.last_known_location.latitude.toFixed(4)}, ${trip.last_known_location.longitude.toFixed(4)}`) : 'Location pending.';

            const card = document.createElement('div');
            card.className = 'result-card';
            // IMPORTANT: The live_trip_id is now unique for every active bus!
            card.setAttribute('onclick', `showDetails('${trip.live_trip_id}', '${trip.vehicleName}')`); 

            const detailText = (trip.current_status === 'Delayed' && trip.last_status_reason) 
                                 ? `<br>Reason: ${trip.last_status_reason}` 
                                 : '';

            card.innerHTML = `
                <div>
                    <strong>${trip.vehicleName} (${trip.licensePlate})</strong>
                    <span class="status-badge ${statusClass}">${trip.current_status}</span>
                </div>
                <div style="font-size: 0.9em; color: #555; margin-top: 5px;">
                    Scheduled: ${trip.time} 
                    <br>
                    Last Known Location: ${locationText}
                    ${detailText}
                </div>
            `;
            busList.appendChild(card);
        });
    }
}

// --- TRACKING FUNCTIONS ---
function showDetails(tripId, vehicleName) {
    
    // Check and set passenger location before proceeding
    if (!getPassengerLocationForTracking()) {
        return; 
    }
    
    document.getElementById('resultsSection').style.display = 'none';
    document.getElementById('detailSection').style.display = 'block';

    if (map) {
        map.invalidateSize();
    }
    
    // Stop any existing listener
    if(trackingListener) {
        trackingListener(); 
    }

    const { lat: passengerLat, lng: passengerLng } = passengerLocation;

    // Start a new real-time listener for the trip data
    trackingListener = db.collection('trips').doc(tripId).onSnapshot(async doc => {
        // Check if the trip has ended or is cancelled
        if (!doc.exists || doc.data().current_status === 'Completed' || doc.data().current_status === 'Cancelled') {
            alert("This trip has ended or been cancelled.");
            hideDetails();
            return;
        }
        
        // --- CRITICAL FIX: UI elements MUST be retrieved inside the listener ---
        const statusBadge = document.getElementById('detailStatus');
        const locationSpan = document.getElementById('detailLocation'); 
        const detailETA = document.getElementById('detailETA'); 
        // ----------------------------------------------------------------------

        const trip = doc.data();
        const vehicleDoc = await db.collection('vehicles').doc(trip.vehicle_id).get();
        const currentVehicleName = vehicleDoc.exists ? vehicleDoc.data().display_name : vehicleName;

        document.getElementById('detailVehicle').textContent = `${currentVehicleName} (Trip ID: ${doc.id.substring(0, 6)}...)`;
        
        // Update Status Badge
        statusBadge.textContent = trip.current_status;
        statusBadge.className = `status-badge ${getStatusClass(trip.current_status)}`;
        
        if (trip.current_status === 'Delayed' && trip.last_status_reason) {
            statusBadge.textContent += ` (Reason: ${trip.last_status_reason})`;
        }
        
        let busLat = null;
        let busLng = null;

        if (trip.last_known_location) {
            busLat = trip.last_known_location.latitude;
            busLng = trip.last_known_location.longitude;
            
            // ✅ FIX: Show Driver's/Bus's Lat/Lng for 'Last Known Location'
            locationSpan.textContent = `${busLat.toFixed(6)}, ${busLng.toFixed(6)}`; 

            const distanceToLocation = calculateDistance(busLat, busLng, passengerLat, passengerLng);
            
            // --- ETA INTEGRATION ---
            const eta = estimateETA(distanceToLocation);
            // ✅ FIX: Show ONLY the ETA time/status for 'Estimated ETA'
            detailETA.textContent = eta; 
            // -----------------------
            
            // --- MODIFIED NOTIFICATION LOGIC (Corrected two-step alert system) ---
            const THRESHOLD_2KM = 2; 
            const THRESHOLD_1KM = 1;
            const REACHED_DISTANCE_KM = 0.05; 
            
            // 1. Alert at 2km
            if (distanceToLocation > THRESHOLD_1KM && distanceToLocation <= THRESHOLD_2KM) {
                const key_2km = `alerted_${tripId}_2km`;
                const message_2km = `📢 Bus ${currentVehicleName} is ${distanceToLocation.toFixed(2)} km away. ETA: ${eta}.`;
                notifyPassenger(message_2km, key_2km);
            } 
            
            // 2. Alert at 1km
            else if (distanceToLocation > REACHED_DISTANCE_KM && distanceToLocation <= THRESHOLD_1KM) {
                const key_1km = `alerted_${tripId}_1km`;
                const message_1km = `🚨 Bus ${currentVehicleName} is ${distanceToLocation.toFixed(2)} km away. ETA: ${eta}. Get ready!`;
                notifyPassenger(message_1km, key_1km);
            } 
            
            // 3. Final Arrival Alert (Now using a trip-specific key)
            else if (distanceToLocation <= REACHED_DISTANCE_KM) {
                const key_arrival = `alerted_${tripId}_arrived`; // Corrected key
                const arrivalMessage = `🛑 Bus ${currentVehicleName} has arrived near your stop/location!`;
                notifyPassenger(arrivalMessage, key_arrival); 
            }
            // ----------------------------------------------------------------------
            
            if (mapInitialized && !isNaN(busLat) && !isNaN(busLng)) {
                const busLatLng = [busLat, busLng];
                const passengerLatLng = [passengerLat, passengerLng];
                
                // Bus Marker (Red)
                if (busMarker) {
                    busMarker.setLatLng(busLatLng); 
                    map.panTo(busLatLng, { duration: 0.5 });
                } else {
                    busMarker = L.circleMarker(busLatLng, {
                        radius: 6,
                        color: 'red',
                        fillColor: 'pink',
                        fillOpacity: 0.8
                    }).addTo(map);
                    busMarker.bindPopup(`Bus: ${currentVehicleName}`).openPopup();
                }
                
                // Destination Marker (Blue)
                if (!destinationMarker) {
                    destinationMarker = L.circleMarker(passengerLatLng, {
                        radius: 6,
                        color: 'blue',
                        fillColor: '#00bcd4',
                        fillOpacity: 0.8
                    }).addTo(map);
                    destinationMarker.bindPopup(`Your Location`).openPopup();
                    
                    const bounds = L.latLngBounds([busLatLng, passengerLatLng]);
                    map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
                } else {
                    destinationMarker.setLatLng(passengerLatLng);
                }
            }

        } else {
            locationSpan.textContent = 'Location not yet available.';
            detailETA.textContent = 'N/A'; 
        }
    });
}
function hideDetails() {
    // Unsubscribe from the live trip data listener
    if(trackingListener) {
        trackingListener();
        trackingListener = null;
        // No need to clear 'last_alert_message' here, as we use trip-specific keys
    }
    // Remove map markers
    if (map && busMarker) {
        map.removeLayer(busMarker);
        busMarker = null;
    }
    if (map && destinationMarker) {
        map.removeLayer(destinationMarker);
        destinationMarker = null;
    }
    // FIX: Remove the temporary passenger marker (created by getLiveLocation)
    if (map && tempPassengerMarker) {
        map.removeLayer(tempPassengerMarker);
        tempPassengerMarker = null;
    }

    // Return to the search results view
    document.getElementById('resultsSection').style.display = 'block'; 
    document.getElementById('detailSection').style.display = 'none';
    
    // Rerun the search to re-establish the schedule list listener for real-time updates on the results screen
    const routeId = document.getElementById('routeSelect').value;
    if (routeId) {
        searchBuses();
    }
}

/**
 * Stops any active bus tracking listener and returns the user
 * to the initial route selection/search screen.
 */
function showSearchSection() {
    // 1. Stop any currently active real-time tracking
    if (trackingListener) {
        trackingListener();
        trackingListener = null;
        // No need to clear 'last_alert_message' here
    }

    // 2. Remove any temporary or active markers from the map
    if (map && busMarker) {
        map.removeLayer(busMarker);
        busMarker = null;
    }
    if (map && destinationMarker) {
        map.removeLayer(destinationMarker);
        destinationMarker = null;
    }
    if (map && tempPassengerMarker) {
        map.removeLayer(tempPassengerMarker);
        tempPassengerMarker = null;
    }

    // 3. Clear any ongoing GPS watch
    if (passengerWatchId) {
        navigator.geolocation.clearWatch(passengerWatchId);
        passengerWatchId = null;
    }
    
    // 4. Reset passenger location global variable
    passengerLocation = null;
    // 5. Toggle section visibility
    document.getElementById('searchSection').style.display = 'block'; 
    document.getElementById('resultsSection').style.display = 'none';
    document.getElementById('detailSection').style.display = 'none';
}
