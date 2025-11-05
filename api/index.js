// Import the libraries we installed
const express = require('express');
const axios = require('axios');
const admin = require('firebase-admin');
const Razorpay = require('razorpay');
const crypto = require('crypto');

// --- WhatsApp Configuration ---
// NOTE: These are placeholders. In a real scenario, you would use a specific provider (Meta/Twilio)
// and these variables would contain the real endpoint and auth token.
const WHATSAPP_API_URL = process.env.WHATSAPP_API_URL || 'https://graph.facebook.com/v19.0/';
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
// NEW: This is the token that must match the 'Verify Token' entered in Meta's dashboard.
const VERIFY_TOKEN = process.env.VERIFY_TOKEN; 

// --- Common Configuration ---
const RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;
const MOCK_TRACKING_BASE_URL = "https://goroute-bot.web.app/";

// --- Predefined City List (Used for suggested buttons only) ---
const MAJOR_CITIES = [
    'Mumbai', 'Kolhapur', 'Goa (Panaji)', 'Bengaluru', 'Hyderabad', 'Nagpur', 'Nashik',
    'Pune', 'Aurangabad', 'Margao', 'Hubballi'
];

// --- Seat Icons Mapping ---
const SEAT_ICONS = {
    'sleeper upper': '🛏️',
    'sleeper lower': '🛏️',
    'seater': '💺'
};

// --- Razorpay Initialization ---
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// --- UTILITY FUNCTION: Converts HTML to WhatsApp Markdown ---
function formatForWhatsApp(text) {
    if (!text) return '';
    // Replace <b>, </b> with *
    text = text.replace(/<\/?b>/gi, '*');
    // Replace <i>, </i> with _
    text = text.replace(/<\/?i>/gi, '_');
    // Replace <code>, </pre>, <pre> with backticks or just * (WhatsApp doesn't have true code blocks)
    text = text.replace(/<\/?(pre|code)>/gi, '`');
    // Replace HTML anchor links with plain URL (WhatsApp auto-links)
    text = text.replace(/<a href='([^']+)'>(.*?)<\/a>/gi, (match, url, linkText) => `${linkText}: ${url}`);
    // Replace <span>, </span> and other generic tags with nothing
    text = text.replace(/<\/?span[^>]*>/gi, '');
    return text.trim();
}

// --- MESSAGES (Updated to use WhatsApp/Plain Text Formatting) ---
const MESSAGES = {
    help: `*GoRoute Help Center*

Select an option from the menu below to get started. You can also type commands like "book bus".`,
    no_buses: "❌ *No buses available matching your criteria.*\n\nPlease check back later or try different routes.",
    specify_bus_id: '❌ Please specify the Bus ID.\nExample: "Show seats BUS101"',
    seat_map_error: '❌ Error generating seat map for {busID}.',
    no_seats_found: '❌ No seats found in the system for bus {busID}.',
    feature_wip: '🚧 This feature is coming soon!',
    welcome_back: '👋 Welcome back, {name}!',

    // --- LAYOUT DESCRIPTIONS ---
    bus_layout_seater: "Seater Bus (2x2)",
    bus_layout_sleeper: "Sleeper Coach (Upper & Lower Berth, 2x1)",
    bus_layout_both: "Semi Sleeper (2x1) & Seater (2x2) Mix",

    // Registration
    prompt_role: "🎉 *Welcome to GoRoute!* To get started, please choose your role by *typing the corresponding number*:\n\n1. User (Book Tickets)\n2. Bus Manager (Manage Buses)\n3. Bus Owner (Manage Staff)",
    registration_started: "✅ Great! Your role is set to *{role}*.\n\nTo complete your profile, please provide your details in this exact format:\n\n`my profile details [Your Full Name] / [Your Aadhar Number] / [Your Phone Number]`",
    profile_updated: "✅ *Profile Updated!* Your details have been saved.",
    profile_update_error: "❌ *Error!* Please use the correct format:\n`my profile details [Name] / [Aadhar Number] / [Phone Number]`",
    user_not_found: "❌ User not found. Please send /start to register.",

    // Phone Update
    update_phone_prompt: "📞 *Update Phone:* Please enter your new 10-digit phone number now.",
    phone_updated_success: "✅ Phone number updated successfully!",
    phone_invalid: "❌ Invalid phone number. Please enter a 10-digit number only.",

    // Booking (UPDATED FOR BOARDING & DESTINATION)
    prompt_boarding: "🚌 *Boarding Point:* Please enter your preferred *boarding point* for this journey (e.g., `Mumbai Central` or `Pune Bypass`):",
    prompt_destination: "📍 *Drop-off Point:* Please enter the passenger's *final destination city* on this route (e.g., *{to}*):",
    booking_type_prompt: "👤 *Booking Seats:* Please select your booking type:",
    gender_prompt: "🚻 *Seat Safety:* Is the passenger booking seat {seatNo} a *Male* or *Female*?\n\nPlease reply with *M* or *F*.",
    safety_violation: "🚫 *Seat Safety Violation:* A male cannot book seat {seatNo} as it is next to a female-occupied seat. Please choose another seat.",
    details_prompt: "✍️ *Passenger Details:* Please enter the passenger's Name, Age, and Aadhar number in this exact format:\n`[Name] / [Age] / [Aadhar Number]`",
    booking_passenger_prompt: "✅ Details saved for seat {seatNo}.\n\n*What's next?*\n\n1. Complete Booking\n2. Add Another Passenger (WIP)",

    // Payment
    payment_required: "💰 *Payment Required:* Total Amount: ₹{amount} INR.\n\n*Order ID: {orderId}*\n\n*Payment Link:* {paymentUrl}\n\n_(Note: Your seat is held for 15 minutes. The ticket will be automatically sent upon successful payment.)_",
    payment_awaiting: "⏳ Your seat is still locked while we await payment confirmation from Razorpay (Order ID: {orderId}).\n\n*Reply with 'Confirm Payment' or 'Cancel Booking'.*",
    payment_failed: "❌ Payment verification failed. Your seats have been released. Please try booking again.",
    session_cleared: "🧹 *Previous booking session cleared.* Your locked seats have been released.",

    // Detailed Ticket Confirmation (UPDATED FOR BOARDING POINT)
    payment_confirmed_ticket: `✅ *Payment Confirmed & E-Ticket Issued!*

🎫 *E-Ticket Details*
Bus: {busName} ({busType})
Route: {from} → {to}
Date: {journeyDate}
Departure: {departTime}
Seats: {seatList}
Boarding Point: *{boardingPoint}*
Passenger Drop-off: *{destination}*

👤 *Passenger Info (Primary)*
Name: {name}
Phone: {phone}

💰 *Transaction Details*
Order ID: {orderId}
Amount Paid: ₹{amount} INR
Time: {dateTime}
`,
    // Passenger Self-Service Messages
    ticket_not_found: "❌ E-Ticket for Booking ID *{bookingId}* not found or not confirmed.",
    booking_status_info: "📋 *Booking Status - {bookingId}*\n\nBus: {busID}\nSeats: {seats}\nStatus: *{status}*\nBooked On: {date}",
    seat_change_invalid: "❌ Invalid format. Use: `Request seat change BOOKID NEW_SEAT`",
    seat_change_wip: "🚧 Seat change request received for Booking *{bookingId}* (New seat: {newSeat}). This feature requires manager approval, and is currently pending implementation.",
    user_share_location_wip: "👨‍👩‍👧‍👦 *Personal Location Sharing:* This feature requires deep integration with your device's GPS and is under development. Please check back later!",
    fare_alert_invalid: "❌ Invalid format. Use: `Alert on [FROM] to [TO] @ [HH:MM]`",
    fare_alert_set: "🔔 *Fare Alert Set!* We will notify you if tickets for {from} to {to} around {time} become available or change significantly.",


    booking_details_error: "❌ *Error!* Please provide details in the format: `[Name] / [Age] / [Aadhar Number]`",
    seat_not_available: "❌ Seat {seatNo} on bus {busID} is already booked or invalid.",
    no_bookings: "📭 You don't have any active bookings.",
    booking_cancelled: "🗑️ *Booking Cancelled*\n\nBooking {bookingId} has been cancelled successfully.\n\nYour refund will be processed and credited within 6 hours of *{dateTime}*.",

    // NEW SEARCH MESSAGES
    search_from: "🗺️ *Travel From:* Please *type the full name of your boarding city*:",
    search_to: "➡️ *Travel To:* Please *type the full name of your drop-off city*:",
    search_city_invalid: "❌ City not found. Please ensure you type the full city name correctly (e.g., 'Pune'). Try again:",
    search_route_not_found: "❌ No routes available from *{city}*. Please check your spelling or try another city.",
    search_date: "📅 *Travel Date:* When do you plan to travel?\n\n*Reply with a date in YYYY-MM-DD format* (e.g., 2025-12-25) or type *'Today'* or *'Tomorrow'*.",
    search_results: "🚌 *Search Results ({from} to {to}, {date})* 🚌\n\n",

    // NEW MANIFEST MESSAGE
    manifest_header: "📋 *Bus Manifest - {busID}*\nRoute: {from} → {to}\nDate: {date}\nTotal Booked Seats: {count}\n\n",
    manifest_entry: " • *Seat {seat}:* {name} (Aadhar {aadhar}) {gender}",
    no_manifest: "❌ No confirmed bookings found for bus {busID}.",

    // New Seat Map Header (UPDATED)
    seat_map_header: "🚍 *Seat Map - {busID}* ({layout})\nRoute: {from} → {to}\nDate: {date} 🕒 {time}\n\nLegend: ✅ Available • ⚫ Booked/Locked • 🚺 Female • 🚹 Male • 💺 Seater • 🛏️ Sleeper",
    seat_map_group_header: "\n--- {type} Seats ---\n",
    seat_map_list_item: " {seatNo} ({typeIcon}) {statusIcon} | Booked To: {destination}",

    // NEW TRACKING MESSAGES (Manager Flow)
    manager_tracking_prompt: "📍 *Start Tracking:* Enter the Bus ID that is now departing (e.g., `BUS101`):",
    manager_tracking_location_prompt: "📍 *Current Location:* Where is the bus departing from? (e.g., `Mumbai Central Bus Stand`):",
    manager_tracking_duration_prompt: "⏳ *Sharing Duration:* For how long should the location tracking run? (e.g., `3 hours`, `45 minutes`):",
    manager_tracking_session_active: "🚌 *Bus {busID} Tracking Session Active.* Ends at: *{stopTime}*.\n\n*Type 'Stop Tracking {busID}' to end the session.*",
    manager_tracking_started: "✅ *LIVE Location Sharing Started for {busID}!*.\n\n📍 *Tracking Link:* {trackingUrl}?bus={busID}\n\nPassengers have been notified. Tracking will automatically stop at *{stopTime}*.",
    manager_tracking_stopped: "⏹️ *Tracking Stopped for {busID}.* The journey status is now 'Arrived'.",
    tracking_auto_stopped: "⏰ *Tracking Session Ended.* Bus {busID} tracking automatically stopped at {time} after {duration} and status set to 'Arrived'.",
    tracking_not_tracking: "❌ Bus *{busID}* has not started tracking yet or the route is finished. Please check with the operator.",
    passenger_tracking_info: "🚍 *Live Tracking - {busID}*\n\n📍 *Last Location:* {location}\n🕒 *Last Updated:* {time}\n\n🔗 *Tracking Link:* {trackingUrl}?bus={busID}",

    // Manager/Owner Trip/Staff Management
    manager_list_trips: "🚌 *Your Active Trips:*\n\n{tripList}",
    no_active_trips: "📭 You currently have no active or scheduled trips assigned.",
    owner_manage_staff_prompt: "👑 *Staff Management:* Enter the Chat ID to assign/revoke a role, using the format:\n`assign manager CHAT_ID` or `revoke manager CHAT_ID`",
    owner_staff_assigned: "✅ Chat ID *{chatId}* role updated to *manager*.",
    owner_staff_revoked: "✅ Chat ID *{chatId}* role revoked (set to user).",
    owner_invalid_format: "❌ Invalid format. Use: `assign manager CHAT_ID` or `revoke manager CHAT_ID`",
    owner_permission_denied: "❌ Only Bus Owners can manage staff roles.",

    // Revenue & Audit
    revenue_report: "💵 *Revenue Report for {date}*\n\nTotal Confirmed Bookings: {count}\nTotal Revenue (Gross): *₹{totalRevenue} INR*",
    bus_status_invalid: "❌ Invalid status. Status must be one of: `scheduled`, `departed`, `arrived`, or `maintenance`.\nExample: `Set status BUS101 maintenance`",
    bus_status_updated: "✅ Bus *{busID}* status updated to *{status}*.",
    checkin_invalid: "❌ Invalid format. Use: `Check-in BOOKID`",
    checkin_success: "✅ Passenger check-in successful for Booking *{bookingId}*. Status set to 'Boarded'.",
    seat_release_invalid: "❌ Invalid format. Use: `Release seat BUSID SEAT_NO`",
    seat_release_success: "✅ Seat *{seatNo}* on Bus *{busID}* released and set to 'Available'.",
    aadhar_api_config_show: "🔒 *Aadhar Verification API Configuration*\n\nEndpoint URL: `{url}`\nStatus: {status}\n\nTo update, type 'Setup Aadhar API'.",

    // Aadhar API Setup
    aadhar_api_init: "🔒 *Aadhar Verification Setup:* Enter the verification API endpoint URL:",
    aadhar_api_success: "✅ Aadhar API Endpoint set to: {url}",

    // Manager
    manager_add_bus_init: "📝 *Bus Creation:* Enter the *Bus Number* (e.g., `MH-12 AB 1234`):",
    manager_add_bus_number: "🚌 Enter the *Bus Name* (e.g., `Sharma Travels`):",
    manager_add_bus_route: "📍 Enter the Route (e.g., `Delhi to Jaipur`):",
    manager_add_bus_price: "💰 Enter the Base Price (e.g., `850`):",
    manager_add_bus_type: "🛋️ Enter the *Bus Seating Layout* (*Seater*, *Sleeper*, or *Both*):",
    manager_add_seat_type: "🪑 Enter the seat type for *Row {row}* (*Sleeper Upper*, *Sleeper Lower*, or *Seater*):",
    manager_add_bus_depart_date: "📅 Enter the Departure Date (YYYY-MM-DD, e.g., `2025-12-25`):",
    manager_add_bus_depart_time: "🕒 Enter the Departure Time (HH:MM, 24h format, e.g., `08:30`):",
    manager_add_bus_arrive_time: "🕡 Enter the Estimated Arrival Time (HH:MM, 24h format, e.g., `18:00`):",
    manager_add_bus_manager_phone: "📞 *Final Step:* Enter your Phone Number to associate with the bus:",
    manager_add_bus_boarding_init: "📍 *Boarding Points:* Enter the points and times in the format:\n`[Point Name] / [HH:MM]`\n\nSend *'DONE'* when finished (max 5 points):",
    manager_add_bus_boarding_more: "✅ Point added. Add another (or send *'DONE'*):",
    manager_add_bus_boarding_invalid: "❌ Invalid format. Please use: `[Point Name] / [HH:MM]`",
    manager_bus_saved: "✅ *Bus {busID} created!* Route: {route}. Next, add seats: \n\n*Next Step:* Now, create all seats for this bus by typing:\n`add seats {busID} 40`",
    manager_seats_saved: "✅ *Seats Added!* 40 seats have been created for bus {busID} and marked available. You can now use `show seats {busID}`.",
    manager_seats_invalid: "❌ Invalid format. Please use: `add seats [BUSID] [COUNT]`",
    manager_invalid_layout: "❌ Invalid layout. Please enter *Seater*, *Sleeper*, or *Both*.",
    manager_invalid_seat_type: "❌ Invalid seat type. Please enter *Sleeper Upper*, *Sleeper Lower*, or *Seater*.",

    // Manager Notifications
    manager_notification_booking: "🔔 *NEW BOOKING ALERT ({busID})*\n\nSeats: {seats}\nPassenger: {passengerName}\nTime: {dateTime}\n\nUse `show manifest {busID}` to view the full list.",
    manager_notification_cancellation: "🗑️ *CANCELLATION ALERT ({busID})*\n\nBooking ID: {bookingId}\nSeats: {seats}\nTime: {dateTime}\n\nSeats have been automatically released.",

    // General
    db_error: "❌ CRITICAL ERROR: The bot's database is not connected. Please contact support.",
    unknown_command: "🤔 I don't understand that command. Type */help* for a list of available options.",
    sync_setup_init: "📝 *Inventory Sync Setup:* Enter the Bus ID you wish to synchronize (e.g., `BUS101`).",
    sync_setup_url: "🔗 Enter the *OSP API Endpoint* (the external URL for inventory data) for bus {busID}:",
    sync_success: "✅ *Inventory Sync Setup Successful!* Bus {busID} is now configured to pull data from {url}.",
};

