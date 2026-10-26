/**
 * Auto "😎 Decompression" block after calls/meetings.
 *
 * SETUP (do this once, in script.google.com):
 *   1. Create a new Apps Script project, paste this whole file in.
 *   2. Editor sidebar -> Services (+) -> add "Calendar API" (this is the
 *      *Advanced* Calendar Service, not the same as the built-in CalendarApp).
 *   3. Select the `initialize` function in the toolbar dropdown and click Run.
 *      Approve the OAuth prompt (needs Calendar read/write).
 *   4. Check Triggers (clock icon, left sidebar): you should see
 *      - onCalendarChange, event source "Calendar - Event Updated"
 *      - dailyReconcile, time-driven, daily around 3am
 *
 * WHAT IT DOES:
 *   - onCalendarChange fires (with some latency, usually a few minutes,
 *     not instant) whenever any event on your primary calendar is
 *     created/updated/deleted. It uses an incremental sync token so it
 *     only looks at what changed, not your whole calendar.
 *   - dailyReconcile is a safety net: once a day it re-scans the next
 *     13 days, backfills any qualifying meeting that's missing its
 *     Decompression block, and removes blocks whose meeting is gone
 *     (calendar-update triggers aren't 100% guaranteed to fire on every
 *     single change).
 *   - A meeting "qualifies" if it has other guests on it, OR you organized
 *     it and its title starts with "Call" or "Meeting" or "Interview".
 *   - Declined events, all-day events, and Decompression events themselves
 *     are skipped.
 *   - Each block is tagged (private extended property) with the ID of the
 *     meeting it belongs to. That lets the block follow the meeting when
 *     it's moved or resized, and disappear when the meeting is cancelled,
 *     declined, or stops qualifying.
 */

var DECOMPRESSION_TITLE = '😎 Decompression';
var DECOMPRESSION_MINUTES = 15;
var DECOMPRESSION_COLOR_ID = '8'; // Graphite
var RECONCILE_WINDOW_DAYS = 13;
var SYNC_TOKEN_PROPERTY = 'DECOMPRESSION_SYNC_TOKEN';
var SOURCE_EVENT_KEY = 'decompressionFor'; // private extended property on each block

function getCalendarId() {
  return CalendarApp.getDefaultCalendar().getId();
}

function isDecompressionTitle(title) {
  return /^\s*(😎\s*)?decompression/i.test(title || '');
}

function sameInstant(a, b) {
  return new Date(a).getTime() === new Date(b).getTime();
}

function sourceIdOf(block) {
  var priv = block.extendedProperties && block.extendedProperties.private;
  return priv && priv[SOURCE_EVENT_KEY];
}

function qualifies(event) {
  if (!event || event.status === 'cancelled') return false;
  if (!event.start || !event.start.dateTime) return false; // all-day event
  if (isDecompressionTitle(event.summary)) return false;

  var attendees = event.attendees || [];
  var self = attendees.filter(function (a) { return a.self; })[0];
  if (self && self.responseStatus === 'declined') return false;

  var hasOtherGuests = attendees.some(function (a) { return !a.self; });
  var isOwnCallOrMeeting =
    event.organizer && event.organizer.self &&
    /^\s*(call|meeting|interview)\b/i.test(event.summary || '');

  return hasOtherGuests || isOwnCallOrMeeting;
}

/** Blocks tagged as belonging to this meeting. */
function findBlocksFor(calendarId, sourceEventId) {
  var resp = Calendar.Events.list(calendarId, {
    privateExtendedProperty: SOURCE_EVENT_KEY + '=' + sourceEventId,
    maxResults: 10
  });
  return resp.items || [];
}

/** Any Decompression block (tagged or not) starting exactly when a meeting ends. */
function findBlockStartingAt(calendarId, startISO) {
  var windowEnd = new Date(new Date(startISO).getTime() + 20 * 60000).toISOString();
  var resp = Calendar.Events.list(calendarId, {
    timeMin: startISO,
    timeMax: windowEnd,
    singleEvents: true,
    q: 'Decompression'
  });
  return (resp.items || []).filter(function (e) {
    return e.start && sameInstant(e.start.dateTime, startISO) && isDecompressionTitle(e.summary);
  })[0];
}

/** Start/end of the block that belongs after `event`. */
function blockTimes(event) {
  var start = new Date(event.end.dateTime);
  var end = new Date(start.getTime() + DECOMPRESSION_MINUTES * 60000);
  var timeZone = event.end.timeZone || Session.getScriptTimeZone();
  return {
    start: { dateTime: start.toISOString(), timeZone: timeZone },
    end: { dateTime: end.toISOString(), timeZone: timeZone }
  };
}

function createDecompressionEvent(calendarId, event) {
  var times = blockTimes(event);
  var priv = {};
  priv[SOURCE_EVENT_KEY] = event.id;

  Calendar.Events.insert({
    summary: DECOMPRESSION_TITLE,
    start: times.start,
    end: times.end,
    colorId: DECOMPRESSION_COLOR_ID,
    transparency: 'opaque', // busy
    extendedProperties: { private: priv }
  }, calendarId);
}

