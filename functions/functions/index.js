const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();

exports.sendPushNotification = functions.firestore
  .document('bookings/{bookingId}')
  .onCreate(async (snap, context) => {
    const booking = snap.data();

    const payload = {
      notification: {
        title: `New Booking from ${booking.name}`,
        body: `For ${booking.date} at ${booking.time}`
      }
    };

    const tokensSnapshot = await admin.firestore().collection('adminTokens').get();
    const tokens = tokensSnapshot.docs.map(doc => doc.id);

    if (tokens.length > 0) {
      return admin.messaging().sendToDevice(tokens, payload);
    } else {
      console.log('No admin tokens found.');
      return null;
    }
  });
