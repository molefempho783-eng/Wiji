// functions/src/index.ts

import * as dotenv from 'dotenv';
dotenv.config();
dotenv.config({ path: '.env.local' });

import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getMessaging } from 'firebase-admin/messaging';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';



import { onDocumentUpdated, onDocumentCreated  } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';

// ---------- Admin init ----------
if (getApps().length === 0) initializeApp();
const db = getFirestore();
const messaging = getMessaging();
const authAdmin = getAuth();

// ---------- Helpers ----------

function uidOrThrow(req: { auth?: { uid?: string } }): string {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Not signed in.');
  return uid;
}

function previewFromMessage(msg: any): string {
  if (typeof msg?.text === 'string' && msg.text.trim()) return msg.text.trim().slice(0, 140);
  if (msg?.mediaType === 'image') return 'Image 📸';
  if (msg?.mediaType === 'video') return 'Video 🎥';
  if (msg?.mediaType === 'file')  return `File 📄${msg?.fileName ? `: ${String(msg.fileName)}` : ''}`;
  return 'New message';
}

//-------------push notification ---------------

/**
 * Send FCM push notification to one or more tokens
 */
async function sendFCMPush(
  to: string[] | string,
  title: string,
  body: string,
  data: Record<string, any> = {}
) {
  const tokens = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (tokens.length === 0) return;

  // FCM supports up to 500 tokens per batch
  const batchSize = 500;
  
  for (let i = 0; i < tokens.length; i += batchSize) {
    const chunk = tokens.slice(i, i + batchSize);
    
    try {
      const message = {
        notification: {
          title,
          body,
        },
        data: {
          ...Object.keys(data).reduce((acc, key) => {
            acc[key] = String(data[key]);
            return acc;
          }, {} as Record<string, string>),
        },
        android: {
          priority: 'high' as const,
          notification: {
            sound: 'default',
            channelId: 'default',
          },
        },
        apns: {
          payload: {
            aps: {
              sound: 'default',
            },
          },
        },
        tokens: chunk,
      };

      const response = await messaging.sendEachForMulticast(message);
      
      // Log results
      logger.info(`FCM sent to ${response.successCount}/${chunk.length} tokens`);
      
      // Handle failures
      if (response.failureCount > 0) {
        response.responses.forEach((resp, idx) => {
          if (!resp.success) {
            logger.warn(`FCM send failed for token ${chunk[idx].substring(0, 20)}...:`, resp.error);
            // Optional: Remove invalid tokens
            // if (resp.error?.code === 'messaging/invalid-registration-token' || 
            //     resp.error?.code === 'messaging/registration-token-not-registered') {
            //   await removeBadTokenFromAllUsers(chunk[idx]);
            // }
          }
        });
      }
    } catch (error: any) {
      logger.error('FCM send error:', error);
    }
  }
}


export const notifyIncomingCall = onDocumentCreated('callSessions/{callId}', async (event) => {
  const callId = event.params.callId;
  const call = event.data?.data() as any;
  if (!call) return;
  if (call.status !== 'ringing') return;

  const callerId = String(call.callerId || '');
  const calleeId = String(call.calleeId || '');
  if (!callerId || !calleeId || callerId === calleeId) return;

  try {
    const [callerSnap, calleeSnap] = await Promise.all([
      db.collection('users').doc(callerId).get(),
      db.collection('users').doc(calleeId).get(),
    ]);
    if (!calleeSnap.exists) return;

    const callerName = callerSnap.get('username') || 'Someone';
    const fcmTokens: string[] = (calleeSnap.get('fcmTokens') || []).filter(
      (t: any) => typeof t === 'string' && t.length > 0
    );
    const expoTokens: string[] = (calleeSnap.get('expoPushTokens') || []).filter(
      (t: any) => typeof t === 'string' && t.startsWith('ExponentPushToken')
    );
    const tokens = fcmTokens.length > 0 ? fcmTokens : expoTokens;
    if (!tokens.length) return;

    await sendFCMPush(tokens, 'Incoming call', `${callerName} is calling you`, {
      type: 'call',
      callId,
      callerId,
      calleeId,
    });
  } catch (e) {
    logger.warn('notifyIncomingCall failed', e);
  }
});

