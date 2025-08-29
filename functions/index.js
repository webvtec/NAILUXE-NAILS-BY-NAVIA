const functions = require('firebase-functions');
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');

admin.initializeApp();

// Email configuration - Replace with your Gmail credentials
const transporter = nodemailer.createTransporter({
  service: 'gmail',
  auth: {
    user: 'your-business-email@gmail.com', // Replace with your business email
    pass: 'your-app-password'              // Replace with Gmail App Password
  }
});

// Runs every hour to check for appointments needing reminders
exports.sendAppointmentReminders = functions.pubsub
  .schedule('0 * * * *') // Every hour
  .timeZone('America/Jamaica')
  .onRun(async (context) => {
    console.log('Checking for appointment reminders...');

    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    // Format dates as YYYY-MM-DD to match your booking format
    const tomorrowStr = tomorrow.toISOString().split('T')[0];
    const todayStr = now.toISOString().split('T')[0];

    try {
      const bookingsSnapshot = await admin.firestore()
        .collection('bookings')
        .get();

      const reminderPromises = [];

      for (const doc of bookingsSnapshot.docs) {
        const booking = doc.data();
        
        if (!booking.uid || !booking.name || !booking.date) {
          continue;
        }

        // Get user's email from Firebase Auth
        let userEmail;
        try {
          const userRecord = await admin.auth().getUser(booking.uid);
          userEmail = userRecord.email;
        } catch (authError) {
          console.log(`Could not get email for user ${booking.uid}`);
          continue;
        }

        if (!userEmail) {
          continue;
        }

        // Check for 24-hour reminder (tomorrow's appointments)
        if (booking.date === tomorrowStr) {
          // Check if we already sent this reminder
          const reminderCheck = await admin.firestore()
            .collection('emailReminders')
            .doc(`${doc.id}_24h`)
            .get();

          if (!reminderCheck.exists) {
            console.log(`Sending 24h reminder for booking ${doc.id}`);
            reminderPromises.push(
              send24HourReminder(booking, userEmail)
                .then(() => markReminderSent(doc.id, '24h'))
            );
          }
        }

        // Check for 2-hour reminder (today's appointments)
        if (booking.date === todayStr && booking.time) {
          const appointmentDateTime = getAppointmentDateTime(booking.date, booking.time);
          const hoursUntil = (appointmentDateTime - now) / (1000 * 60 * 60);

          // Send reminder if appointment is 1.5-2.5 hours away
          if (hoursUntil >= 1.5 && hoursUntil <= 2.5) {
            const reminderCheck = await admin.firestore()
              .collection('emailReminders')
              .doc(`${doc.id}_2h`)
              .get();

            if (!reminderCheck.exists) {
              console.log(`Sending 2h reminder for booking ${doc.id}`);
              reminderPromises.push(
                send2HourReminder(booking, userEmail)
                  .then(() => markReminderSent(doc.id, '2h'))
              );
            }
          }
        }
      }

      await Promise.all(reminderPromises);
      console.log(`Processed ${reminderPromises.length} reminders`);

    } catch (error) {
      console.error('Error in reminder function:', error);
    }

    return null;
  });

// Helper function to convert appointment date/time to Date object
function getAppointmentDateTime(dateStr, timeStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const [time, period] = timeStr.split(' ');
  const [hours, minutes] = time.split(':').map(Number);
  
  let adjustedHours = hours;
  if (period === 'PM' && hours !== 12) adjustedHours += 12;
  if (period === 'AM' && hours === 12) adjustedHours = 0;

  return new Date(year, month - 1, day, adjustedHours, minutes);
}

// Mark reminder as sent to prevent duplicates
async function markReminderSent(bookingId, type) {
  return admin.firestore()
    .collection('emailReminders')
    .doc(`${bookingId}_${type}`)
    .set({
      sent: true,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });
}

