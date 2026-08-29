# Chinese Flashcards

A personal, single-user flashcard web app with FSRS spaced repetition, browsef
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
- **Auth**: single password (`APP_PASSWORD`) checked server-side; 30-day
  HttpOnly session cookie signed with `SESSION_SECRET`.
- **Keyboard shortcuts** (desktop): Space = reveal, 1–4 = Again/Hard/Good/Easy,
  ←/→ = previous/next in study mode.

## Local development

Prereqs: Node 22+, Docker (for DynamoDB Local) *or* AWS credentials.

```bash
npm install
cp .env.example .env.local          # then edit:
#   APP_PASSWORD=1212
#   SESSION_SECRET=$(openssl rand -hex 32)
#   TABLE_NAME=flashcards-dev
#   APP_REGION=us-east-1
#   DYNAMODB_ENDPOINT=http://localhost:8000   # only when using DynamoDB Local

# Option A: DynamoDB Local (no AWS account needed)
docker run -d --name dynamodb-local -p 8000:8000 amazon/dynamodb-local
DYNAMODB_ENDPOINT=http://localhost:8000 npx tsx scripts/create-table.ts

# Option B: real AWS (uses your ~/.aws profile; omit DYNAMODB_ENDPOINT)
npx tsx scripts/create-table.ts

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
        "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:DeleteItem",
        "dynamodb:Query", "dynamodb:Scan",
        "dynamodb:BatchWriteItem", "dynamodb:TransactWriteItems"
      ],
      "Resource": "arn:aws:dynamodb:us-east-1:<ACCOUNT_ID>:table/flashcards"
    }]
  }'
```

### 3. Connect the repo

1. Push this repository to GitHub (secrets stay out of git — `.env*` is
   ignored).
2. AWS console → **Amplify** → **Create new app** → **GitHub** → pick the repo
   and the `main` branch. Amplify auto-detects Next.js and uses the committed
   `amplify.yml`.

### 4. Configure the app

In the Amplify app:

- **Hosting → Environment variables** — add:
  - `APP_PASSWORD` — pick a strong password (not `1212`)
  - `SESSION_SECRET` — `openssl rand -hex 32`
  - `TABLE_NAME` — `flashcards`
  - `APP_REGION` — `us-east-1` (env var names starting with `AWS_` are
    reserved by Amplify, hence the custom name)
- **App settings → IAM roles → Compute role** — attach
  `flashcards-amplify-compute`.

Then trigger a deploy (push to `main` or "Redeploy this version"). The app is
served at `https://main.<app-id>.amplifyapp.com`.

Note: `amplify.yml` writes those four env vars into `.env.production` during
the build — Amplify does not expose console env vars to the Next.js server
runtime otherwise.

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
| ReviewLog | `LOGS`         | `<reviewISO>#<cardId>` |

Cards store their FSRS state inline (`due`, `stability`, `difficulty`,
`state`, …) as ISO strings. Due counts are computed by scanning cards —
perfectly fine at single-user scale.

## CSV format

```csv
front,back,notes,reverse
你好,hello,greeting,true
老师,teacher,,
```

The header row and the `notes`/`reverse` columns are optional; headerless
files are treated as `front,back[,notes]`. Quoted fields may contain commas,
quotes (`""`), and newlines. Export produces UTF-8 with a BOM so Excel opens
Chinese text correctly.
