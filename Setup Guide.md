# Production Setup & Deployment Guide — Alexithymia Love Quantifier

This guide details how to deploy the **Alexithymia Love Quantifier** (WebApp and Android App backend) onto a Linux server behind an Nginx reverse-proxy under the **`voglerprojekte.com`** domain ecosystem.

---

## 1. Domain & Network Architecture

### Subdomain Topology

* **WebApp Domain:** `https://alexithymialovequantifier.voglerprojekte.com`
* **API Subdomain:** `https://api.alexithymialovequantifier.voglerprojekte.com`
* **Parent Domain:** `voglerprojekte.com`

### Traffic Routing Diagram

```text
[ Web Browser ]                [ Android App (Capacitor) ]
       │                                     │
       ▼ (HTTPS :443)                        ▼ (HTTPS :443)
alexithymialovequantifier.              api.alexithymialovequantifier.
    voglerprojekte.com                      voglerprojekte.com
       │                                     │
       └───────────────────┬─────────────────┘
                           ▼
          ┌───────────────────────────────────┐
          │     Host Nginx Reverse Proxy      │
          │ (SSL/TLS Termination via Certbot) │
          └─────────────────┬─────────────────┘
                            │ Proxy Pass (http://127.0.0.1:8082)
                            ▼
          ┌───────────────────────────────────┐
          │  Frontend Container (Nginx:80)   │
          │  - Serves compiled React SPA      │
          │  - Auth rate limiting (/api/auth) │
          │  - Proxies /api/ and /uploads/    │
          └─────────────────┬─────────────────┘
                            │ Internal Docker Web Network (http://backend:8080)
                            ▼
          ┌───────────────────────────────────┐
          │   Backend Container (Go Service)  │
          │   - REST API & CORS enabled       │
          │   - Auth & Session verification   │
          └─────────────────┬─────────────────┘
                            │ Internal Data Network (pgx :5432)
                            ▼
          ┌───────────────────────────────────┐
          │   PostgreSQL Database (v15)       │
          │   - Encrypted data volume         │
          └───────────────────────────────────┘
```

---

## 2. Prerequisites & Server Preparation

### 2.1 DNS Configuration
In your DNS provider (for `voglerprojekte.com`), add `A` records pointing to your Linux server's public IP address:

| Host / Subdomain | Type | Target |
| :--- | :--- | :--- |
| `voglerprojekte.com` | `A` | `<SERVER_PUBLIC_IP>` |
| `alexithymialovequantifier.voglerprojekte.com` | `A` | `<SERVER_PUBLIC_IP>` |
| `api.alexithymialovequantifier.voglerprojekte.com` | `A` | `<SERVER_PUBLIC_IP>` |

### 2.2 Install Required Packages on the Linux Server

```bash
# Update package repositories
sudo apt update && sudo apt upgrade -y

# Install Docker, Docker Compose plugin, Git, Nginx, and Certbot
sudo apt install -y git curl ufw nginx certbot python3-certbot-nginx docker.io docker-compose-v2 make

# Enable and start Docker & Nginx
sudo systemctl enable --now docker
sudo systemctl enable --now nginx

# Ensure the current user can run docker commands without sudo (optional)
sudo usermod -aG docker $USER
```

### 2.3 Firewall Setup (UFW)

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

---

## 3. Host Nginx Reverse Proxy & SSL Setup

Create an Nginx server configuration on the host machine for both subdomains.

### 3.1 Create Nginx Site Configuration

Create `/etc/nginx/sites-available/alexithymialovequantifier.conf`:

```bash
sudo nano /etc/nginx/sites-available/alexithymialovequantifier.conf
```

Paste the following configuration:

```nginx
# ==============================================================================
# 1. WebApp: alexithymialovequantifier.voglerprojekte.com
# ==============================================================================
server {
    server_name alexithymialovequantifier.voglerprojekte.com;

    # Maximum upload size for avatars
    client_max_body_size 8m;

    location / {
        proxy_pass http://127.0.0.1:8082;
        proxy_http_version 1.1;

        # Header forwarding
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket support (if needed)
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # Timeouts
        proxy_connect_timeout 10s;
        proxy_read_timeout 60s;
        proxy_send_timeout 60s;
    }

    listen 80;
}

# ==============================================================================
# 2. Backend API: api.alexithymialovequantifier.voglerprojekte.com
# ==============================================================================
server {
    server_name api.alexithymialovequantifier.voglerprojekte.com;

    # Maximum upload size for avatars
    client_max_body_size 8m;

    location / {
        proxy_pass http://127.0.0.1:8082;
        proxy_http_version 1.1;

        # Header forwarding
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Timeouts
        proxy_connect_timeout 10s;
        proxy_read_timeout 60s;
        proxy_send_timeout 60s;
    }

    listen 80;
}
```

### 3.2 Enable the Site & Test Nginx