/** Make sure a qualifying meeting has exactly one correctly placed block. */
function syncBlock(calendarId, event) {
  var own = findBlocksFor(calendarId, event.id)[0];

  if (own) {
    // Meeting moved or resized -> move the block with it.
    if (!sameInstant(own.start.dateTime, event.end.dateTime)) {
      var times = blockTimes(event);
      Calendar.Events.patch({ start: times.start, end: times.end }, calendarId, own.id);
    }
    return;
  }

  var existing = findBlockStartingAt(calendarId, event.end.dateTime);
  if (existing) {
    // Block from an older version of this script (untagged): adopt it.
    // A block already tagged for another meeting ending at the same moment
    // is shared, so leave it alone.
    if (!sourceIdOf(existing)) {
      var priv = {};
      priv[SOURCE_EVENT_KEY] = event.id;
      Calendar.Events.patch({ extendedProperties: { private: priv } }, calendarId, existing.id);
    }
    return;
  }

  createDecompressionEvent(calendarId, event);
}

function removeBlocksFor(calendarId, sourceEventId) {
  findBlocksFor(calendarId, sourceEventId).forEach(function (block) {
    Calendar.Events.remove(calendarId, block.id);
  });
}

/**
 * `cleanup` = also remove the meeting's block when the meeting is cancelled,
 * declined, or no longer qualifies. Only used for change notifications, where
 * the event list is small.
 */
function processEvent(calendarId, event, cleanup) {
  if (qualifies(event)) {
    syncBlock(calendarId, event);
  } else if (cleanup && !isDecompressionTitle(event.summary)) {
    removeBlocksFor(calendarId, event.id);
  }
}

/**
 * Installable trigger handler: fires on calendar change.
 * Uses a stored sync token to fetch only what changed since last run.
 */
function onCalendarChange(e) {
  var calendarId = getCalendarId();
  var props = PropertiesService.getScriptProperties();
  var syncToken = props.getProperty(SYNC_TOKEN_PROPERTY);
  var pageToken = null;
  var items = [];

  try {
    do {
      var params = { showDeleted: true, singleEvents: true, maxResults: 100 };
      if (pageToken) params.pageToken = pageToken;
      if (syncToken) {
        params.syncToken = syncToken;
      } else {
        params.timeMin = new Date().toISOString();
        params.timeMax = new Date(Date.now() + RECONCILE_WINDOW_DAYS * 24 * 60 * 60000).toISOString();
      }

      var resp = Calendar.Events.list(calendarId, params);
      items = items.concat(resp.items || []);
      pageToken = resp.nextPageToken;
      if (!pageToken) {
        props.setProperty(SYNC_TOKEN_PROPERTY, resp.nextSyncToken);
      }
    } while (pageToken);
  } catch (err) {
    // Expired/invalid sync token -> drop it and do a fresh full sync.
    if (err.message && err.message.indexOf('410') !== -1) {
      props.deleteProperty(SYNC_TOKEN_PROPERTY);
      onCalendarChange(e);
      return;
    }
    throw err;
  }

  items.forEach(function (event) { processEvent(calendarId, event, true); });
}

/**
 * Daily safety-net reconciliation over the next two weeks: backfill missing
 * blocks, then sweep blocks whose meeting no longer qualifies.
 */
function dailyReconcile() {
  var calendarId = getCalendarId();
  var now = Date.now();
  var timeMin = new Date(now).toISOString();
  var timeMax = new Date(now + RECONCILE_WINDOW_DAYS * 24 * 60 * 60000).toISOString();
  var qualifyingIds = {};
  var pageToken = null;

  do {
    var params = { timeMin: timeMin, timeMax: timeMax, singleEvents: true, maxResults: 100 };
    if (pageToken) params.pageToken = pageToken;
    var resp = Calendar.Events.list(calendarId, params);
    (resp.items || []).forEach(function (event) {
      if (qualifies(event)) qualifyingIds[event.id] = true;
      processEvent(calendarId, event, false);
    });
    pageToken = resp.nextPageToken;
  } while (pageToken);

  // Only judge blocks starting at least a minute into the window: their meeting
  // ends after timeMin, so it is guaranteed to be in the list above.
  sweepOrphanBlocks(calendarId, new Date(now + 60000).toISOString(), timeMax, qualifyingIds);
}

function sweepOrphanBlocks(calendarId, sweepMin, timeMax, qualifyingIds) {
  var pageToken = null;
  do {
    var params = { timeMin: sweepMin, timeMax: timeMax, singleEvents: true, q: 'Decompression', maxResults: 100 };
    if (pageToken) params.pageToken = pageToken;
    var resp = Calendar.Events.list(calendarId, params);
    (resp.items || []).forEach(function (block) {
      var sourceId = sourceIdOf(block);
      if (sourceId && isDecompressionTitle(block.summary) && !qualifyingIds[sourceId]) {
        Calendar.Events.remove(calendarId, block.id);
      }
    });
    pageToken = resp.nextPageToken;
  } while (pageToken);
}

/**
 * Run this once by hand to set everything up.
 */
function initialize() {
  var calendarId = getCalendarId();

  ScriptApp.getProjectTriggers().forEach(function (t) {
    var fn = t.getHandlerFunction();
    if (fn === 'onCalendarChange' || fn === 'dailyReconcile') {
      ScriptApp.deleteTrigger(t);
    }
  });

  ScriptApp.newTrigger('onCalendarChange').forUserCalendar(calendarId).onEventUpdated().create();
  ScriptApp.newTrigger('dailyReconcile').timeBased().everyDays(1).atHour(3).create();

  PropertiesService.getScriptProperties().deleteProperty(SYNC_TOKEN_PROPERTY);
  onCalendarChange(); // seeds the sync token and processes the current window
}
