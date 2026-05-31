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
    sessionId: row.session_id || "",
    sessionName: row.session_name || "",
  };
}

function slug(value) {
  return String(value || "session")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "session";
}

function sessionFromRow(row) {
  return {
    id: row.id,
    name: row.name,
    team: row.team_name,
    adminId: row.admin_id || "",
    status: row.status,
    archived: row.archived,
    createdAt: row.created_at,
  };
}

function participantFromRow(row) {
  return {
    id: row.id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    philipsTeam: row.philips_team,
    teamNumber: row.team_number,
    businessUnit: row.business_unit || "",
    specificTeam: row.specific_team || "",
    sessionId: row.session_id,
    sessionName: row.session_name || "",
    eventStatus: row.event_status,
    archived: row.archived,
  };
}

async function ensureSessionForAdmin(admin) {
  if (admin.role !== "Session Admin") return null;

  const team = admin.team_name || admin.username;
  const sessionId = `session-${slug(team)}`;
  const sessionName = `${team} Lean Sessions`;
  const result = await pool.query(
    `
      INSERT INTO sessions (
        id,
        name,
        team_name,
        admin_id,
        status
      )
      VALUES ($1, $2, $3, $4, 'Not Started')
      ON CONFLICT (id) DO UPDATE
        SET name = EXCLUDED.name,
            team_name = EXCLUDED.team_name,
            admin_id = EXCLUDED.admin_id
      RETURNING *
    `,
    [sessionId, sessionName, team, admin.id]
  );
  return result.rows[0];
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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      team_name TEXT NOT NULL,
      admin_id TEXT REFERENCES admins(id),
      status TEXT NOT NULL DEFAULT 'Not Started',
      archived BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS participants (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      philips_team TEXT NOT NULL,
      team_number TEXT,
      business_unit TEXT,
      specific_team TEXT,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      event_status TEXT NOT NULL DEFAULT 'Not Started',
      archived BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(
    `
      INSERT INTO sessions (
        id,
        name,
        team_name,
        status
      )
      VALUES ('master-data', 'Master Data Lean Sessions', 'Master Data', 'Not Started')
      ON CONFLICT (id) DO NOTHING
    `
  );

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

    const session = await ensureSessionForAdmin(admin);
    sendJson(response, 200, {
      ok: true,
      admin: {
        ...adminFromRow(admin),
        sessionId: session?.id || "",
        sessionName: session?.name || "",
      },
    });
    return true;
  }

  if (url.pathname === "/api/admins" && request.method === "GET") {
    const result = await pool.query(`
      SELECT
        admins.*,
        sessions.id AS session_id,
        sessions.name AS session_name
      FROM admins
      LEFT JOIN sessions
        ON sessions.admin_id = admins.id
        AND sessions.archived = false
      ORDER BY admins.created_at DESC
    `);
    sendJson(response, 200, { ok: true, admins: result.rows.map(adminFromRow) });
    return true;
  }

  if (url.pathname === "/api/sessions" && request.method === "GET") {
    const result = await pool.query("SELECT * FROM sessions WHERE archived = false ORDER BY created_at DESC");
    sendJson(response, 200, { ok: true, sessions: result.rows.map(sessionFromRow) });
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

    const session = await ensureSessionForAdmin(result.rows[0]);
    sendJson(response, 201, {
      ok: true,
      admin: {
        ...adminFromRow(result.rows[0]),
        sessionId: session?.id || "",
        sessionName: session?.name || "",
      },
    });
    return true;
  }

  if (url.pathname === "/api/participants" && request.method === "GET") {
    const result = await pool.query(`
      SELECT
        participants.*,
        sessions.name AS session_name
      FROM participants
      JOIN sessions ON sessions.id = participants.session_id
      ORDER BY participants.created_at DESC
    `);
    sendJson(response, 200, { ok: true, participants: result.rows.map(participantFromRow) });
    return true;
  }

  if (url.pathname === "/api/participants" && request.method === "POST") {
    const body = await readRequestBody(request);
    const id = body.id || `participant-${crypto.randomUUID()}`;
    const sessionId = body.sessionId || "master-data";
    const result = await pool.query(
      `
        INSERT INTO participants (
          id,
          email,
          first_name,
          last_name,
          password_hash,
          philips_team,
          team_number,
          business_unit,
          specific_team,
          session_id,
          event_status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING *,
          (SELECT name FROM sessions WHERE sessions.id = participants.session_id) AS session_name
      `,
      [
        id,
        String(body.email || "").trim(),
        String(body.firstName || "").trim(),
        String(body.lastName || "").trim(),
        hashPassword(body.password || ""),
        String(body.philipsTeam || "").trim(),
        String(body.teamNumber || "").trim(),
        String(body.businessUnit || "").trim() || null,
        String(body.specificTeam || "").trim() || null,
        sessionId,
        body.eventStatus || "Not Started",
      ]
    );
    sendJson(response, 201, { ok: true, participant: participantFromRow(result.rows[0]) });
    return true;
  }

  if (url.pathname === "/api/participant-login" && request.method === "POST") {
    const body = await readRequestBody(request);
    const result = await pool.query(
      `
        SELECT
          participants.*,
          sessions.name AS session_name,
          sessions.team_name AS session_team
        FROM participants
        JOIN sessions ON sessions.id = participants.session_id
        WHERE participants.email = $1
          AND participants.archived = false
        LIMIT 1
      `,
      [String(body.email || "").trim()]
    );
    const participant = result.rows[0];

    if (!participant || !passwordMatches(body.password || "", participant.password_hash)) {
      sendJson(response, 401, { ok: false, error: "Invalid email address or password." });
      return true;
    }

    if (participant.event_status === "Completed") {
      sendJson(response, 403, { ok: false, error: "This participant has already completed the event." });
      return true;
    }

    sendJson(response, 200, {
      ok: true,
      participant: participantFromRow(participant),
      session: {
        id: participant.session_id,
        name: participant.session_name,
        team: participant.session_team,
      },
    });
    return true;
  }

  if (url.pathname.startsWith("/api/participants/") && request.method === "PATCH") {
    const participantId = decodeURIComponent(url.pathname.split("/").pop());
    const body = await readRequestBody(request);
    const result = await pool.query(
      `
        UPDATE participants
        SET archived = COALESCE($2, archived),
            event_status = COALESCE($3, event_status)
        WHERE id = $1
        RETURNING *,
          (SELECT name FROM sessions WHERE sessions.id = participants.session_id) AS session_name
      `,
      [
        participantId,
        typeof body.archived === "boolean" ? body.archived : null,
        body.eventStatus || null,
      ]
    );
    if (!result.rows[0]) {
      sendJson(response, 404, { ok: false, error: "Participant not found." });
      return true;
    }
    sendJson(response, 200, { ok: true, participant: participantFromRow(result.rows[0]) });
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