```bash
# Enable the configuration
sudo ln -s /etc/nginx/sites-available/alexithymialovequantifier.conf /etc/nginx/sites-enabled/

# Verify syntax
sudo nginx -t

# Reload Nginx
sudo systemctl reload nginx
```

### 3.3 Obtain Free SSL/TLS Certificates with Let's Encrypt Certbot

Run Certbot to automatically configure HTTPS and HTTP-to-HTTPS redirects:

```bash
sudo certbot --nginx -d alexithymialovequantifier.voglerprojekte.com -d api.alexithymialovequantifier.voglerprojekte.com
```

Certbot will automatically update the Nginx configuration with certificate paths and HTTPS redirect rules.

---

## 4. Deploying the Application via Docker Compose

### 4.1 Clone the Repository

```bash
cd /opt  # or ~/projects
git clone https://github.com/SirGrandmasterr/AlexithymiaLoveQuantifier.git
cd AlexithymiaLoveQuantifier
```

### 4.2 Configure Secrets in `.env`

Copy the environment template:

```bash
cp .env.example .env
```

Generate secure secrets for Postgres and JWT:

```bash
# Generate Postgres Password
openssl rand -base64 30 | tr -dc 'A-Za-z0-9' | head -c 40

# Generate JWT Secret
openssl rand -hex 32
```

Edit `.env` and fill in the values:

```ini
POSTGRES_USER=postgres
POSTGRES_PASSWORD=YOUR_GENERATED_POSTGRES_PASSWORD
POSTGRES_DB=alexithymia

JWT_SECRET=YOUR_GENERATED_JWT_SECRET

# Nginx container bound to localhost port 8082
FRONTEND_PORT=8082
BACKEND_DEBUG_PORT=8081
```

### 4.3 Start the Stack

Use `make up` to launch the database, run schema migrations, and start all containers:

```bash
make up
```

*(Or equivalently: `docker compose up -d --build`)*

### 4.4 Verify Deployment

```bash
# Check container status
docker compose ps

# View backend logs to verify database connectivity and auto-migrations
docker compose logs -f backend
```

Once running, visit:
* WebApp: `https://alexithymialovequantifier.voglerprojekte.com`
* API Meta Endpoint: `https://api.alexithymialovequantifier.voglerprojekte.com/api/meta`

---

## 5. Android App Build & Configuration

The Android application is packaged using Capacitor and built directly inside Docker (no Android Studio or JDK needed on the build host).

### 5.1 Default API Configuration

The app defaults to:
`https://api.alexithymialovequantifier.voglerprojekte.com`

This can be customized during the build if targeting a staging or test server:

```bash
# Build APK in Docker with the production API endpoint
make build-android ANDROID_API_URL=https://api.alexithymialovequantifier.voglerprojekte.com
```

The output APK will be placed in `dist-android/app-debug.apk`.

### 5.2 Release Bundle for Google Play (AAB)

To generate a signed production bundle:

```bash
make bundle-android \
  KEYSTORE=/path/to/my-release-key.jks \
  KEYSTORE_PASS=mySecretPassword \
  KEY_ALIAS=my-key-alias
```

The signed Android App Bundle will be exported to `dist-android/app-release.aab`.

### 5.3 In-App Server Switching

The Android app features a built-in **Server Settings** modal. If a user needs to switch instances or test against a private server:
1. Tap the server settings icon in the top navigation bar.
2. Enter the server root URL (e.g. `https://api.alexithymialovequantifier.voglerprojekte.com`).
3. Tap **Test** to verify connection, then **Save**.

---

## 6. Local Development Workflow

If you want to run and develop the project on your local machine:

### 6.1 Install Dependencies
```bash
npm install
```

### 6.2 Run Frontend Dev Server (Vite)
```bash
npm run dev
# App is available at http://localhost:5173
```

### 6.3 Run Go Backend Locally
```bash
cd backend
JWT_SECRET=dev-secret-key-change-in-production go run ./cmd/server
# Backend listens on http://localhost:8080
```

### 6.4 Run Automated Tests
```bash
# Run frontend Vitest suite (160+ unit tests)
npm test

# Run Go backend test suite
cd backend && go test ./...
```

---

## 7. Database Backups and Maintenance

### 7.1 Creating a Database Backup
```bash
make db-backup
# Creates timestamped backup under backups/alexithymia-YYYYMMDD-HHMMSS.sql
```

### 7.2 Restoring from a Backup
```bash
make db-restore FILE=backups/alexithymia-20260820-120000.sql
```

### 7.3 Changing Database Password
To update the password on a live database:
1. Update `POSTGRES_PASSWORD` in `.env`.
2. Run `make db-password` to apply it to the running Postgres container.
3. Restart backend: `docker compose up -d backend`.

### 7.4 Viewing Container Logs
```bash
make logs
# or: docker compose logs -f
```
