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