export const expireRingingCalls = onSchedule('every 1 minutes', async () => {
  const now = Timestamp.now();
  const stale = await db
    .collection('callSessions')
    .where('status', '==', 'ringing')
    .where('ttlExpiresAt', '<=', now)
    .get();

  if (stale.empty) return;

  for (const docSnap of stale.docs) {
    const call = docSnap.data() as any;
    const callerId = String(call.callerId || '');
    const calleeId = String(call.calleeId || '');

    await docSnap.ref.set(
      {
        status: 'missed',
        endReason: 'timeout_no_answer',
        endedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    if (!callerId || !calleeId) continue;
    try {
      const callerSnap = await db.collection('users').doc(callerId).get();
      const calleeSnap = await db.collection('users').doc(calleeId).get();
      const fcmTokens: string[] = (callerSnap.get('fcmTokens') || []).filter(
        (t: any) => typeof t === 'string' && t.length > 0
      );
      const expoTokens: string[] = (callerSnap.get('expoPushTokens') || []).filter(
        (t: any) => typeof t === 'string' && t.startsWith('ExponentPushToken')
      );
      const tokens = fcmTokens.length > 0 ? fcmTokens : expoTokens;
      if (!tokens.length) continue;
      const calleeName = calleeSnap.get('username') || 'User';
      await sendFCMPush(tokens, 'Call missed', `${calleeName} did not answer`, {
        type: 'call_missed',
        callId: docSnap.id,
        calleeId,
      });
    } catch (e) {
      logger.warn('expireRingingCalls notify caller failed', e);
    }
  }
});

// ---------- [MODIFIED] Notify on new DM message & maintain chat meta ----------
export const notifyOnNewDM = onDocumentCreated('chats/{chatId}/messages/{messageId}', async (event) => {
  const chatId = event.params.chatId;
  const msg = event.data?.data();
  if (!msg) return;

  const senderId = String(msg.senderId || '');
  if (!senderId) return;

  try {
    const chatRef = db.collection('chats').doc(chatId);
    const chatSnap = await chatRef.get();
    if (!chatSnap.exists) return;

    const chat = chatSnap.data() || {};

    // Figure out the two participants and the recipient
    let participants: string[] = [];
    if (Array.isArray(chat.participants)) {
      participants = chat.participants.filter((x: any) => typeof x === 'string');
    } else if (chat.participants && typeof chat.participants === 'object') {
      participants = Object.keys(chat.participants).filter((k) => chat.participants[k] === true);
    }

    // This trigger is for 1-on-1 direct messages only
    if (participants.length !== 2) return;

    const recipientId = participants.find((p) => p !== senderId);
    if (!recipientId) return;

    // Update chat meta: last message + unread flags + unread count for recipient
    const lastMessageText = previewFromMessage(msg);
    await chatRef.set(
      {
        lastMessageText,
        lastMessageSenderId: senderId,
        lastMessageTimestamp: FieldValue.serverTimestamp(),
        unreadFor: {
          [recipientId]: true,
          [senderId]: false,
        },
        [`unreadCount.${recipientId}`]: FieldValue.increment(1),
        [`unreadCount.${senderId}`]: 0,
      },
      { merge: true }
    );

    // Trip shares and SOS messages already sent their own (more urgent) push
    if (msg.skipPush) return;

    // Fetch sender's name for the title and recipient's tokens for sending
    const senderSnap = await db.collection('users').doc(senderId).get();
    const recipientSnap = await db.collection('users').doc(recipientId).get();

    // Check if recipient has ignored this sender
    const ignoredUsers: string[] = recipientSnap.get('ignoredUsers') || [];
    if (ignoredUsers.includes(senderId)) {
      // User has ignored this sender, skip push notification but still update chat meta
      return;
    }

    // Get FCM tokens (prefer fcmTokens, fallback to expoPushTokens for migration)
    const fcmTokens: string[] = (recipientSnap.get('fcmTokens') || []).filter(
      (t: any) => typeof t === 'string' && t.length > 0
    );
    const expoTokens: string[] = (recipientSnap.get('expoPushTokens') || []).filter(
      (t: any) => typeof t === 'string' && t.startsWith('ExponentPushToken')
    );
    const tokens = fcmTokens.length > 0 ? fcmTokens : expoTokens;

    if (!tokens.length) return;

    // Use sender's name for the notification title
    const title = senderSnap.get('username') ? String(senderSnap.get('username')) : 'New message';
    const body  = lastMessageText;

    // Include navigation hints in data payload for your app
    // When the recipient taps, they need to open a chat with the SENDER.
    // So the navigation `recipientId` param should be the sender's ID.
    await sendFCMPush(tokens, title, body, {
      type: 'dm',
      chatId,
      recipientId: senderId,
    });
  } catch (e) {
    logger.warn('notifyOnNewDM failed', e);
  }
});

// ---------- [NEW] Notify on new group chat message ----------
// Haversine formula to calculate distance between two coordinates in km
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Radius of the Earth in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// When 3+ people join an activity within 10 minutes, notify nearby users who haven't joined ("Don't miss out")
const JOIN_WINDOW_MINUTES = 10;
const DONT_MISS_OUT_COOLDOWN_MINUTES = 30;

export const notifyOnActivityJoins = onDocumentUpdated('activities/{activityId}', async (event) => {
  const before: any = event.data?.before?.data();
  const after: any = event.data?.after?.data();
  if (!before || !after) return;

  const beforeParticipants: string[] = before.participants || [];
  const afterParticipants: string[] = after.participants || [];
  if (afterParticipants.length <= beforeParticipants.length) return; // no new join

  const activityId = event.params.activityId;
  const activityLat = after.latitude;
  const activityLng = after.longitude;
  const activityTitle = after.title || 'Activity';
  const activityType = after.activityType || 'activity';
  const visibility = after.visibility || 'everyone';
  const allowedViewers: string[] = after.allowedViewers || [];

  if (!activityLat || !activityLng) return;

  try {
    const joinEventsRef = db.collection('activities').doc(activityId).collection('joinEvents');
    await joinEventsRef.add({ joinedAt: FieldValue.serverTimestamp() });

    const tenMinutesAgo = Timestamp.fromMillis(Date.now() - JOIN_WINDOW_MINUTES * 60 * 1000);
    const recentJoinsSnap = await joinEventsRef.where('joinedAt', '>=', tenMinutesAgo).get();
    if (recentJoinsSnap.size < 3) return;

    const lastSent = after.lastDonMissOutNotificationAt?.toMillis?.() ?? 0;
    const cooldownMs = DONT_MISS_OUT_COOLDOWN_MINUTES * 60 * 1000;
    if (Date.now() - lastSent < cooldownMs) return;

    const participantsSet = new Set(afterParticipants);
    const usersSnapshot = await db.collection('users').get();
    const nearbyUserTokens: string[] = [];

    for (const userDoc of usersSnapshot.docs) {
      const userId = userDoc.id;
      if (participantsSet.has(userId)) continue;

      const userData = userDoc.data();
      const userLat = userData.latitude;
      const userLng = userData.longitude;
      if (userLat == null || userLng == null) continue;

      const distance = calculateDistance(activityLat, activityLng, userLat, userLng);
      if (distance > 50) continue;
      if (visibility === 'friends_only' && allowedViewers.length > 0 && !allowedViewers.includes(userId)) continue;

      const fcmTokens: string[] = (userData.fcmTokens || []).filter(
        (t: any) => typeof t === 'string' && t.length > 0
      );
      const expoTokens: string[] = (userData.expoPushTokens || []).filter(
        (t: any) => typeof t === 'string' && t.startsWith('ExponentPushToken')
      );
      const tokens = fcmTokens.length > 0 ? fcmTokens : expoTokens;
      if (tokens.length > 0) nearbyUserTokens.push(...tokens);
    }

    if (nearbyUserTokens.length === 0) return;

    await sendFCMPush(
      nearbyUserTokens,
      'People are joining!',
      `People are joining "${activityTitle}". Don't miss out!`,
      { type: 'activity_hot', activityId, title: activityTitle }
    );
    await db.collection('activities').doc(activityId).update({
      lastDonMissOutNotificationAt: FieldValue.serverTimestamp(),
    });
    logger.info(`notifyOnActivityJoins: sent "Don't miss out" to ${nearbyUserTokens.length} users for activity ${activityId}`);
  } catch (e) {
    logger.warn('notifyOnActivityJoins failed', e);
  }
});

// Notify users within 50km when a new activity is created
export const notifyOnNewActivity = onDocumentCreated('activities/{activityId}', async (event) => {
  const activity = event.data?.data();
  if (!activity) return;

  const activityLat = activity.latitude;
  const activityLng = activity.longitude;
  const activityTitle = activity.title || 'New Activity';
  const activityType = activity.activityType || 'activity';
  const createdBy = activity.createdBy;
  const visibility = activity.visibility || 'everyone';
  const allowedViewers: string[] = activity.allowedViewers || [];

  if (!activityLat || !activityLng) {
    logger.warn('notifyOnNewActivity: activity missing latitude/longitude');
    return;
  }

  try {
    // Get all users (we'll filter by distance)
    const usersSnapshot = await db.collection('users').get();
    const nearbyUserTokens: string[] = [];
    let usersWithLocation = 0;
    let usersNearbyNoToken = 0;

    for (const userDoc of usersSnapshot.docs) {
      const userId = userDoc.id;
      // Skip the creator
      if (userId === createdBy) continue;

      const userData = userDoc.data();
      const userLat = userData.latitude;
      const userLng = userData.longitude;

      // If user has location, calculate distance
      if (userLat != null && userLng != null) {
        usersWithLocation++;
        const distance = calculateDistance(activityLat, activityLng, userLat, userLng);

        // Only notify users within 50km
        if (distance <= 50) {
          // For friends_only activities, only notify users in allowedViewers
          if (visibility === 'friends_only' && allowedViewers.length > 0 && !allowedViewers.includes(userId)) {
            continue;
          }
          // Get FCM tokens (prefer fcmTokens, fallback to expoPushTokens)
          const fcmTokens: string[] = (userData.fcmTokens || []).filter(
            (t: any) => typeof t === 'string' && t.length > 0
          );
          const expoTokens: string[] = (userData.expoPushTokens || []).filter(
            (t: any) => typeof t === 'string' && t.startsWith('ExponentPushToken')
          );
          const tokens = fcmTokens.length > 0 ? fcmTokens : expoTokens;
          if (tokens.length > 0) {
            nearbyUserTokens.push(...tokens);
          } else {
            usersNearbyNoToken++;
          }
        }
      }
    }

    logger.info(`notifyOnNewActivity: activity at (${activityLat},${activityLng}), users with location=${usersWithLocation}, nearby with tokens=${nearbyUserTokens.length}, nearby without token=${usersNearbyNoToken}`);

    if (nearbyUserTokens.length === 0) {
      logger.info('No nearby users with push tokens to notify; ensure users open the Map so their location is saved and they have notification permission.');
      return;
    }

    // Send notification to all nearby users
    await sendFCMPush(
      nearbyUserTokens,
      `New ${activityType} Activity nearby`,
      activityTitle,
      {
        type: 'activity',
        activityId: event.params.activityId,
        title: activityTitle,
      }
    );

    logger.info(`Sent activity notification to ${nearbyUserTokens.length} nearby users`);
  } catch (e) {
    logger.warn('notifyOnNewActivity failed', e);
  }
});

/** When someone requests to join an activity (require-approval), notify the activity creator. */
export const notifyOnActivityJoinRequest = onDocumentCreated(
  'activities/{activityId}/joinRequests/{requestId}',
  async (event) => {
    const activityId = event.params.activityId;
    const requestData = event.data?.data();
    if (!requestData) return;

    const requesterName = String(requestData.userName || 'Someone');
    try {
      const activitySnap = await db.collection('activities').doc(activityId).get();
      if (!activitySnap.exists) return;

      const createdBy = activitySnap.get('createdBy');
      const activityTitle = activitySnap.get('title') || 'your activity';
      if (!createdBy) return;

      const creatorSnap = await db.collection('users').doc(createdBy).get();
      if (!creatorSnap.exists) return;

      const fcmTokens: string[] = (creatorSnap.get('fcmTokens') || []).filter(
        (t: any) => typeof t === 'string' && t.length > 0
      );
      const expoTokens: string[] = (creatorSnap.get('expoPushTokens') || []).filter(
        (t: any) => typeof t === 'string' && t.startsWith('ExponentPushToken')
      );
      const tokens = fcmTokens.length > 0 ? fcmTokens : expoTokens;
      if (tokens.length === 0) return;

      await sendFCMPush(
        tokens,
        'Join request',
        `${requesterName} requested to join "${activityTitle}". Open the activity to accept or decline.`,
        { type: 'activity_join_request', activityId, activityTitle }
      );
      logger.info(`Sent join-request notification to creator of activity ${activityId}`);
    } catch (e) {
      logger.warn('notifyOnActivityJoinRequest failed', e);
    }
  }
);

/** Callable: send push to the user whose join request was accepted (call after client has added them to participants and deleted the request). */
export const notifyJoinRequestAccepted = onCall({}, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Must be signed in');
  const { activityId, activityTitle, recipientUserId } = request.data as {
    activityId?: string;
    activityTitle?: string;
    recipientUserId?: string;
  };
  if (!activityId || !recipientUserId) throw new HttpsError('invalid-argument', 'activityId and recipientUserId required');
  const title = activityTitle ? String(activityTitle) : 'Activity';
  try {
    const userSnap = await db.collection('users').doc(recipientUserId).get();
    if (!userSnap.exists) return { ok: false };
    const data = userSnap.data() || {};
    const fcmTokens: string[] = (data.fcmTokens || []).filter((t: any) => typeof t === 'string' && t.length > 0);
    const expoTokens: string[] = (data.expoPushTokens || []).filter((t: any) => typeof t === 'string' && String(t).startsWith('ExponentPushToken'));
    const tokens = fcmTokens.length > 0 ? fcmTokens : expoTokens;
    if (tokens.length > 0) {
      await sendFCMPush(
        tokens,
        "You're in!",
        `You were accepted to "${title}". Open the activity to chat and add memories.`,
        { type: 'activity_join_accepted', activityId, title }
      );
    }
    return { ok: true };
  } catch (e) {
    logger.warn('notifyJoinRequestAccepted failed', e);
    return { ok: false };
  }
});

export const notifyOnNewActivityChatMessage = onDocumentCreated(
  'activityChats/{activityId}/messages/{messageId}',
  async (event) => {
    const activityId = event.params.activityId;
    const msg = event.data?.data();
    if (!msg) return;

    const senderId = String(msg.senderId || '');
    if (!senderId) return;

    try {
      const activitySnap = await db.collection('activities').doc(activityId).get();
      if (!activitySnap.exists) return;

      const participants: string[] = activitySnap.get('participants') || [];
      const recipients = participants.filter((p) => p !== senderId);
      if (recipients.length === 0) return;

      const activityTitle = activitySnap.get('title') || 'Activity';
      const senderSnap = await db.collection('users').doc(senderId).get();
      const senderName = senderSnap.get('username') || 'Someone';
      const messagePreview = previewFromMessage(msg);

      const allTokens: string[] = [];
      for (const recipientId of recipients) {
        try {
          const userSnap = await db.collection('users').doc(recipientId).get();
          if (userSnap.exists) {
            const fcmTokens: string[] = (userSnap.get('fcmTokens') || []).filter(
              (t: any) => typeof t === 'string' && t.length > 0
            );
            const expoTokens: string[] = (userSnap.get('expoPushTokens') || []).filter(
              (t: any) => typeof t === 'string' && t.startsWith('ExponentPushToken')
            );
            const tokens = fcmTokens.length > 0 ? fcmTokens : expoTokens;
            allTokens.push(...tokens);
          }
        } catch (e) {
          logger.warn(`Failed to get tokens for user ${recipientId}`, e);
        }
      }

      if (allTokens.length === 0) return;

      await sendFCMPush(
        allTokens,
        `${senderName} in ${activityTitle}`,
        messagePreview,
        { type: 'activity_chat', activityId, activityTitle }
      );
    } catch (e) {
      logger.warn('notifyOnNewActivityChatMessage failed', e);
    }
  }
);

export const notifyOnNewGroupMessage = onDocumentCreated(
  'communities/{communityId}/groupChats/{chatId}/messages/{messageId}',
  async (event) => {
    const communityId = event.params.communityId;
    const chatId = event.params.chatId;
    const msg = event.data?.data();
    if (!msg) return;

    const senderId = String(msg.senderId || '');
    if (!senderId) return;

    try {
      // Get group chat document to find members
      const groupRef = db
        .collection('communities')
        .doc(communityId)
        .collection('groupChats')
        .doc(chatId);
      const groupSnap = await groupRef.get();
      if (!groupSnap.exists) return;

      const groupData = groupSnap.data() || {};
      const members: string[] = Array.isArray(groupData.members)
        ? groupData.members
        : [];

      // Don't notify the sender
      const recipients = members.filter((m) => m !== senderId);
      if (recipients.length === 0) return;

      // Get sender's name for notification
      const senderSnap = await db.collection('users').doc(senderId).get();
      const senderName = senderSnap.get('username') || 'Someone';
      const groupName = groupData.name || groupData.title || 'Group';

      // Get message preview
      const messagePreview = previewFromMessage(msg);

      // Collect all push tokens from recipients
      const allTokens: string[] = [];
      for (const recipientId of recipients) {
        try {
          const userSnap = await db.collection('users').doc(recipientId).get();
          if (userSnap.exists) {
            // Prefer FCM tokens, fallback to Expo tokens for migration
            const fcmTokens: string[] = (userSnap.get('fcmTokens') || []).filter(
              (t: any) => typeof t === 'string' && t.length > 0
            );
            const expoTokens: string[] = (userSnap.get('expoPushTokens') || []).filter(
              (t: any) => typeof t === 'string' && t.startsWith('ExponentPushToken')
            );
            const tokens = fcmTokens.length > 0 ? fcmTokens : expoTokens;
            allTokens.push(...tokens);
          }
        } catch (e) {
          logger.warn(`Failed to get tokens for user ${recipientId}`, e);
        }
      }

      if (allTokens.length === 0) return;

      // Send notification to all group members (except sender)
      await sendFCMPush(
        allTokens,
        `${senderName} in ${groupName}`,
        messagePreview,
        {
          type: 'group',
          communityId,
          chatId,
          groupId: chatId,
          groupName,
        }
      );
    } catch (e) {
      logger.warn('notifyOnNewGroupMessage failed', e);
    }
  }
);

// ---------- KLIPY GIF API proxy (uses Firebase secret KLIPY_SECRET) ----------
// Set secret: firebase functions:secrets:set KLIPY_SECRET
interface KlipyApiResponse {
  data?: { data?: unknown[]; results?: unknown[]; has_next?: boolean };
  results?: unknown[];
}
function parseKlipyItem(item: any): { id: string; url: string; tinyUrl: string; title?: string } {
  const id = item.id || item.slug || String(Math.random());
  let url = '';
  let tinyUrl = '';
  if (item.media_formats) {
    const m = item.media_formats;
    const gif = m.gif || m.mediumgif;
    const tiny = m.tinygif || m.nanogif || gif;
    url = gif?.url || tiny?.url || '';
    tinyUrl = tiny?.url || gif?.url || url;
  }
  if (item.files && typeof item.files === 'object') {
    const f = item.files;
    url = f.gif?.url || f.medium?.url || f.large?.url || f.small?.url || url;
    tinyUrl = f.tiny?.url || f.small?.url || f.nano?.url || url || tinyUrl;
  }
  if (!url && item.url) url = item.url;
  if (!tinyUrl) tinyUrl = url;
  if (!url && item.images?.original?.url) url = item.images.original.url;
  if (!tinyUrl && item.images?.fixed_height_small?.url) tinyUrl = item.images.fixed_height_small.url;
  return {
    id,
    url,
    tinyUrl: tinyUrl || url,
    title: item.content_description || item.title || item.description || '',
  };
}

export const getKlipyTrending = onCall(
  {
    region: 'us-central1',
    cors: true,
    secrets: ['KLIPY_SECRET'],
  },
  async (request) => {
    const key = process.env.KLIPY_SECRET;
    if (!key) throw new HttpsError('failed-precondition', 'KLIPY_SECRET not set');
    const limit = Math.min(50, Math.max(8, Number(request.data?.limit) || 24));
    const page = String(request.data?.page || '1');
    const params = new URLSearchParams({ per_page: String(limit), page });
    const res = await fetch(`https://api.klipy.com/api/v1/${key}/gifs/trending?${params}`);
    if (!res.ok) throw new HttpsError('internal', `KLIPY trending: ${res.status}`);
    const json = (await res.json()) as KlipyApiResponse;
    const payload =
      json?.data?.data ??
      json?.data?.results ??
      json?.data ??
      json?.results ??
      (Array.isArray(json) ? json : []);
    const list = Array.isArray(payload) ? payload : [];
    const gifs = list.map(parseKlipyItem).filter((g: { url: string }) => g.url);
    const hasNext = json?.data?.has_next === true;
    const next = hasNext ? String((parseInt(page, 10) || 1) + 1) : null;
    return { gifs, next };
  }
);

export const getKlipySearch = onCall(
  {
    region: 'us-central1',
    cors: true,
    secrets: ['KLIPY_SECRET'],
  },
  async (request) => {
    const key = process.env.KLIPY_SECRET;
    if (!key) throw new HttpsError('failed-precondition', 'KLIPY_SECRET not set');
    const q = String(request.data?.query || '').trim();
    const limit = Math.min(50, Math.max(8, Number(request.data?.limit) || 24));
    const page = String(request.data?.page || '1');
    const params = new URLSearchParams({ per_page: String(limit), page });
    const url = q
      ? `https://api.klipy.com/api/v1/${key}/gifs/search?${params}&q=${encodeURIComponent(q)}`
      : `https://api.klipy.com/api/v1/${key}/gifs/trending?${params}`;
    const res = await fetch(url);
    if (!res.ok) throw new HttpsError('internal', `KLIPY: ${res.status}`);
    const json = (await res.json()) as KlipyApiResponse;
    const payload =
      json?.data?.data ??
      json?.data?.results ??
      json?.data ??
      json?.results ??
      (Array.isArray(json) ? json : []);
    const list = Array.isArray(payload) ? payload : [];
    const gifs = list.map(parseKlipyItem).filter((g: { url: string }) => g.url);
    const hasNext = json?.data?.has_next === true;
    const next = hasNext ? String((parseInt(page, 10) || 1) + 1) : null;
    return { gifs, next };
  }
);

/** Radius for map deal notifications (km); keep in sync with MapScreen client filter */
const MAP_SPECIAL_NOTIFY_RADIUS_KM = 15;

const MAP_SPECIAL_NOTIFY_LEAD_MINUTES = 60;
const MAP_SPECIAL_NOTIFY_WINDOW_MINUTES = 15;

function parseUtcTimeToMinutes(value: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * Every 15 minutes (UTC): notify users ~1 hour before each deal time for the selected weekday.
 */
export const notifyMapSpecialsDaily = onSchedule(
  {
    schedule: '*/15 * * * *',
    timeZone: 'Etc/UTC',
    region: 'us-central1',
    memory: '512MiB',
  },
  async () => {
    const now = new Date();
    const target = new Date(now.getTime() + MAP_SPECIAL_NOTIFY_LEAD_MINUTES * 60 * 1000);
    const targetDay = target.getUTCDay();
    const targetYmd = target.toISOString().slice(0, 10);
    const targetMinutes = target.getUTCHours() * 60 + target.getUTCMinutes();
    const windowEnd = targetMinutes + MAP_SPECIAL_NOTIFY_WINDOW_MINUTES;

    const specialsSnap = await db.collection('mapSpecials').where('active', '==', true).get();
    if (specialsSnap.empty) {
      logger.info('notifyMapSpecialsDaily: no active specials');
      return;
    }

    const usersSnapshot = await db.collection('users').get();

    for (const docSnap of specialsSnap.docs) {
      const special = docSnap.data();
      const weekdays: number[] = Array.isArray(special.weekdays) ? special.weekdays : [];
      if (!weekdays.includes(targetDay)) continue;
      const timeMinutes = parseUtcTimeToMinutes(String(special.dealTimeUtc || ''));
      if (timeMinutes == null) continue;
      if (!(timeMinutes >= targetMinutes && timeMinutes < windowEnd)) continue;

      const occurrenceKey = `${targetYmd}_${String(timeMinutes).padStart(4, '0')}`;
      if (special.lastNotifiedOccurrenceKey === occurrenceKey) continue;

      const lat = special.latitude;
      const lng = special.longitude;
      const createdBy = special.createdBy;
      const title = String(special.title || 'Nearby deal');
      const locationLine =
        special.location != null && String(special.location).trim() !== ''
          ? String(special.location)
          : special.placeName
            ? String(special.placeName)
            : '';

      if (typeof lat !== 'number' || typeof lng !== 'number' || !createdBy) {
        await docSnap.ref.update({
          lastNotifiedOccurrenceKey: occurrenceKey,
          lastNotifiedAt: FieldValue.serverTimestamp(),
        });
        continue;
      }

      const tokenSet = new Set<string>();
      for (const userDoc of usersSnapshot.docs) {
        const userId = userDoc.id;
        if (userId === createdBy) continue;
        const userData = userDoc.data();
        const userLat = userData.latitude;
        const userLng = userData.longitude;
        if (userLat == null || userLng == null) continue;
        const distance = calculateDistance(lat, lng, userLat, userLng);
        if (distance > MAP_SPECIAL_NOTIFY_RADIUS_KM) continue;
        const fcmTokens: string[] = (userData.fcmTokens || []).filter(
          (t: any) => typeof t === 'string' && t.length > 0
        );
        const expoTokens: string[] = (userData.expoPushTokens || []).filter(
          (t: any) => typeof t === 'string' && t.startsWith('ExponentPushToken')
        );
        const tokens = fcmTokens.length > 0 ? fcmTokens : expoTokens;
        for (const t of tokens) tokenSet.add(t);
      }

      const uniqueTokens = [...tokenSet];
      if (uniqueTokens.length > 0) {
        const body = locationLine ? `${title} — ${locationLine}` : title;
        await sendFCMPush(uniqueTokens, 'Deal reminder (1 hour)', body, {
          type: 'map_special',
          specialId: docSnap.id,
        });
      }

      await docSnap.ref.update({
        lastNotifiedOccurrenceKey: occurrenceKey,
        lastNotifiedAt: FieldValue.serverTimestamp(),
      });
      logger.info(
        `notifyMapSpecialsDaily: special ${docSnap.id} → ${uniqueTokens.length} device token(s)`
      );
    }
  }
);

// Paystack payments (drivers and merchants get paid)
export * from "./paystack.js";

// Wiji Rides: driver registration and verification
export * from "./drivers.js";

// Wiji Rides: requests, trips, sharing, emergency and reports
export * from "./rides.js";
export * from "./business.js";
export * from "./admin.js";
export * from "./shop.js";
export * from "./groupSubscriptions.js";
