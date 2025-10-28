// GLOBAL VARIABLES
let map = null;
let busMarker = null;
let destinationMarker = null; 
let allRoutes = []; 
let allStops = []; 
let passengerLocation = null;
let trackingListener = null; 
let mapInitialized = false; 
let tempPassengerMarker = null;
let passengerWatchId = null; 

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
    const R = 6371; 
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
        0.5 - Math.cos(dLat) / 2 + 
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * (1 - Math.cos(dLon)) / 2;
    return R * 2 * Math.asin(Math.sqrt(a)); 
}

function notifyPassenger(message) {
    const lastAlert = localStorage.getItem('last_alert_message');
    if (lastAlert !== message) {
        alert(message);
        localStorage.setItem('last_alert_message', message);
    }
}

// --- INITIALIZATION ---

document.addEventListener('DOMContentLoaded', () => {
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

function getLiveLocation() {
    const locationInput = document.getElementById('currentLocationInput');
    locationInput.value = 'Acquiring GPS Lock...';
    
    if (tempPassengerMarker) {
        map.removeLayer(tempPassengerMarker);
        tempPassengerMarker = null;
    }
    
    if (passengerWatchId) {
        navigator.geolocation.clearWatch(passengerWatchId);
        passengerWatchId = null;
    }

    if (!navigator.geolocation) {
        locationInput.value = 'Not supported.';
        alert("Geolocation not supported by this browser.");
        return;
    }

    const successCallback = (position) => {
        if (passengerWatchId === null) return; 

        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        
        locationInput.value = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
        
        // CRUCIAL: Set the global passengerLocation variable
        passengerLocation = { lat: lat, lng: lng }; 
        
        // Immediately stop the continuous watch (Driver Logic applied for a snapshot!)
        navigator.geolocation.clearWatch(passengerWatchId);
        passengerWatchId = null; 

        if (mapInitialized) {
            const latLng = [lat, lng];
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
        if (passengerWatchId) {
            navigator.geolocation.clearWatch(passengerWatchId);
            passengerWatchId = null;
        }
        console.error("Geolocation Error:", error.message);
        locationInput.value = 'GPS BLOCKED/FAILED';
        alert(`Could not get current location: ${error.message}. Please manually enter coordinates.`);
    };

    // Start the continuous watch (then clear in success)
    passengerWatchId = navigator.geolocation.watchPosition(
        successCallback, 
        errorCallback, 
        {
            enableHighAccuracy: true,
            timeout: 10000, 
            maximumAge: 0 
        }
    );
}

function getPassengerLocationForTracking() {
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
            alert("Please click 'Get Live GPS' or enter valid coordinates (e.g., 35.0000, 75.0000).");
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
        allRoutes = routesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        routeSelect.innerHTML = '<option value="">Select Route</option>';
        allRoutes.forEach(route => {
            routeSelect.innerHTML += `<option value="${route.id}">${route.routename}</option>`;
        });
        
        const stopsSnapshot = await db.collection('stops').get();
        allStops = stopsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        notifStopSelect.innerHTML = '<option value="">Select Stop for Notifications</option>';
        allStops.forEach(stop => {
            notifStopSelect.innerHTML += `<option value="${stop.id}">${stop.name}</option>`;
        });

    } catch (error) {
        console.error("Error loading routes/stops:", error);
        routeSelect.innerHTML = '<option value="">Failed to load routes</option>';
        notifStopSelect.innerHTML = '<option value="">Failed to load stops</option>';
    }
}

// ... (All code before searchBuses() remains the same)

async function searchBuses() {
    const routeId = document.getElementById('routeSelect').value;

    document.getElementById('searchBtn').disabled = true;

    try {
        // 1. Fetch all schedules for the route (still ordered by time for standard behavior)
        const schedulesSnapshot = await db.collection('schedules')
            .where('route_id', '==', routeId)
            .orderBy('time', 'asc') 
            .get();

        const schedulePromises = schedulesSnapshot.docs.map(async doc => {
            const schedule = {
                id: doc.id,
                ...doc.data(),
                current_status: 'Scheduled',
                live_trip_id: null,
            };
            
            // 🎯 Fetch vehicle details INCLUDING bus_type and service_type
            if (schedule.default_vehicle_id) {
                const vehicleDoc = await db.collection('vehicles').doc(schedule.default_vehicle_id).get();
                if (vehicleDoc.exists) {
                    const vehicleData = vehicleDoc.data();
                    schedule.vehicleName = vehicleData.display_name || 'N/A';
                    schedule.licensePlate = vehicleData.license_plate || 'N/A';
                    schedule.bus_type = vehicleData.bus_type || 'N/A';
                    schedule.service_type = vehicleData.service_type || 'N/A';
                } else {
                    schedule.vehicleName = 'N/A';
                    schedule.licensePlate = 'N/A';
                    schedule.bus_type = 'N/A';
                    schedule.service_type = 'N/A';
                }
            } else {
                schedule.vehicleName = 'N/A';
                schedule.licensePlate = 'N/A';
                schedule.bus_type = 'N/A';
                schedule.service_type = 'N/A';
            }
            return schedule;
        });

        let mergedTrips = await Promise.all(schedulePromises);

        // 2. Fetch live trips (logic for live trips remains the same, fetching vehicle data)
        const liveTripsSnapshot = await db.collection('trips')
            .where('route_id', '==', routeId)
            .where('current_status', 'in', ['Ontime', 'Delayed', 'Cancelled'])
            .get();
        
        const liveTripsPromises = liveTripsSnapshot.docs.map(async doc => {
            const trip = doc.data();
            trip.id = doc.id;
            
            const vehicleDoc = await db.collection('vehicles').doc(trip.vehicle_id).get();
            if (vehicleDoc.exists) {
                 const vehicleData = vehicleDoc.data();
                 trip.vehicleName = vehicleData.display_name || 'N/A';
                 trip.licensePlate = vehicleData.license_plate || 'N/A';
                 trip.bus_type = vehicleData.bus_type || 'N/A';
                 trip.service_type = vehicleData.service_type || 'N/A';
            } else {
                 trip.vehicleName = 'N/A';
                 trip.licensePlate = 'N/A';
                 trip.bus_type = 'N/A';
                 trip.service_type = 'N/A';
            }
            
            return trip;
        });
        
        const liveTrips = await Promise.all(liveTripsPromises);
        
        // 3. Merge live data with scheduled data
        liveTrips.forEach(liveTrip => {
            const scheduleIndex = mergedTrips.findIndex(s => s.id === liveTrip.scheduled_slot_id);
            
            if (scheduleIndex !== -1) {
                // Overwrite scheduled status/vehicle info with live info
                mergedTrips[scheduleIndex].current_status = liveTrip.current_status;
                mergedTrips[scheduleIndex].last_status_reason = liveTrip.last_status_reason;
                mergedTrips[scheduleIndex].vehicleName = liveTrip.vehicleName;
                mergedTrips[scheduleIndex].licensePlate = liveTrip.licensePlate;
                mergedTrips[scheduleIndex].actual_departure_time = liveTrip.actual_departure_time; 
                
                // Overwrite with live trip's vehicle details
                mergedTrips[scheduleIndex].bus_type = liveTrip.bus_type;
                mergedTrips[scheduleIndex].service_type = liveTrip.service_type;

                if (liveTrip.current_status === 'Ontime' || liveTrip.current_status === 'Delayed') {
                    mergedTrips[scheduleIndex].live_trip_id = liveTrip.id; 
                    mergedTrips[scheduleIndex].last_known_location = liveTrip.last_known_location;
                }
            }
        });
        
        // ⭐ NEW SORTING STEP ⭐
        // Sort the merged array alphabetically by License Plate before rendering
        mergedTrips.sort((a, b) => {
            const plateA = a.licensePlate.toUpperCase();
            const plateB = b.licensePlate.toUpperCase();
            if (plateA < plateB) {
                return -1;
            }
            if (plateA > plateB) {
                return 1;
            }
            // If License Plates are the same, use the Scheduled Time as a secondary sort
            const timeA = a.time || 'ZZZZ';
            const timeB = b.time || 'ZZZZ';
            if (timeA < timeB) {
                 return -1;
            }
            if (timeA > timeB) {
                 return 1;
            }
            return 0;
        });

        renderResults(mergedTrips, routeId);

    } catch (error) {
        console.error("Error searching buses:", error);
        alert("Failed to search buses. Check console.");
        renderResults([], routeId); 
    } finally {
        document.getElementById('searchBtn').disabled = false;
    }
}

// ... (All code after searchBuses() remains the same)

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
        
        const reason = trip.last_status_reason ? `Reason: ${trip.last_status_reason}` : '';
        const statusClass = getStatusClass(trip.current_status);
        
        // Construct the table row
        const newRow = `
            <tr class="${trip.current_status.toLowerCase()}-row">
                <td>${scheduledTimeStr}</td>
                
                <td>
                    <span style="${actualTimeStyle}">${actualTimeStr}</span>
                </td>
                
                <td>${daysActiveStr}</td>

                <td>${busTypeStr}</td>
                
                <td>${serviceTypeStr}</td>
                
                <td>${trip.vehicleName || 'N/A'} / ${trip.licensePlate || 'N/A'}</td>
                
                <td>
                    <span class="status-badge ${statusClass}">${trip.current_status}</span>
                    <br><small>${reason}</small>
                </td>
            </tr>
        `;
        tableBody.innerHTML += newRow;
    });
}


