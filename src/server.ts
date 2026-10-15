import { createServer } from "./app.js";

const port = Number(process.env["PORT"] ?? 3000);

const server = createServer();

server.listen(port, () => {
  console.log(`ShareLink is running at http://localhost:${port}`);
});
