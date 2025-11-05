// driver.js
// Assumes 'auth' and 'db' are globally available from script.js

let currentDriverId = null;
let activeTripId = null; // Stores the auto-generated ID of the current trip
let trackingInterval = null; // Holds the reference for stopping MOCK location updates
let locationWatchId = null; // Holds the reference for stopping REAL GPS location updates
// --- NEW: destination auto-end globals ---
let destinationCoords = null;  // { lat, lng } of final stop
let destinationReached = false; // ensures auto-end runs only once
// ------------------------------------------------


// --- NEW VARIABLE TO STORE ACTUAL DEPARTURE TIME ---
let actualDepartureTimestamp = null; 

// --- MOCK LOCATION VARIABLES (Used only if useMock is true) ---
let currentMockLat = 12.7443; 
let currentMockLng = 75.0679;
let mockMoveStep = 0.0001; 
let mockMoveDirection = 0; 
// ------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
    // 1. Check if the user is logged in (Driver)
    auth.onAuthStateChanged(user => {
        if (user && user.uid) {
            currentDriverId = user.uid;
            document.getElementById('driverWelcome').textContent = `Welcome, ${user.email}!`;
            loadInitialData();
        } else {
            alert("You must be logged in as a Driver to access this page.");
            window.location.href = 'index.html';
        }
    });
    
    // Add event listener for the new "Record Departure" button
    const recordBtn = document.getElementById('recordDepartureBtn');
    if (recordBtn) {
        recordBtn.addEventListener('click', recordActualDeparture);
    }

    // Add event listener for the Start Trip button
    const startBtn = document.getElementById('startTripBtn');
    if (startBtn) {
        startBtn.addEventListener('click', startTrip);
    }
});

// ----------------------------------------------------------------------
// DATA LOADING FUNCTIONS 
// ----------------------------------------------------------------------

async function loadInitialData() {
    const routeSelect = document.getElementById('routeSelect');
    const vehicleSelect = document.getElementById('vehicleSelect');
    const scheduleSelect = document.getElementById('scheduleSelect');
    const recordBtn = document.getElementById('recordDepartureBtn');

    routeSelect.innerHTML = '<option value="">Select Route</option>';
    vehicleSelect.innerHTML = '<option value="">Select Vehicle</option>';
    scheduleSelect.innerHTML = '<option value="">Select a Route First</option>';
    if (recordBtn) recordBtn.disabled = true; // Disable initially
    
    // Clear any previous departure time display on initial load
    const departureTimeDisplay = document.getElementById('departureTimeDisplay');
    if (departureTimeDisplay) departureTimeDisplay.textContent = ''; 
    actualDepartureTimestamp = null; // Reset state

    try {
        const routesSnapshot = await db.collection('routes').get();
        routesSnapshot.forEach(doc => {
            const route = doc.data();
            routeSelect.innerHTML += `<option value="${doc.id}">${route.routename}</option>`;
        });

        const vehiclesSnapshot = await db.collection('vehicles').get();
        vehiclesSnapshot.forEach(doc => {
            const vehicle = doc.data();
            vehicleSelect.innerHTML += `<option value="${doc.id}">${vehicle.display_name} (${vehicle.license_plate})</option>`;
        });
        
        routeSelect.addEventListener('change', loadSchedulesForSelectedRoute);
        vehicleSelect.addEventListener('change', checkStartButtonEligibility);
        scheduleSelect.addEventListener('change', checkStartButtonEligibility);
        
        // Check if the driver has an active trip to restore the session
        await checkActiveTripPersistence(); 

    } catch (error) {
        console.error("Error loading initial data:", error);
        alert("Failed to load routes and vehicles. Check console.");
    }
}