function renderResults(mergedTrips, routeId) {
    const scheduledTrips = mergedTrips; 
    const activeTrips = mergedTrips.filter(t => t.current_status === 'Ontime' || t.current_status === 'Delayed');

    const route = allRoutes.find(r => r.id === routeId);
    document.getElementById('scheduleRouteName').textContent = route ? route.routename : 'Selected Route';
    
    document.getElementById('searchSection').style.display = 'none';
    document.getElementById('resultsSection').style.display = 'block';
    
    renderScheduleTable(scheduledTrips);

    const busList = document.getElementById('busList');
    busList.innerHTML = '';
    
    document.getElementById('busCount').textContent = activeTrips.length;

    if (activeTrips.length === 0) {
        document.getElementById('noActiveMsg').style.display = 'block';
    } else {
        document.getElementById('noActiveMsg').style.display = 'none';
        activeTrips.forEach(trip => {
            const statusClass = getStatusClass(trip.current_status);
            const locationText = trip.last_known_location ? (`${trip.last_known_location.latitude.toFixed(4)}, ${trip.last_known_location.longitude.toFixed(4)}`) : 'Location pending.';

            const card = document.createElement('div');
            card.className = 'result-card';
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

    trackingListener = db.collection('trips').doc(tripId).onSnapshot(async doc => {
        if (!doc.exists || doc.data().current_status === 'Completed') {
            alert("This trip has ended.");
            hideDetails();
            return;
        }
        
        const trip = doc.data();
        const vehicleDoc = await db.collection('vehicles').doc(trip.vehicle_id).get();
        const currentVehicleName = vehicleDoc.exists ? vehicleDoc.data().display_name : vehicleName;

        document.getElementById('detailVehicle').textContent = `${currentVehicleName} (Trip ID: ${doc.id.substring(0, 6)}...)`;
        
        const statusBadge = document.getElementById('detailStatus');
        statusBadge.textContent = trip.current_status;
        statusBadge.className = `status-badge ${getStatusClass(trip.current_status)}`;
        
        if (trip.current_status === 'Delayed' && trip.last_status_reason) {
             statusBadge.textContent += ` (Reason: ${trip.last_status_reason})`;
        }
        
        const locationSpan = document.getElementById('detailLocation');
        let busLat = null;
        let busLng = null;

        if (trip.last_known_location) {
            busLat = trip.last_known_location.latitude;
            busLng = trip.last_known_location.longitude;
            locationSpan.textContent = `${busLat.toFixed(6)}, ${busLng.toFixed(6)}`;

            const distanceToLocation = calculateDistance(busLat, busLng, passengerLat, passengerLng);
            
            const THRESHOLD_DISTANCE_KM = 2; 
            const REACHED_DISTANCE_KM = 0.05; 

            if (distanceToLocation <= THRESHOLD_DISTANCE_KM && distanceToLocation > REACHED_DISTANCE_KM) {
                notifyPassenger(`🚌 Bus ${currentVehicleName} is approaching your stop/location! It is ${distanceToLocation.toFixed(2)} km away.`);
            } else if (distanceToLocation <= REACHED_DISTANCE_KM) {
                notifyPassenger(`🚨 Bus ${currentVehicleName} has arrived near your stop/location!`);
            }
            
            if (mapInitialized && !isNaN(busLat) && !isNaN(busLng)) {
                const busLatLng = [busLat, busLng];
                const passengerLatLng = [passengerLat, passengerLng];
                
                // Bus Marker (Red)
                if (busMarker) {
                    busMarker.setLatLng(busLatLng);
                    // Use panTo to smoothly center map on bus during updates
                    map.panTo(busLatLng, { duration: 0.5 });
                } else {
                    busMarker = L.circleMarker(busLatLng, {
                        radius: 12,
                        color: 'red',
                        fillColor: 'red',
                        fillOpacity: 1
                    }).addTo(map);
                    busMarker.bindPopup(`Bus: ${currentVehicleName}`).openPopup();
                }
                
                // Destination Marker (Blue)
                if (!destinationMarker) {
                    destinationMarker = L.circleMarker(passengerLatLng, {
                        radius: 8,
                        color: 'blue',
                        fillColor: '#00bcd4',
                        fillOpacity: 0.8
                    }).addTo(map);
                    destinationMarker.bindPopup(`Your Location`).openPopup();
                    
                    // Fit bounds on initial load
                    const bounds = L.latLngBounds([busLatLng, passengerLatLng]);
                    map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
                } else {
                    destinationMarker.setLatLng(passengerLatLng);
                }
            }

        } else {
            locationSpan.textContent = 'Location not yet available.';
        }
    });
}

function hideDetails() {
    if(trackingListener) {
        trackingListener();
        trackingListener = null;
        localStorage.removeItem('last_alert_message'); 
    }
    if (map && busMarker) {
        map.removeLayer(busMarker);
        busMarker = null;
    }
    if (map && destinationMarker) {
        map.removeLayer(destinationMarker);
        destinationMarker = null;
    }
    document.getElementById('resultsSection').style.display = 'block'; 
    document.getElementById('detailSection').style.display = 'none';
}