// Send 24-hour reminder email
async function send24HourReminder(booking, email) {
  const appointmentDate = new Date(booking.date + 'T00:00:00');
  const formattedDate = appointmentDate.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  const mailOptions = {
    from: 'your-business-email@gmail.com', // Replace with your email
    to: email,
    subject: `Tomorrow's Appointment Reminder - NAILUXE NAILZ BY NAVIA`,
    html: `
      <div style="font-family: 'Arial', sans-serif; max-width: 600px; margin: 0 auto; background: #f9f9f9; padding: 20px;">
        
        <!-- Header -->
        <div style="background: linear-gradient(90deg, #FE5DC7, #61134A); padding: 25px; text-align: center; border-radius: 12px 12px 0 0;">
          <h1 style="color: white; margin: 0; font-size: 28px; font-weight: bold;">NAILUXE NAILZ BY NAVIA</h1>
          <p style="color: white; margin: 8px 0 0 0; font-size: 16px;">Appointment Reminder</p>
        </div>
        
        <!-- Content -->
        <div style="background: white; padding: 30px; border-radius: 0 0 12px 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
          
          <h2 style="color: #61134A; margin: 0 0 20px 0;">Hi ${booking.name}!</h2>
          
          <p style="font-size: 16px; line-height: 1.6; color: #333; margin-bottom: 25px;">
            Just a friendly reminder that your nail appointment is scheduled for <strong>tomorrow</strong>.
          </p>
          
          <!-- Appointment Details Box -->
          <div style="background: #f8f9ff; border-left: 4px solid #FE5DC7; padding: 20px; margin: 25px 0; border-radius: 0 8px 8px 0;">
            <h3 style="margin: 0 0 15px 0; color: #61134A; font-size: 18px;">Appointment Details</h3>
            <p style="margin: 8px 0; font-size: 15px;"><strong>Date:</strong> ${formattedDate}</p>
            <p style="margin: 8px 0; font-size: 15px;"><strong>Time:</strong> ${booking.time}</p>
            <p style="margin: 8px 0; font-size: 15px;"><strong>Booking #:</strong> ${booking.bookingNumber}</p>
            ${booking.service ? `<p style="margin: 8px 0; font-size: 15px;"><strong>Service:</strong> ${booking.service}</p>` : ''}
          </div>
          
          <!-- Location -->
          <div style="background: #e8f5e8; padding: 20px; border-radius: 8px; margin: 25px 0;">
            <h4 style="margin: 0 0 12px 0; color: #2e7d32; font-size: 16px;">Location</h4>
            <p style="margin: 0; font-size: 14px; line-height: 1.5; color: #333;">
              Shop #4, 1 Wesley road cheago plaza<br>
              Angellace beauty salon<br>
              Mandeville, Jamaica
            </p>
          </div>
          
          <!-- Payment Reminder -->
          <div style="background: #fff3e0; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <p style="margin: 0; font-size: 14px; color: #e65100;">
              <strong>Payment Reminder:</strong> Please use booking # <strong>${booking.bookingNumber}</strong> as your payment reference.
            </p>
          </div>
          
          <hr style="border: 0; height: 1px; background: #eee; margin: 25px 0;">
          
          <p style="text-align: center; color: #666; font-size: 14px; margin: 0;">
            Looking forward to seeing you!<br>
            <em>NAILUXE NAILZ BY NAVIA Team</em>
          </p>
        </div>
      </div>
    `
  };

  return transporter.sendMail(mailOptions);
}

// Send 2-hour reminder email
async function send2HourReminder(booking, email) {
  const mailOptions = {
    from: 'your-business-email@gmail.com', // Replace with your email
    to: email,
    subject: `Your Appointment is in 2 Hours! - NAILUXE NAILZ BY NAVIA`,
    html: `
      <div style="font-family: 'Arial', sans-serif; max-width: 600px; margin: 0 auto; background: #f9f9f9; padding: 20px;">
        
        <!-- Header -->
        <div style="background: linear-gradient(90deg, #FF6B6B, #FE5DC7); padding: 25px; text-align: center; border-radius: 12px 12px 0 0;">
          <h1 style="color: white; margin: 0; font-size: 28px; font-weight: bold;">NAILUXE NAILZ BY NAVIA</h1>
          <p style="color: white; margin: 8px 0 0 0; font-size: 18px; font-weight: bold;">Appointment Starting Soon!</p>
        </div>
        
        <!-- Content -->
        <div style="background: white; padding: 30px; border-radius: 0 0 12px 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
          
          <h2 style="color: #61134A; margin: 0 0 20px 0;">Hi ${booking.name}!</h2>
          
          <!-- Urgent Notice -->
          <div style="background: #fff3cd; border: 2px solid #ffc107; padding: 20px; border-radius: 8px; text-align: center; margin: 20px 0;">
            <h3 style="margin: 0; color: #856404; font-size: 20px;">Your appointment starts in about 2 hours!</h3>
          </div>
          
          <!-- Quick Details -->
          <div style="background: #f8f9ff; border-left: 4px solid #FE5DC7; padding: 20px; margin: 25px 0; border-radius: 0 8px 8px 0;">
            <h3 style="margin: 0 0 15px 0; color: #61134A; font-size: 18px;">Quick Details</h3>
            <p style="margin: 8px 0; font-size: 15px;"><strong>Today at:</strong> ${booking.time}</p>
            <p style="margin: 8px 0; font-size: 15px;"><strong>Booking #:</strong> ${booking.bookingNumber}</p>
          </div>
          
          <!-- Getting Ready Tips -->
          <div style="background: #e3f2fd; padding: 20px; border-radius: 8px; margin: 25px 0;">
            <h4 style="margin: 0 0 15px 0; color: #1565c0; font-size: 16px;">Getting Ready Tips</h4>
            <ul style="margin: 0; padding-left: 20px; font-size: 14px; line-height: 1.6;">
              <li>Remove any existing nail polish</li>
              <li>Arrive 5 minutes early</li>
              <li>Bring flip-flops if getting a pedicure</li>
            </ul>
          </div>
          
          <!-- Location -->
          <div style="background: #e8f5e8; padding: 20px; border-radius: 8px; margin: 25px 0;">
            <h4 style="margin: 0 0 12px 0; color: #2e7d32; font-size: 16px;">Location</h4>
            <p style="margin: 0; font-size: 14px; line-height: 1.5; color: #333;">
              Shop #4, 1 Wesley road cheago plaza<br>
              Angellace beauty salon<br>
              Mandeville, Jamaica
            </p>
          </div>
          
          <hr style="border: 0; height: 1px; background: #eee; margin: 25px 0;">
          
          <p style="text-align: center; color: #666; font-size: 14px; margin: 0;">
            See you soon!<br>
            <em>NAILUXE NAILZ BY NAVIA Team</em>
          </p>
        </div>
      </div>
    `
  };

  return transporter.sendMail(mailOptions);
}