async function loadSchedulesForSelectedRoute() {
    const routeId = document.getElementById('routeSelect').value;
    const scheduleSelect = document.getElementById('scheduleSelect');
    const startTripBtn = document.getElementById('startTripBtn');

    scheduleSelect.innerHTML = '<option value="">Loading Slots...</option>';
    startTripBtn.disabled = true;

    if (!routeId) {
        scheduleSelect.innerHTML = '<option value="">Select a Route First</option>';
        checkStartButtonEligibility(); 
        return;
    }

    try {
        const schedulesSnapshot = await db.collection('schedules')
            .where('route_id', '==', routeId)
            .orderBy('time', 'asc')
            .get();

        scheduleSelect.innerHTML = '<option value="">Select Schedule Slot</option>';

        if (schedulesSnapshot.empty) {
            scheduleSelect.innerHTML = '<option value="">No schedule slots found for this route</option>';
            checkStartButtonEligibility(); 
            return;
        }

        schedulesSnapshot.forEach(doc => {
            const schedule = doc.data();
            const scheduledTime = schedule.time; 
            const slotName = schedule.slot_name ? ` - ${schedule.slot_name}` : '';
            scheduleSelect.innerHTML += `<option value="${doc.id}" data-time="${scheduledTime}">${scheduledTime}${slotName}</option>`;
        });
        
    } catch (error) {
        console.error("Error loading schedules:", error);
        scheduleSelect.innerHTML = '<option value="">Failed to load schedules</option>';
    } finally {
        checkStartButtonEligibility();
    }
}


function checkStartButtonEligibility() {
    const routeId = document.getElementById('routeSelect').value;
    const vehicleId = document.getElementById('vehicleSelect').value;
    const scheduleSlotId = document.getElementById('scheduleSelect').value;
    const startTripBtn = document.getElementById('startTripBtn');
    const recordBtn = document.getElementById('recordDepartureBtn');
    const isReady = (routeId && vehicleId && scheduleSlotId);

    // Disable the Start Trip button if not all are selected OR if time hasn't been recorded
    startTripBtn.disabled = !(isReady && actualDepartureTimestamp); 
    
    // Disable the Record Departure button if selections are incomplete OR if time is already recorded
    if (recordBtn) recordBtn.disabled = !isReady || !!actualDepartureTimestamp; 
}

// ----------------------------------------------------------------------
// PERSISTENCE AND UI RESTORATION
// ----------------------------------------------------------------------

async function checkActiveTripPersistence() {
    if (!currentDriverId) return;
    
    const activeTripSnapshot = await db.collection('trips')
        .where('driver_id', '==', currentDriverId)
        .where('current_status', 'in', ['Ontime', 'Delayed'])
        .limit(1)
        .get();

    if (!activeTripSnapshot.empty) {
        const existingTrip = activeTripSnapshot.docs[0];
        const tripData = existingTrip.data();
        activeTripId = existingTrip.id;
        
        restoreTripUI(activeTripId, tripData);
        startLocationTracking(tripData.last_known_location); 
        alert(`Active trip ${activeTripId.substring(0, 6)}... restored after page reload.`);
    }
}

function restoreTripUI(tripId, data) {
    document.getElementById('startTripSection').style.display = 'none';
    document.getElementById('tripStatus').style.display = 'block';

    document.getElementById('currentTripId').textContent = `Trip ID: ${tripId}`;
    document.getElementById('currentVehicle').textContent = `Vehicle ID: ${data.vehicle_id}`;
    document.getElementById('currentRoute').textContent = `Route ID: ${data.route_id}`;
    
    updateStatusUI(data.current_status);
}


// ----------------------------------------------------------------------
// RECORD DEPARTURE & START TRIP FUNCTIONS
// ----------------------------------------------------------------------

function recordActualDeparture() {
    const recordBtn = document.getElementById('recordDepartureBtn');
    const displayElement = document.getElementById('departureTimeDisplay'); 

    // Store the current time as a Firebase Timestamp 
    actualDepartureTimestamp = firebase.firestore.Timestamp.now(); 
    
    const now = new Date();
    const timeString = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });

    if (displayElement) {
        displayElement.textContent = `Actual Departure: ${timeString}`;
    }
    
    // Disable the record button and re-check start button eligibility
    if (recordBtn) recordBtn.disabled = true;
    checkStartButtonEligibility();
    alert(`Departure time recorded as ${timeString}. You can now start the trip.`);
}


