const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");

const root = __dirname;
const port = Number(process.env.PORT || 51234);
const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl
  ? new Pool({
      connectionString: databaseUrl,
      ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : undefined,
    })
  : null;

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

function sendJson(response, status, data) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(data));
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;
    });

    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
  });
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function passwordMatches(password, storedHash) {
  if (!storedHash || !storedHash.includes(":")) return false;
  const [salt, hash] = storedHash.split(":");
  const passwordHash = hashPassword(password, salt).split(":")[1];
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(passwordHash, "hex"));
}

function adminFromRow(row) {
  return {
    id: row.id,
    username: row.username,
    firstName: row.first_name,
    lastName: row.last_name,
    role: row.role,
    team: row.team_name || "",
    archived: row.archived,
  };
}

async function initializeDatabase() {
  if (!pool) {
    console.log("DATABASE_URL is not set. Running without PostgreSQL.");
    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admins (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'Session Admin',
      team_name TEXT,
      archived BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const adminCount = await pool.query("SELECT COUNT(*)::int AS count FROM admins");
  const seedUsername = process.env.SUPER_ADMIN_USERNAME;
  const seedPassword = process.env.SUPER_ADMIN_PASSWORD;

  if (adminCount.rows[0].count === 0 && seedUsername && seedPassword) {
    await pool.query(
      `
        INSERT INTO admins (
          id,
          username,
          first_name,
          last_name,
          password_hash,
          role,
          team_name
        )
        VALUES ($1, $2, $3, $4, $5, 'Super Admin', NULL)
      `,
      [
        `admin-${crypto.randomUUID()}`,
        seedUsername,
        process.env.SUPER_ADMIN_FIRST_NAME || "Super",
        process.env.SUPER_ADMIN_LAST_NAME || "Admin",
        hashPassword(seedPassword),
      ]
    );
    console.log(`Seeded Super Admin: ${seedUsername}`);
  }
}

async function handleApi(request, response) {
  const url = new URL(request.url, `http://localhost:${port}`);

  if (url.pathname === "/api/health" && request.method === "GET") {
    sendJson(response, 200, { ok: true, postgres: Boolean(pool) });
    return true;
  }

  if (!pool && url.pathname.startsWith("/api/")) {
    sendJson(response, 503, { ok: false, error: "PostgreSQL is not configured." });
    return true;
  }

  if (url.pathname === "/api/login" && request.method === "POST") {
    const body = await readRequestBody(request);
    const result = await pool.query(
      "SELECT * FROM admins WHERE username = $1 AND archived = false LIMIT 1",
      [String(body.username || "").trim()]
    );
    const admin = result.rows[0];

    if (!admin || !passwordMatches(body.password || "", admin.password_hash)) {
      sendJson(response, 401, { ok: false, error: "Invalid username or password." });
      return true;
    }

    sendJson(response, 200, { ok: true, admin: adminFromRow(admin) });
    return true;
  }

  if (url.pathname === "/api/admins" && request.method === "GET") {
    const result = await pool.query("SELECT * FROM admins ORDER BY created_at DESC");
    sendJson(response, 200, { ok: true, admins: result.rows.map(adminFromRow) });
    return true;
  }

  if (url.pathname === "/api/admins" && request.method === "POST") {
    const body = await readRequestBody(request);
    const id = body.id || `admin-${crypto.randomUUID()}`;
    const role = body.role || "Session Admin";

    const result = await pool.query(
      `
        INSERT INTO admins (
          id,
          username,
          first_name,
          last_name,
          password_hash,
          role,
          team_name
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
      `,
      [
        id,
        String(body.username || "").trim(),
        String(body.firstName || "").trim(),
        String(body.lastName || "").trim(),
        hashPassword(body.password || ""),
        role,
        String(body.team || "").trim() || null,
      ]
    );

    sendJson(response, 201, { ok: true, admin: adminFromRow(result.rows[0]) });
    return true;
  }

  if (url.pathname.startsWith("/api/")) {
    sendJson(response, 404, { ok: false, error: "API route not found." });
    return true;
  }

  return false;
}

function requestedFile(url) {
  const parsedUrl = new URL(url, `http://localhost:${port}`);
  const pathname = decodeURIComponent(parsedUrl.pathname);
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const resolved = path.resolve(root, `.${requestedPath}`);

  if (!resolved.startsWith(root)) {
    return null;
  }

  return resolved;
}

const server = http.createServer(async (request, response) => {
  try {
    if (await handleApi(request, response)) return;
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { ok: false, error: "Server error." });
    return;
  }

  const filePath = requestedFile(request.url);

  if (!filePath) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(error.code === "ENOENT" ? 404 : 500);
      response.end(error.code === "ENOENT" ? "Not found" : "Server error");
      return;
    }

    const contentType = mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream";
    response.writeHead(200, { "Content-Type": contentType });
    response.end(content);
  });
});

initializeDatabase()
  .then(() => {
    server.listen(port, () => {
      console.log(`Lean Sessions is running on port ${port}`);
    });
  })
  .catch((error) => {
    console.error("Database initialization failed:", error);
    process.exit(1);
  });
