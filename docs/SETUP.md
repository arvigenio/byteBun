# Setup on Windows (keeping everything on drive D:)

These are one-time steps for you to do yourself. They change Windows and Docker Desktop settings, which is why they are written here instead of being done automatically.

Paths below use `D:\Byte Bun\bytebun-web` as the project folder.

## 1. Check your Windows version

Press `Win + R`, type `winver`, press Enter.

Current Docker Desktop releases need **Windows 10 22H2 (build 19045) or later**, or Windows 11. If you see a lower build (for example 19041), run Windows Update first. Docker's current requirements are listed at https://docs.docker.com/desktop/setup/install/windows-install/.

## 2. Install WSL 2

Open **PowerShell as Administrator**:

```powershell
wsl --install --no-distribution
```

Restart the PC when asked. Then check:

```powershell
wsl --version
wsl --update
```

If `wsl --version` says the option is unknown, your WSL is the old built-in version: run Windows Update, then try again, or install "Windows Subsystem for Linux" from the Microsoft Store.

## 3. Install Docker Desktop

1. Download Docker Desktop for Windows from https://www.docker.com/products/docker-desktop/.
2. During install, keep **Use WSL 2 instead of Hyper-V** checked.
3. Start Docker Desktop and wait until it says it's running.

## 4. Move Docker's data to drive D:

Docker stores images, build cache, and volumes in one virtual disk. By default it is on C:.

1. Create the folder `D:\Docker\data`.
2. Docker Desktop → **Settings** (gear icon) → **Resources** → **Advanced** → **Disk image location** → **Browse** → choose `D:\Docker\data`.
3. Click **Apply & restart**. Moving can take several minutes.

### If your Docker Desktop has no "Disk image location" setting

Use WSL to move the Docker distro manually. In PowerShell (not as admin is fine):

```powershell
# 1. Quit Docker Desktop completely (tray icon → Quit), then:
wsl --shutdown
wsl --list -v                      # note the Docker distro names, e.g. docker-desktop (and docker-desktop-data on older versions)

# 2. Export, unregister, and import each Docker distro to D:
mkdir D:\WSL\docker-desktop-data
wsl --export docker-desktop-data D:\WSL\docker-desktop-data.tar
wsl --unregister docker-desktop-data
wsl --import docker-desktop-data D:\WSL\docker-desktop-data D:\WSL\docker-desktop-data.tar --version 2

# 3. Start Docker Desktop again, check it works, then delete the .tar file.
```

Only move the distro that holds data (`docker-desktop-data` on older versions; on newer versions use the Settings option above). `wsl --unregister` deletes the distro, so make sure the export finished without errors first.

## 5. Optional but recommended

**Limit memory Docker can use.** SQL Server needs about **2 GB** of RAM available to Docker. Create `C:\Users\<your name>\.wslconfig` (this file must be on C:, it's tiny):

```ini
[wsl2]
memory=6GB
processors=4
swap=2GB
```

Then run `wsl --shutdown` and restart Docker Desktop. Use at least 4 GB if you can.

**npm cache on D:** (only matters if you run npm on Windows itself, outside Docker):

```powershell
npm config set cache D:\npm-cache
```

## 6. Verify everything is on D:

- [ ] Docker Desktop → Settings → Resources → Advanced shows `D:\Docker\data` (or your D: path).
- [ ] `D:\Docker\data` contains a large `.vhdx` file (several GB after the first run).
- [ ] `C:\Users\<your name>\AppData\Local\Docker` is small (under a few hundred MB, mostly logs).
- [ ] After the first run, `D:\Byte Bun\bytebun-web\.data\mssql` exists (SQL Server's files).

## 7. First run

```powershell
cd "D:\Byte Bun\bytebun-web"
docker compose up --build
```

The first run downloads about 2 GB (mostly the SQL Server image) and can take 5 to 10 minutes. You're ready when you see `API listening on port 4000`. Open http://localhost:5173.

Optional: copy `.env.example` to `.env` to set your own passwords. If you change `MSSQL_SA_PASSWORD` after the database was created, SQL Server keeps the old one: either set it back, or run `npm run reset-db` (deletes local data).

## Troubleshooting

**SQL Server is slow to start / API keeps retrying.**
Normal on first start: SQL Server needs 20 to 60 seconds. The API retries for about two minutes. Watch with `docker compose logs -f db`. If it never becomes healthy, check the next items.

**SQL Server exits right away.**
Run `docker compose logs db`. Common causes:
- *Password doesn't meet complexity rules*: at least 8 characters, with upper case, lower case, a number, and a symbol. Avoid `$`.
- *Out of memory*: give Docker at least 2 GB (see `.wslconfig` above).
- *File or I/O errors on `/var/opt/mssql`*: some Windows setups don't support SQL Server's files on a bind-mounted Windows folder. Switch the database to a Docker volume (still on D: after step 4). Create `docker-compose.override.yml` next to `docker-compose.yml`:
  ```yaml
  services:
    db:
      volumes: !override
        - mssql-dev-data:/var/opt/mssql
  volumes:
    mssql-dev-data:
  ```
  Compose picks it up automatically. To reset that data use `docker compose down -v` instead of `npm run reset-db`.

**Port already in use** (`5173`, `4000`, or `1433`).
Something else is using the port, often a local SQL Server install (1433). Either stop that program, or set a different port in `.env` (`WEB_PORT`, `API_PORT`). For 1433, edit the `ports` line of `db` in `docker-compose.yml`, for example `"127.0.0.1:14330:1433"`.

**`exec ... no such file or directory` or `/bin/sh^M` errors.**
A file got Windows line endings (CRLF). The repo's `.gitattributes` forces LF; if you created or edited files outside Git, convert them to LF in your editor (VS Code: bottom-right "CRLF" → "LF"), then rebuild.

**Hot reload doesn't update.**
Both apps use polling because Windows doesn't forward file-change events into containers. If changes still don't appear: make sure you're editing files inside `D:\Byte Bun\bytebun-web`, save the file, and check `docker compose logs -f web` (or `api`). If you added a new npm package, run `docker compose up --build`; the containers also reinstall automatically when `package-lock.json` changes.

**"Configuration error. The API cannot start..."**
A required variable is missing or invalid. The message lists which ones. Compare your `.env` with `.env.example`.

**Start over completely.**
`docker compose down`, then `npm run reset-db` (deletes local leads), then `docker compose up --build`.