async function startTrip() {
    const routeId = document.getElementById('routeSelect').value;
    const vehicleId = document.getElementById('vehicleSelect').value;
    const scheduleSlotId = document.getElementById('scheduleSelect').value; 
    
    // Check if the departure time has been recorded (Safety check)
    if (!actualDepartureTimestamp) {
        alert("Please record the Actual Departure Time by clicking the 'Record Departure' button.");
        return;
    }
    
    document.getElementById('startTripBtn').disabled = true;

    try {
        const scheduleDoc = await db.collection('schedules').doc(scheduleSlotId).get();
        if (!scheduleDoc.exists || !scheduleDoc.data().time) {
             throw new Error("Selected schedule slot or time not found.");
        }
        
        const scheduleTime = scheduleDoc.data().time; 
        const routeDoc = await db.collection('routes').doc(routeId).get();
        const stop_ids = routeDoc.data().stop_ids || [];
// --- NEW: Load destination stop coordinates for auto-end ---
destinationCoords = null;
destinationReached = false;

if (stop_ids.length > 0) {
    const destinationStopId = stop_ids[stop_ids.length - 1];
    try {
        const destStopDoc = await db.collection('stops').doc(destinationStopId).get();
        if (destStopDoc.exists) {
            const stopData = destStopDoc.data();
            // Expect stop documents to have 'latitude' and 'longitude' numeric fields
            if (stopData.latitude != null && stopData.longitude != null) {
                destinationCoords = { lat: Number(stopData.latitude), lng: Number(stopData.longitude) };
                console.log("Destination coords loaded for auto-end:", destinationCoords);
            } else {
                console.warn("Destination stop exists but lacks latitude/longitude fields.");
            }
        } else {
            console.warn("Destination stop doc not found for id:", destinationStopId);
        }
    } catch (err) {
        console.error("Failed to fetch destination stop for auto-end:", err);
    }
}
// ------------------------------------------------------------

        // Construct scheduled date object for Firestore Timestamp conversion
        const [hour, minute] = scheduleTime.split(':').map(Number); 
        const scheduledDate = new Date(); 
        scheduledDate.setHours(hour, minute, 0, 0); 
        
        const tripData = {
            route_id: routeId,
            vehicle_id: vehicleId,
            driver_id: currentDriverId,
            scheduled_slot_id: scheduleSlotId, 
            scheduled_departure_time: firebase.firestore.Timestamp.fromDate(scheduledDate), 
            actual_departure_time: actualDepartureTimestamp, // Use the recorded timestamp
            from_stop_id: stop_ids[0] || null, 
            to_stop_id: stop_ids[stop_ids.length - 1] || null,
            current_status: 'Ontime',
            last_known_location: null, 
            last_status_reason: null,
            trip_start_time: firebase.firestore.FieldValue.serverTimestamp(),
        };

        const docRef = await db.collection('trips').add(tripData);
        activeTripId = docRef.id;

        document.getElementById('startTripSection').style.display = 'none';
        document.getElementById('tripStatus').style.display = 'block';
        document.getElementById('currentTripId').textContent = `Trip ID: ${activeTripId}`;
        document.getElementById('currentVehicle').textContent = `Vehicle: ${document.getElementById('vehicleSelect').options[document.getElementById('vehicleSelect').selectedIndex].text}`;
        document.getElementById('currentRoute').textContent = `Route: ${document.getElementById('routeSelect').options[document.getElementById('routeSelect').selectedIndex].text}`;
        updateStatusUI('Ontime');
        
        // START LOCATION TRACKING
        startLocationTracking(null); 
        
        // Reset the recorded time state after a successful trip start
        actualDepartureTimestamp = null; 

    } catch (error) {
        console.error("Error starting trip:", error);
        alert("Failed to start trip. Check console.");
        document.getElementById('startTripBtn').disabled = false;
        // Re-enable the record button if the trip creation fails
        checkStartButtonEligibility();
    }
}

// ----------------------------------------------------------------------
// LOCATION TRACKING LOGIC
// ----------------------------------------------------------------------

