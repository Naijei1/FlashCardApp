# Multi-user design proposal

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

The major product questions from the first draft are now answered. Remaining
implementation decisions:

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

## 8. Implementation decisions for phases 1–3

These choices close the options this rollout had to make. Phases 4–6 are
unchanged.

### Auth stays opt-in until cutover

- `AUTH_MODE` defaults to `shared`. The current password login, session cookie,
  and legacy DynamoDB keys stay in use. Production behavior does not change
  until `AUTH_MODE` is set to `cognito` after the migration is validated.
- `AUTH_MODE=local-dev` trusts `x-flashcards-dev-user-id` and
  `x-flashcards-dev-role` headers so tests can simulate accounts. It throws if
  `NODE_ENV=production`, and the production env writer rejects it.
- Cognito is used directly. There is no Auth.js dependency. The browser flow is
  authorization code + PKCE against the hosted UI (`/api/auth/cognito/login`
  and `/api/auth/cognito/callback`), active only when `AUTH_MODE=cognito`.
- The server accepts Cognito **ID tokens** only (`token_use=id`), and checks
  issuer, audience (`COGNITO_CLIENT_ID`), and expiry. Role is `admin` only when
  the `admins` group is present. A `role` claim in the token is ignored.
- The ID token is stored in the existing httpOnly session cookie and lives only
  until its `exp`. Refresh tokens are not stored yet.
- Shared-password tokens with no `role` claim remain a regular user
  (`legacy-user`). `requireRegularUser()` therefore still allows study in the
  current app.
- Signup stays on the Cognito hosted UI with email verification. The app does
  not add its own signup route. Login attempts keep the existing limiter, and
  the Cognito start route is limited to 20 attempts per 15 minutes per IP.
  Signup abuse controls beyond Cognito are phase 6.
- No per-user caps, CAPTCHA, or admin delete policy are implemented in this
  rollout. Those remain phases 5 and 6.

### Compatibility layer

- `AUTH_MODE=shared` continues to read and write `DECKS`, `DECK#…`, `LOGS`,
  `REVIEW_REQUESTS`, and `META/STATS`.
- `cognito` and `local-dev` use the design's global/private content keys,
  per-user progress, logs, receipts, and stats. Callers still receive the
  existing `Card` shape, with optional `source`.
- Private cards use the same content/progress split as global cards.
- Missing progress means a new card. Hide markers are separate items; unhide
  deletes only the marker. Hiding never deletes progress.
- In multi-user mode, deleting a deck archives it (`archivedAt`) instead of
  removing cards. Legacy deck deletion is unchanged.
- Regular users can create private decks and cards. Only an admin can write
  global content. Admins do not receive private progress rows.
- `commitReview`, hard-marker updates, and hide/unhide reject an admin session.
  Study routes (`/api/review`, `/api/review/queue`, `/api/progress`,
  `/api/cards/:id/hard`) use `requireRegularUser()` and return 403 for admins.
  `/api/visibility` is the hide/unhide route and is 404 while `AUTH_MODE=shared`.
- Review receipts match when either side has no `source`, so existing
  idempotency tests and legacy receipts keep working. Multi-user receipts are
  stored under the user and include `source`.
- Daily analytics and global-deck usage aggregates from the design are not
  written yet. They belong to phase 5. Review commits update the user stats
  counter only.

### Migration

- Config is a JSON file. Every existing non-deleting deck id must appear as
  `"global"` or `"private"`. Unknown config ids also fail the run. Failure
  happens before any write.
- The tool writes new keys with `attribute_not_exists(PK)`. A rerun that finds
  the same item skips it. A different existing item fails the run. Old records
  are never updated or deleted.
- FSRS, `modes`, `practice`, `hard`, and `reviewVersion` are copied as stored.
  The migration does not pass them through retention rescheduling. Due/new
  counts in the report use the same read-time adjustment as the app, and the
  run fails if those counts change.
- Review logs and receipts are copied onto Naijei's user. `source` comes from
  the deck config. History that does not reference a classified deck fails the
  run instead of being dropped.
- If `META/STATS` exists, its `reviewCount` is copied. Otherwise the count is
  the number of legacy logs.
- The admin profile and directory row are created with no progress, logs,
  receipts, stats, or private decks.
- The script refuses `TABLE_NAME=flashcards` unless
  `MIGRATION_ALLOW_PRODUCTION_TABLE=I_UNDERSTAND`. It refuses to run without
  `DYNAMODB_ENDPOINT` (or against an `amazonaws.com` endpoint) unless
  `MIGRATION_ALLOW_AWS=I_UNDERSTAND`. Neither flag is set by the app.
- Profile `createdAt` is the migration time. A rerun does not treat a different
  timestamp as a conflict. Card and progress timestamps come from the source
  rows and must match exactly.
- Old pre-migration rows stay until a later, explicit cleanup. That cleanup is
  not part of phases 1–3.

### AWS resources to provision separately

Deploy `infra/cognito.yaml`. It creates:

- Cognito user pool `flashcards-users` with email sign-in and email verification
- hosted UI domain
- public app client (no secret) using authorization-code + PKCE
- group `admins`

Create two users after the pool exists. Put only the dedicated admin in
`admins`. Naijei's account stays out of that group. Then fill
`scripts/migration-config.example.json` with their Cognito `sub` values and the
per-deck global/private choices.

Environment variables:

- Keep current `APP_PASSWORD`, `SESSION_SECRET`, `TABLE_NAME`, `APP_REGION`,
  and `APP_TIME_ZONE` until cutover.
- `AUTH_MODE=shared` (or unset) until cutover, then `cognito`.
- `COGNITO_USER_POOL_ID`
- `COGNITO_CLIENT_ID`
- `COGNITO_ISSUER` (optional if pool id and `APP_REGION` are set)
- `COGNITO_DOMAIN`
- `COGNITO_REDIRECT_URI`
- `COGNITO_LOGOUT_URI` (optional, for a later logout redirect)
- Local tests only: `DYNAMODB_ENDPOINT`, `AUTH_MODE=local-dev`. Never set
  `local-dev` on Amplify.

The production env writer bakes Cognito variables only when `AUTH_MODE=cognito`.
A normal production build with those variables unset keeps the shared-password
app.