// Create the server
const app = express();
// The Razorpay webhook requires raw body parsing for signature verification
app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));

// --- Database Initialization ---
let db;

function getFirebaseDb() {
    if (db) return db;

    try {
        const rawCredsBase64 = process.env.FIREBASE_CREDS_BASE64;
        if (!rawCredsBase64) {
            throw new Error("CRITICAL: FIREBASE_CREDS_BASE64 is not defined in Vercel Environment Variables.");
        }

        let jsonString;
        try {
            jsonString = Buffer.from(rawCredsBase64, 'base64').toString('utf8');
        } catch (bufferError) {
            throw new Error(`CRITICAL: Buffer conversion failed. Error: ${bufferError.message}`);
        }

        let serviceAccount;
        try {
            serviceAccount = JSON.parse(jsonString);
        } catch (jsonError) {
            throw new Error(`CRITICAL: JSON parsing failed. Error: ${jsonError.message}`);
        }


        try {
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount)
            });
        } catch (error) {
            if (!error.message.includes("default Firebase app already exists")) {
                throw error;
            }
        }

        db = admin.firestore();
        console.log("✅ Firebase DB initialized successfully.");
        return db;

    } catch (e) {
        console.error("CRITICAL FIREBASE ERROR", e.message);
        throw e;
    }
}

/* --------------------- WhatsApp Axios Helpers (Generic Provider) ---------------------- */

/**
 * Simulates sending a message using a generic WhatsApp API provider.
 * NOTE: This is a placeholder for a specific provider's API structure (e.g., Twilio/Meta).
 * @param {string} chatId The user's phone number or chat ID.
 * @param {string} text The message content (will be formatted).
 * @param {object | null} replyMarkup Optional structure for buttons/lists (not fully implemented here).
 */
