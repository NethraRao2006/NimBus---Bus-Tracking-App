
// scripts.js

// *** IMPORTANT: REPLACE WITH YOUR ACTUAL FIREBASE PROJECT CONFIG ***
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
let currentRole = "";
let currentMode = "login"; // Default mode

// ======================================================================
// Direct Passenger Access Function
// ======================================================================
function goToPassengerPortal() {
    window.location.href = 'passenger.html';
}
// ======================================================================

function setMode(mode) {
    currentMode = mode;
    document.getElementById("loginModeBtn").classList.remove("active");
    document.getElementById("signupModeBtn").classList.remove("active");

    const submitButton = document.getElementById("submitButton");
    const formTitle = document.getElementById("formTitle");
    const licenseField = document.getElementById("licenseField");
    
    // Control License Field visibility based on role (Driver only)
    if (licenseField) {
        licenseField.style.display = (currentRole === 'Driver') ? 'block' : 'none';
    }

    if (mode === 'login') {
        document.getElementById("loginModeBtn").classList.add("active");
        submitButton.innerText = "Login";
        formTitle.innerText = `${currentRole} Login`;
    } else {
        document.getElementById("signupModeBtn").classList.add("active");
        submitButton.innerText = "Signup";
        formTitle.innerText = `${currentRole} Signup`;
    }
    document.getElementById("errorMsg").innerText = ""; // Clear errors on mode switch
}

function openForm(role) {
    currentRole = role;
    document.getElementById("popupForm").style.display = "flex";
    
    // EXPLICITLY control License Field visibility based on role selection
    const licenseField = document.getElementById("licenseField");
    if (licenseField) {
        licenseField.style.display = (currentRole === 'Driver') ? 'block' : 'none';
    }

    setMode('login'); 
}

function closeForm() {
    document.getElementById("popupForm").style.display = "none";
    document.getElementById("errorMsg").innerText = "";
    document.getElementById("userForm").reset();
}

function displayError(message) {
    const errorMsg = document.getElementById("errorMsg");
    errorMsg.innerText = `⚠ ${message}`;
}


// ----------------------------------------------------------------------
// 3. FIREBASE AUTHENTICATION HANDLER (FOR DRIVER/AUTHORITY ONLY)
// ----------------------------------------------------------------------

// ----------------------------------------------------------------------
// 3. FIREBASE AUTHENTICATION HANDLER (FOR DRIVER/AUTHORITY ONLY)
// ----------------------------------------------------------------------

