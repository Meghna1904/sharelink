# ShareLink

A lightweight web app for two partners to save links into one shared space. Each partner enters their name and the same shared code, then both see the same list of URLs with titles, notes, who saved each link, and when.

## Stack

- Node.js 24
- Built-in `node:http`
- Built-in `node:sqlite`
- Vanilla HTML, CSS, and JavaScript
- Node's built-in test runner

No package install is required.

## Run Locally

```bash
npm start
```

Then open [http://localhost:3000](http://localhost:3000).

The app stores data in `data/sharelink.sqlite` by default. You can change that path:

```bash
DB_PATH=./data/dev.sqlite npm start
```

For production, set a stable secret used to hash shared codes:

```bash
CODE_HASH_SECRET=replace-with-a-long-random-secret npm start
```

## Creating a Couple

There is no admin setup. A new couple is created the first time someone enters a name and a shared code. For example:

1. Whiskey enters `Whiskey` and code `0101`.
2. Matilda enters `Matilda` and the same code `0101`.
3. Both land in the same shared link list.

The code is a shared access key for the couple. It is stored as a server-side HMAC hash, not in plain text.

## Tests

```bash
npm test
```

The tests cover:

- Creating and joining a space with the shared code
- Adding and listing links
- Editing and deleting a partner's own links
- Rejecting malformed URLs

## Notes

- Partners can edit or delete links saved under their own name.
- URL input only accepts `http` and `https`.
- If a title is left blank, the server tries to fetch the page title and falls back to the URL.
