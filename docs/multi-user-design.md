# Multi-user design

## Agreed implementation

This section is the source of truth. The Cognito proposal below is kept as
background and is superseded wherever it disagrees, especially on the identity
provider, deck visibility, migration, weekly releases, and admin stats.

Open pull request #9 (`cursor/multi-user-phases-1-3-9752`) is an earlier Cognito
draft. Do not merge it with this work. Pull request #13
(`cursor/durable-auth-and-performance-73bb`) is merged into this branch: DynamoDB
login limits, server-side session revocation, the 30-day `reviewedAt` bound,
login contrast, self-hosted Noto fonts, and the study-queue performance work.
Merge #13 before this pull request so `main` takes that diff first.

### Auth

Auth.js (NextAuth v5) with the Google provider replaces the shared password
when `AUTH_MODE=google`. Until that flag is set, `APP_PASSWORD` still works so
a deploy cannot lock the live site out before Google OAuth exists.

- Open signup. Anyone with a verified Google email gets a learner account.
- Admin is not a Google group. It is `ADMIN_EMAILS`, a comma-separated
  allowlist, and it is granted only when Google reports `email_verified`.
  An unverified address on the allowlist is still a non-admin, and sign-in is
  rejected until Google verifies the email.
- The app user id is stable and is not the email and not the Google `sub`.
  The link item is `PK=AUTH#google#<sub>`, `SK=LINK`, pointing at `userId`.
  Later sign-ins resolve only that subject. Changing the Google email does not
  move progress to another account.
- The admin account is a different Google user. It cannot study, has no review
  queue, and cannot write progress. Study routes return 403.
- The admin sees overall per-user stats only: cards studied, review count,
  streak, last review time. `GET /api/admin/users/:id/cards` is 403 for
  everyone, including admins. Responses are passed through an allowlist so a
  directory row cannot leak card fields.

Shared-password and Google sessions use the same DynamoDB rows. They do not
overlap progress (`PROGRESS#`), profiles, or hidden cards:

```txt
PK = USER#<userId>   SK = AUTH                  sessionVersion
PK = USER#<userId>   SK = SESSION#<sessionId>   expiresAt, ttl
```

The password principal stays `shared` until cutover. Google sessions use the
stable app user id (`user_...`), never the email and never the Google `sub`.
Logout deletes that `SESSION#` row. Log out everywhere adds 1 to
`sessionVersion`, so every browser and the installed app for that user fails
the check even if other session rows remain until TTL. A Google token without
a session id and version is treated as signed out.

Login failures share one limiter, including a Google sign-in whose email
Google has not verified:

```txt
PK = AUTH#LOGIN   SK = ATTEMPT#<sha256 of the last X-Forwarded-For hop>
```

A block refuses the next password attempt with 429 and refuses the Google
callback until the window passes. A successful sign-in clears the row.

### Data

One DynamoDB table. Card text is separate from per-user progress.

- Global decks: `PK=GLOBAL#DECKS`, `SK=DECK#<deckId>`
- Global cards: `PK=GLOBAL#DECK#<deckId>`, `SK=CARD#<cardId>`
- Private decks: `PK=USER#<userId>#DECKS`, `SK=DECK#<deckId>`
- Private cards: `PK=USER#<userId>#DECK#<deckId>`, `SK=CARD#<cardId>`
- Progress: `PK=USER#<userId>`, `SK=PROGRESS#GLOBAL|PRIVATE#<deckId>#CARD#<cardId>`
- Hidden global cards: `PK=USER#<userId>`, `SK=HIDDEN#GLOBAL#<deckId>#CARD#<cardId>`
- Learner directory for admin totals: `PK=USERS`, `SK=USER#<userId>`

No progress item means the card is new. Weekly drops do not write a progress
row per user. New learners see every released global deck. They can hide and
unhide global cards; hiding does not delete progress. Private decks are only
theirs. Learners cannot edit global text.

`DATA_MODE=multi-user` reads and writes the split. `DATA_MODE=legacy`, or
unsetting `DATA_MODE`, rolls reads back to the original `DECKS` / `DECK#` /
inline FSRS items. Migrated rows are never required for that rollback because
the migration does not delete or overwrite them.

### Weekly uploads

Admin CSV flow: preview, save draft, set a release date labeled `week N`, or
press publish now. There is no scheduler. A learner's read checks `status` and
`releaseAt`:

- `draft` is hidden
- `scheduled` is hidden until `releaseAt` is in the past
- `published` is visible immediately, including when publish-now overrides a
  future date
- migrated decks are stored as `published`
- archived decks and cards are hidden

### Admin edits

The edit form does not save until the admin chooses:

- Typo fix: same card id, `contentVersion` increases, every learner's progress
  stays.
- Meaning change: the old card gets `archivedAt` and keeps its progress for
  history; a new card id is created with no progress.

### Migration

All current decks become global. Deck and card ids do not change. FSRS,
modes, practice, hard markers, and review version are copied onto `PROGRESS#`
items for the placeholder user `user_legacy_nj277`. A claim item
`CLAIM#email#<email>` points at that id. The default email is
`nj277@cornell.edu`. The first Google sign-in whose **verified** email matches
the claim adopts that user id and writes `AUTH#google#<sub>`. After that, only
the subject matches. A different Google subject with the same email does not
receive the progress.

The script is `npm run migrate:multi-user`. It prints a backup reminder, dry
runs unless `--apply --i-backed-up` are both set, and reports before/after
counts. It refuses `TABLE_NAME=flashcards` with no override, and it refuses a
real AWS endpoint unless `MIGRATION_ALLOW_REMOTE=1` (still not `flashcards`).
Do not run it against production from this change. Apply it yourself to a
copied table, check the counts, then apply to production only after a backup.

`cornell.edu` may not be a Google account (campus Microsoft sign-in is
common). Fallback: set `LEGACY_OWNER_EMAIL` to a personal Gmail **before the
first apply**, then sign in with that verified Gmail. Adding a Microsoft
provider later is an Auth.js provider plus an `AUTH#microsoft#<sub>` link to
the same app user id; it is not wired in this change. Do not put the study
Gmail in `ADMIN_EMAILS` or that account becomes the admin and cannot study.

Suggested order:

1. Back up `flashcards`.
2. Restore a copy and dry-run, then apply, against the copy.
3. Create the Google OAuth client and Amplify env vars below.
4. Deploy with `AUTH_MODE=google` and `DATA_MODE=multi-user` only after the
   production apply. Leaving the flags unset keeps today's password app.
5. Sign in once with the verified claim email. Use a different verified Google
   email for the admin.

### Environment variables