function startLocationTracking(initialLocation) {
    // 1. Clear any existing tracking mechanisms before starting a new one
    if (trackingInterval) clearInterval(trackingInterval);
    if (locationWatchId) navigator.geolocation.clearWatch(locationWatchId);
    
    // If the trip was restored, set the mock location to the last known location
    if (initialLocation && initialLocation.latitude && initialLocation.longitude) {
        currentMockLat = initialLocation.latitude;
        currentMockLng = initialLocation.longitude;
    }

    const useMock = false; // ⭐ THIS IS NOW SET TO FALSE FOR REAL GPS TRACKING ⭐

    if (useMock) {
        startMockTracking(); 
    } else if (navigator.geolocation) {
        startRealGpsTracking(); 
    } else {
        document.getElementById('trackingStatus').style.color = 'red';
        document.getElementById('trackingStatus').textContent = 'DISABLED: Geolocation not available on this device/browser.';
    }
}


function startMockTracking() {
    const trackingIntervalTime = 10000; 
    const trackingStatus = document.getElementById('trackingStatus');
    const locationDisplay = document.getElementById('currentLocationDisplay');

    trackingStatus.style.color = 'green';
    trackingStatus.textContent = 'ACTIVE (MOCK)';
    
    function simulateMovement() {
        // Your movement logic (simple square loop)
        if (mockMoveDirection === 0) { 
            currentMockLng += mockMoveStep;
            if (currentMockLng > 75.0689) mockMoveDirection = 1; 
        } else if (mockMoveDirection === 1) { 
            currentMockLat -= mockMoveStep;
            if (currentMockLat < 12.7433) mockMoveDirection = 2;
        } else if (mockMoveDirection === 2) { 
            currentMockLng -= mockMoveStep;
            if (currentMockLng < 75.0669) mockMoveDirection = 3;
        } else if (mockMoveDirection === 3) { 
            currentMockLat += mockMoveStep;
            if (currentMockLat > 12.7453) mockMoveDirection = 0;
        }
        
        writeLocationToFirestore(currentMockLat, currentMockLng);
        locationDisplay.textContent = `MOCK: Lat: ${currentMockLat.toFixed(6)}, Lng: ${currentMockLng.toFixed(6)}`;
    }
    
    simulateMovement();
    trackingInterval = setInterval(simulateMovement, trackingIntervalTime);
}


function startRealGpsTracking() {
    const trackingStatus = document.getElementById('trackingStatus');
    const locationDisplay = document.getElementById('currentLocationDisplay');

    trackingStatus.style.color = 'orange';
    trackingStatus.textContent = 'STARTING REAL GPS...';
    
    const successCallback = (position) => {
        const { latitude, longitude } = position.coords;
        writeLocationToFirestore(latitude, longitude);
        fetchWeather(latitude, longitude);
        
        // Check if bus reached the destination (auto-end logic)
        checkIfDestinationReached(latitude, longitude);

        trackingStatus.style.color = 'green';
        trackingStatus.textContent = 'ACTIVE (REAL GPS)';
        locationDisplay.textContent = `REAL: Lat: ${latitude.toFixed(6)}, Lng: ${longitude.toFixed(6)}`;
    };

    const errorCallback = (error) => {
        console.error("Geolocation Error:", error.message, error.code);
        
        let statusMessage = 'GPS ERROR';
        if (error.code === 1) statusMessage = 'GPS DENIED (Permissions)';
        if (error.code === 2) statusMessage = 'GPS UNAVAILABLE (No Signal)';
        if (error.code === 3) statusMessage = 'GPS TIMEOUT';

        trackingStatus.style.color = 'red';
        trackingStatus.textContent = `BLOCKED: ${statusMessage}`;
        locationDisplay.textContent = `Error: ${error.message}`;
        
        // If GPS fails, you might want to stop tracking or try again.
        // For now, we keep the UI updated with the error.
    };

    locationWatchId = navigator.geolocation.watchPosition(
        successCallback, 
        errorCallback, 
        {
            enableHighAccuracy: true,
            timeout: 15000, // Wait up to 15 seconds for a position
            maximumAge: 0   // Do not use cached positions
        }
    );
}



