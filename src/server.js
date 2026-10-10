import { createServer } from "./app.js";

const port = Number(process.env.PORT ?? 3000);
const dbPath = process.env.DB_PATH ?? "data/sharelink.sqlite";

const server = createServer({ dbPath });

server.listen(port, () => {
  console.log(`ShareLink is running at http://localhost:${port}`);
});
