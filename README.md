# Lean Sessions

Localhost package for running the Lean Sessions web application.

## Requirements

- Node.js 18 or later

## Run Locally

From this folder:

```bash
npm start
```

Then open:

```text
http://127.0.0.1:51234/
```

## Optional Port

To run on another port:

```bash
PORT=3000 npm start
```

On Windows PowerShell:

```powershell
$env:PORT=3000
npm start
```

## Pages

- Landing page: `http://127.0.0.1:51234/`
- Admin login: `http://127.0.0.1:51234/login.html`
- Participant login: `http://127.0.0.1:51234/begin.html`

All session data is stored in the browser's local storage.

## PostgreSQL Setup On Render

Create a Render PostgreSQL database, then add its connection string to your web service as:

```text
DATABASE_URL
```

To create your first Super Admin automatically, add these environment variables to the Render web service:

```text
SUPER_ADMIN_USERNAME=admin_stephen
SUPER_ADMIN_PASSWORD=choose-a-strong-password
SUPER_ADMIN_FIRST_NAME=Stephen
SUPER_ADMIN_LAST_NAME=Admin
```

After saving the environment variables, redeploy the web service. The server will create the `admins` table and seed the first Super Admin if the table is empty.

The app now uses PostgreSQL for:

- Admin login
- Register Admin
- Admin View loading
- Session Admin sessions
- Register Participant
- Participant View loading
- Participant login

Topics, votes, timers, and archived results still use browser local storage until they are migrated to API routes.
