# Decklist Compare

Compare two or more [Moxfield](https://www.moxfield.com) decklists. The app shows which cards are
in **every** deck, which are **shared by some** decks, and which are **unique** to each deck, as card
images from [Scryfall](https://scryfall.com).

## Develop

Node 18 or newer. The `.npmrc` disables bin symlinks so the project also installs on exFAT/FAT drives;
the npm scripts call each tool's entry point directly, so they work with or without bin links.

```bash
npm install
npm run dev             # Vite on :5173; the Moxfield function runs inside the dev server
npm test                # unit + component tests
npm run build           # type-check + production build into dist/
```

Try it: `http://localhost:5173/?d=dL6gcTQ7hUq6nQq7fijzUA,caQw6W6nwkSjBJkBED-0-Q,pdTbH1kXzUuDht7kgBm-1g`

## Deploy to Netlify

1. Push this repo and create a Netlify site from it. `netlify.toml` already sets the build command,
   publish directory, functions directory and redirects.
2. (Recommended) Add the environment variable `MOXFIELD_USER_AGENT` with a descriptive user agent,
   e.g. `decklist-compare/1.0 (your@email)`. Moxfield asks third-party tools to use an approved
   User-Agent; contact support@moxfield.com to get one. Without it Moxfield may answer 403, in which
   case users can still paste decklist text.

## How it works

- Browsers can't call the Moxfield API directly (no CORS, bot protection), so the Netlify Function
  in `netlify/functions/moxfield.ts` fetches `api2.moxfield.com/v3/decks/all/<id>` and returns a trimmed payload.
- Cards are matched by normalised front-face name; quantities are kept per deck.
- Images come from Scryfall's `POST /cards/collection` endpoint, 75 cards per request, using the exact
  printing Moxfield lists where possible. Image URLs are cached in `localStorage`.
