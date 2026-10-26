# 😎 Decompression

A Google Apps Script that automatically adds a 15-minute **😎 Decompression** block to your Google Calendar right after your calls and meetings, so you get a built-in buffer instead of blocking it by hand.

```
2:00 – 3:00   Product sync (with 4 guests)
3:00 – 3:15   😎 Decompression   <- added automatically
```

It runs entirely inside your own Google account. There is no server, no third-party service, and no data leaves Google.

## How it works

- **`onCalendarChange`** is an installable *Calendar - Event Updated* trigger. Google fires it when any event on your primary calendar is created, updated, or deleted. The script uses the Calendar API's incremental **sync token** to fetch only what changed, then adds a Decompression block for any qualifying event that doesn't already have one. Delivery typically takes a few minutes, so it is not instant.
- **`dailyReconcile`** is a safety net. Calendar-update triggers aren't guaranteed to fire on every change, so once a day (around 3am) the script rescans the next 13 days, backfills anything missing, and removes blocks whose meeting no longer exists.

Each block is tagged with a private extended property (`decompressionFor`) holding the ID of the meeting it belongs to. That is how the block **follows its meeting** when you move or resize it, and **disappears** when the meeting is cancelled, declined, or stops qualifying. Duplicates are avoided by looking up the tag; if two meetings end at the same moment they share one block. Blocks created by earlier versions of the script (untagged) are adopted automatically.

## Which events get a block

An event qualifies if **either**:

- it has other guests on it, **or**
- you organized it and its title starts with `Call`, `Meeting`, or `Interview`.

It is skipped if it is:

- declined by you,
- an all-day event, or
- itself a Decompression event.

The block is **Busy**, colored **Graphite**, and is added even if it overlaps your next meeting (it is a soft reminder, not a hard scheduling block).

## Setup

You do this once, under your own Google account.

1. Go to [script.google.com](https://script.google.com) and create a **New project**.
2. Delete the placeholder code and paste in all of [`decompression.gs`](decompression.gs).
3. In the left sidebar click **Services (+)** and add **Calendar API**. This is the *Advanced* Calendar Service (needed for sync tokens), which is different from the built-in `CalendarApp`.
4. In the toolbar function dropdown, select **`initialize`**, then click **Run**. Approve the Google authorization prompt (it needs Calendar read/write).
5. Open **Triggers** (clock icon) and confirm you see:
   - `onCalendarChange`, event source *Calendar - Event Updated*
   - `dailyReconcile`, time-driven, daily

> **Gotcha:** if you click Run and get *"Attempted to execute myFunction, but it was deleted"*, the function dropdown is still pointing at the deleted placeholder. Pick `initialize` from the dropdown first.

`appsscript.json` is included as a reference for the required runtime, advanced service, and OAuth scopes. If you prefer [`clasp`](https://github.com/google/clasp), it will push as-is (set `timeZone` to your own first).

## Customize

Edit the constants at the top of `decompression.gs`:

| Constant | Default | Meaning |
|---|---|---|
| `DECOMPRESSION_TITLE` | `😎 Decompression` | Title of the added event |
| `DECOMPRESSION_MINUTES` | `15` | Length of the block |
| `DECOMPRESSION_COLOR_ID` | `'8'` (Graphite) | [Calendar color ID](https://developers.google.com/calendar/api/v3/reference/colors) |
| `RECONCILE_WINDOW_DAYS` | `13` | How far ahead the daily scan and first sync look |

To change which self-organized events qualify, edit the regex in `qualifies()`: `/^\s*(call|meeting|interview)\b/i`.

After changing the code, re-run `initialize` so the triggers and sync token are reset cleanly.

## Verify it works

1. Create a test event with a guest, or a solo event titled `Meeting: test`.
2. Within a few minutes a 15-minute **😎 Decompression** block should appear right after it.
3. Edit and re-save the event. No second block should be created.
4. Move the meeting to a different time. The block should move with it. Cancel or decline the meeting and the block should be removed.
5. Check **Executions** in the Apps Script sidebar to see each trigger run and any errors.

## Limitations

- Primary calendar only.
- Trigger delivery is best-effort and can lag (that is what the daily job is for).
- If you delete a block by hand while its meeting still qualifies, the script re-adds it the next time that meeting changes or the daily job runs.
- If two meetings end at the same moment they share one block. Cancelling the one that owns it removes the block until the daily job (or the other meeting's next change) re-creates it.
- Subject to normal [Apps Script quotas](https://developers.google.com/apps-script/guides/services/quotas).

## Uninstall

1. In the Apps Script project, open **Triggers** and delete `onCalendarChange` and `dailyReconcile` (or delete the whole project).
2. Delete any remaining *😎 Decompression* events from your calendar.

## License

[MIT](LICENSE)
