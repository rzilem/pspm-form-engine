---
name: pspm-survey
description: >
  Spin up and run informal live polls/surveys for PSPM HOA annual meetings
  (Slido/Mentimeter style — attendees answer on phones, results animate on a
  big screen). Use when the user wants to "create a survey", "run a live poll",
  "poll the room", "put a question on the screen", "show survey results",
  "advance to the next question", "start/close the poll", or asks what people
  voted during a meeting. NOT for formal elections/ballots/quorum voting — that
  is a separate system.
---

# PSPM Survey (live polling)

Wraps the PSPM Form Engine survey API. Informal in-meeting polling only.

- Base URL: `$PSPM_SURVEY_BASE_URL` (default `https://forms.psprop.net`).
- Auth: `Authorization: Bearer $PSPM_SURVEY_API_KEY` (machine credential — never
  the human admin password). The key is in `~/.claude/api_keys.env`; never echo
  its value into the transcript.

## Question types
`single_choice`, `multi_choice`, `yes_no`, `rating_scale`, `star`, `nps`,
`open_text`, `word_cloud`. Choice options may be plain strings (`["Yes","No"]`)
or `{id,label}`. Rating range via `config:{min,max}`; word cloud via
`config:{max_words}`.

## Commands

### Create a survey
Build the `questions[]` array from the user's description/agenda, then
`POST /api/surveys`. Default `visibility:"live_public"` unless the user says
results should stay private (`"private"`) or only show after voting closes
(`"after_close"`). After creating, present back in this order:
  1. The **join URL + room code** (read aloud / put on screen).
  2. The **QR image URL** (drop on the big screen).
  3. The **presenter URL** (open on the presenting laptop — it has the controls).
  4. **Save the `presenter_token`** — it is returned ONCE and authorizes the
     presenter controls.

```bash
curl -s -X POST "$PSPM_SURVEY_BASE_URL/api/surveys" \
  -H "Authorization: Bearer $PSPM_SURVEY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Falcon Pointe Annual Meeting — Live Poll",
    "meeting_label": "Falcon Pointe POA Annual Meeting 2026",
    "community": "falcon-pointe",
    "visibility": "live_public",
    "questions": [
      { "prompt": "Extend pool hours to 10pm in summer?", "type": "single_choice", "options": ["Yes","No","No opinion"] },
      { "prompt": "Rate board communication this year", "type": "rating_scale", "config": { "min": 1, "max": 5 } },
      { "prompt": "One word for the community this year", "type": "word_cloud", "config": { "max_words": 1 } }
    ]
  }'
```

### Start / advance / close a question
The presenter laptop drives this from the presenter URL, but a Claude session
can too with the `presenter_token`:
```bash
# header: X-Survey-Presenter-Token: <presenter_token>
# expected_epoch comes from GET /api/surveys/<id>/state (the state_epoch field)
POST /api/surveys/<id>/present   {"action":"open","expected_epoch":<n>}   # start / show first question
POST /api/surveys/<id>/present   {"action":"next","expected_epoch":<n>}   # next question
POST /api/surveys/<id>/present   {"action":"close","expected_epoch":<n>}  # close current voting
POST /api/surveys/<id>/present   {"action":"reveal","expected_epoch":<n>} # reveal results on screen
```
Actions: `open`, `next`, `prev`, `close`, `reopen`, `reveal`, `reset`. A `409`
means someone else advanced — re-read `/state` and retry with the new epoch.

### Open / close the whole poll
```bash
POST /api/surveys/<id>/status   {"status":"live"}     # before the meeting (open also auto-promotes on first question)
POST /api/surveys/<id>/status   {"status":"closed"}   # when done
```

### Show results
`GET /api/surveys/<id>/results` returns per-question aggregates (visibility-gated;
never raw responses). Summarize in plain English: winning option + margin per
question, rating averages, top words. Poll every few seconds only if the user
asks for a live readout.

## Conventions
- Group a meeting's polls with one `meeting_label` + `community`.
- Always echo the **room code + presenter URL**, and confirm the
  `presenter_token` is saved (it's shown once).
- Free-text + word-cloud default to **pre-approve** moderation for live_public —
  terms are held until a presenter approves them (so a heckler can't put crude
  text on the big screen).
- If the user blurs "vote"/"election" with "poll/survey", clarify: this skill is
  informal in-meeting polling only. Formal ballots go through the elections system.

## Composition
- `board-weekly-updates` — feed `GET /api/surveys/<id>/results` into a board recap.
- `pspm-brand-guidelines` — participant/presenter pages already render in PSPM
  navy/blue/green (never pspmCyan).