async function sendWhatsAppMessage(chatId, text, replyMarkup = null) {
    if (!WHATSAPP_TOKEN) {
        console.error("❌ CRITICAL: WHATSAPP_TOKEN is missing. Cannot send message.");
        return;
    }

    // Apply WhatsApp markdown formatting
    const formattedText = formatForWhatsApp(text);

    if (!formattedText || formattedText.trim() === '') {
        console.error(`❌ CRITICAL: Attempted to send an empty message to ${chatId}.`);
        return;
    }

    try {
        // This payload assumes the Meta Cloud API format for sending text messages
        const payload = {
            messaging_product: "whatsapp",
            to: String(chatId),
            type: "text",
            text: {
                body: formattedText
            }
        };

        const phone_number_id = '837590122771193'; // Using the ID from the Meta Quickstart page.

        // Send message using Meta Cloud API
        const response = await axios.post(`${WHATSAPP_API_URL}${phone_number_id}/messages`, payload, {
            headers: {
                'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });

        console.log(`[WHATSAPP] Message sent successfully to ${chatId}. Status: ${response.status}. Content: ${formattedText.substring(0, 50)}...`);
    } catch (error) {
        // Generic error logging for WhatsApp API failure
        console.error(`❌ WHATSAPP API ERROR for ${chatId}: ${error.message || error.response?.data?.error?.message}`);
        // Log status 400 errors from Meta
        if (error.response && error.response.status === 400) {
            console.error("Meta API 400 Error Details:", error.response.data);
        }
    }
}

// WhatsApp does not use separate functions for chat actions or callback answers,
// so those Telegram functions are removed/merged into the core flow.

/* --------------------- Shared Helper Functions ---------------------- */
// (Remaining helper functions like getAppState, saveAppState, unlockSeats, getBusInfo, sendManagerNotification are unchanged)

async function getAppState(chatId) {
    const db = getFirebaseDb();
    const doc = await db.collection('user_state').doc(String(chatId)).get();
    if (doc.exists) return { state: doc.data().state, data: doc.data().data };
    return { state: 'IDLE', data: {} };
}

async function saveAppState(chatId, stateName, data) {
    const db = getFirebaseDb();
    await db.collection('user_state').doc(String(chatId)).set({
        state: stateName,
        data: data,
        updated_at: admin.firestore.FieldValue.serverTimestamp()
    });
}

async function unlockSeats(booking) {
    try {
        const db = getFirebaseDb();
        const batch = db.batch();
        if (booking && booking.seats && Array.isArray(booking.seats)) {
             booking.seats.forEach(seat => {
                 const seatRef = db.collection('seats').doc(`${booking.busID}-${seat.seatNo}`);
                 batch.set(seatRef, { status: 'available', temp_chat_id: admin.firestore.FieldValue.delete(), booked_to_destination: admin.firestore.FieldValue.delete() }, { merge: true });
             });
        }
        await batch.commit();
    } catch (e) {
        console.error("CRITICAL: Failed to unlock seats:", e.message);
    }
}

async function getBusInfo(busID) {
    try {
        const db = getFirebaseDb();
        const doc = await db.collection('buses').doc(busID).get();
        if (!doc.exists) return null;

        const data = doc.data();
        return {
            busID: data.bus_id,
            busName: data.bus_name,
            busType: data.bus_type,
            price: data.price,
            from: data.from,
            to: data.to,
            date: data.departure_time.split(' ')[0],
            time: data.departure_time.split(' ')[1],
            boardingPoints: data.boarding_points || [],
            seatConfig: data.seat_configuration || []
        };
    } catch (e) {
        console.error("Error fetching bus info:", e.message);
        return null;
    }
}

async function sendManagerNotification(busID, type, details) {
    try {
        const db = getFirebaseDb();
        const busDoc = await db.collection('buses').doc(busID).get();

        if (!busDoc.exists || !busDoc.data().manager_chat_id) return;

        const managerChatId = busDoc.data().manager_chat_id;
        const now = details.dateTime || new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

        let notificationText = '';
        if (type === 'BOOKING') {
            const seatList = details.seats.map(s => s.seatNo).join(', ');
            notificationText = MESSAGES.manager_notification_booking
                .replace('{busID}', busID)
                .replace('{seats}', seatList)
                .replace('{passengerName}', details.passengerName || 'A Passenger')
                .replace('{dateTime}', now);
        } else if (type === 'CANCELLATION') {
            const seatsList = details.seats.join(', ');
            notificationText = MESSAGES.manager_notification_cancellation
                .replace('{bookingId}', details.bookingId)
                .replace('{busID}', busID)
                .replace('{seats}', seatsList)
                .replace('{dateTime}', now);
        }

        if (notificationText) {
            await sendWhatsAppMessage(managerChatId, notificationText);
        }
    } catch (e) {
        console.error("Error sending manager notification:", e.message);
    }
}

async function notifyPassengersOfTrackingStart(busID, location, time) {
    const db = getFirebaseDb();

    try {
        const bookingsSnapshot = await db.collection('bookings')
            .where('busID', '==', busID)
            .where('status', '==', 'confirmed')
            .get();

        if (bookingsSnapshot.empty) return;

        const updates = [];
        const trackingUrl = MOCK_TRACKING_BASE_URL;

        const notificationText = MESSAGES.passenger_tracking_info
            .replace('{busID}', busID)
            .replace('{location}', location)
            .replace('{time}', time)
            .replace('{trackingUrl}', trackingUrl);

        const notifiedChats = new Set();
        bookingsSnapshot.forEach(doc => {
            const chatId = doc.data().chat_id;
            if (!notifiedChats.has(chatId)) {
                updates.push(sendWhatsAppMessage(chatId, notificationText));
                notifiedChats.add(chatId);
            }
        });

        await Promise.all(updates);

    } catch (e) {
        console.error(`Error notifying passengers for bus ${busID}:`, e.message);
    }
}

// (Utility functions parseDurationToMs, checkAndReleaseMidRouteSeats, and sendLiveLocationUpdates are unchanged)
function parseDurationToMs(durationString) {
    if (typeof durationString !== 'string' || durationString.trim() === '') {
        return 0;
    }

    const parts = durationString.toLowerCase().trim().split(' ');
    if (parts.length !== 2) return 0;

    const value = parseInt(parts[0]);
    const unit = parts[1];

    if (isNaN(value)) return 0;

    if (unit.startsWith('minute')) {
        return value * 60 * 1000;
    } else if (unit.startsWith('hour')) {
        return value * 60 * 60 * 1000;
    }
    return 0;
}

async function checkAndReleaseMidRouteSeats() {
    const db = getFirebaseDb();

    const trackedBusesSnapshot = await db.collection('buses').where('is_tracking', '==', true).get();

    for (const busDoc of trackedBusesSnapshot.docs) {
        const busID = busDoc.id;
        const busData = busDoc.data();
        const currentLocation = busData.last_location_name;

        if (!currentLocation) continue;

        const seatsSnapshot = await db.collection('seats')
            .where('bus_id', '==', busID)
            .where('status', '==', 'booked')
            .get();

        const batch = db.batch();
        let seatsReleasedCount = 0;

        seatsSnapshot.forEach(seatDoc => {
            const seatData = seatDoc.data();
            const destination = seatData.booked_to_destination;

            if (destination && currentLocation && destination.toLowerCase().includes(currentLocation.toLowerCase())) {
                console.log(`[MID-ROUTE RELEASE] Releasing seat ${seatData.seat_no} on ${busID}. Destination matched: ${destination} vs ${currentLocation}`);

                batch.update(seatDoc.ref, {
                    status: 'available',
                    booking_id: admin.firestore.FieldValue.delete(),
                    booked_to_destination: admin.firestore.FieldValue.delete(),
                });
                seatsReleasedCount++;
            }
        });

        if (seatsReleasedCount > 0) {
             await batch.commit();
             console.log(`[MID-ROUTE SUCCESS] Released ${seatsReleasedCount} seats on Bus ${busID}.`);
        }
    }
}

async function sendLiveLocationUpdates() {
    const db = getFirebaseDb();
    const updates = [];
    let updatesSent = 0;
    const currentTime = new Date();
    const notificationTime = currentTime.toLocaleTimeString('en-IN');
    const mockLocation = ['Mumbai', 'Pune', 'Nagpur', 'Nashik', 'Aurangabad', 'Kolhapur'];

    try {

        await checkAndReleaseMidRouteSeats();

        const busesSnapshot = await db.collection('buses').where('is_tracking', '==', true).get();

        for (const busDoc of busesSnapshot.docs) {
            const data = busDoc.data();
            const busID = data.bus_id;
            const managerId = data.manager_chat_id;

            // 2a. Check for Automatic Stop
            if (data.tracking_stop_time) {
                const stopTime = data.tracking_stop_time.toDate();
                if (currentTime > stopTime) {
                    const startTime = busDoc.data().last_location_time.toDate();
                    const durationMs = stopTime.getTime() - startTime.getTime();
                    const durationString = `${Math.floor(durationMs / 3600000)}h ${Math.floor((durationMs % 3600000) / 60000)}m`;

                    await busDoc.ref.update({ is_tracking: false, status: 'arrived', tracking_stop_time: admin.firestore.FieldValue.delete() });

                    const autoStopMsg = MESSAGES.tracking_auto_stopped
                        .replace('{busID}', busID)
                        .replace('{time}', notificationTime)
                        .replace('{duration}', durationString);

                    if (managerId) updates.push(sendWhatsAppMessage(managerId, autoStopMsg));
                    continue;
                }
            }

            // 2b. Regular Location Update
            const randomLocation = mockLocation[Math.floor(Math.random() * mockLocation.length)];

            await busDoc.ref.update({
                last_location_time: admin.firestore.FieldValue.serverTimestamp(),
                last_location_name: randomLocation
            });

            if (managerId) {
                updatesSent++;
            }
        }

        await Promise.all(updates);
        return { updatesSent };

    } catch (error) {
        console.error("CRON JOB FAILED during update loop:", error.message);
        throw error;
    }
}
// (Razorpay function remains the same)
function verifyRazorpaySignature(payload, signature) {
    if (!RAZORPAY_WEBHOOK_SECRET) {
        console.warn("RAZORPAY_WEBHOOK_SECRET is not set. Skipping signature verification.");
        return true;
    }
    const expectedSignature = crypto.createHmac('sha256', RAZORPAY_WEBHOOK_SECRET)
        .update(payload)
        .digest('hex');

    return expectedSignature === signature;
}


/* --------------------- Core Handlers (Adapted for WhatsApp Text Flow) ---------------------- */

async function getUserRole(chatId) {
    try {
        const db = getFirebaseDb();
        const doc = await db.collection('users').doc(String(chatId)).get();
        if (doc.exists) return doc.data().role;
        return 'unregistered';
    } catch (e) {
        console.error('Error fetching user role, assuming error:', e.message);
        return 'error';
    }
}

async function sendHelpMessage(chatId) {
    try {
        const db = getFirebaseDb();
        const userDoc = await db.collection('users').doc(String(chatId)).get();
        const userRole = userDoc.exists ? userDoc.data().role : 'unregistered';

        let helpText = MESSAGES.help + "\n\n*Available Commands:*\n\n";

        if (userRole === 'owner') {
            helpText += "👑 *Owner Commands*:\n`Manage Staff`, `Show Revenue`, `Set Status`, `Setup Aadhar API`, `View Fare Alerts`\n\n";
        }

        if (userRole === 'manager' || userRole === 'owner') {
            helpText += "👨‍💼 *Manager Commands*:\n`Add New Bus`, `Show My Trips`, `Start Tracking`, `Show Manifest`, `Setup Inventory Sync`, `Check-in BOOKID`, `Release seat BUSID SEAT_NO`\n\n";
        }

        if (userRole === 'user' || userRole === 'unregistered') {
            helpText += "👤 *Passenger Commands*:\n`Book a Bus`, `My Bookings`, `Set Fare Alert`\n\n";
        }

        helpText += "🛠️ *General Commands*:\n`My Profile`, `Update Phone`, `Get ticket BOOKID`, `Check status BOOKID`";

        await sendWhatsAppMessage(chatId, helpText);
    } catch (e) {
        console.error("❌ sendHelpMessage failed:", e.message);
        await sendWhatsAppMessage(chatId, "❌ Database error when loading help menu. Please try /start again.");
    }
}

// --- Booking Entry Point ---
async function handleBusSearch(chatId) {
    await handleStartSearch(chatId);
}

// --- Definition for starting the guided search flow (Required by handleBusSearch) ---
async function handleStartSearch(chatId) {
    try {
        await saveAppState(chatId, 'AWAITING_SEARCH_FROM', { step: 1 });
        await sendWhatsAppMessage(chatId, MESSAGES.search_from);

    } catch (e) {
        console.error('Error starting search:', e.message);
        await sendWhatsAppMessage(chatId, MESSAGES.db_error);
    }
}
// -----------------------------------------------------------

// (All other handle* functions remain logically similar, replacing callback logic with simple text input processing)

async function handleShowRevenue(chatId, text) {
    const userRole = await getUserRole(chatId);
    if (userRole !== 'owner') return await sendWhatsAppMessage(chatId, MESSAGES.owner_permission_denied);

    const match = text.match(/show revenue\s+(\d{4}-\d{2}-\d{2})/i);
    const targetDate = match ? match[1] : new Date().toISOString().split('T')[0];

    try {
        const db = getFirebaseDb();
        const snapshot = await db.collection('bookings')
            .where('status', '==', 'confirmed')
            .get();

        let totalRevenue = 0;
        let confirmedCount = 0;

        snapshot.forEach(doc => {
            const data = doc.data();
            const bookingDate = data.created_at ? data.created_at.toDate().toISOString().split('T')[0] : null;

            if (bookingDate === targetDate) {
                totalRevenue += data.total_paid || 0;
                confirmedCount++;
            }
        });

        const response = MESSAGES.revenue_report
            .replace('{date}', targetDate)
            .replace('{count}', confirmedCount)
            .replace('{totalRevenue}', (totalRevenue / 100).toFixed(2));

        await sendWhatsAppMessage(chatId, response);
        return;
    } catch (e) {
        await sendWhatsAppMessage(chatId, MESSAGES.db_error);
    }
}

// --- OWNER: GLOBAL BUS STATUS ---
async function handleSetBusStatus(chatId, text) {
    const userRole = await getUserRole(chatId);
    if (userRole !== 'owner') return await sendWhatsAppMessage(chatId, MESSAGES.owner_permission_denied);

    const match = text.match(/set status\s+(BUS\d+)\s+(scheduled|departed|arrived|maintenance)/i);

    if (!match) return await sendWhatsAppMessage(chatId, MESSAGES.bus_status_invalid);

    const busID = match[1].toUpperCase();
    const newStatus = match[2].toLowerCase();

    try {
        const db = getFirebaseDb();
        const busRef = db.collection('buses').doc(busID);
        const busDoc = await busRef.get();

        if (!busDoc.exists) return await sendWhatsAppMessage(chatId, `❌ Bus ID *${busID}* not found.`);

        const updateData = { status: newStatus };

        if (newStatus === 'maintenance' || newStatus === 'arrived') {
            updateData.is_tracking = false;
        }

        await busRef.update(updateData);
        await sendWhatsAppMessage(chatId, MESSAGES.bus_status_updated.replace('{busID}', busID).replace('{status}', newStatus.toUpperCase()));
        return;

    } catch (e) {
        await sendWhatsAppMessage(chatId, MESSAGES.db_error);
    }
}

// (The remaining handler functions must also be updated to use sendWhatsAppMessage instead of sendMessage)

// ... (Rest of the handler functions: handleCheckIn, handleSeatRelease, handleShowAadharApiConfig, handleFareAlertSetup, handleShowFareAlerts, handleUserProfile, handleUpdatePhoneNumberCallback, handleShowMyTrips, showSearchResults, handleSearchTextInput, handlePhoneUpdateInput, handleGetTicket, handleCheckStatus, handleSeatChangeRequest, handleCancellation, handleShowManifest, handleStartTrackingCommand, handlePassengerTracking, handleStartTrackingFlow, handleManagerAddBus, handleAddSeatsCommand, handleInventorySyncSetup, handleInventorySyncInput, handleStaffDelegation, handleUserShareLocation, handleAadharApiSetupInput, handleTrackingAction are included here with the same logic but updated API calls)

async function handleCheckIn(chatId, text) {
    const userRole = await getUserRole(chatId);
    if (userRole !== 'manager' && userRole !== 'owner') return await sendWhatsAppMessage(chatId, "❌ Permission denied.");

    const match = text.match(/check-in\s+(BOOK\d+)/i);
    if (!match) return await sendWhatsAppMessage(chatId, MESSAGES.checkin_invalid);

    const bookingId = match[1].toUpperCase();

    try {
        const db = getFirebaseDb();
        const bookingRef = db.collection('bookings').doc(bookingId);
        const bookingDoc = await bookingRef.get();

        if (!bookingDoc.exists || bookingDoc.data().status !== 'confirmed') {
            return await sendWhatsAppMessage(chatId, `❌ Booking *${bookingId}* not found or not confirmed.`);
        }

        await bookingRef.update({
            status: 'boarded',
            check_in_time: admin.firestore.FieldValue.serverTimestamp()
        });

        await sendWhatsAppMessage(chatId, MESSAGES.checkin_success.replace('{bookingId}', bookingId));
        return;

    } catch (e) {
        await sendWhatsAppMessage(chatId, MESSAGES.db_error);
    }
}

async function handleSeatRelease(chatId, text) {
    const userRole = await getUserRole(chatId);
    if (userRole !== 'manager' && userRole !== 'owner') return await sendWhatsAppMessage(chatId, "❌ Permission denied.");

    const match = text.match(/release seat\s+(BUS\d+)\s+([A-Z0-9]+)/i);
    if (!match) return await sendWhatsAppMessage(chatId, MESSAGES.seat_release_invalid);

    const busID = match[1].toUpperCase();
    const seatNo = match[2].toUpperCase();
    const seatDocId = `${busID}-${seatNo}`;

    try {
        const db = getFirebaseDb();
        const seatRef = db.collection('seats').doc(seatDocId);
        const seatDoc = await seatRef.get();

        if (!seatDoc.exists || seatDoc.data().status === 'available') {
            return await sendWhatsAppMessage(chatId, `❌ Seat *${seatNo}* on bus *${busID}* is already available or does not exist.`);
        }

        await seatRef.update({
            status: 'available',
            booking_id: admin.firestore.FieldValue.delete(),
            booked_to_destination: admin.firestore.FieldValue.delete(),
            temp_chat_id: admin.firestore.FieldValue.delete(),
            gender: admin.firestore.FieldValue.delete()
        });

        await sendWhatsAppMessage(chatId, MESSAGES.seat_release_success.replace('{seatNo}', seatNo).replace('{busID}', busID));
        return;

    } catch (e) {
        await sendWhatsAppMessage(chatId, MESSAGES.db_error);
    }
}

async function handleShowAadharApiConfig(chatId) {
    const userRole = await getUserRole(chatId);
    if (userRole !== 'manager' && userRole !== 'owner') return await sendWhatsAppMessage(chatId, "❌ Permission denied.");

    try {
        const db = getFirebaseDb();
        const doc = await db.collection('settings').doc('aadhar_verification').get();

        const url = doc.exists ? doc.data().endpoint_url : 'N/A';
        const status = doc.exists && url !== 'N/A' ? '✅ Active' : '🔴 Not Configured';

        const response = MESSAGES.aadhar_api_config_show
            .replace('{url}', url)
            .replace('{status}', status);

        await sendWhatsAppMessage(chatId, response);
        return;

    } catch (e) {
        await sendWhatsAppMessage(chatId, MESSAGES.db_error);
    }
}

async function handleFareAlertSetup(chatId, text) {
    const match = text.match(/alert on\s+([^\s@]+)\s+to\s+([^\s@]+)\s+@\s+(\d{2}:\d{2})/i);
    if (!match) return await sendWhatsAppMessage(chatId, MESSAGES.fare_alert_invalid);

    const from = match[1].trim();
    const to = match[2].trim();
    const time = match[3].trim();

    try {
        const db = getFirebaseDb();
        await db.collection('fare_alerts').add({
            chat_id: String(chatId),
            from: from,
            to: to,
            time: time,
            created_at: admin.firestore.FieldValue.serverTimestamp()
        });

        const response = MESSAGES.fare_alert_set.replace('{from}', from).replace('{to}', to).replace('{time}', time);
        await sendWhatsAppMessage(chatId, response);
        return;

    } catch (e) {
        await sendWhatsAppMessage(chatId, MESSAGES.db_error);
    }
}

async function handleShowFareAlerts(chatId) {
    const userRole = await getUserRole(chatId);
    if (userRole !== 'manager' && userRole !== 'owner') return await sendWhatsAppMessage(chatId, "❌ Permission denied.");

    try {
        const db = getFirebaseDb();
        const snapshot = await db.collection('fare_alerts').orderBy('created_at', 'asc').limit(20).get();

        if (snapshot.empty) {
            return await sendWhatsAppMessage(chatId, "📭 No active fare alerts have been set by any users.");
        }

        let alertList = "🔔 *Active Fare Alerts (Last 20)*\n\n";

        snapshot.docs.forEach((doc, index) => {
            const alert = doc.data();
            const date = alert.created_at ? alert.created_at.toDate().toLocaleString('en-IN') : 'N/A';
            alertList += `${index + 1}. *${alert.from}* → *${alert.to}* @ ${alert.time}\n`;
            alertList += `  Set by Chat ID: \`${alert.chat_id}\`\n`;
            alertList += `  Set On: ${date}\n\n`;
        });

        alertList += "💡 To delete an alert, notify the user or manage the record in the database.";

        await sendWhatsAppMessage(chatId, alertList);
        return;

    } catch (e) {
        console.error("Error fetching fare alerts:", e.message);
        await sendWhatsAppMessage(chatId, MESSAGES.db_error);
    }
}

async function handleUserProfile(chatId) {
    try {
        const db = getFirebaseDb();
        const doc = await db.collection('users').doc(String(chatId)).get();

        if (doc.exists) {
            const user = doc.data();
            const joinDate = user.join_date ? user.join_date.toDate().toLocaleDateString('en-IN') : 'N/A';

            const profileText = `👤 *Your Profile*\n\n` +
                                `*Name:* ${user.name || 'Not set'}\n` +
                                `*Chat ID:* \`${user.chat_id}\`\n` +
                                `*Phone:* ${user.phone || 'Not set'}\n` +
                                `*Aadhar:* ${user.aadhar || 'Not set'}\n` +
                                `*Role:* ${user.role || 'user'}\n` +
                                `*Status:* ${user.status || 'N/A'}\n` +
                                `*Member since:* ${joinDate}`;

            await sendWhatsAppMessage(chatId, profileText);
            return;
        } else {
            await sendWhatsAppMessage(chatId, MESSAGES.user_not_found);
            return;
        }

    } catch (error) {
        await sendWhatsAppMessage(chatId, MESSAGES.db_error);
    }
}

async function handleUpdatePhoneNumberCallback(chatId) {
    const userRole = await getUserRole(chatId);
    if (userRole === 'unregistered' || userRole === 'error') {
        return await sendWhatsAppMessage(chatId, "❌ You must register first to update your profile. Send /start.");
    }

    try {
        await saveAppState(chatId, 'AWAITING_NEW_PHONE', {});
        await sendWhatsAppMessage(chatId, MESSAGES.update_phone_prompt);
        return;
    } catch (e) {
        await sendWhatsAppMessage(chatId, MESSAGES.db_error + " Could not initiate phone update.");
    }
}

async function handleShowMyTrips(chatId) {
    const userRole = await getUserRole(chatId);
    if (userRole !== 'manager' && userRole !== 'owner') {
        return await sendWhatsAppMessage(chatId, "❌ You do not have permission to view trips.");
    }

    try {
        const db = getFirebaseDb();
        const snapshot = await db.collection('buses')
            .where('manager_chat_id', '==', String(chatId))
            .get();

        if (snapshot.empty) {
            return await sendWhatsAppMessage(chatId, MESSAGES.no_active_trips);
        }

        const buses = snapshot.docs.map(doc => doc.data());
        buses.sort((a, b) => (a.departure_time > b.departure_time) ? 1 : -1);

        let tripList = '';
        buses.forEach(data => {
            const date = data.departure_time.split(' ')[0];
            tripList += `\n• *${data.bus_id}*: ${data.from} → ${data.to}\n`;
            tripList += `  Status: *${data.status.toUpperCase()}* | Date: ${date}`;
        });

        const response = MESSAGES.manager_list_trips.replace('{tripList}', tripList);
        await sendWhatsAppMessage(chatId, response);
        return;

    } catch (e) {
        await sendWhatsAppMessage(chatId, MESSAGES.db_error);
    }
}

async function showSearchResults(chatId, from, to, date) {
    try {
        const db = getFirebaseDb();

        const snapshot = await db.collection('buses')
            .where('from', '==', from)
            .where('to', '==', to)
            .get();

        const buses = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            if (data.departure_time.startsWith(date)) {
                 buses.push({
                     busID: data.bus_id, from: data.from, to: data.to,
                     date: data.departure_time.split(' ')[0], time: data.departure_time.split(' ')[1],
                     owner: data.bus_name, price: data.price, busType: data.bus_type,
                     rating: data.rating || 4.2, total_seats: data.total_seats || 40
                 });
            }
        });

        if (buses.length === 0) return await sendWhatsAppMessage(chatId, MESSAGES.no_buses);

        let response = MESSAGES.search_results.replace('{from}', from).replace('{to}', to).replace('{date}', date);

        for (const bus of buses) {
            const seatsSnapshot = await db.collection('seats').where('bus_id', '==', bus.busID).where('status', '==', 'available').get();
            const availableSeats = seatsSnapshot.size;

            response += `*${bus.busID}* - ${bus.owner}\n`;
            response += `🕒 ${bus.time}\n`;
            response += `💰 ₹${bus.price} • ${bus.busType} • ⭐ ${bus.rating}\n`;
            response += `💺 ${availableSeats} seats available\n`;
            response += `📋 Type: "Show seats ${bus.busID}" to view seats\n\n`;
        }
        await sendWhatsAppMessage(chatId, response);
        return;

    } catch (error) {
        await sendWhatsAppMessage(chatId, MESSAGES.db_error);
    }
}

async function handleSeatMap(chatId, text) {
    try {
        const busMatch = text.match(/(BUS\d+)/i);
        const busID = busMatch ? busMatch[1].toUpperCase() : null;

        if (!busID) return await sendWhatsAppMessage(chatId, MESSAGES.specify_bus_id);

        const busInfo = await getBusInfo(busID);
        if (!busInfo) return await sendWhatsAppMessage(chatId, MESSAGES.seat_map_error.replace('{busID}', busID));

        const db = getFirebaseDb();
        const seatsSnapshot = await db.collection('seats').where('bus_id', '==', busID).get();

        if (seatsSnapshot.empty) return await sendWhatsAppMessage(chatId, MESSAGES.no_seats_found.replace('{busID}', busID));

        const seatData = {};
        const availableSeatsList = [];

        let descriptiveLayout = '';
        if (busInfo.busType === 'seater') descriptiveLayout = MESSAGES.bus_layout_seater;
        else if (busInfo.busType === 'sleeper') descriptiveLayout = MESSAGES.bus_layout_sleeper;
        else if (busInfo.busType === 'both') descriptiveLayout = MESSAGES.bus_layout_both;
        else descriptiveLayout = busInfo.busType;

        seatsSnapshot.forEach(doc => {
            const data = doc.data();
            if (!seatData[data.type]) seatData[data.type] = [];
            seatData[data.type].push(data);
        });

        let seatMap = MESSAGES.seat_map_header
            .replace('{busID}', busID)
            .replace('{layout}', descriptiveLayout)
            .replace('{from}', busInfo.from)
            .replace('{to}', busInfo.to)
            .replace('{date}', busInfo.date)
            .replace('{time}', busInfo.time);

        let availableCount = 0;

        for (const type in seatData) {
            seatMap += MESSAGES.seat_map_group_header.replace('{type}', type.toUpperCase());
            seatData[type].sort((a, b) => a.seat_no.localeCompare(b.seat_no));

            seatData[type].forEach(seat => {
                const typeIcon = SEAT_ICONS[type.toLowerCase()] || '🪑';

                let statusIcon = '';
                let destination = '';

                if (seat.status === 'available') {
                    statusIcon = '✅';
                    availableCount++;
                    availableSeatsList.push({
                        seatNo: seat.seat_no,
                        display: seat.seat_no
                    });
                } else {
                    const genderIcon = seat.gender === 'F' ? '🚺' : '🚹';
                    statusIcon = `${genderIcon} ⚫`;
                    destination = seat.booked_to_destination ? ` to ${seat.booked_to_destination}` : '';
                }

                seatMap += MESSAGES.seat_map_list_item
                    .replace('{seatNo}', seat.seat_no.padEnd(3))
                    .replace('{typeIcon}', typeIcon)
                    .replace('{statusIcon}', statusIcon)
                    .replace('{destination}', destination) + '\n';
            });
        }

        seatMap += `\n📊 *${availableCount}* seats available / ${seatsSnapshot.size || 0} total\n`;
        seatMap += availableSeatsList.length > 0 ? "\n👇 *To book, type:* `Book seat {busID} SEAT_NO` (e.g., `Book seat {busID} 3A`)" : "";

        // Replace the placeholder in the booking instruction
        seatMap = seatMap.replace(/{busID}/g, busID);

        await sendWhatsAppMessage(chatId, seatMap);
        return;

    } catch (error) {
        console.error("Error in handleSeatMap:", error.message);
        await sendWhatsAppMessage(chatId, MESSAGES.db_error);
    }
}


async function handleSeatSelection(chatId, text) {
    try {
        const match = text.match(/book seat\s+(BUS\d+)\s+([A-Z0-9]+)/i);
        if (!match) return await sendWhatsAppMessage(chatId, "❌ Please specify Bus ID and Seat Number.\nExample: `Book seat BUS101 3A`");

        const busID = match[1].toUpperCase();
        const seatNo = match[2].toUpperCase();

        await handleBookSeatSelection(chatId, busID, seatNo);
        return;

    } catch (error) {
        console.error("Error in handleSeatSelection:", error.message);
        await sendWhatsAppMessage(chatId, MESSAGES.db_error);
    }
}


async function handleBookSeatSelection(chatId, busID, seatNo) {
    const db = getFirebaseDb();
    const seatRef = db.collection('seats').doc(`${busID}-${seatNo}`);
    const seatDoc = await seatRef.get();

    if (!seatDoc.exists || seatDoc.data().status !== 'available') {
        await saveAppState(chatId, 'IDLE', {});
        return await sendWhatsAppMessage(chatId, MESSAGES.seat_not_available.replace('{seatNo}', seatNo).replace('{busID}', busID));
    }

    const busInfo = await getBusInfo(busID);
    if (!busInfo) return await sendWhatsAppMessage(chatId, "❌ Bus details unavailable for booking.");

    const bookingData = {
        busID,
        seatNo,
        busTo: busInfo.to,
        destination: null,
        boardingPoint: null,
        passengers: [],
    };

    await saveAppState(chatId, 'AWAITING_BOARDING_POINT', bookingData);
    await sendWhatsAppMessage(chatId, MESSAGES.prompt_boarding);
}

async function handleBoardingPointInput(chatId, text, state) {
    const boardingPoint = text.trim();

    if (boardingPoint.length < 3) {
        return await sendWhatsAppMessage(chatId, "❌ Please enter a valid boarding point (at least 3 characters). Try again:");
    }

    const booking = state.data;
    booking.boardingPoint = boardingPoint;

    await saveAppState(chatId, 'AWAITING_DESTINATION', booking);

    await sendWhatsAppMessage(chatId, MESSAGES.prompt_destination.replace('{to}', booking.busTo));
}


async function handleDestinationSelectionInput(chatId, text, state) {
    const booking = state.data;
    const destination = text.trim();

    if (destination.length < 3) {
        return await sendWhatsAppMessage(chatId, "❌ Please enter a valid destination city name (at least 3 characters). Try again:");
    }

    if (!booking.busTo.toLowerCase().includes(destination.toLowerCase())) {
        await sendWhatsAppMessage(chatId, `⚠️ Warning: Your destination *${destination}* is not the final stop (*${booking.busTo}*). This is valid for mid-route drops.`);
    }

    booking.destination = destination;

    await saveAppState(chatId, 'AWAITING_GENDER_SELECTION', booking);

    await sendWhatsAppMessage(chatId, MESSAGES.gender_prompt.replace('{seatNo}', booking.seatNo));
}


async function handleShowLiveLocation(chatId, text) {
    const match = text.match(/show live location\s+(BUS\d+)/i);
    if (!match) return await sendWhatsAppMessage(chatId, "❌ Please specify Bus ID.\nExample: `Show live location BUS101`");

    const busID = match[1].toUpperCase();

    try {
        const db = getFirebaseDb();
        const busDoc = await db.collection('buses').doc(busID).get();

        if (!busDoc.exists || !busDoc.data().is_tracking) {
            return await sendWhatsAppMessage(chatId, MESSAGES.tracking_not_tracking.replace('{busID}', busID));
        }

        const busData = busDoc.data();
        const lastUpdateTime = busData.last_location_time ?
            busData.last_location_time.toDate().toLocaleTimeString('en-IN') : 'N/A';

        const trackingUrl = MOCK_TRACKING_BASE_URL;

        const response = MESSAGES.passenger_tracking_info
            .replace('{busID}', busID)
            .replace('{location}', busData.last_location_name || 'Location update pending')
            .replace('{time}', lastUpdateTime)
            .replace('{trackingUrl}', trackingUrl);

        await sendWhatsAppMessage(chatId, response);
        return;

    } catch (e) {
        await sendWhatsAppMessage(chatId, MESSAGES.db_error);
    }
}

async function handleBookingInput(chatId, text, state) {
    try {
        const booking = state.data;

        if (state.state === 'AWAITING_BOARDING_POINT') {
            await handleBoardingPointInput(chatId, text, state);
            return;
        }

        if (state.state === 'AWAITING_DESTINATION') {
            await handleDestinationSelectionInput(chatId, text, state);
            return;
        }

        if (state.state === 'AWAITING_PASSENGER_DETAILS') {
            const passengerMatch = text.match(/([^\/]+)\s*\/\s*(\d+)\s*\/\s*(\d+)/i);
            if (!passengerMatch) return await sendWhatsAppMessage(chatId, MESSAGES.booking_details_error);

            const name = passengerMatch[1].trim();
            const age = passengerMatch[2].trim();
            const aadhar = passengerMatch[3].trim();

            booking.passengers.push({ name, age, aadhar, gender: booking.gender, seat: booking.seatNo });

            await saveAppState(chatId, 'AWAITING_BOOKING_ACTION', booking);

            const response = MESSAGES.booking_passenger_prompt.replace('{seatNo}', booking.seatNo);
            await sendWhatsAppMessage(chatId, response + "\n\n*Type 1 to Complete Booking or 2 to Add Another Passenger (WIP)*");
            return;
        }
    } catch (error) {
        console.error("Error in handleBookingInput:", error.message);
        await sendWhatsAppMessage(chatId, MESSAGES.db_error);
    }
}

async function handleStaffDelegation(chatId, text) {
    const userRole = await getUserRole(chatId);
    if (userRole !== 'owner') {
        return await sendWhatsAppMessage(chatId, MESSAGES.owner_permission_denied);
    }

    const assignMatch = text.match(/assign manager\s+(\d+)/i);
    const revokeMatch = text.match(/revoke manager\s+(\d+)/i);
    const db = getFirebaseDb();

    let targetChatId, newRole;

    if (assignMatch) {
        targetChatId = assignMatch[1];
        newRole = 'manager';
    } else if (revokeMatch) {
        targetChatId = revokeMatch[1];
        newRole = 'user';
    } else {
        return await sendWhatsAppMessage(chatId, MESSAGES.owner_invalid_format);
    }

    try {
        const targetRef = db.collection('users').doc(targetChatId);
        const targetDoc = await targetRef.get();

        if (!targetDoc.exists) {
            return await sendWhatsAppMessage(chatId, `❌ User with Chat ID *${targetChatId}* is not registered.`);
        }

        await targetRef.update({ role: newRole });

        if (newRole === 'manager') {
            await sendWhatsAppMessage(chatId, MESSAGES.owner_staff_assigned.replace('{chatId}', targetChatId));
        } else {
            await sendWhatsAppMessage(chatId, MESSAGES.owner_staff_revoked.replace('{chatId}', targetChatId));
        }
        return;

    } catch (e) {
        await sendWhatsAppMessage(chatId, MESSAGES.db_error);
    }
}

async function handleUserShareLocation(chatId) {
    await sendWhatsAppMessage(chatId, MESSAGES.user_share_location_wip);
    return;
}

async function handleAadharApiSetupInput(chatId, text) {
    const urlRegex = /^(http|https):\/\/[^ "]+$/;
    const db = getFirebaseDb();

    if (!text.match(urlRegex)) {
        return await sendWhatsAppMessage(chatId, "❌ Invalid URL format. Try again:");
    }

    try {
        await db.collection('settings').doc('aadhar_verification').set({
            endpoint_url: text.trim(),
            updated_at: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        await saveAppState(chatId, 'IDLE', {});
        await sendWhatsAppMessage(chatId, MESSAGES.aadhar_api_success.replace('{url}', text.trim()));
        return;
    } catch (e) {
        await sendWhatsAppMessage(chatId, MESSAGES.db_error + " Failed to save Aadhar API URL.");
    }
}

async function handleStartTrackingFlow(chatId) {
    const userRole = await getUserRole(chatId);
    if (userRole !== 'manager' && userRole !== 'owner') {
        return await sendWhatsAppMessage(chatId, "❌ You do not have permission to start tracking.");
    }

    await saveAppState(chatId, 'MANAGER_TRACKING_BUS_ID', {});
    await sendWhatsAppMessage(chatId, MESSAGES.manager_tracking_prompt);
    return;
}

async function handleTrackingAction(chatId, action, busID) {
    const db = getFirebaseDb();
    const busRef = db.collection('buses').doc(busID);
    const busDoc = await busRef.get();

    if (!busDoc.exists) return await sendWhatsAppMessage(chatId, `❌ Bus ID *${busID}* not found.`);
    const busData = busDoc.data();

    if (action === 'start_live') {
        const state = await getAppState(chatId);
        const data = state.data;

        const durationMs = parseDurationToMs(data.trackingDuration);
        const stopTime = new Date(Date.now() + durationMs);
        const stopTimeStr = stopTime.toLocaleTimeString('en-IN');
        const trackingUrl = MOCK_TRACKING_BASE_URL;

        await busRef.update({
            is_tracking: true,
            status: 'departed',
            last_location_name: data.trackingLocation,
            tracking_stop_time: admin.firestore.Timestamp.fromDate(stopTime),
            last_location_time: admin.firestore.FieldValue.serverTimestamp()
        });

        const lastUpdateTime = new Date().toLocaleTimeString('en-IN');
        await notifyPassengersOfTrackingStart(busID, data.trackingLocation, lastUpdateTime);


        await saveAppState(chatId, 'MANAGER_AWAITING_LIVE_ACTION', { busID: busID });

        const managerMessage = MESSAGES.manager_tracking_started
            .replace('{busID}', busID)
            .replace('{trackingUrl}', trackingUrl)
            .replace('{stopTime}', stopTimeStr);

        await sendWhatsAppMessage(chatId, managerMessage);
        return;


    } else if (action === 'stop') {
        await busRef.update({
            is_tracking: false,
            status: 'arrived',
            tracking_stop_time: admin.firestore.FieldValue.delete(),
        });
        await saveAppState(chatId, 'IDLE', {});
        await sendWhatsAppMessage(chatId, MESSAGES.manager_tracking_stopped.replace('{busID}', busID));
        return;
    }
}

async function handleManagerAddBus(chatId) {
    try {
        const userRole = await getUserRole(chatId);
        if (userRole !== 'manager' && userRole !== 'owner') {
             return await sendWhatsAppMessage(chatId, "❌ You do not have permission to add buses.");
        }

        await saveAppState(chatId, 'MANAGER_ADD_BUS_NUMBER', {});
        await sendWhatsAppMessage(chatId, MESSAGES.manager_add_bus_init);
        return;

    } catch (error) {
        await sendWhatsAppMessage(chatId, MESSAGES.db_error);
    }
}

async function handleManagerInput(chatId, text, state) {
    const db = getFirebaseDb();
    const data = state.data;
    let nextState = '';
    let response = '';

    const timeRegex = /^\d{2}:\d{2}$/;
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    const phoneRegex = /^\d{10}$/;
    const validLayouts = ['seater', 'sleeper', 'both'];
    const validSeatTypes = ['sleeper upper', 'sleeper lower', 'seater'];

    try {
        if (!text || typeof text !== 'string' || text.trim() === '') {
            await saveAppState(chatId, state.state, data);
            return await sendWhatsAppMessage(chatId, "❌ Please provide the required text input for this step.");
        }

        const textLower = text.toLowerCase().trim();

        switch (state.state) {

            case 'MANAGER_TRACKING_BUS_ID':
                const busMatch = text.match(/(BUS\d+)/i);
                const busID = busMatch ? busMatch[1].toUpperCase() : null;

                if (!busID) return await sendWhatsAppMessage(chatId, "❌ Invalid Bus ID format. Try again:");

                const busDoc = await db.collection('buses').doc(busID).get();
                if (!busDoc.exists) return await sendWhatsAppMessage(chatId, `❌ Bus ID *${busID}* not found.`);

                data.busID = busID;
                nextState = 'MANAGER_TRACKING_LOCATION';
                response = MESSAGES.manager_tracking_location_prompt;
                break;

            case 'MANAGER_TRACKING_LOCATION':
                data.trackingLocation = text.trim();
                nextState = 'MANAGER_TRACKING_DURATION';
                response = MESSAGES.manager_tracking_duration_prompt;
                break;

            case 'MANAGER_TRACKING_DURATION':
                const durationMs = parseDurationToMs(text);
                if (durationMs === 0 || durationMs < (15 * 60 * 1000)) {
                    return await sendWhatsAppMessage(chatId, "❌ Invalid or too short duration. Please use format 'X hours' or 'Y minutes' (min 15 min):");
                }

                data.trackingDuration = text.trim();

                // Call the start function to save data and notify passengers
                await handleTrackingAction(chatId, 'start_live', data.busID);

                return;

            case 'MANAGER_ADD_BUS_NUMBER':
                data.busNumber = text.toUpperCase().replace(/[^A-Z0-9\s-]/g, '');
                if (!data.busNumber) return await sendWhatsAppMessage(chatId, "❌ Invalid Bus Number. Try again:");

                nextState = 'MANAGER_ADD_BUS_NAME';
                response = MESSAGES.manager_add_bus_number;
                break;

            case 'MANAGER_ADD_BUS_NAME':
                data.busName = text;
                nextState = 'MANAGER_ADD_BUS_ROUTE';
                response = MESSAGES.manager_add_bus_route;
                break;

            case 'MANAGER_ADD_BUS_ROUTE':
                data.route = text;
                nextState = 'MANAGER_ADD_BUS_PRICE';
                response = MESSAGES.manager_add_bus_price;
                break;

            case 'MANAGER_ADD_BUS_PRICE':
                data.price = parseFloat(text.replace(/[^0-9.]/g, ''));
                if (isNaN(data.price)) return await sendWhatsAppMessage(chatId, "❌ Invalid price. Enter a number (e.g., 850):");

                nextState = 'MANAGER_ADD_BUS_TYPE';
                response = MESSAGES.manager_add_bus_type;
                break;

            case 'MANAGER_ADD_BUS_TYPE':
                data.busLayout = textLower;
                if (!validLayouts.includes(data.busLayout)) return await sendWhatsAppMessage(chatId, MESSAGES.manager_invalid_layout);

                data.seatsToConfigure = [];

                if (data.busLayout === 'sleeper' || data.busLayout === 'both') {
                    data.currentRow = 1;
                    nextState = 'MANAGER_ADD_SEAT_TYPE';
                    response = MESSAGES.manager_add_seat_type.replace('{row}', data.currentRow);
                } else {
                    for (let i = 1; i <= 10; i++) {
                        data.seatsToConfigure.push({ row: i, type: 'seater' });
                    }
                    nextState = 'MANAGER_ADD_BUS_DEPART_DATE';
                    response = MESSAGES.manager_add_bus_depart_date;
                }
                break;

            case 'MANAGER_ADD_SEAT_TYPE':
                const seatTypeInput = textLower;
                const isValidSeatType = validSeatTypes.includes(seatTypeInput);

                if (!isValidSeatType) return await sendWhatsAppMessage(chatId, MESSAGES.manager_invalid_seat_type);

                data.seatsToConfigure.push({
                    row: data.currentRow,
                    type: seatTypeInput
                });

                data.currentRow++;

                if (data.currentRow <= 10) {
                    nextState = 'MANAGER_ADD_SEAT_TYPE';
                    response = MESSAGES.manager_add_seat_type.replace('{row}', data.currentRow);
                } else {
                    nextState = 'MANAGER_ADD_BUS_DEPART_DATE';
                    response = MESSAGES.manager_add_bus_depart_date;
                }
                break;

            case 'MANAGER_ADD_BUS_DEPART_DATE':
                if (!text.match(dateRegex)) return await sendWhatsAppMessage(chatId, "❌ Invalid date format (YYYY-MM-DD). Try again:");
                data.departDate = text;
                nextState = 'MANAGER_ADD_BUS_DEPART_TIME';
                response = MESSAGES.manager_add_bus_depart_time;
                break;

            case 'MANAGER_ADD_BUS_DEPART_TIME':
                if (!text.match(timeRegex)) return await sendWhatsAppMessage(chatId, "❌ Invalid time format (HH:MM). Try again:");
                data.departTime = text;
                nextState = 'MANAGER_ADD_BUS_ARRIVE_TIME';
                response = MESSAGES.manager_add_bus_arrive_time;
                break;

            case 'MANAGER_ADD_BUS_ARRIVE_TIME':
                if (!text.match(timeRegex)) return await sendWhatsAppMessage(chatId, "❌ Invalid time format (HH:MM). Try again:");
                data.arriveTime = text;
                nextState = 'MANAGER_ADD_BUS_MANAGER_PHONE';
                response = MESSAGES.manager_add_bus_manager_phone;
                break;

            case 'MANAGER_ADD_BUS_MANAGER_PHONE':
                data.managerPhone = text.replace(/[^0-9]/g, '');
                if (!data.managerPhone.match(phoneRegex)) return await sendWhatsAppMessage(chatId, "❌ Invalid Phone Number. Enter a 10-digit number:");

                const uniqueBusId = `BUS${Date.now().toString().slice(-6)}`;
                data.uniqueBusId = uniqueBusId;
                data.boardingPoints = [];

                nextState = 'MANAGER_ADD_BUS_BOARDING_POINTS_INIT';
                response = MESSAGES.manager_add_bus_boarding_init;
                await saveAppState(chatId, nextState, data);
                await sendWhatsAppMessage(chatId, response);
                return;

            case 'MANAGER_ADD_BUS_BOARDING_POINTS_INIT':
            case 'MANAGER_ADD_BUS_BOARDING_POINTS_INPUT':
                const pointMatch = text.match(/^([^\/]+)\s*\/\s*(\d{2}:\d{2})$/i);

                if (text.toUpperCase() === 'DONE' || data.boardingPoints.length >= 5) {

                    if (data.boardingPoints.length === 0) {
                        await sendWhatsAppMessage(chatId, "⚠️ No boarding points added. Proceeding without them.");
                    } else if (data.boardingPoints.length >= 5 && text.toUpperCase() !== 'DONE') {
                        await sendWhatsAppMessage(chatId, "⚠️ Max 5 boarding points reached. Proceeding to save.");
                    }

                    // --- FINAL BUS COMMIT ---
                    const userDoc = await db.collection('users').doc(String(chatId)).get();
                    const ownerName = userDoc.exists ? userDoc.data().name : 'System Owner';

                    if (userDoc.exists) {
                        await db.collection('users').doc(String(chatId)).update({ phone: data.managerPhone });
                    }

                    const routeParts = data.route.split(' to ').map(s => s.trim());
                    const from = routeParts[0] || 'Unknown';
                    const to = routeParts.length > 1 ? routeParts[1] : 'Unknown';

                    await db.collection('buses').doc(data.uniqueBusId).set({
                        bus_id: data.uniqueBusId,
                        bus_number: data.busNumber,
                        bus_name: data.busName,
                        owner: ownerName,
                        from: from,
                        to: to,
                        departure_time: `${data.departDate} ${data.departTime}`,
                        arrival_time: data.arriveTime,
                        manager_chat_id: String(chatId),
                        manager_phone: data.managerPhone,
                        price: data.price,
                        bus_type: data.busLayout,
                        seat_configuration: data.seatsToConfigure,
                        boarding_points: data.boardingPoints,
                        total_seats: 40,
                        rating: 5.0,
                        status: 'scheduled',
                        is_tracking: false,
                        last_location_name: from,
                        last_location_time: admin.firestore.FieldValue.serverTimestamp()
                    });

                    await db.collection('user_state').doc(String(chatId)).delete();

                    response = MESSAGES.manager_bus_saved
                        .replace('{busID}', data.uniqueBusId)
                        .replace('{route}', data.route);
                    await sendWhatsAppMessage(chatId, response);
                    return;

                } else if (pointMatch) {
                    const pointName = pointMatch[1].trim();
                    const time = pointMatch[2].trim();
                    data.boardingPoints.push({ name: pointName, time: time });
                    nextState = 'MANAGER_ADD_BUS_BOARDING_POINTS_INPUT';
                    response = MESSAGES.manager_add_bus_boarding_more;

                } else {
                    nextState = state.state;
                    response = MESSAGES.manager_add_bus_boarding_invalid;
                }
                break;

            case 'MANAGER_AADHAR_API_SETUP':
                await handleAadharApiSetupInput(chatId, text);
                return;

            case 'MANAGER_SYNC_SETUP_BUSID':
            case 'MANAGER_SYNC_SETUP_URL':
                await handleInventorySyncInput(chatId, text, state);
                return;

        }

        await saveAppState(chatId, nextState, data);
        await sendWhatsAppMessage(chatId, response);

    } catch (error) {
        console.error("Manager Input Error:", error.message);
        await db.collection('user_state').doc(String(chatId)).delete();
        await sendWhatsAppMessage(chatId, MESSAGES.db_error + " (A critical operation failed. Try again or check the format.)");
    }
}

async function startUserRegistration(chatId, user) {
    try {
        const db = getFirebaseDb();
        const doc = await db.collection('users').doc(String(chatId)).get();

        if (doc.exists) {
            const userName = user.first_name || 'User';
            await sendWhatsAppMessage(chatId, MESSAGES.welcome_back.replace('{name}', userName));
            await sendHelpMessage(chatId);
        } else {
            await sendWhatsAppMessage(chatId, MESSAGES.prompt_role);
            await saveAppState(chatId, 'AWAITING_ROLE_SELECTION', {});
        }
    } catch (error) {
        await sendWhatsAppMessage(chatId, MESSAGES.db_error + " (Check FIREBASE_CREDS_BASE64/Permissions. Error: " + error.message + ")");
    }
}

async function handleRoleSelectionInput(chatId, user, text) {
    const roleMap = {
        '1': 'user',
        '2': 'manager',
        '3': 'owner'
    };
    const roleKey = text.trim();
    const role = roleMap[roleKey];

    if (!role) {
        return await sendWhatsAppMessage(chatId, "❌ Invalid selection. Please reply with *1*, *2*, or *3*.");
    }

    try {
        const db = getFirebaseDb();
        const newUser = {
            user_id: 'USER' + Date.now(),
            name: user.first_name + (user.last_name ? ' ' + user.last_name : ''),
            chat_id: String(chatId),
            phone: '', aadhar: '',
            status: 'pending_details',
            role: role, lang: 'en',
            join_date: admin.firestore.FieldValue.serverTimestamp()
        };
        await db.collection('users').doc(String(chatId)).set(newUser);

        await saveAppState(chatId, 'AWAITING_PROFILE_DETAILS', { role: role });

        await sendWhatsAppMessage(chatId, MESSAGES.registration_started.replace('{role}', role));
        return;
    } catch (error) {
        await sendWhatsAppMessage(chatId, MESSAGES.db_error);
    }
}


async function handleAddSeatsCommand(chatId, text) {
    const match = text.match(/add seats\s+(BUS\d+)\s+(\d+)/i);
    if (!match) return await sendWhatsAppMessage(chatId, MESSAGES.manager_seats_invalid);

    const userRole = await getUserRole(chatId);
    if (userRole !== 'manager' && userRole !== 'owner') {
             return await sendWhatsAppMessage(chatId, "❌ You do not have permission to add seats.");
    }

    const busID = match[1].toUpperCase();
    const count = parseInt(match[2], 10);

    if (count > 40 || count < 1) return await sendWhatsAppMessage(chatId, "❌ Seat count must be between 1 and 40.");

    try {
        const db = getFirebaseDb();
        const busDoc = await db.collection('buses').doc(busID).get();
        if (!busDoc.exists) return await sendWhatsAppMessage(chatId, `❌ Bus ID ${busID} does not exist. Please create it first.`);

        const busData = busDoc.data();
        const config = busData.seat_configuration || [];
        if (config.length === 0) return await sendWhatsAppMessage(chatId, `❌ Bus ${busID} configuration missing. Please complete the bus creation flow.`);

        await busDoc.ref.update({ total_seats: count });

        const batch = db.batch();
        let seatsAdded = 0;

        const seatCols = ['A', 'B', 'C', 'D'];

        for (const rowConfig of config) {
            if (seatsAdded >= count) break;

            const rowIndex = rowConfig.row;
            const seatType = rowConfig.type;

            const colsForThisRow = seatCols;

            for (let col of colsForThisRow) {
                if (seatsAdded >= count) break;

                const seatNo = `${rowIndex}${col}`;
                const docId = `${busID}-${seatNo}`;
                const seatRef = db.collection('seats').doc(docId);

                batch.set(seatRef, {
                    bus_id: busID,
                    seat_no: seatNo,
                    status: 'available',
                    gender: null,
                    type: seatType,
                    row: rowIndex,
                    col: col,
                    booked_to_destination: null
                });
                seatsAdded++;
            }
        }

        await batch.commit();
        await sendWhatsAppMessage(chatId, MESSAGES.manager_seats_saved.replace('{busID}', busID));
        return;

    } catch (error) {
        console.error("Error in handleAddSeatsCommand:", error.message);
        await sendWhatsAppMessage(chatId, MESSAGES.db_error + " Seat creation failed.");
    }
}

async function handleInventorySyncSetup(chatId) {
    const userRole = await getUserRole(chatId);
    if (userRole !== 'manager' && userRole !== 'owner') {
             return await sendWhatsAppMessage(chatId, "❌ You do not have permission to manage inventory sync.");
    }

    await saveAppState(chatId, 'MANAGER_SYNC_SETUP_BUSID', {});
    await sendWhatsAppMessage(chatId, MESSAGES.sync_setup_init);
    return;
}

async function handleInventorySyncInput(chatId, text, state) {
    const db = getFirebaseDb();
    const data = state.data;
    let nextState = '';
    let response = '';
    const urlRegex = /^(http|https):\/\/[^ "]+$/;

    try {
        switch (state.state) {
            case 'MANAGER_SYNC_SETUP_BUSID':
                data.busID = text.toUpperCase().replace(/[^A-Z0-9]/g, '');
                const busDoc = await db.collection('buses').doc(data.busID).get();
                if (!busDoc.exists) return await sendWhatsAppMessage(chatId, `❌ Bus ID ${data.busID} does not exist. Please create it first.`);

                nextState = 'MANAGER_SYNC_SETUP_URL';
                response = MESSAGES.sync_setup_url.replace('{busID}', data.busID);
                break;

            case 'MANAGER_SYNC_SETUP_URL':
                data.syncUrl = text.trim();
                if (!data.syncUrl.match(urlRegex)) return await sendWhatsAppMessage(chatId, "❌ Invalid URL format. Must start with http:// or https://. Try again:");

                await db.collection('buses').doc(data.busID).update({
                    osp_api_endpoint: data.syncUrl,
                    sync_status: 'Pending Sync',
                    last_sync_attempt: admin.firestore.FieldValue.serverTimestamp()
                });

                await saveAppState(chatId, 'IDLE', {});

                response = MESSAGES.sync_success.replace('{busID}', data.busID).replace('{url}', data.syncUrl);
                await sendWhatsAppMessage(chatId, response);
                return;
        }

        await saveAppState(chatId, nextState, data);
        await sendWhatsAppMessage(chatId, response);

    } catch (error) {
        console.error("Inventory Sync Input Error:", error.message);
        await sendWhatsAppMessage(chatId, MESSAGES.db_error + " (Inventory sync failed. Try again.)");
    }
}

async function handleProfileUpdate(chatId, text) {
    const match = text.match(/my profile details\s+([^/]+)\s*\/\s*([^/]+)\s*\/\s*(\d+)/i);
    if (!match) return await sendWhatsAppMessage(chatId, MESSAGES.profile_update_error);

    const [_, name, aadhar, phone] = match;
    const db = getFirebaseDb();

    try {
        const userRef = db.collection('users').doc(String(chatId));
        const userDoc = await userRef.get();

        if (!userDoc.exists) return await startUserRegistration(chatId, { first_name: name.trim() });

        await userRef.update({
            name: name.trim(),
            aadhar: aadhar.trim(),
            phone: phone.trim(),
            status: 'active'
        });

        await saveAppState(chatId, 'IDLE', {});

        await sendWhatsAppMessage(chatId, MESSAGES.profile_updated);
        await sendHelpMessage(chatId);

    } catch (e) {
        await sendWhatsAppMessage(chatId, MESSAGES.db_error);
    }
}

async function handleSearchTextInput(chatId, text, state) {
    const db = getFirebaseDb();
    let data = state.data;
    const city = text.trim();
    let nextState = '';
    let response = '';

    if (!city) return await sendWhatsAppMessage(chatId, "❌ Please type a city name.");

    if (state.state === 'AWAITING_SEARCH_FROM') {
        data.from = city;

        const snapshot = await db.collection('buses').where('from', '==', city).get();
        const availableDestinations = new Set();
        snapshot.forEach(doc => availableDestinations.add(doc.data().to));

        const dests = Array.from(availableDestinations).sort();

        if (dests.length === 0) {
            return await sendWhatsAppMessage(chatId, MESSAGES.search_route_not_found.replace('{city}', city));
        }

        nextState = 'AWAITING_SEARCH_TO';
        response = MESSAGES.search_to;
        response += "\n\n*Available Destinations:* " + dests.join(', ');

    } else if (state.state === 'AWAITING_SEARCH_TO') {
        data.to = city;

        nextState = 'AWAITING_SEARCH_DATE';
        response = MESSAGES.search_date;

    } else if (state.state === 'AWAITING_SEARCH_DATE') {
        let targetDate;
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

        if (city.toLowerCase() === 'today') {
            targetDate = new Date().toISOString().split('T')[0];
        } else if (city.toLowerCase() === 'tomorrow') {
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            targetDate = tomorrow.toISOString().split('T')[0];
        } else if (city.match(dateRegex)) {
            targetDate = city;
        } else {
            return await sendWhatsAppMessage(chatId, "❌ Invalid input. Please use YYYY-MM-DD format (e.g., 2025-12-25) or type *'Today'* or *'Tomorrow'*.");
        }

        data.date = targetDate;
        await saveAppState(chatId, 'IDLE', {});
        return await showSearchResults(chatId, data.from, data.to, data.date);
    }

    await saveAppState(chatId, nextState, data);
    await sendWhatsAppMessage(chatId, response);
}

async function handlePhoneUpdateInput(chatId, text) {
    const phone = text.replace(/[^0-9]/g, '');
    const phoneRegex = /^\d{10}$/;

    if (!phone.match(phoneRegex)) {
        return await sendWhatsAppMessage(chatId, MESSAGES.phone_invalid);
    }

    try {
        const db = getFirebaseDb();
        await db.collection('users').doc(String(chatId)).update({ phone: phone });

        await saveAppState(chatId, 'IDLE', {});
        await sendWhatsAppMessage(chatId, MESSAGES.phone_updated_success);
        await sendHelpMessage(chatId);
    } catch (e) {
        await sendWhatsAppMessage(chatId, MESSAGES.db_error);
    }
}

async function handleGetTicket(chatId, text) {
    const match = text.match(/get ticket\s+(BOOK\d+)/i);
    if (!match) return await sendWhatsAppMessage(chatId, "❌ Please specify Booking ID.\nExample: `Get ticket BOOK123456`");

    const bookingId = match[1].toUpperCase();

    try {
        const db = getFirebaseDb();
        const doc = await db.collection('bookings').doc(bookingId).get();

        if (!doc.exists || doc.data().status !== 'confirmed') {
            return await sendWhatsAppMessage(chatId, MESSAGES.ticket_not_found.replace('{bookingId}', bookingId));
        }

        const booking = doc.data();
        const busInfo = await getBusInfo(booking.busID);
        if (!busInfo) return await sendWhatsAppMessage(chatId, "❌ Bus information is unavailable.");

        const passengerDestination = booking.seats[0].booked_to_destination || busInfo.to;
        const boardingPoint = booking.boarding_point || 'N/A';

        const response = MESSAGES.payment_confirmed_ticket
            .replace('{busName}', busInfo.busName || 'N/A')
            .replace('{busType}', busInfo.busType || 'N/A')
            .replace('{from}', busInfo.from)
            .replace('{to}', busInfo.to)
            .replace('{journeyDate}', busInfo.date)
            .replace('{departTime}', busInfo.time)
            .replace('{seatList}', booking.seats.map(s => s.seatNo).join(', '))
            .replace('{boardingPoint}', boardingPoint)
            .replace('{destination}', passengerDestination)
            .replace('{name}', booking.passengers[0].name)
            .replace('{phone}', booking.phone)
            .replace('{orderId}', booking.razorpay_order_id)
            .replace('{amount}', (booking.total_paid / 100).toFixed(2))
            .replace('{dateTime}', booking.created_at.toDate().toLocaleString('en-IN'));

        await sendWhatsAppMessage(chatId, response);
    } catch (e) {
        console.error("Error in handleGetTicket:", e.message);
        await sendWhatsAppMessage(chatId, MESSAGES.db_error);
    }
}

async function handleCheckStatus(chatId, text) {
    const match = text.match(/check status\s+(BOOK\d+)/i);
    if (!match) return await sendWhatsAppMessage(chatId, "❌ Please specify Booking ID.\nExample: `Check status BOOK123456`");

    const bookingId = match[1].toUpperCase();

    try {
        const db = getFirebaseDb();
        const doc = await db.collection('bookings').doc(bookingId).get();

        if (!doc.exists) {
            return await sendWhatsAppMessage(chatId, MESSAGES.ticket_not_found.replace('{bookingId}', bookingId));
        }

        const booking = doc.data();

        const response = MESSAGES.booking_status_info
            .replace('{bookingId}', bookingId)
            .replace('{busID}', booking.busID)
            .replace('{seats}', booking.seats.map(s => s.seatNo).join(', '))
            .replace('{status}', booking.status.toUpperCase())
            .replace('{date}', booking.created_at.toDate().toLocaleDateString('en-IN'));

        await sendWhatsAppMessage(chatId, response);
    } catch (e) {
        await sendWhatsAppMessage(chatId, MESSAGES.db_error);
    }
}

async function handleSeatChangeRequest(chatId, text) {
    const match = text.match(/request seat change\s+(BOOK\d+)\s+([A-Z0-9]+)/i);
    if (!match) return await sendWhatsAppMessage(chatId, MESSAGES.seat_change_invalid);

    const bookingId = match[1].toUpperCase();
    const newSeat = match[2].toUpperCase();

    const response = MESSAGES.seat_change_wip
        .replace('{bookingId}', bookingId)
        .replace('{newSeat}', newSeat);

    await sendWhatsAppMessage(chatId, response);
}

async function handleCancellation(chatId, text) {
    const match = text.match(/cancel booking\s+(BOOK\d+)/i);
    if (!match) return await sendWhatsAppMessage(chatId, "❌ Please specify Booking ID.\nExample: `Cancel booking BOOK123456`");

    const bookingId = match[1].toUpperCase();

    try {
        const db = getFirebaseDb();
        const bookingRef = db.collection('bookings').doc(bookingId);
        const bookingDoc = await bookingRef.get();
        const booking = bookingDoc.data();

        if (!bookingDoc.exists || booking.status !== 'confirmed') {
            return await sendWhatsAppMessage(chatId, `❌ Booking *${bookingId}* is not confirmed or does not exist.`);
        }

        const seatsToRelease = booking.seats.map(s => s.seatNo);
        const batch = db.batch();
        seatsToRelease.forEach(seat => {
            const seatRef = db.collection('seats').doc(`${booking.busID}-${seat}`);
            batch.update(seatRef, {
                status: 'available',
                booking_id: admin.firestore.FieldValue.delete(),
                booked_to_destination: admin.firestore.FieldValue.delete(),
                gender: admin.firestore.FieldValue.delete()
            });
        });
        await batch.commit();

        await bookingRef.update({
            status: 'cancelled',
            cancellation_time: admin.firestore.FieldValue.serverTimestamp()
        });

        const now = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
        await sendManagerNotification(booking.busID, 'CANCELLATION', {
            bookingId: bookingId,
            seats: seatsToRelease,
            dateTime: now
        });

        await sendWhatsAppMessage(chatId, MESSAGES.booking_cancelled.replace('{bookingId}', bookingId).replace('{dateTime}', now));
    } catch (e) {
        await sendWhatsAppMessage(chatId, MESSAGES.db_error);
    }
}

async function handleShowManifest(chatId, text) {
    const userRole = await getUserRole(chatId);
    if (userRole !== 'manager' && userRole !== 'owner') return await sendWhatsAppMessage(chatId, "❌ Permission denied.");

    const match = text.match(/show manifest\s+(BUS\d+)/i);
    if (!match) return await sendWhatsAppMessage(chatId, "❌ Please specify Bus ID.\nExample: `Show manifest BUS101`");

    const busID = match[1].toUpperCase();

    try {
        const db = getFirebaseDb();
        const busDoc = await db.collection('buses').doc(busID).get();
        if (!busDoc.exists) return await sendWhatsAppMessage(chatId, `❌ Bus ID *${busID}* not found.`);

        const bookingSnapshot = await db.collection('bookings')
            .where('busID', '==', busID)
            .where('status', '==', 'confirmed')
            .get();

        if (bookingSnapshot.empty) {
            return await sendWhatsAppMessage(chatId, MESSAGES.no_manifest.replace('{busID}', busID));
        }

        let manifest = MESSAGES.manifest_header
            .replace('{busID}', busID)
            .replace('{from}', busDoc.data().from)
            .replace('{to}', busDoc.data().to)
            .replace('{date}', busDoc.data().departure_time.split(' ')[0])
            .replace('{count}', bookingSnapshot.size);

        bookingSnapshot.forEach(doc => {
            const booking = doc.data();
            booking.passengers.forEach(p => {
                manifest += MESSAGES.manifest_entry
                    .replace('{seat}', p.seat)
                    .replace('{name}', p.name)
                    .replace('{aadhar}', p.aadhar.slice(-4))
                    .replace('{gender}', p.gender === 'F' ? '(Female 🚺)' : '(Male 🚹)');
            });
        });

        await sendWhatsAppMessage(chatId, manifest);
    } catch (e) {
        await sendWhatsAppMessage(chatId, MESSAGES.db_error);
    }
}

async function handleStartTrackingCommand(chatId, text) {
    const match = text.match(/start tracking\s+(BUS\d+)/i);
    const userRole = await getUserRole(chatId);

    if (userRole !== 'manager' && userRole !== 'owner') return await sendWhatsAppMessage(chatId, "❌ Permission denied.");

    if (match) {
        const busID = match[1].toUpperCase();

        await saveAppState(chatId, 'MANAGER_TRACKING_LOCATION', { busID: busID });
        return await sendWhatsAppMessage(chatId, MESSAGES.manager_tracking_location_prompt);
    } else {
        await handleStartTrackingFlow(chatId);
    }
}

async function handlePassengerTracking(chatId, text) {
    const match = text.match(/track bus\s+(BUS\d+)/i);
    if (!match) return await sendWhatsAppMessage(chatId, "❌ Please specify Bus ID.\nExample: `Track bus BUS101`");

    await handleShowLiveLocation(chatId, text);
}

async function handleGenderSelectionInput(chatId, text, state) {
    const genderInput = text.trim().toUpperCase();
    const gender = (genderInput === 'M' || genderInput === 'MALE') ? 'M' :
                   (genderInput === 'F' || genderInput === 'FEMALE') ? 'F' : null;

    if (!gender) return await sendWhatsAppMessage(chatId, "❌ Invalid input. Please reply with *M* or *F*.");

    const db = getFirebaseDb();
    const booking = state.data;
    const { busID, seatNo, destination } = booking;
    const seatRow = seatNo.slice(0, -1);
    const seatCol = seatNo.slice(-1);

    // 1. Safety Check (Only for Male Passengers booking next to Female)
    if (gender === 'M') {
        let adjacentSeatNo = null;
        if (seatCol === 'A') adjacentSeatNo = `${seatRow}B`;
        else if (seatCol === 'B') adjacentSeatNo = `${seatRow}A`;
        else if (seatCol === 'C') adjacentSeatNo = `${seatRow}D`;
        else if (seatCol === 'D') adjacentSeatNo = `${seatRow}C`;

        if (adjacentSeatNo) {
            const adjacentSeatDoc = await db.collection('seats').doc(`${busID}-${adjacentSeatNo}`).get();
            const adjacentSeatData = adjacentSeatDoc.data();

            if (adjacentSeatDoc.exists && (adjacentSeatData.status === 'booked' || adjacentSeatData.status === 'locked') && adjacentSeatData.gender === 'F') {
                await unlockSeats({ busID, seats: [{ seatNo }] });
                await saveAppState(chatId, 'IDLE', {});
                return await sendWhatsAppMessage(chatId, MESSAGES.safety_violation.replace('{seatNo}', seatNo));
            }
        }
    }

    // 2. Lock the seat and save gender and booked destination
    const seatRef = db.collection('seats').doc(`${busID}-${seatNo}`);
    await seatRef.update({
        status: 'locked',
        booked_to_destination: destination,
        temp_chat_id: String(chatId),
        gender: gender
    });

    booking.gender = gender;

    await saveAppState(chatId, 'AWAITING_PASSENGER_DETAILS', booking);
    await sendWhatsAppMessage(chatId, MESSAGES.details_prompt);
}

async function handleAddPassengerInput(chatId, text, state) {
    if (text.trim() === '1') {
        // Complete Booking
        await createPaymentOrder(chatId, state.data);
    } else if (text.trim() === '2') {
        // Add Passenger (WIP)
        await saveAppState(chatId, 'IDLE', {});
        await sendWhatsAppMessage(chatId, MESSAGES.feature_wip + " Multi-seat selection coming soon! Please complete your current booking.");
    } else {
        await sendWhatsAppMessage(chatId, "❌ Invalid reply. Please type *1* to complete or *2* to add passenger (WIP).");
    }
}

async function createPaymentOrder(chatId, bookingData) {
    try {
        const db = getFirebaseDb();
        const busInfo = await getBusInfo(bookingData.busID);
        if (!busInfo) return await sendWhatsAppMessage(chatId, "❌ Bus not found for payment.");

        const amount = busInfo.price * bookingData.passengers.length * 100;

        // 1. Create Razorpay Order
        const order = await razorpay.orders.create({
            amount: amount,
            currency: "INR",
            receipt: `rcpt_${chatId}_${Date.now()}`,
            notes: {
                chatId: String(chatId),
                busID: bookingData.busID,
            }
        });

        if (!order || !order.id) {
            throw new Error("Razorpay returned an invalid or empty order object. Check API keys and permissions.");
        }

        // 2. Save payment session data
        const uniqueBookingId = `BOOK${Date.now().toString().slice(-6)}`;
        const userDoc = await db.collection('users').doc(String(chatId)).get();
        const userData = userDoc.data() || {};

        const finalBookingData = {
            chat_id: String(chatId),
            busID: bookingData.busID,
            boarding_point: bookingData.boardingPoint,
            seats: bookingData.passengers.map(p => ({ seatNo: p.seat, gender: p.gender, booked_to_destination: bookingData.destination })),
            passengers: bookingData.passengers,
            total_paid: amount,
            razorpay_order_id: order.id,
            status: 'pending_payment',
            phone: userData.phone || 'N/A',
            bookingId: uniqueBookingId
        };

        await db.collection('payment_sessions').doc(order.id).set({ booking: finalBookingData });

        await saveAppState(chatId, 'AWAITING_PAYMENT', {
            razorpay_order_id: order.id,
            busID: bookingData.busID,
            seats: finalBookingData.seats,
            bookingId: uniqueBookingId
        });

        const paymentUrl = `https://rzp.io/i/${order.id}`;

        const response = MESSAGES.payment_required
            .replace('{amount}', (amount / 100).toFixed(2))
            .replace('{orderId}', order.id)
            .replace('{paymentUrl}', paymentUrl);

        await sendWhatsAppMessage(chatId, response + "\n\n*Type 'Confirm Payment' after paying, or 'Cancel Booking'.*");

    } catch (e) {
        console.error("Razorpay Error:", e.message);
        await unlockSeats({ busID: bookingData.busID, seats: [{ seatNo: bookingData.seatNo }] });
        await saveAppState(chatId, 'IDLE', {});
        await sendWhatsAppMessage(chatId, "❌ Failed to create payment order. Seats released. Check your server logs for the full error.");
    }
}

async function handlePaymentVerification(chatId, stateData) {
    const orderId = stateData.razorpay_order_id;
    const db = getFirebaseDb();

    try {
        const sessionDoc = await db.collection('payment_sessions').doc(orderId).get();

        if (!sessionDoc.exists) {
            return await sendWhatsAppMessage(chatId, `✅ Your payment might have already been processed! Please use "Get ticket ${stateData.bookingId || 'BOOKID'}" or check your tickets.`);
        }

        const response = MESSAGES.payment_awaiting.replace('{orderId}', orderId) + "\n\n(We are waiting for the Razorpay webhook for final confirmation.)";
        await sendWhatsAppMessage(chatId, response);

    } catch (e) {
        console.error("Verification Error:", e.message);
        await sendWhatsAppMessage(chatId, "❌ An error occurred while verifying payment status. Please try again later.");
    }
}

async function handlePaymentCancelInput(chatId) {
    const state = await getAppState(chatId);
    if (state.state !== 'AWAITING_PAYMENT') return await sendWhatsAppMessage(chatId, "❌ No active payment session to cancel.");

    try {
        await unlockSeats(state.data);
        const db = getFirebaseDb();
        if (state.data.razorpay_order_id) {
            await db.collection('payment_sessions').doc(state.data.razorpay_order_id).delete();
        }
        await saveAppState(chatId, 'IDLE', {});
        await sendWhatsAppMessage(chatId, MESSAGES.session_cleared);
    } catch (e) {
        await sendWhatsAppMessage(chatId, MESSAGES.db_error + " Cancellation failed.");
    }
}

async function commitFinalBookingBatch(chatId, bookingData) {
    const db = getFirebaseDb();
    const batch = db.batch();
    const orderId = bookingData.razorpay_order_id;
    const bookingId = bookingData.bookingId;
    const now = admin.firestore.FieldValue.serverTimestamp();
    const nowReadable = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

    try {
        // 1. Update Seats
        bookingData.seats.forEach(seat => {
            const seatRef = db.collection('seats').doc(`${bookingData.busID}-${seat.seatNo}`);
            batch.update(seatRef, {
                status: 'booked',
                booking_id: bookingId,
                booked_to_destination: seat.booked_to_destination,
                temp_chat_id: admin.firestore.FieldValue.delete()
            });
        });

        // 2. Create Final Booking Record
        const bookingRef = db.collection('bookings').doc(bookingId);
        batch.set(bookingRef, {
            ...bookingData,
            status: 'confirmed',
            created_at: now
        });

        // 3. Delete Payment Session
        batch.delete(db.collection('payment_sessions').doc(orderId));

        // 4. Clear App State (Only if triggered by manual user verification)
        if (chatId) {
            batch.delete(db.collection('user_state').doc(String(chatId)));
        }

        await batch.commit();

        // 5. Send Notifications (Outside of batch)
        const busInfo = await getBusInfo(bookingData.busID);
        const seatsList = bookingData.seats.map(s => s.seatNo).join(', ');
        const passengerDestination = bookingData.seats[0].booked_to_destination || busInfo.to;
        const boardingPoint = bookingData.boarding_point || 'N/A';


        const response = MESSAGES.payment_confirmed_ticket
            .replace('{busName}', busInfo.busName || 'N/A')
            .replace('{busType}', busInfo.busType || 'N/A')
            .replace('{from}', busInfo.from)
            .replace('{to}', busInfo.to)
            .replace('{journeyDate}', busInfo.date)
            .replace('{departTime}', busInfo.time)
            .replace('{seatList}', seatsList)
            .replace('{boardingPoint}', boardingPoint)
            .replace('{destination}', passengerDestination)
            .replace('{name}', bookingData.passengers[0].name)
            .replace('{phone}', bookingData.phone)
            .replace('{orderId}', orderId)
            .replace('{amount}', (bookingData.total_paid / 100).toFixed(2))
            .replace('{dateTime}', nowReadable);

        if (chatId) {
             await sendWhatsAppMessage(chatId, response);
        }

        await sendManagerNotification(bookingData.busID, 'BOOKING', {
            seats: bookingData.seats,
            passengerName: bookingData.passengers[0].name,
            dateTime: nowReadable
        });

    } catch (e) {
        console.error("CRITICAL: Failed to commit final booking batch for order:", orderId, e.message);
        if (chatId) await sendWhatsAppMessage(chatId, MESSAGES.db_error + " (Booking failed, contact support with Order ID: " + orderId + ")");
    }
}

async function handleBookingInfo(chatId) {
    try {
        const db = getFirebaseDb();
        const snapshot = await db.collection('bookings')
            .where('chat_id', '==', String(chatId))
            .where('status', 'in', ['confirmed', 'boarded', 'pending_payment'])
            .orderBy('created_at', 'desc')
            .limit(10)
            .get();

        if (snapshot.empty) {
            return await sendWhatsAppMessage(chatId, MESSAGES.no_bookings);
        }

        let bookingList = "🎫 *Your Recent Bookings:*\n\n";

        snapshot.docs.forEach(doc => {
            const booking = doc.data();
            const date = booking.created_at ? booking.created_at.toDate().toLocaleDateString('en-IN') : 'N/A';
            const seats = booking.seats.map(s => s.seatNo).join(', ');

            bookingList += `• *${doc.id}* (${booking.busID})\n`;
            bookingList += `  Route: ${booking.passengers[0].name} @ ${seats}\n`;
            bookingList += `  Status: *${booking.status.toUpperCase()}* on ${date}\n\n`;
        });

        await sendWhatsAppMessage(chatId, bookingList + '💡 Use "Get ticket BOOKID" or "Check status BOOKID".');

    } catch (e) {
        console.error("handleBookingInfo Error:", e.message);
        await sendWhatsAppMessage(chatId, MESSAGES.db_error);
    }
}

/* --------------------- Message Router ---------------------- */

async function handleUserMessage(chatId, text, user) {
    const textLower = text ? text.toLowerCase().trim() : '';
    let state;

    // --- GLOBAL COMMANDS (Check first to allow flow breaking/reset) ---
    if (textLower === '/start' || textLower === '/help' || textLower === 'help') {
        try {
            state = await getAppState(chatId);
            if (state.state === 'AWAITING_PAYMENT' && state.data.busID) {
                await unlockSeats(state.data);
                const db = getFirebaseDb();
                if (state.data.razorpay_order_id) {
                    await db.collection('payment_sessions').doc(state.data.razorpay_order_id).delete();
                }
                await saveAppState(chatId, 'IDLE', {});
                await sendWhatsAppMessage(chatId, MESSAGES.session_cleared);
            } else if (state.state !== 'IDLE') {
                await saveAppState(chatId, 'IDLE', {});
            }
        } catch (e) {
            console.error('Error during global command cleanup:', e.message);
        }

        if (textLower === '/start') {
            await startUserRegistration(chatId, user);
        } else {
            await sendHelpMessage(chatId);
        }
        return;
    }


    // --- STATE MANAGEMENT CHECK (Handles sequential input) ---
    try {
        state = await getAppState(chatId);
    } catch (e) {
        await sendWhatsAppMessage(chatId, MESSAGES.db_error + " (State check failed)");
        return;
    }

    if (state.state !== 'IDLE') {
        // Registration Flow
        if (state.state === 'AWAITING_ROLE_SELECTION') {
            await handleRoleSelectionInput(chatId, user, text);
            return;
        }
        if (state.state === 'AWAITING_PROFILE_DETAILS' && textLower.startsWith('my profile details')) {
            await handleProfileUpdate(chatId, text);
            return;
        }

        // Search Flow
        if (state.state.startsWith('AWAITING_SEARCH')) {
            await handleSearchTextInput(chatId, text, state);
            return;
        }

        // Booking Flow
        if (state.state === 'AWAITING_BOARDING_POINT' || state.state === 'AWAITING_DESTINATION') {
            await handleBookingInput(chatId, text, state);
            return;
        }
        if (state.state === 'AWAITING_GENDER_SELECTION') {
            await handleGenderSelectionInput(chatId, text, state);
            return;
        }
        if (state.state === 'AWAITING_PASSENGER_DETAILS') {
            await handleBookingInput(chatId, text, state);
            return;
        }
        if (state.state === 'AWAITING_BOOKING_ACTION') {
            await handleAddPassengerInput(chatId, text, state);
            return;
        }

        // Manager Flow
        if (state.state.startsWith('MANAGER_ADD_BUS') || state.state.startsWith('MANAGER_ADD_SEAT') || state.state.startsWith('MANAGER_TRACKING') || state.state.startsWith('MANAGER_AADHAR_API_SETUP') || state.state.startsWith('MANAGER_SYNC_SETUP')) {
            await handleManagerInput(chatId, text, state);
            return;
        }

        // Phone Update
        if (state.state === 'AWAITING_NEW_PHONE') {
            await handlePhoneUpdateInput(chatId, text);
            return;
        }

        // Payment Awaiting
        if (state.state === 'AWAITING_PAYMENT') {
            if (textLower === 'confirm payment') {
                await handlePaymentVerification(chatId, state.data);
            } else if (textLower === 'cancel booking') {
                await handlePaymentCancelInput(chatId);
            } else {
                 await sendWhatsAppMessage(chatId, MESSAGES.payment_awaiting.replace('{orderId}', state.data.razorpay_order_id));
            }
            return;
        }

        // Manager Awaiting Live Action (Handle Stop command)
        if (state.state === 'MANAGER_AWAITING_LIVE_ACTION' && textLower.startsWith('stop tracking')) {
            const match = text.match(/stop tracking\s+(BUS\d+)/i);
            const busID = match ? match[1].toUpperCase() : null;
            if (busID && busID === state.data.busID) {
                await handleTrackingAction(chatId, 'stop', busID);
            } else {
                 await sendWhatsAppMessage(chatId, "❌ Invalid Bus ID for stopping. Please use the exact format: `Stop Tracking BUSID`");
            }
            return;
        }
    }

    // --- STANDARD COMMANDS (IDLE state) ---

    // OWNER STAFF COMMANDS
    if (textLower.startsWith('assign manager') || textLower.startsWith('revoke manager')) {
        await handleStaffDelegation(chatId, text);
    }
    else if (textLower.startsWith('show revenue')) {
        await handleShowRevenue(chatId, text);
    }
    else if (textLower.startsWith('set status')) {
        await handleSetBusStatus(chatId, text);
    }
    else if (textLower.startsWith('view fare alerts')) {
        await handleShowFareAlerts(chatId);
    }
    // PASSENGER SELF-SERVICE COMMANDS
    else if (textLower.startsWith('get ticket')) {
        await handleGetTicket(chatId, text);
    }
    else if (textLower.startsWith('check status')) {
        await handleCheckStatus(chatId, text);
    }
    else if (textLower.startsWith('request seat change')) {
        await handleSeatChangeRequest(chatId, text);
    }
    else if (textLower.startsWith('alert on')) {
        await handleFareAlertSetup(chatId, text);
    }
    else if (textLower.startsWith('share my location') || textLower.startsWith('share location')) {
        await handleUserShareLocation(chatId);
    }
    // MANAGER COMMANDS
    else if (textLower.startsWith('check-in')) {
        await handleCheckIn(chatId, text);
    }
    else if (textLower.startsWith('release seat')) {
        await handleSeatRelease(chatId, text);
    }
    else if (textLower.startsWith('setup aadhar api')) {
        const userRole = await getUserRole(chatId);
        if (userRole !== 'manager' && userRole !== 'owner') return await sendWhatsAppMessage(chatId, "❌ Permission denied.");
        await saveAppState(chatId, 'MANAGER_AADHAR_API_SETUP', {});
        await sendWhatsAppMessage(chatId, MESSAGES.aadhar_api_init);
    }
    else if (textLower.startsWith('show aadhar api config')) {
        await handleShowAadharApiConfig(chatId);
    }
    else if (textLower.startsWith('add new bus')) {
        await handleManagerAddBus(chatId);
    }
    else if (textLower.startsWith('show my trips')) {
        await handleShowMyTrips(chatId);
    }
    else if (textLower.startsWith('setup inventory sync')) {
        await handleInventorySyncSetup(chatId);
    }
    // GENERAL COMMANDS
    else if (textLower === 'book a bus' || textLower === '/book') {
        await handleBusSearch(chatId);
    }
    else if (textLower.startsWith('show seats')) {
        await handleSeatMap(chatId, text);
    }
    else if (textLower.startsWith('book seat')) {
        await handleSeatSelection(chatId, text);
    }
    else if (textLower.startsWith('cancel booking')) {
        await handleCancellation(chatId, text);
    }
    else if (textLower.startsWith('my profile') || textLower === '/profile') {
        await handleUserProfile(chatId);
    }
    else if (textLower.startsWith('update phone')) {
        await handleUpdatePhoneNumberCallback(chatId);
    }
    else if (textLower.startsWith('add seats')) {
        await handleAddSeatsCommand(chatId, text);
    }
    else if (textLower.startsWith('show manifest')) {
        await handleShowManifest(chatId, text);
    }
    else if (textLower.startsWith('start tracking')) {
        await handleStartTrackingCommand(chatId, text);
    }
    else if (textLower.startsWith('track bus')) {
        await handlePassengerTracking(chatId, text);
    }
    else if (textLower.startsWith('show live location')) {
        await handleShowLiveLocation(chatId, text);
    }
    else {
        await sendWhatsAppMessage(chatId, MESSAGES.unknown_command);
    }
}

/* --------------------- Main Webhook Handler (Adapted for Generic WhatsApp Payload) ---------------------- */

// NEW: GET route for webhook verification
app.get('/api/webhook', (req, res) => {
    console.log('--- RECEIVED META VERIFICATION REQUEST ---');
    
    // 1. Get the required query parameters
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    
    console.log(`Mode: ${mode}, Token: ${token}, Challenge: ${challenge}`);
    console.log(`Expected VERIFY_TOKEN from ENV: ${VERIFY_TOKEN}`);

    // 2. Check the mode and the token
    if (mode === 'subscribe' && token === VERIFY_TOKEN && challenge) {
        // 3. Respond with the challenge to complete verification
        console.log('✅ WEBHOOK VERIFIED. Sending Challenge back.');
        res.status(200).send(challenge);
    } else {
        // 4. If any detail is wrong, fail the request
        console.error('❌ WEBHOOK VERIFICATION FAILED. Token mismatch or missing parameters.');
        res.status(403).send('Forbidden: Verification token mismatch or missing parameters.');
    }
});


app.post('/api/webhook', async (req, res) => {
    // Acknowledge the webhook immediately to avoid retries
    res.status(200).send('OK');

    const update = req.body;
    let chatId = null;
    let text = null;
    let user = { first_name: 'WhatsApp User', last_name: '' }; 

    // --- META CLOUD API PAYLOAD PARSING ---
    try {
        if (update.object === 'whatsapp_business_account' && update.entry) {
            
            // Go through entry/changes structure to find the message content
            const change = update.entry[0].changes[0];
            
            if (change.field === 'messages') {
                const messageData = change.value.messages[0];
                const contacts = change.value.contacts[0];
                
                chatId = messageData.from; // User's phone number
                user.first_name = contacts.profile.name;

                if (messageData.type === 'text') {
                    text = messageData.text.body;
                } 
                // Handle button replies (interactive type)
                else if (messageData.type === 'interactive') {
                    if (messageData.interactive.type === 'button_reply') {
                        // For a simple button reply, the text is contained in the reply.title
                        text = messageData.interactive.button_reply.title; 
                    } else if (messageData.interactive.type === 'list_reply') {
                        // For a list selection, the text is contained in the list_reply.title or id
                        text = messageData.interactive.list_reply.title || messageData.interactive.list_reply.id;
                    }
                }
                
                // If text and chatId found, proceed to core handler
                if (chatId && text) {
                    console.log(`[META PARSE] Message from ${chatId}: ${text}`);
                    try { getFirebaseDb(); } catch (e) {
                         console.error("CRITICAL FIREBASE INITIALIZATION ERROR on webhook call:", e.message);
                         await sendWhatsAppMessage(chatId, MESSAGES.db_error);
                         return;
                    }
                    await handleUserMessage(chatId, text, user);
                    return;
                }
            }
        }
        
        // Log if payload was received but not a standard text/interactive message
        if (chatId) {
            console.log(`[META PARSE] Ignoring non-text/non-interactive message or status update from ${chatId}.`);
        } else {
             console.warn("❌ WARNING: Unrecognized WhatsApp webhook payload structure or non-message event received.");
        }


    } catch (error) {
        console.error("❌ CRITICAL WEBHOOK PARSING ERROR:", error.message);
        // If parsing fails, and we have the chatId, try to send an error message back.
        if (chatId) {
            await sendWhatsAppMessage(chatId, "❌ Sorry, I received an unknown message format. Please try sending only plain text.");
        }
    }
});

// --- RAZORPAY WEBHOOK ENDPOINT ---
app.post('/api/razorpay/webhook', async (req, res) => {
    const signature = req.headers['x-razorpay-signature'];
    const payload = req.rawBody;

    try { getFirebaseDb(); } catch (e) {
        console.error("CRITICAL FIREBASE INITIALIZATION FAILED during Razorpay webhook.", e.message);
        return res.status(500).send('DB Init Error');
    }

    res.status(200).send('OK');

    if (RAZORPAY_WEBHOOK_SECRET && !verifyRazorpaySignature(payload, signature)) {
        console.error("WEBHOOK ERROR: Signature verification failed. Ignoring update.");
        return;
    }

    const event = req.body.event;

    if (event === 'payment.failed' || event === 'order.paid') {
        const orderId = req.body.payload.order.entity.id;
        const db = getFirebaseDb();

        const sessionDoc = await db.collection('payment_sessions').doc(orderId).get();

        if (sessionDoc.exists) {
            const bookingData = sessionDoc.data().booking;

            if (event === 'order.paid') {
                await commitFinalBookingBatch(null, bookingData);
            } else if (event === 'payment.failed') {
                await unlockSeats(bookingData);
                await db.collection('payment_sessions').doc(orderId).delete();
                await sendWhatsAppMessage(bookingData.chat_id, MESSAGES.payment_failed);
            }
        }
    }
});

// Add a simple health check endpoint
app.get('/', (req, res) => {
    res.status(200).json({
        status: 'OK',
        message: 'GoRoute WhatsApp Bot is running',
        timestamp: new Date().toISOString()
    });
});

// Start the server
module.exports = app;
// Export cron function so Vercel can run it
module.exports.sendLiveLocationUpdates = sendLiveLocationUpdates;