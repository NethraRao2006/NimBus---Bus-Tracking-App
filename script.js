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
// NEW: Direct Passenger Access Function
// ======================================================================
function goToPassengerPortal() {
    // Passenger bypasses authentication entirely and is redirected immediately
    window.location.href = 'passenger.html';
}
// ======================================================================

function setMode(mode) {
    currentMode = mode;
    document.getElementById("loginModeBtn").classList.remove("active");
    document.getElementById("signupModeBtn").classList.remove("active");

    const submitButton = document.getElementById("submitButton");
    const formTitle = document.getElementById("formTitle");

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
    // This is now only called for Driver and Authority
    currentRole = role;
    document.getElementById("popupForm").style.display = "flex";
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

function handleAuth(event) {
    event.preventDefault();

    const email = document.getElementById("email").value.trim();
    const passwordInput = document.getElementById("password"); 
    const password = passwordInput.value.trim();
    const username = document.getElementById("username").value.trim(); // Get username early
    const submitButton = document.getElementById("submitButton");

    document.getElementById("errorMsg").innerText = "";

    if (email === "" || password === "" || password.length < 6) {
        displayError("Please enter a valid email and a password (min 6 characters).");
        return false;
    }
    
    submitButton.disabled = true;
    submitButton.innerText = currentMode === 'login' ? 'Logging in...' : 'Signing up...';

    const authPromise = currentMode === 'signup'
        ? auth.createUserWithEmailAndPassword(email, password)
        : auth.signInWithEmailAndPassword(email, password);

    authPromise
        .then((userCredential) => {
            const user = userCredential.user;
            
            if (currentMode === 'signup') {
                
                // 1. Set the role and username in Firestore upon successful SIGNUP
                return db.collection("users").doc(user.uid).set({
                    email: user.email,
                    // *** 🔥 FIX APPLIED HERE: Save the username field to Firestore ***
                    username: username || user.email, // Use provided username or fallback to email
                    role: currentRole,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                })
                .then(() => {
                    // 2. Also set the displayName in Firebase Auth (optional, but good practice)
                    if (username) return user.updateProfile({ displayName: username });
                    return user;
                });
            }
            return user; // Return user for the login scenario
        })
        .then(async (user) => {
            // CHECK ROLE during LOGIN
            if (currentMode === 'login') {
                const userDoc = await db.collection("users").doc(user.uid).get();

                if (!userDoc.exists) {
                    throw new Error("User data not found. Please contact support.");
                }

                const storedRole = userDoc.data().role;
                // Since your Authority Portal looks for the 'drivers' collection, 
                // we'll assume the driver details are mirrored there (best practice).
                // For now, we only need to check the 'users' collection for the role.
                
                // CRITICAL CHECK: Does the stored role match the portal being accessed?
                if (storedRole !== currentRole) {
                    await auth.signOut(); 
                    throw new Error(`Access Denied! You are registered as a ${storedRole}, not a ${currentRole}.`);
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
            let errorMessage = error.message;

            if (error.code) {
                // Auto-switch: If user tries to SIGNUP with an existing email
                if (error.code === 'auth/email-already-in-use' && currentMode === 'signup') {
                    errorMessage = "This account already exists. Please LOG IN with your password.";
                    setMode('login'); 
                    passwordInput.value = ''; // CRITICAL CLEANUP
                }
                // Handle common login failure codes
                else if (error.code === 'auth/invalid-login-credentials' || 
                         error.code === 'auth/wrong-password' || 
                         error.code === 'auth/user-not-found') {
                    
                    errorMessage = "Login failed. Please check your password and email, or use the Signup tab if you are a new user.";
                    passwordInput.value = ''; 
                } 
                else {
                    // Clean up default Firebase error messages
                    errorMessage = error.message.replace("Firebase: ", "");
                }
            } 
            
            submitButton.disabled = false;
            submitButton.innerText = currentMode === 'login' ? 'Login' : 'Signup';

            if (errorMessage.includes("Access Denied")) {
                setMode('login'); 
            }

            console.error("Auth Error:", error.code || 'Custom', errorMessage);
            displayError(errorMessage);
        });

    return false;
}
