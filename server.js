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

function timerFromRow(row) {
  return {
    duration: Number(row.duration_seconds),
    remaining: Number(row.remaining_seconds),
    running: row.running,
    endAt: row.end_at ? new Date(row.end_at).getTime() : null,
    countdownEndAt: row.countdown_end_at ? new Date(row.countdown_end_at).getTime() : null,
    concluded: row.concluded,
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

function topicEntryFromRows(rows) {
  const entries = new Map();

  rows.forEach((row) => {
    if (!entries.has(row.submission_id)) {
      entries.set(row.submission_id, {
        id: row.submission_id,
        participantId: row.participant_id,
        firstName: row.first_name || "",
        lastName: row.last_name || "",
        participantName: row.participant_name || "",
        teamNumber: row.team_number || "",
        teamAssociation: row.team_association || "",
        philipsTeam: row.philips_team || "",
        sessionId: row.session_id || "",
        sessionName: row.session_name || "",
        archived: row.submission_archived || false,
        topics: [],
      });
    }

    if (row.topic_id) {
      entries.get(row.submission_id).topics.push({
        title: row.title || "",
        details: row.details || "",
        notes: row.notes || "",
        painPoints: row.pain_points || "",
        solutions: row.solutions || "",
        status: row.status || "For Further Discussion",
      });
    }
  });

  return [...entries.values()].filter((entry) => entry.topics.length > 0);
}

function voteFromRow(row) {
  return {
    id: row.id,
    topicKey: row.topic_key,
    participantId: row.participant_id,
    firstName: row.first_name || "",
    lastName: row.last_name || "",
    teamNumber: row.team_number || "",
    teamAssociation: row.team_association || "",
    sessionId: row.session_id || "",
    sessionName: row.session_name || "",
    archived: row.archived,
  };
}

async function loadTopicEntries(sessionId = "") {
  const values = [];
  let sessionFilter = "";
  if (sessionId) {
    values.push(sessionId);
    sessionFilter = "AND topic_submissions.session_id = $1";
  }

  const result = await pool.query(
    `
      SELECT
        topic_submissions.id AS submission_id,
        topic_submissions.participant_id,
        topic_submissions.first_name,
        topic_submissions.last_name,
        topic_submissions.participant_name,
        topic_submissions.team_number,
        topic_submissions.team_association,
        topic_submissions.philips_team,
        topic_submissions.session_id,
        topic_submissions.archived AS submission_archived,
        sessions.name AS session_name,
        topics.id AS topic_id,
        topics.topic_index,
        topics.title,
        topics.details,
        topics.notes,
        topics.pain_points,
        topics.solutions,
        topics.status
      FROM topic_submissions
      JOIN sessions ON sessions.id = topic_submissions.session_id
      LEFT JOIN topics
        ON topics.submission_id = topic_submissions.id
        AND topics.archived = false
      WHERE topic_submissions.archived = false
        ${sessionFilter}
      ORDER BY topic_submissions.created_at DESC, topics.topic_index ASC
    `,
    values
  );

  return topicEntryFromRows(result.rows);
}

async function createSessionForAdmin(admin, sessionName) {
  if (admin.role !== "Session Admin") return null;

  const team = admin.team_name || admin.username;
  const name = String(sessionName || "").trim();
  if (!name) return null;
  const sessionId = `session-${slug(name)}-${crypto.randomUUID().slice(0, 8)}`;
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
      RETURNING *
    `,
    [sessionId, name, team, admin.id]
  );
  return result.rows[0];
}

async function primarySessionForAdmin(admin) {
  if (admin.role !== "Session Admin") return null;
  const result = await pool.query(
    `
      SELECT *
      FROM sessions
      WHERE admin_id = $1
        AND archived = false
      ORDER BY created_at ASC
      LIMIT 1
    `,
    [admin.id]
  );
  return result.rows[0] || null;
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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS topic_submissions (
      id TEXT PRIMARY KEY,
      participant_id TEXT,
      first_name TEXT,
      last_name TEXT,
      participant_name TEXT,
      team_number TEXT,
      team_association TEXT,
      philips_team TEXT,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      archived BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS topics (
      id TEXT PRIMARY KEY,
      submission_id TEXT NOT NULL REFERENCES topic_submissions(id) ON DELETE CASCADE,
      topic_index INTEGER NOT NULL,
      title TEXT,
      details TEXT,
      notes TEXT,
      pain_points TEXT,
      solutions TEXT,
      status TEXT NOT NULL DEFAULT 'For Further Discussion',
      archived BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (submission_id, topic_index)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS votes (
      id TEXT PRIMARY KEY,
      topic_key TEXT NOT NULL,
      participant_id TEXT,
      first_name TEXT,
      last_name TEXT,
      team_number TEXT,
      team_association TEXT,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      archived BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS timer_states (
      session_id TEXT PRIMARY KEY REFERENCES sessions(id),
      duration_seconds INTEGER NOT NULL,
      remaining_seconds INTEGER NOT NULL,
      running BOOLEAN NOT NULL DEFAULT false,
      end_at TIMESTAMPTZ,
      countdown_end_at TIMESTAMPTZ,
      concluded BOOLEAN NOT NULL DEFAULT false,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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

    const session = await primarySessionForAdmin(admin);
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
      LEFT JOIN LATERAL (
        SELECT id, name
        FROM sessions
        WHERE sessions.admin_id = admins.id
          AND sessions.archived = false
        ORDER BY sessions.created_at ASC
        LIMIT 1
      ) sessions ON true
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

  if (url.pathname === "/api/sessions" && request.method === "POST") {
    const body = await readRequestBody(request);
    const adminId = String(body.adminId || "").trim();
    const sessionName = String(body.name || body.sessionName || "").trim();

    if (!adminId || !sessionName) {
      sendJson(response, 400, { ok: false, error: "Session name and Session Manager are required." });
      return true;
    }

    const adminResult = await pool.query(
      "SELECT * FROM admins WHERE id = $1 AND role = 'Session Admin' AND archived = false LIMIT 1",
      [adminId]
    );
    const admin = adminResult.rows[0];
    if (!admin) {
      sendJson(response, 400, { ok: false, error: "Session Manager was not found." });
      return true;
    }

    const session = await createSessionForAdmin(admin, sessionName);
    sendJson(response, 201, { ok: true, session: sessionFromRow(session) });
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

    const session = await createSessionForAdmin(result.rows[0], body.sessionName);
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

  if (url.pathname.startsWith("/api/admins/") && request.method === "PATCH") {
    const adminId = decodeURIComponent(url.pathname.split("/").pop());
    const body = await readRequestBody(request);
    const result = await pool.query(
      `
        UPDATE admins
        SET archived = COALESCE($2, archived)
        WHERE id = $1
        RETURNING *
      `,
      [adminId, typeof body.archived === "boolean" ? body.archived : null]
    );

    if (!result.rows[0]) {
      sendJson(response, 404, { ok: false, error: "Admin not found." });
      return true;
    }

    sendJson(response, 200, { ok: true, admin: adminFromRow(result.rows[0]) });
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

  if (url.pathname === "/api/timer" && request.method === "GET") {
    const sessionId = url.searchParams.get("sessionId") || "master-data";
    const result = await pool.query("SELECT * FROM timer_states WHERE session_id = $1", [sessionId]);
    if (!result.rows[0]) {
      sendJson(response, 200, { ok: true, timer: null });
      return true;
    }

    sendJson(response, 200, { ok: true, timer: timerFromRow(result.rows[0]) });
    return true;
  }

  if (url.pathname === "/api/timer" && request.method === "PUT") {
    const body = await readRequestBody(request);
    const sessionId = body.sessionId || "master-data";
    const duration = Number(body.duration || 0);
    const remaining = Number(body.remaining || 0);
    const running = Boolean(body.running);
    const concluded = Boolean(body.concluded);
    const endAt = body.endAt ? new Date(Number(body.endAt)) : null;
    const countdownEndAt = body.countdownEndAt ? new Date(Number(body.countdownEndAt)) : null;
    const status = concluded
      ? "Concluded"
      : running || countdownEndAt || remaining < duration
        ? "Ongoing"
        : "Not Started";

    const result = await pool.query(
      `
        INSERT INTO timer_states (
          session_id,
          duration_seconds,
          remaining_seconds,
          running,
          end_at,
          countdown_end_at,
          concluded
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (session_id) DO UPDATE
          SET duration_seconds = EXCLUDED.duration_seconds,
              remaining_seconds = EXCLUDED.remaining_seconds,
              running = EXCLUDED.running,
              end_at = EXCLUDED.end_at,
              countdown_end_at = EXCLUDED.countdown_end_at,
              concluded = EXCLUDED.concluded,
              updated_at = NOW()
        RETURNING *
      `,
      [sessionId, duration, remaining, running, endAt, countdownEndAt, concluded]
    );
    await pool.query("UPDATE sessions SET status = $2 WHERE id = $1", [sessionId, status]);
    sendJson(response, 200, { ok: true, timer: timerFromRow(result.rows[0]) });
    return true;
  }

  if (url.pathname === "/api/topics" && request.method === "GET") {
    const topics = await loadTopicEntries(url.searchParams.get("sessionId") || "");
    sendJson(response, 200, { ok: true, topics });
    return true;
  }

  if (url.pathname === "/api/topics" && request.method === "POST") {
    const body = await readRequestBody(request);
    const id = body.id || `topic-${crypto.randomUUID()}`;
    const topics = Array.isArray(body.topics) ? body.topics : [];
    const sessionId = body.sessionId || "master-data";

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `
          INSERT INTO topic_submissions (
            id,
            participant_id,
            first_name,
            last_name,
            participant_name,
            team_number,
            team_association,
            philips_team,
            session_id
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          ON CONFLICT (id) DO UPDATE
            SET participant_id = EXCLUDED.participant_id,
                first_name = EXCLUDED.first_name,
                last_name = EXCLUDED.last_name,
                participant_name = EXCLUDED.participant_name,
                team_number = EXCLUDED.team_number,
                team_association = EXCLUDED.team_association,
                philips_team = EXCLUDED.philips_team,
                session_id = EXCLUDED.session_id,
                archived = false
        `,
        [
          id,
          body.participantId || "",
          body.firstName || "",
          body.lastName || "",
          body.participantName || "",
          body.teamNumber || "",
          body.teamAssociation || "",
          body.philipsTeam || "",
          sessionId,
        ]
      );

      for (const [index, topic] of topics.entries()) {
        await client.query(
          `
            INSERT INTO topics (
              id,
              submission_id,
              topic_index,
              title,
              details,
              notes,
              pain_points,
              solutions,
              status
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (submission_id, topic_index) DO UPDATE
              SET title = EXCLUDED.title,
                  details = EXCLUDED.details,
                  notes = EXCLUDED.notes,
                  pain_points = EXCLUDED.pain_points,
                  solutions = EXCLUDED.solutions,
                  status = EXCLUDED.status,
                  archived = false
          `,
          [
            `topic-${id}-${index}`,
            id,
            index,
            topic.title || "",
            topic.details || "",
            topic.notes || "",
            topic.painPoints || "",
            topic.solutions || "",
            topic.status || "For Further Discussion",
          ]
        );
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    const entries = await loadTopicEntries(sessionId);
    sendJson(response, 201, { ok: true, topic: entries.find((entry) => entry.id === id) || null });
    return true;
  }

  if (url.pathname === "/api/topics" && request.method === "PATCH") {
    const body = await readRequestBody(request);
    const [submissionId, indexValue] = String(body.topicKey || "").split(":");
    const topicIndex = Number(indexValue);

    if (!submissionId || Number.isNaN(topicIndex)) {
      sendJson(response, 400, { ok: false, error: "Topic key is required." });
      return true;
    }

    const result = await pool.query(
      `
        UPDATE topics
        SET title = COALESCE($3, title),
            details = COALESCE($4, details),
            notes = COALESCE($5, notes),
            pain_points = COALESCE($6, pain_points),
            solutions = COALESCE($7, solutions),
            status = COALESCE($8, status),
            archived = COALESCE($9, archived)
        WHERE submission_id = $1
          AND topic_index = $2
        RETURNING *
      `,
      [
        submissionId,
        topicIndex,
        typeof body.title === "string" ? body.title : null,
        typeof body.details === "string" ? body.details : null,
        typeof body.notes === "string" ? body.notes : null,
        typeof body.painPoints === "string" ? body.painPoints : null,
        typeof body.solutions === "string" ? body.solutions : null,
        typeof body.status === "string" ? body.status : null,
        typeof body.archived === "boolean" ? body.archived : null,
      ]
    );

    if (!result.rows[0]) {
      sendJson(response, 404, { ok: false, error: "Topic not found." });
      return true;
    }

    sendJson(response, 200, { ok: true });
    return true;
  }

  if (url.pathname === "/api/topics/archive-session" && request.method === "POST") {
    const body = await readRequestBody(request);
    const sessionId = body.sessionId || "";
    if (!sessionId) {
      sendJson(response, 400, { ok: false, error: "Session id is required." });
      return true;
    }
    await pool.query("UPDATE topic_submissions SET archived = true WHERE session_id = $1", [sessionId]);
    await pool.query("UPDATE votes SET archived = true WHERE session_id = $1", [sessionId]);
    sendJson(response, 200, { ok: true });
    return true;
  }

  if (url.pathname === "/api/votes" && request.method === "GET") {
    const sessionId = url.searchParams.get("sessionId") || "";
    const values = [];
    let sessionFilter = "";
    if (sessionId) {
      values.push(sessionId);
      sessionFilter = "AND votes.session_id = $1";
    }
    const result = await pool.query(
      `
        SELECT
          votes.*,
          sessions.name AS session_name
        FROM votes
        JOIN sessions ON sessions.id = votes.session_id
        WHERE votes.archived = false
          ${sessionFilter}
        ORDER BY votes.created_at DESC
      `,
      values
    );
    sendJson(response, 200, { ok: true, votes: result.rows.map(voteFromRow) });
    return true;
  }

  if (url.pathname === "/api/votes" && request.method === "POST") {
    const body = await readRequestBody(request);
    const id = body.id || `vote-${crypto.randomUUID()}`;
    const sessionId = body.sessionId || "master-data";
    const result = await pool.query(
      `
        INSERT INTO votes (
          id,
          topic_key,
          participant_id,
          first_name,
          last_name,
          team_number,
          team_association,
          session_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *,
          (SELECT name FROM sessions WHERE sessions.id = votes.session_id) AS session_name
      `,
      [
        id,
        body.topicKey || "",
        body.participantId || "",
        body.firstName || "",
        body.lastName || "",
        body.teamNumber || "",
        body.teamAssociation || "",
        sessionId,
      ]
    );
    sendJson(response, 201, { ok: true, vote: voteFromRow(result.rows[0]) });
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
