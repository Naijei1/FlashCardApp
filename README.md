# Chinese Flashcards

A personal, single-user flashcard web app with FSRS spaced repetition, browser
text-to-speech for Mandarin/English, CSV import/export, and an installable
iPhone PWA. Built with Next.js 15 (App Router), TypeScript, React, and
Tailwind CSS; data lives in a single DynamoDB table.

## Features

- **Two study modes**: casual flipping (never touches scheduling) and FSRS
  spaced repetition (`ts-fsrs`, FSRS-6) with Again/Hard/Good/Easy buttons that
  show the next interval.
- **Decks**: create, rename, delete, per-deck front/back speech languages,
  card counts and due counts.
- **Cards**: front/back/notes, optional independent reverse card, move
  between decks, browse/search.
- **CSV import/export**: RFC-4180 (quoted commas, multi-line fields, UTF-8,
  BOM), header optional, invalid-row preview, reverse-card option with
  flipped-duplicate warning.
- **Pronunciation**: browser `speechSynthesis`, Mandarin (`zh-CN`) and English
  (`en-US`) by default, per-deck override; fails silently when unavailable.
- **Write Pinyin**: detects Chinese on either side of existing cards and
  generates Mandarin readings using `pinyin-pro`, including traditional text.
  Type tone marks (`nǐ hǎo`) or numbers (`ni3 hao3`), or turn off **Check tones**
  for spelling practice. `ü`, `v`, and `u:` are equivalent; neutral tones can
  be omitted or written as `0`/`5`. Like Write Chinese, ratings update the
  original card's FSRS schedule and use 25-card batches with five-minute breaks.
  Readings use dictionary tones. For a specific reading, put spaced Pinyin
  after the Chinese, such as `行 (háng)` or `老师 (lao3 shi1)`; a complete
  reading recognized for those characters takes precedence over the default.
  Write Chinese excludes these romanization annotations from the expected
  answer. The dictionary runs only on the server.
- **Auth**: single password (`APP_PASSWORD`) checked server-side; 30-day
  HttpOnly session cookie signed with `SESSION_SECRET`.
- **Keyboard shortcuts** (desktop): Space = reveal, 1–4 = Again/Hard/Good/Easy,
  ←/→ = previous/next in study mode.

## Local development

Prereqs: Node 22, Docker (for DynamoDB Local) *or* AWS credentials.

```bash
npm install
cp .env.example .env.local          # then edit:
#   APP_PASSWORD=replace-with-a-strong-password
#   SESSION_SECRET=$(openssl rand -hex 32)
#   TABLE_NAME=flashcards-dev
#   APP_REGION=us-east-1
#   APP_TIME_ZONE=America/New_York
#   DYNAMODB_ENDPOINT=http://localhost:8000   # only when using DynamoDB Local

# Option A: DynamoDB Local (no AWS account needed)
docker run -d --name dynamodb-local -p 8000:8000 amazon/dynamodb-local
npm run db:create

# Option B: real AWS (uses your ~/.aws profile; omit DYNAMODB_ENDPOINT)
npm run db:create

npm run dev
```

Checks:

```bash
npm test            # Vitest unit tests (CSV, FSRS, due dates, reverse cards, auth)
npm run typecheck   # tsc --noEmit
npm run lint
npm run build
```

## Deploying to AWS (Amplify Hosting)

Push to `main` → Amplify builds and deploys automatically over HTTPS.

### 1. Create the production DynamoDB table

```bash
aws dynamodb create-table \
  --table-name flashcards \
  --attribute-definitions AttributeName=PK,AttributeType=S AttributeName=SK,AttributeType=S \
  --key-schema AttributeName=PK,KeyType=HASH AttributeName=SK,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST \
  --region us-east-1
```

### 2. Create the compute IAM role (no access keys needed)

Amplify's SSR compute assumes this role at runtime, so the app never handles
AWS credentials.

```bash
aws iam create-role --role-name flashcards-amplify-compute \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": { "Service": "amplify.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }]
  }'

aws iam put-role-policy --role-name flashcards-amplify-compute \
  --policy-name dynamodb-flashcards \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem",
        "dynamodb:ConditionCheckItem",
        "dynamodb:Query",
        "dynamodb:BatchWriteItem"
      ],
      "Resource": "arn:aws:dynamodb:us-east-1:<ACCOUNT_ID>:table/flashcards"
    }]
  }'
```

If the role already exists, re-run `put-role-policy` before deploying this
version so its policy includes both `dynamodb:UpdateItem` and
`dynamodb:ConditionCheckItem`.

### 3. Connect the repo

1. Push this repository to GitHub (secrets stay out of git — `.env*` is
   ignored).
2. AWS console → **Amplify** → **Create new app** → **GitHub** → pick the repo
   and the `main` branch. Amplify auto-detects Next.js and uses the committed
   `amplify.yml`.

### 4. Configure the app

In the Amplify app:

- **Hosting → Environment variables** — add:
  - `APP_PASSWORD` — pick a strong password of at least 12 characters
  - `SESSION_SECRET` — `openssl rand -hex 32`
  - `TABLE_NAME` — `flashcards`
  - `APP_REGION` — `us-east-1` (env var names starting with `AWS_` are
    reserved by Amplify, hence the custom name)
  - `APP_TIME_ZONE` — your IANA timezone, for example `America/New_York`
- **App settings → IAM roles → Compute role** — attach
  `flashcards-amplify-compute`.

Then trigger a deploy (push to `main` or "Redeploy this version"). The app is
served at `https://main.<app-id>.amplifyapp.com`.

Note: `amplify.yml` validates this configuration and writes `.env.production`
during the build — Amplify does not expose console env vars to the Next.js
server runtime otherwise. Passwords and session secrets are hex-encoded in
that private artifact to preserve punctuation and Unicode through dotenv
loading; this is encoding, not encryption. Keep the artifact private, like
any other file containing credentials.

### 5. Install on iPhone

Open the site in Safari → Share → **Add to Home Screen**. The installed app
has its own cookie jar, so enter the password once inside it; the session then
lasts ~30 days (server-set cookies are exempt from Safari's 7-day cap).

## Data model

Single DynamoDB table (`PK`/`SK`):

| Entity    | PK             | SK               |
| --------- | -------------- | ---------------- |
| Deck      | `DECKS`        | `DECK#<uuid>`    |
| Card      | `DECK#<deckId>`| `CARD#<uuid>`    |
| Review log | `LOGS` | `<reviewISO>#<cardId>#<clientReviewId>` |
| Review receipt | `REVIEW_REQUESTS` | `<clientReviewId>` |
| Review stats | `META` | `STATS` |

Cards store their FSRS state inline (`due`, `stability`, `difficulty`,
`state`, …) as ISO strings. All-card views query deck partitions with bounded
concurrency; the review-log count is maintained as an atomic aggregate.

## CSV format

```csv
front,back,notes,reverse
你好,hello,greeting,true
老师,teacher,,
```

The header row and the `notes`/`reverse` columns are optional; headerless
files are treated as `front,back[,notes[,reverse]]`. Quoted fields may contain commas,
quotes (`""`), and newlines. Export produces UTF-8 with a BOM so Excel opens
Chinese text correctly.