function writeLocationToFirestore(lat, lng) {
    if (activeTripId) {
        db.collection('trips').doc(activeTripId).update({
            last_known_location: new firebase.firestore.GeoPoint(lat, lng),
            last_updated: firebase.firestore.FieldValue.serverTimestamp(),
        }).catch(error => {
            console.error("Error updating location:", error);
        });
    }
}

// ----------------------------------------------------------------------
// STATUS & END TRIP LOGIC
// ----------------------------------------------------------------------

function updateStatusUI(status) {
    const displayStatus = document.getElementById('displayStatus');
    displayStatus.textContent = status;

    let color = '#4caf50';
    if (status === 'Delayed') color = '#ff9800';
    if (status === 'Cancelled') color = '#f44336';
    displayStatus.style.color = color;
}

async function updateStatus(status, reason) {
    if (!activeTripId) {
        alert("No active trip to update.");
        return;
    }
    
    if (status === 'Delayed' && !reason) {
        alert("Please select a reason for the delay.");
        return;
    }
    
    const updatePayload = {
        current_status: status,
        last_status_reason: reason || null, 
        last_status_time: firebase.firestore.FieldValue.serverTimestamp(),
    };
    
    try {
        await db.collection('trips').doc(activeTripId).update(updatePayload);
        updateStatusUI(status);
        document.getElementById('delayReasonSection').style.display = 'none';

        if (status === 'Cancelled') {
            alert("Trip has been CANCELLED and tracking is stopped.");
            endTrip(); 
        }

    } catch (error) {
        console.error("Error updating trip status:", error);
        alert("Failed to update status. Check console.");
    }
}

// ----------------------------------------------------------------------
// AUTO END TRIP FEATURE - Checks if driver reached destination
// ----------------------------------------------------------------------
function checkIfDestinationReached(currentLat, currentLng) {
    // Guard conditions
    if (!destinationCoords || destinationReached || !activeTripId) return;

    // Haversine formula to compute distance (meters)
    const R = 6371e3; // meters
    const φ1 = currentLat * Math.PI / 180;
    const φ2 = destinationCoords.lat * Math.PI / 180;
    const Δφ = (destinationCoords.lat - currentLat) * Math.PI / 180;
    const Δλ = (destinationCoords.lng - currentLng) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c; // meters

    console.log(`Distance to destination: ${distance.toFixed(1)} m`);

    // Threshold in meters to auto-end (tweak as needed)
    const AUTO_END_THRESHOLD_METERS = 100;

    if (distance <= AUTO_END_THRESHOLD_METERS) {
        destinationReached = true; // prevent re-entry
        alert("✅ Trip completed automatically — destination reached!");

        // Stop local tracking immediately
        if (trackingInterval) { clearInterval(trackingInterval); trackingInterval = null; }
        if (locationWatchId) { navigator.geolocation.clearWatch(locationWatchId); locationWatchId = null; }

        // Update Firestore to mark trip as completed
        db.collection('trips').doc(activeTripId).update({
            current_status: 'Completed',
            end_time: firebase.firestore.FieldValue.serverTimestamp(),
            last_known_location: new firebase.firestore.GeoPoint(currentLat, currentLng)
        })
        .then(() => {
            console.log("Trip auto-ended successfully in Firestore.");
            // Clear local state and update UI
            activeTripId = null;
            document.getElementById('startTripSection').style.display = 'block';
            document.getElementById('tripStatus').style.display = 'none';
            // reset departure display & state
            actualDepartureTimestamp = null;
            const departureTimeDisplay = document.getElementById('departureTimeDisplay');
            if (departureTimeDisplay) departureTimeDisplay.textContent = '';
            checkStartButtonEligibility();
        })
        .catch((error) => {
            console.error("Error updating trip to Completed during auto-end:", error);
            // Still clear local tracking to avoid continued location writes
            activeTripId = null;
            document.getElementById('startTripSection').style.display = 'block';
            document.getElementById('tripStatus').style.display = 'none';
        });
    }
}
// ----------------------------------------------------------------------