Shared-password mode (today's default):

- `APP_PASSWORD`
- `SESSION_SECRET`
- `TABLE_NAME`
- `APP_REGION`
- `APP_TIME_ZONE`

Google multi-user mode:

- `AUTH_MODE=google`
- `DATA_MODE=multi-user` after migration (`legacy` rolls reads back)
- `AUTH_SECRET` (`openssl rand -hex 32`)
- `AUTH_GOOGLE_ID` (Google OAuth client id)
- `AUTH_GOOGLE_SECRET` (Google OAuth client secret)
- `AUTH_URL` (the site origin, such as `https://main.d3otcaeyemrjvk.amplifyapp.com`)
- `ADMIN_EMAILS` (comma-separated verified Google emails for admins only)
- `TABLE_NAME`, `APP_REGION`, `APP_TIME_ZONE`
- Optional `LEGACY_OWNER_EMAIL` for the migration script only

Amplify still does not pass console env vars into the SSR runtime. `npm run
env:production` hex-encodes `AUTH_SECRET` and `AUTH_GOOGLE_SECRET` into
`.env.production`, and the server decodes those `*_HEX` values before Auth.js
starts. Keep `APP_PASSWORD` and `SESSION_SECRET` set as well if you want to
flip `AUTH_MODE` back to shared.

### Google Cloud and Amplify setup

1. Google Cloud Console → APIs & Services → OAuth consent screen. External is
   fine. Add the app name and the support email. While the app is in testing,
   add every Google account that should sign in (the study account and the
   admin account). Publish the consent screen before real open signup.
2. Create an OAuth client ID of type **Web application**.
3. Authorized JavaScript origins:
   - `https://main.d3otcaeyemrjvk.amplifyapp.com`
   - `http://localhost:3000` for local development
4. Authorized redirect URIs:
   - `https://main.d3otcaeyemrjvk.amplifyapp.com/api/auth/callback/google`
   - `http://localhost:3000/api/auth/callback/google`
5. Copy the client id and secret into Amplify Hosting environment variables
   with the names above. Set `AUTH_URL` to the Amplify origin with no trailing
   path. Redeploy so `env:production` bakes them into the server bundle.
6. The existing Amplify compute role still needs DynamoDB read/write on
   `flashcards`, including `PutItem`, `UpdateItem`, `DeleteItem`, `Query`,
   `GetItem`, `BatchWriteItem`, `TransactWriteItems`, and `ConditionCheckItem`.
   Add `dynamodb:Scan` only if you run the migration from a machine using that
   role. Prefer running the migration from an admin workstation with a backup,
   not from the web app.
7. Do not merge until you have decided to cut over. Merging `main` deploys.
   With the flags unset, the deploy keeps the shared password.

---

## Earlier proposal (superseded where it conflicts)

This document proposes a practical multi-user design for FlashCardApp while
keeping the current Next.js App Router, TypeScript, DynamoDB single-table, FSRS,
CSV import/export, and iPhone PWA architecture.

The target product shape is:

- A dedicated admin account manages global decks/cards and oversees users.
- The admin account cannot study, has no study queue, and has no progress.
- Naijei's current account becomes a regular user account, with all existing
  progress, review history, hard markers, and stats preserved.
- Global decks are chosen per deck during migration.
- Regular users automatically see global decks/cards, can create private decks,
  and can hide/unhide global cards or whole global decks for themselves.
- Each regular user has independent FSRS state across all modes, hard markers,
  weekly goals, stats, and review history.
- Admin analytics can read per-user activity/progress and global deck usage
  efficiently.

## 1. Auth and accounts

### Options

#### Cognito User Pool

Recommended. Cognito fits the app's AWS Amplify Hosting deployment and covers
real account needs that should not be hand-rolled: self sign-up, email
verification, password reset, account disable/delete, MFA options, hosted login,
JWT issuance, and user groups.

This app only needs users to call its own Next.js routes, so it does not need a
Cognito Identity Pool unless the browser later calls AWS services directly.
Amplify SSR compute can continue using its server-side IAM role for DynamoDB.

#### Auth.js with Cognito provider

Reasonable if the app wants Auth.js to manage Next.js session cookies and route
helpers while Cognito remains the identity provider. This adds a dependency and
an abstraction layer, but can reduce custom OAuth/session code.

#### Roll-your-own accounts in DynamoDB

Not recommended. Password storage, reset, email verification, account recovery,
session revocation, brute-force defense, MFA, and abuse handling are easy to get
wrong. The current shared password is suitable for a personal app, not for open
multi-user signup.

### Recommendation

Use a Cognito User Pool with self sign-up and email verification enabled.

Implementation choices:

- Use Cognito Hosted UI / Managed Login directly, or Auth.js with Cognito as the
  provider.
- Use auth code + PKCE for browser/mobile login.
- Validate Cognito tokens server-side, or use Auth.js server sessions backed by
  Cognito.
- Keep a server-side session helper shaped like the current `requireSession()`
  and `requireAuth()`, but have it return account context:

```txt
userId
email
role = "admin" | "user"
isAdmin
```

Never accept `userId` or role from request bodies.

### Session revocation already in the shared-password app

The agreed implementation above keeps this key shape for the shared password
and for Google. Logout and “log out everywhere” use the same
user partition this design expects. The current principal is `shared` (the
pre-Cognito account that migration should attach to Naijei’s regular user, not
the admin):

```txt
PK = USER#<userId>
SK = AUTH
sessionVersion

PK = USER#<userId>
SK = SESSION#<sessionId>
sessionVersion
expiresAt
ttl
```

A JWT carries `sub` (user id), `sid` (session id), and `sv` (session version).
Logout deletes that session row. Log out everywhere adds 1 to `sessionVersion`,
which rejects every existing token for that user even if other session rows
remain until TTL. Cognito migration can keep this shape and substitute the
Cognito `sub` for `shared`.

Login rate-limit rows are not user progress:

```txt
PK = AUTH#LOGIN
SK = ATTEMPT#<sha256>
failures
windowStartedAt
blockedUntil
ttl
```

### Roles

Use either Cognito groups or app metadata synchronized from Cognito.

Recommended Cognito groups:

- `admins`: the dedicated admin account only.
- regular users: no admin group.

The dedicated admin account can:

- create, edit, archive, and restore global decks/cards
- import/export global deck content
- see and manage all users
- disable or delete users
- view all users' progress and stats read-only
- view global deck usage analytics

The admin account cannot:

- study
- create review logs for itself
- have a review queue
- have progress rows
- have weekly goals or personal FSRS stats
- call review/queue/write/pinyin/study APIs

Server-side guards should reject admin calls to study/review routes with a 403,
even if the admin UI does not link to those pages.

Naijei's current account should be created as a regular user account. Existing
cards, progress, hard markers, review logs, receipts, and stats migrate to that
regular user, not to the admin account.

### Signup and abuse protections

Signup is open with email verification. Because this is a small app backed by
paid AWS resources, add guardrails before making it public:

- Cognito email verification required.
- Rate-limit signup, login, password reset, import, card creation, and review
  submission routes.
- Consider CAPTCHA or turnstile on signup if abuse appears.
- Per-user caps, configurable by admin:
  - private decks per user
  - private cards per user
  - CSV import rows and bytes per import
  - imports per day
  - review submissions per minute
- Keep current file/import limits and make them user-scoped.
- Admin ability to disable users quickly.
- CloudWatch alarms for signup spikes, failed auth spikes, DynamoDB throttles,
  and unusually high write volume.

## 2. Data model

The current `Card` stores both content and progress:

- content: `front`, `back`, `notes`, deck membership
- progress: `fsrs`, `modes`, `practice`, `hard`

For multi-user, split content from per-user progress. The app can still expose a
merged/effective card object to existing FSRS and UI code.

### Entity overview

Use one DynamoDB table with `PK` and `SK`, preserving the single-table approach.

#### User profile

Cognito remains the auth source of truth. Store app metadata and admin dashboard
fields in DynamoDB:

```txt
PK = USER#<userId>
SK = PROFILE
email
displayName
role = "user" | "admin"
status = "active" | "disabled" | "deleted"
createdAt
lastSeenAt
privateDeckCount
privateCardCount
```

The admin account has a profile row but no progress rows.

#### Global deck content

```txt
PK = GLOBAL#DECKS
SK = DECK#<deckId>
name
frontLanguage
backLanguage
chineseSide
createdAt
updatedAt
archivedAt?
```

#### Global card content

```txt
PK = GLOBAL#DECK#<deckId>
SK = CARD#<cardId>
front
back
notes
createdAt
updatedAt
contentVersion
archivedAt?
```

Global cards are content only. They never store FSRS state, practice stats, or
hard markers.

#### Private user decks

```txt
PK = USER#<userId>#DECKS
SK = DECK#<deckId>
name
frontLanguage
backLanguage
chineseSide
createdAt
updatedAt
archivedAt?
```

#### Private user card content

```txt
PK = USER#<userId>#DECK#<deckId>
SK = CARD#<cardId>
front
back
notes
createdAt
updatedAt
contentVersion
archivedAt?
```

#### Per-user progress

Create progress lazily. A missing progress item means the card is visible but
unseen/new for that user.

Global card progress:

```txt
PK = USER#<userId>
SK = PROGRESS#GLOBAL#<deckId>#CARD#<cardId>
source = "global"
deckId
cardId
fsrs
modes
practice
hard
hidden?
contentVersionSeen
updatedAt
reviewVersion
```

Private card progress:

```txt
PK = USER#<userId>
SK = PROGRESS#PRIVATE#<deckId>#CARD#<cardId>
source = "private"
deckId
cardId
fsrs
modes
practice
hard
hidden?
contentVersionSeen
updatedAt
reviewVersion
```

The current `modes.write` and `modes.pinyin` structure can move into this item
largely unchanged.

#### Hide/unhide global content

Users can hide global cards or whole global decks without changing global
content.

Hide global deck:

```txt
PK = USER#<userId>
SK = HIDDEN#GLOBAL#DECK#<deckId>
hiddenAt
```

Hide global card:

```txt
PK = USER#<userId>
SK = HIDDEN#GLOBAL#<deckId>#CARD#<cardId>
hiddenAt
```

Unhide deletes the hide marker. Hiding a deck excludes its cards from deck
lists, all-cards study, queues, due counts, weekly goals, and stats for that
user. It does not delete the user's progress, so unhide restores the card with
the same FSRS state.

Private decks/cards can use `archivedAt` or delete behavior rather than hidden
markers, because the user owns that content.

#### User-scoped review logs

```txt
PK = USER#<userId>#LOGS
SK = <reviewISO>#<source>#<deckId>#<cardId>#<clientReviewId>
source = "global" | "private"
deckId
cardId
mode
rating
reviewedAt
appliedAt
due
stability
difficulty
elapsed_days
scheduled_days
```

#### User-scoped review receipts

```txt
PK = USER#<userId>#REVIEW_REQUESTS
SK = <clientReviewId>
source
deckId
cardId
mode
rating
reviewedAt
```

Client review IDs only need to be unique per user. Scoping receipts by user
prevents collisions across accounts.

#### User stats

```txt
PK = USER#<userId>#META
SK = STATS
reviewCount
lastReviewAt
updatedAt
```

For admin analytics, maintain lightweight aggregate rows as reviews are
committed. This avoids scanning every user's review logs for dashboards.

Per-user daily activity:

```txt
PK = ANALYTICS#USER#<userId>
SK = DAY#<yyyy-mm-dd>
reviews
introducedWords
againCount
hardCount
goodCount
easyCount
activeDeckIds
updatedAt
```

Global deck daily usage:

```txt
PK = ANALYTICS#GLOBAL#DECK#<deckId>
SK = DAY#<yyyy-mm-dd>
activeUsers
reviews
introducedWords
hiddenCount
updatedAt
```

For distinct active users per global deck per day, exact counting in DynamoDB can
be expensive if implemented with one huge set. Prefer one of these:

- write idempotent marker rows like
  `PK=ANALYTICS#GLOBAL#DECK#<deckId>#DAY#<date>`,
  `SK=USER#<userId>`, then count/query with pagination for admin detail; or
- keep approximate counters initially and add exact marker rows only if needed.

For a small personal/community app, marker rows are simple and accurate.

### Access patterns

#### Regular user: list visible decks

1. Query `GLOBAL#DECKS`.
2. Query `USER#<userId>#DECKS`.
3. Query user's hidden global deck markers.
4. Filter hidden/archived decks.
5. Merge global and private decks.

#### Regular user: list cards in one global deck

1. Query `GLOBAL#DECK#<deckId>`.
2. Query or batch-get matching `PROGRESS#GLOBAL#...` rows for the user.
3. Query hidden card markers for that user/deck.
4. Merge content + progress into effective cards.
5. Filter archived/hidden cards.

#### Regular user: list cards in one private deck

1. Query `USER#<userId>#DECK#<deckId>`.
2. Query or batch-get matching `PROGRESS#PRIVATE#...` rows.
3. Merge content + progress.

Private cards could store progress inline to reduce reads, but using the same
content/progress split for private and global cards keeps review code simpler.

#### Regular user: build all-cards queue

1. Load visible global decks/cards.
2. Load private decks/cards.
3. Load user progress and hide markers.
4. Merge to effective cards.
5. Reuse existing queue logic.

This preserves the current ability to study all cards while keeping each user's
progress independent.

#### Review commit

Only regular users can call this path.

1. Validate session role is `user`.
2. Validate source card exists and is visible to the user.
3. Load progress item or synthesize empty state from content `createdAt`.
4. Apply FSRS for the requested mode.
5. Transactionally write:
   - progress item
   - review log
   - review receipt
   - user stats
   - analytics aggregate updates

#### Admin: user management dashboard

Efficient dashboard reads should use profile and aggregate rows:

- Query/list `USER#... PROFILE` rows via an admin index pattern or a maintained
  user directory partition.
- Query `ANALYTICS#USER#<userId>` for recent per-user activity.
- Query `USER#<userId>#META/STATS` for totals.
- Query progress rows by user only when drilling into one user's details.

Because DynamoDB cannot query all `USER#...` profiles without a scan unless they
share a partition or GSI, add a user directory item collection:

```txt
PK = USERS
SK = USER#<userId>
email
role
status
createdAt
lastSeenAt
reviewCount
lastReviewAt
privateDeckCount
privateCardCount
```

Update this summary on sign-up, login, user disable/delete, and review commits.
The admin dashboard can query `PK=USERS` with pagination.

#### Admin: global deck usage dashboard

Use global deck summary rows and daily analytics:

```txt
PK = GLOBAL#DECK#<deckId>
SK = SUMMARY
cardCount
activeUserCount7d
reviewCount7d
hiddenByUserCount
lastReviewedAt
updatedAt
```

Admin dashboard shows:

- total users, active users today/7 days/30 days
- new signups
- disabled/deleted users
- per-user review counts and last active time
- per-user due/new counts when drilling into a user
- global deck card counts
- global deck active users
- global deck reviews/introduced words over time
- most hidden global decks/cards
- cards with high Again rates across users

Avoid computing this by scanning logs. Maintain aggregates during review commits
and hide/unhide actions.

### Global card edits/deletes

Admin edits need a policy because users may have progress tied to content.

#### Minor edits

Examples: typo, punctuation, note clarification, pronunciation annotation fix.

- Keep same card ID.
- Increment `contentVersion`.
- Preserve all user progress.
- User progress can store `contentVersionSeen` for diagnostics, but the current
  FSRS state remains valid.

#### Meaning-changing edits

Examples: changing the target word, changing a translation enough that prior
memory no longer applies.

Recommended policy:

- Create a new card.
- Archive the old card.
- Existing user progress remains attached to the old archived card for history.
- New card starts unseen for every user.

#### Delete/archive

Prefer soft archive:

- Set `archivedAt` on the global card or deck.
- Exclude it from queues and normal lists.
- Keep user progress/logs intact.
- Admin can restore later.

Hard delete should be rare and should require an export/backup first.

## 3. Migration

Migration creates two real accounts:

- dedicated admin account with role `admin`
- Naijei's regular user account with role `user`

The admin receives no study data. Naijei's user receives all existing progress
and history.

### Deck selection config

Use an explicit migration config listing existing deck IDs and target visibility.
Example:

```json
{
  "naijeiUserId": "cognito-sub-for-naijei",
  "adminUserId": "cognito-sub-for-admin",
  "decks": {
    "deck-id-1": "global",
    "deck-id-2": "private",
    "deck-id-3": "global"
  }
}
```

Any deck missing from the config should fail migration validation rather than
defaulting silently. That prevents accidentally publishing a private deck as
global.

### Migration behavior

For each existing deck:

- If config says `global`:
  - write deck content to `GLOBAL#DECKS`
  - write card content to `GLOBAL#DECK#<deckId>`
  - write each card's current FSRS/practice/modes/hard data as Naijei's
    `PROGRESS#GLOBAL#...` item
- If config says `private`:
  - write deck content to `USER#<naijeiUserId>#DECKS`
  - write card content to `USER#<naijeiUserId>#DECK#<deckId>`
  - write each card's current FSRS/practice/modes/hard data as Naijei's
    `PROGRESS#PRIVATE#...` item

Review logs:

- move existing `LOGS` rows to `USER#<naijeiUserId>#LOGS`
- include `source` based on the deck migration config
- preserve review timestamps, card IDs, ratings, mode, FSRS log fields, and
  client review IDs

Review receipts:

- move existing `REVIEW_REQUESTS` rows to
  `USER#<naijeiUserId>#REVIEW_REQUESTS`
- include `source` based on deck config

Stats:

- move current `META/STATS` to `USER#<naijeiUserId>#META/STATS`
- create/update `USERS / USER#<naijeiUserId>` summary row

Admin:

- create `USER#<adminUserId> / PROFILE`
- create `USERS / USER#<adminUserId>` summary row
- do not create progress, logs, receipts, or stats for admin

### Migration safety

The migration script should be idempotent:

- use deterministic target keys
- use conditional writes where possible
- never delete old records during the first migration pass
- write a migration report:
  - source deck count
  - global deck count
  - private deck count
  - source card count
  - migrated content count
  - migrated progress count
  - review log count
  - review receipt count
  - hard marker count
  - due/new counts before and after for Naijei

Recommended rollout:

1. Run against a copied table or staging table.
2. Validate counts and sample cards.
3. Deploy multi-user code in maintenance window or with dual-read fallback.
4. Run production migration.
5. Keep old records for rollback until Naijei confirms production behavior.

## 4. Code impact

This section names areas likely to change. It is intentionally docs-only; no app
code is changed by this proposal.

### Auth/session

Likely files:

- `lib/auth.ts`
- `lib/session.ts`
- `lib/api.ts`
- `app/login/page.tsx`
- `app/api/auth/login/route.ts`
- `app/api/auth/logout/route.ts`
- `app/(app)/layout.tsx`

Changes:

- replace shared password auth with Cognito-backed accounts
- have session helpers return user context
- add `requireRegularUser()` for study/review routes
- add `requireAdmin()` for global management and admin dashboards
- reject admin role from review queues, review commits, write/pinyin study, hard
  marker changes, and weekly personal progress APIs

### Types

Likely file:

- `lib/types.ts`

Changes:

- split card content from card progress
- represent card source: `global` or `private`
- keep or introduce an effective merged card type for existing FSRS/UI code
- add user profile and admin summary types
- add hide marker types

### Data layer

Likely file:

- `lib/db.ts`

This is the largest change. Current functions assume one global namespace.
Future functions should be user-aware:

- `listDecksForUser(user)`
- `listCardsForUserDeck(user, deckRef)`
- `listAllCardsForUser(user)`
- `getCardForReview(user, cardRef)`
- `commitReview(user, review)`
- `setCardHard(user, cardRef, hard)`
- `hideGlobalDeck(user, deckId)`
- `unhideGlobalDeck(user, deckId)`
- `hideGlobalCard(user, deckId, cardId)`
- `unhideGlobalCard(user, deckId, cardId)`

Admin/global functions:

- `listUsersForAdmin`
- `getUserForAdmin`
- `disableUser`
- `deleteUser`
- `listGlobalDecksForAdmin`
- `putGlobalDeck`
- `archiveGlobalDeck`
- `putGlobalCard`
- `archiveGlobalCard`
- `listUserProgressForAdmin`
- `listGlobalDeckUsageForAdmin`

Watch out for:

- no admin progress rows
- no cross-user progress leaks
- source refs included in review receipts/logs
- hidden global cards excluded from queues/counts
- archived global content excluded from regular-user queues

### Review and queue routes

Likely files:

- `app/api/review/queue/route.ts`
- `app/api/review/route.ts`
- `components/useStudyQueue.ts`
- `components/reviewSync.ts`
- `lib/review-queue.ts`
- `lib/pinyin-queue.ts`
- `lib/modes.ts`
- `lib/practice.ts`

Changes:

- route guards must require regular user role
- queue API must load visible global plus private cards
- review payload should include card source:

```txt
source = "global" | "private"
deckId
cardId
mode
rating
clientReviewId
reviewedAt
```

- idempotency receipts are scoped by user
- review commits update progress, not content
- analytics aggregates update transactionally or with retry-safe follow-up writes

Most FSRS logic can remain unchanged if it receives merged/effective cards.

### Deck/card/import/export UI and routes

Likely files:

- `app/api/decks/route.ts`
- `app/api/decks/[id]/route.ts`
- `app/api/cards/route.ts`
- `app/api/cards/[id]/route.ts`
- `app/api/cards/[id]/hard/route.ts`
- `app/api/import/route.ts`
- `app/api/decks/[id]/export/route.ts`
- `components/AddCardForm.tsx`
- `components/CardRow.tsx`
- `components/DeckSettings.tsx`
- `components/ImportWizard.tsx`

Changes:

- regular users create private decks/cards only
- admin creates/edits/imports global decks/cards only
- hard marker writes per-user progress
- global card/deck hide/unhide controls for regular users
- admin import should target global decks
- regular import should target private decks
- export should clarify whether it exports global content, private content, or a
  user's progress backup

### Stats, weekly goals, and admin analytics

Likely files:

- `app/(app)/stats/page.tsx`
- `components/WeeklyGoal.tsx`
- `app/api/progress/route.ts`
- `lib/forecast.ts`
- `lib/due.ts`
- `lib/words.ts`

Changes:

- regular stats read only the current user's effective visible cards/progress
- weekly goals count the user's introductions, not global card creation
- hidden global decks/cards are excluded
- admin dashboard uses `USERS`, `ANALYTICS#USER#...`, and
  `ANALYTICS#GLOBAL#DECK#...` aggregates rather than scanning all logs
- admin can drill into one user's progress read-only

### Pages/navigation

Likely files:

- `components/AppShell.tsx`
- `app/(app)/page.tsx`
- `app/(app)/decks/[deckId]/page.tsx`
- `app/(app)/browse/page.tsx`
- `app/(app)/settings/page.tsx`

Changes:

- regular users see study UI
- admin sees admin dashboard/global management UI
- admin should not see Start Review, Write Chinese, Write Pinyin, Normal Review,
  or weekly goal UI

## 5. Phased rollout plan

### Phase 1: Auth foundation - medium

- Add Cognito User Pool with open self sign-up and email verification.
- Add dedicated admin account in `admins` group.
- Create Naijei's regular user account.
- Replace shared-password session with real account session.
- Add server-side role guards:
  - admin routes
  - regular-user study/review routes
- Add basic signup/login rate limits.

Main risk: auth/session integration and making sure admin cannot reach study
routes.

### Phase 2: Data model split and compatibility layer - large

- Add content/progress types.
- Teach data layer to return merged/effective cards.
- Add user-scoped logs, receipts, stats.
- Add source refs for global/private cards.
- Keep UI behavior mostly unchanged for Naijei as a regular user.

Main risk: preserving existing FSRS state and idempotent review behavior.

### Phase 3: Migration tooling - medium

- Add migration config requiring every existing deck ID to be marked global or
  private.
- Write idempotent migration script.
- Run against staging/copied table.
- Validate counts and sample cards.
- Confirm Naijei's due queues and stats match pre-migration behavior.

Main risk: accidentally classifying a private deck as global or losing mode
progress.

### Phase 4: Global/private deck product behavior - large

- Regular users can create private decks/cards.
- Admin can manage global decks/cards.
- Users can hide/unhide global decks/cards.
- Review queues include visible global plus private content.
- Import/export paths split by role and target.

Main risk: source identity bugs and hidden-content filtering mistakes.

### Phase 5: Admin dashboard and analytics - medium to large

- Add user directory summary rows.
- Add per-user daily analytics.
- Add global deck usage analytics.
- Admin dashboard:
  - user list
  - activity and progress summaries
  - disable/delete users
  - global deck usage
  - high-failure global cards
  - hidden deck/card counts
- Add drill-down views for one user in read-only mode.

Main risk: analytics write amplification and expensive dashboard queries if
aggregates are not maintained.

### Phase 6: Abuse controls and operational hardening - medium

- Add configurable user caps.
- Add CAPTCHA if signup abuse appears.
- Add CloudWatch alarms.
- Add admin audit logs.
- Add CI checks before production deploy from `main`.

Main risk: underestimating abuse/cost exposure once signup is open.

## 6. Cost and security concerns

### Cost

- Cognito should be inexpensive at small scale, but verify current pricing.
- Open signup means costs are no longer fully controlled by Naijei's own usage.
- DynamoDB reads increase because many views now merge content plus progress.
- Admin analytics should use aggregate rows, not scans over every user's logs.
- Avoid per-user copying of global cards; it creates unnecessary write and
  storage amplification.
- Enforce per-user private card/import caps to avoid accidental or abusive table
  growth.
- Watch for hot partitions in analytics if every review updates the same global
  deck/day item. If needed, shard counters by bucket and roll them up for the
  dashboard.

### Security

- Use Cognito User Pool; do not store app passwords in DynamoDB.
- Require email verification for self sign-up.
- Use auth code + PKCE for browser/mobile login.
- Validate token issuer, audience/client ID, expiry, and token use server-side.
- Do not put an app client secret in browser code.
- Do not trust `userId`, email, or role from the client.
- Add `requireAdmin()` and `requireRegularUser()` server guards.
- Reject admin access to all study/review/progress-writing routes.
- Scope every content/progress read by authenticated user and source.
- Keep review receipts/logs user-scoped.
- Add CSRF protection if using cookie-authenticated POST routes.
- Add rate limits for auth-adjacent and write-heavy routes.
- Add admin audit logs for:
  - global deck/card changes
  - user disable/delete
  - role changes
  - viewing user progress if that needs accountability
- Use soft delete/archive for global content and users where possible.
- Be careful with admin analytics: it intentionally exposes every user's study
  progress to admin, so keep it admin-only and avoid leaking it through client
  props or cached pages.

## 7. Remaining decisions

The decisions below were the open questions in the first proposal. They are
answered in **Agreed implementation** at the top: Auth.js with Google (not
Cognito), admin from `ADMIN_EMAILS` plus `email_verified`, all current decks
global, weekly release dates checked at read time, typo versus meaning edits
enforced by the form, and admin stats without per-card progress.

Historical notes:

- Hosted UI directly, or Auth.js with Cognito provider?
- Exact private deck/card caps for regular users.
- Whether CAPTCHA is enabled from day one or only after abuse appears.
- Whether admin deletes users as hard delete, soft delete, or disable plus
  retention window.
- Whether semantic global card edits are enforced technically as "archive old
  and create new" or handled by admin convention.
- Whether user progress drill-down should show card-level details by default or
  require an explicit admin action.
- How long to retain old pre-migration records before cleanup.
