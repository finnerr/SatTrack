# SatTrack — Deployment Runbook

## How the stack works

- Code lives on this host at `/data/SatTrack`
- `docker-compose.yml` uses `build: .` — **there is no pre-built image in any registry**
- The container runs behind a Cloudflare tunnel (no exposed ports)
- Portainer monitors the container but **cannot rebuild the image** — it only restarts/pulls

> **This means:** "Redeploy" or "Pull latest image" in Portainer does nothing useful.
> Every deploy must be done manually on this host.

---

## Standard deploy (code change → live)

```bash
cd /data/SatTrack
git pull
docker compose build
docker compose up -d
```

That's it. The old container is replaced automatically by `up -d`.

---

## After deploying — clear browser cache

Because nginx serves JS assets with `Cache-Control: immutable`, browsers aggressively cache them. After a rebuild the JS filename hash changes, so a normal refresh is usually enough. If something still looks stale:

1. **Hard refresh:** `Cmd+Shift+R` (Mac) / `Ctrl+Shift+R` (Windows/Linux)
2. **Cloudflare cache:** If the app is behind Cloudflare, purge the cache in the Cloudflare dashboard → Caching → Purge Everything
3. **localStorage issues:** Some settings (imagery mode, filters) are persisted in localStorage. If behavior seems wrong, open DevTools → Application → Local Storage → delete stale keys (`sattrack_imagery`, etc.)

---

## Verify the new image is actually running

```bash
# Confirm the new container was just created
docker ps --filter name=sattrack

# Confirm the JS bundle hash inside the running container
docker run --rm sattrack-sattrack:latest ls /usr/share/nginx/html/assets/
# Should show something like index-XXXXXXXX.js
# Compare that hash to what the browser loaded (DevTools → Network → filter .js)
```

---

## Known issues / things to watch

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| Blue globe (no imagery) | `sattrack_imagery` in localStorage has stale value, or Cloudflare cached old HTML | Delete `sattrack_imagery` from localStorage; purge Cloudflare cache |
| Satellite stays on screen after closing | Fixed in code (nameSearch now clears on deselect) | Already deployed |
| Footprint opacity flickers | Fixed in code (memo now depends on altitude value, not object reference) | Already deployed |
| Old JS still loading | Browser loaded old index.html from cache | Hard refresh |

---

## Make deploys easier (future improvement)

The current setup requires SSH access to this host for every deploy. A better workflow:

### Option A — GitHub Actions → GHCR (recommended)

1. Add a GitHub Actions workflow that builds and pushes the image to `ghcr.io/finnerr/sattrack:latest` on every push to `main`
2. Change `docker-compose.yml` from `build: .` to `image: ghcr.io/finnerr/sattrack:latest`
3. Then Portainer's "Pull and redeploy" button actually works
4. Deploy becomes: push to GitHub → Portainer clicks "Redeploy"

### Option B — Portainer Git-based stack

Configure the Portainer stack to point at this GitHub repo. Portainer can pull and rebuild on a schedule or webhook trigger.

### Option C — Keep current, add a deploy script

```bash
#!/bin/bash
# /data/SatTrack/deploy.sh
set -e
cd /data/SatTrack
git pull
docker compose build
docker compose up -d
echo "Deploy complete. New bundle:"
docker run --rm sattrack-sattrack:latest ls /usr/share/nginx/html/assets/
```

Make it executable: `chmod +x deploy.sh`
Then future deploys are just: `./deploy.sh`
