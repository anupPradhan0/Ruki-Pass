# Ruki-Pass Backend

A small **FastAPI** service for hash-cracking research, managed with **uv**.

> Cracking here means a **dictionary attack**: hashes can't be reversed, so we
> hash candidate words from a wordlist and compare against the target — the same
> idea behind hashcat/john. MD5 is the first supported algorithm; more are a
> one-line change in `app/hashing.py`.

## Setup

```bash
cd backend
uv sync                 # create venv + install deps
```

## Run

```bash
uv run uvicorn app.main:app --reload --port 8000
```

- API docs (Swagger UI): http://localhost:8000/docs
- Health: http://localhost:8000/api/health

## Endpoints

| Method | Path                  | Description                                       |
| ------ | --------------------- | ------------------------------------------------- |
| GET    | `/api/health`         | Liveness check                                    |
| GET    | `/api/algorithms`     | List supported hash algorithms                    |
| POST   | `/api/crack`          | Crack a hash against the wordlist                 |
| GET    | `/api/assist/status`  | Whether the AI assistant is configured            |
| POST   | `/api/assist`         | AI-assisted cracking loop (asks questions, plans) |

### Example

```bash
curl -X POST http://localhost:8000/api/crack \
  -H 'Content-Type: application/json' \
  -d '{"hash": "f30aa7a662c728b7407c54ae6bfd27d1", "algorithm": "md5"}'
```

```json
{
  "found": true,
  "hash": "f30aa7a662c728b7407c54ae6bfd27d1",
  "algorithm": "md5",
  "password": "hello123",
  "attempts": 19,
  "duration_ms": 0.12,
  "wordlist_exhausted": false
}
```

`algorithm` is optional — if omitted it's auto-detected from the hash length
(32 chars → MD5, 64 → SHA-256, …).

## Wordlists

The cracker uses the best wordlist available on disk (see
`WORDLIST_PRIORITY` in `app/cracker.py`):

1. **`rockyou.txt`** — ~14.3M real leaked passwords from
   [SecLists](https://github.com/danielmiessler/SecLists). Big (134MB), so it's
   **gitignored**, not committed.
2. **`common.txt`** — a tiny starter list that always ships, used as a fallback.

Fetch the big one once:

```bash
./scripts/fetch_wordlists.sh
```

The `/api/crack` response includes a `wordlist` field telling you which list
produced the answer.

## Tests

```bash
uv run pytest
```

## Supported algorithms

`md5`, `sha1`, `sha224`, `sha256`, `sha384`, `sha512` — add more in
`app/hashing.py`.

## AI assistant (Gemini / Gemma)

When the deterministic pipeline fails, an optional AI **strategist** can ask the
user questions and turn the answers into crack strategies. It uses Google's
Gemini API with the **Gemma 4 26B** model (`gemma-4-26b-a4b-it`) by default.

The model never hashes anything — it only plans (asks / chooses a strategy /
gives up as strict JSON); the deterministic engine in `cracker.py` does the real
work. See `app/assistant.py`.

Setup:

```bash
cp .env.example .env
# edit .env and set GEMINI_API_KEY (from https://aistudio.google.com/apikey)
```

Then restart the server. Without a key, `/api/assist` returns a clean 503 and
the rest of the API works normally. Override the model with `GEMINI_MODEL` in
`.env`.
