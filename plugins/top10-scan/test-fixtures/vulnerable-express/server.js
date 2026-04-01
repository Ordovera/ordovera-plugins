import express from "express";
import cors from "cors";
import http from "node:http";
import vm from "node:vm";

const app = express();
app.use(express.json());

// VULNERABILITY [A02]: CORS allows all origins.
app.use(cors({ origin: "*" }));

// VULNERABILITY [A02]: No helmet middleware for security headers.
// VULNERABILITY [A02]: Serving over HTTP, not HTTPS.

// VULNERABILITY [A08]: HTML served without SRI on external scripts.
app.get("/", (req, res) => {
  res.send(`
    <html>
      <head>
        <script src="https://cdn.example.com/lib.js"></script>
      </head>
      <body><h1>App</h1></body>
    </html>
  `);
});

// VULNERABILITY [A05]: Dynamic code execution with user-controlled input via vm.runInThisContext.
app.post("/calculate", (req, res) => {
  const { expression } = req.body;
  try {
    const result = vm.runInThisContext(expression);
    res.json({ result });
  } catch (e) {
    // VULNERABILITY [A10]: Empty catch block - error swallowed silently.
  }
  res.json({ result: null });
});

// VULNERABILITY [A05]: SQL string concatenation with user input.
app.get("/users", (req, res) => {
  const name = req.query.name;
  const query = "SELECT * FROM users WHERE name = '" + name + "'";

  // Simulated DB call
  const db = { query: async (q) => [{ id: 1, name }] };
  db.query(query)
    .then((rows) => res.json(rows))
    .catch(() => {
      // VULNERABILITY [A10]: Empty catch block.
    });
});

// VULNERABILITY [A10]: SSRF - fetches arbitrary URL provided by user without validation.
app.get("/fetch", (req, res) => {
  const url = req.query.url;
  http.get(url, (proxyRes) => {
    let data = "";
    proxyRes.on("data", (chunk) => { data += chunk; });
    proxyRes.on("end", () => res.send(data));
  }).on("error", () => {
    // VULNERABILITY [A10]: Empty catch block.
  });
});

app.listen(3000);