function endTrip() {
    if (confirm("Are you sure you want to END the current trip? This will stop tracking.")) {
        
        // Stop tracking mechanisms
        if (trackingInterval) clearInterval(trackingInterval); 
        if (locationWatchId) navigator.geolocation.clearWatch(locationWatchId);
        
        trackingInterval = null;
        locationWatchId = null; 
        
        // Clear local state
        actualDepartureTimestamp = null; 
        const departureTimeDisplay = document.getElementById('departureTimeDisplay');
        if (departureTimeDisplay) departureTimeDisplay.textContent = '';


        if (activeTripId) {
            db.collection('trips').doc(activeTripId).update({
                current_status: 'Completed',
                end_time: firebase.firestore.FieldValue.serverTimestamp(),
                last_known_location: null, 
            })
            .then(() => {
                activeTripId = null;
                document.getElementById('startTripSection').style.display = 'block';
                document.getElementById('tripStatus').style.display = 'none';
                checkStartButtonEligibility(); // Resets all buttons based on current selection state
                alert("Trip successfully ended.");
            })
            .catch(error => {
                console.error("Error ending trip:", error);
                alert("Trip ended locally, but failed to update the database record.");
            });
        } else {
            activeTripId = null;
            document.getElementById('startTripSection').style.display = 'block';
            document.getElementById('tripStatus').style.display = 'none';
            checkStartButtonEligibility();
        }
    }
}

async function driverLogout() {
    const activeTripId = localStorage.getItem('activeTripId'); 
    
    // Step 1: Securely complete the active trip
    if (activeTripId) {
        try {
            await db.collection('trips').doc(activeTripId).update({
                status: 'Completed',
                end_time: firebase.firestore.FieldValue.serverTimestamp()
            });
            console.log("Trip successfully marked as 'Completed'.");
        } catch (error) {
            console.error("FIREBASE ERROR: Failed to complete active trip:", error);
        }
    }

    // Step 2: Clear Local Data (Confirmed working)
    localStorage.removeItem('activeTripId'); 
    console.log("Local trip data cleared.");
    
    // Step 3: Perform Firebase Logout and Redirect
    // If the firebase-auth.js script isn't loaded, this fails silently.
    firebase.auth().signOut()
        .then(() => {
            console.log("SUCCESS: Firebase sign out completed. Redirecting...");
            window.location.href = 'index.html'; 
        })
        .catch((error) => {
            console.error("CRITICAL AUTH ERROR: Firebase Sign Out Failed:", error);
            alert("Logout failed! Check HTML script loading.");
        });
}

// ----------------------------------------------------------------------
// SIMPLE WEATHER FEATURE - Uses Open-Meteo API (No key needed)
// ----------------------------------------------------------------------
function fetchWeather(lat, lng) {
    const weatherDisplay = document.getElementById('weatherDisplay');
    if (!weatherDisplay) return;

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current_weather=true`;

    fetch(url)
        .then(res => res.json())
        .then(data => {
            if (data && data.current_weather) {
                const temp = data.current_weather.temperature;
                const wind = data.current_weather.windspeed;
                const code = data.current_weather.weathercode;

                // Base weather text
                let weatherText = `Weather: ${temp}°C, Wind ${wind} km/h`;

                // 🌧️ Weather code meaning (based on Open-Meteo docs)
                // 51–67 → Drizzle/Rain, 80–99 → Showers/Thunderstorms
                const rainyCodes = [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99];

                if (rainyCodes.includes(code)) {
                    weatherText += " ⚠️ Heavy rain — network connectivity may be poor.";
                    weatherDisplay.style.color = "#d32f2f"; // Red warning color
                    weatherDisplay.style.fontWeight = "bold";
                } else {
                    weatherDisplay.style.color = "#2e7d32"; // Normal green for clear weather
                    weatherDisplay.style.fontWeight = "normal";
                }

                weatherDisplay.textContent = weatherText;
            } else {
                weatherDisplay.textContent = "Weather: Not available";
            }
        })
        .catch(err => {
            console.error("Weather fetch error:", err);
            weatherDisplay.textContent = "Weather: Error fetching data";
        });
}

