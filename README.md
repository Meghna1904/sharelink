<div align="center">

# sharelink

**A tiny private shelf for the links you two keep sending each other.**

No feed to doom-scroll. No accounts. No ads. Just a shared code and a place where good links stop getting buried in chat.

[Run it locally](#run-it-locally) · [Deploy in a few minutes](#deploy-to-vercel) · [How sharing works](#how-sharing-works)

![ShareLink shared link shelf](docs/images/shared-links.png)

</div>

## Why this exists

Links sent in a group chat disappear within a day. That recipe, that weird browser game, that place you wanted to visit: gone, somewhere above 400 messages.

ShareLink is the fix. Paste a link, and it lands on a shelf you both can see, sorted by date, searchable, and still there next month.

## What you get

- **Paste and go.** Drop in a URL and save it. The title and preview image are fetched when the site allows it.
- **Notes and tags** for when a link needs a reason ("for the trip", "try this Friday").
- **Search that covers everything.** Titles, URLs, notes, and tags, all at once.
- **Filters that make sense.** Your links, their links, favorites, or a single tag.
- **Favorites that belong to you.** Either of you can favorite any link, and your stars stay yours.
- **Link previews.** Open a saved link to see its description and image, then follow through to the site.
- **Edit or delete your own links.** Nobody can tidy up yours but you.
- **A dark, responsive UI** that works on a laptop or a phone.

## Getting in

![ShareLink sign-in screen](docs/images/sign-in.png)

There is no signup. Type a name and a shared code (4 to 80 characters). The first time a code is used, the space is created. The other person types the same code and they are in.

## How sharing works

Your shelf is only as private as your code, so make it a good one.

- The database stores the code as an HMAC-SHA256 hash rather than plain text.
- The browser keeps your session in local storage, including the code needed to reconnect.
- Anyone who knows the code can open that space. Treat it like a shared password.
- In production, set a strong `CODE_HASH_SECRET`. If you change that secret later, existing spaces become unreachable until you restore the original.

## Run it locally

You need **Node.js 22 or newer** and a **Neon Postgres** connection string.

```sh
npm install
```

Create a `.env.local` file in the project root:

```dotenv
DATABASE_URL=postgresql://user:password@host/database?sslmode=require
CODE_HASH_SECRET=replace-with-a-long-random-secret
```

`.env.local` is git-ignored, so your credentials stay out of the repo.

Then build and start:

```sh
npm run build
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Tables are created automatically the first time the server connects to the database.

For a production-style run, use `npm start` after building. Set `PORT` if you want something other than 3000.

## Deploy to Vercel

The repo already includes `vercel.json` and the API entry points.

1. Import the repository into Vercel.
2. Add two environment variables:
   - `DATABASE_URL`: your Neon Postgres connection string
   - `CODE_HASH_SECRET`: a long random secret used to hash shared codes
3. Deploy. Vercel runs `npm run build` for you.

Prefer your own server? Any Node.js 22 host works with the same environment variables and `npm start`.

## Under the hood

Deliberately simple.

- A Node.js HTTP server with TypeScript API handlers
- Neon Postgres through `@neondatabase/serverless`
- A plain HTML, CSS, and JavaScript frontend, with no framework and no client-side build step
- Vercel configuration included

## Tests

```sh
npm test
```

The suite covers session creation, link operations, authorization, and error handling.