function handleAuth(event) {
    event.preventDefault();

    const email = document.getElementById("email").value.trim();
    const passwordInput = document.getElementById("password"); 
    const password = passwordInput.value.trim();
    const username = document.getElementById("username").value.trim(); 
    
    // Safely get license value only if the field is visible (Driver)
    const licenseInput = document.getElementById("license");
    const license = currentRole === 'Driver' && licenseInput ? licenseInput.value.trim() : null;
    
    const submitButton = document.getElementById("submitButton");

    document.getElementById("errorMsg").innerText = "";

    if (email === "" || password === "" || password.length < 6) {
        displayError("Please enter a valid email and a password (min 6 characters).");
        return false;
    }
    
    // Validation for all roles/modes (Username is always required)
    if (username === "") {
        displayError("Username is required.");
        return false;
    }
    
    // Validation for License Number (Driver Only)
    if (currentRole === 'Driver' && (!license || license === "")) {
        displayError("License Number is required for Driver accounts.");
        return false;
    }

    
    submitButton.disabled = true;
    submitButton.innerText = currentMode === 'login' ? 'Logging in...' : 'Signing up...';

    // --- NEW LOGIC START: Check License Before Signup ---
    const preAuthPromise = (currentMode === 'signup' && currentRole === 'Driver')
        ? db.collection("drivers").where('license', '==', license).limit(1).get()
            .then(snapshot => {
                if (snapshot.empty) {
                    // Fail signup if license is not found in the 'drivers' collection
                    throw new Error("License not found in records. Driver signup requires a pre-registered license number.");
                }
                // License found, proceed to Firebase Auth creation
                return Promise.resolve(); 
            })
        : Promise.resolve(); // For login or Authority signup, resolve immediately
    // --- NEW LOGIC END ---

    preAuthPromise
        .then(() => {
            // IF PRE-AUTH IS SUCCESSFUL (OR SKIPPED), PROCEED WITH AUTH
            return currentMode === 'signup'
                ? auth.createUserWithEmailAndPassword(email, password)
                : auth.signInWithEmailAndPassword(email, password);
        })
        .then((userCredential) => {
            const user = userCredential.user;
            
            if (currentMode === 'signup') {
                
                // 1. Set the role and user details in Firestore 'users' collection
                const userSetupPromise = db.collection("users").doc(user.uid).set({
                    email: user.email,
                    username: username,
                    role: currentRole,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                
                // 2. Update the 'drivers' document with the user's UID for linking (RECOMMENDED)
                // This step links the pre-registered license document to the new user.
                let driverUpdatePromise = Promise.resolve();
                if (currentRole === 'Driver' && license) {
                     // We already checked for the license's existence in preAuthPromise, 
                     // so we can now query it again to get the document reference.
                    driverUpdatePromise = db.collection("drivers").where('license', '==', license).limit(1).get()
                        .then(snapshot => {
                            if (!snapshot.empty) {
                                // Update the first (and only) matching driver document with the new user's UID
                                const driverDocRef = snapshot.docs[0].ref;
                                return driverDocRef.update({ uid: user.uid }); // Link the account
                            }
                            // Should not happen due to the check earlier, but good to handle
                            return Promise.resolve();
                        });
                }
                
                return Promise.all([userSetupPromise, driverUpdatePromise])
                    .then(() => {
                        return user.updateProfile({ displayName: username });
                    });
            }
            return user; // Return user for the login scenario
        })
        .then(async (user) => {
            // ... (rest of the login/redirection logic remains the same) ...
            
            // CHECK ROLE & LICENSE during LOGIN
            if (currentMode === 'login') {
                
                // --- Step 1: Check Role in 'users' collection (ALL ROLES) ---
                const userDoc = await db.collection("users").doc(user.uid).get();

                if (!userDoc.exists) {
                    throw new Error("User data not found. Please contact support.");
                }

                const storedRole = userDoc.data().role;
                
                // CRITICAL CHECK 1: Does the stored role match the portal being accessed?
                if (storedRole !== currentRole) {
                    await auth.signOut(); 
                    throw new Error(`Access Denied! You are registered as a ${storedRole}, not a ${currentRole}.`);
                }
                
                // 🔑 Step 2: LICENSE CHECK (ONLY FOR DRIVER) - MODIFIED FOR YOUR STRUCTURE 🔑
                if (currentRole === 'Driver') {
                    
                    // 1. Query the 'drivers' collection for the entered license number
                    const licenseQuerySnapshot = await db.collection("drivers")
                        .where('license', '==', license) // Query the 'license' field
                        .limit(1) 
                        .get();

                    if (licenseQuerySnapshot.empty) {
                        await auth.signOut();
                        throw new Error("License number mismatch. License not found in records.");
                    }
                    
                    // NOTE: If the license is found, the user is authenticated. 
                    // If you add the UID to the driver document in the future, 
                    // you would add a check here to ensure the license belongs to the current user.
                }
            }
            
            alert(`${currentRole} ${currentMode} successful! Welcome!`);

            closeForm();
            
            // Redirect based on role (Driver/Authority)
            if (currentRole === 'Driver') {
                window.location.href = 'driver.html'; 
            } else if (currentRole === 'Authority') {
                window.location.href = 'authority.html';
            }
        })
        .catch((error) => {
            // ... (rest of the error handling remains the same) ...
            let errorMessage = error.message;

            if (error.code) {
                if (error.code === 'auth/email-already-in-use' && currentMode === 'signup') {
                    errorMessage = "This account already exists. Please LOG IN with your password.";
                    setMode('login'); 
                    passwordInput.value = ''; 
                }
                else if (error.code === 'auth/invalid-login-credentials' || 
                         error.code === 'auth/wrong-password' || 
                         error.code === 'auth/user-not-found') {
                    
                    errorMessage = "Login failed. Please check your password and email.";
                    passwordInput.value = ''; 
                } 
                else {
                    errorMessage = error.message.replace("Firebase: ", "");
                }
            } 
            
            submitButton.disabled = false;
            submitButton.innerText = currentMode === 'login' ? 'Login' : 'Signup';

            if (errorMessage.includes("Access Denied") || errorMessage.includes("License number mismatch") || errorMessage.includes("License not found")) {
                setMode('login'); 
            }

            console.error("Auth Error:", error.code || 'Custom', errorMessage);
            displayError(errorMessage);
        });

    return false;
}
