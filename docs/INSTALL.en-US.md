# Installation and configuration manual

> **Leia em português:** [INSTALL.pt-BR.md](INSTALL.pt-BR.md)

This manual explains how to install the speed test on your own server, from
zero to a working test — including HTTPS, branding, creating a new language
and the optional result persistence in a database.

The project is a fork of [OpenSpeedTest](https://github.com/openspeedtest/Speed-Test):
**100% static files** (HTML, CSS, JavaScript and SVG). There is no build step,
no Node.js, no mandatory backend — any web server will do. The only optional
server-side component is result recording (PHP + MariaDB, §8).

## Table of contents

1. [Requirements](#1-requirements)
2. [Quick checklist](#2-quick-checklist)
3. [Getting the code and preparing the files](#3-getting-the-code-and-preparing-the-files)
4. [nginx (recommended)](#4-nginx-recommended)
5. [Apache 2.4](#5-apache-24)
6. [Branding — logo, colors and domains (tenants)](#6-branding--logo-colors-and-domains-tenants)
7. [Creating a new language](#7-creating-a-new-language)
8. [Result persistence (optional)](#8-result-persistence-optional)
9. [Test tuning](#9-test-tuning)
10. [Connectivity analysis (optional)](#10-connectivity-analysis-optional)
11. [Updates](#11-updates)
12. [Troubleshooting](#12-troubleshooting)
13. [License and credits](#13-license-and-credits)

---

## 1. Requirements

- **A Linux server** (examples use Debian/Ubuntu; any distribution works).
- **nginx ≥ 1.18** (recommended — it is what runs Vialink's production
  deployment) **or Apache ≥ 2.4** (§5).
- **A DNS name** pointing at the server (e.g. `speedtest.example.com`) and
  **ports 80/443** reachable — required for HTTPS with Let's Encrypt.
- ~110 MB of disk for the repository + the 100 MB download file.
- **Optional** (only for recording results, §8): PHP-FPM 8.x and MariaDB/MySQL.

Capacity note: the test saturates the **client's** bandwidth, not the server's
CPU — a modest server measures 1 Gbps clients effortlessly, as long as the
**server's uplink** is larger than the connections you want to measure. To
measure clients of up to 1 Gbps, the server needs an uplink ≥ 1 Gbps.

## 2. Quick checklist

```bash
# 1. Code
sudo git clone https://github.com/vialink/vialink-speedtest.git /var/www/speedtest

# 2. Download file (100 MB, not versioned)
sudo dd if=/dev/urandom of=/var/www/speedtest/downloading bs=1M count=100

# 3. Permissions
sudo chown -R www-data:www-data /var/www/speedtest

# 4. Web server (§4 or §5) + HTTPS
sudo certbot --nginx -d speedtest.example.com

# 5. Open https://speedtest.example.com and run a test
```

## 3. Getting the code and preparing the files

```bash
sudo git clone https://github.com/vialink/vialink-speedtest.git /var/www/speedtest
cd /var/www/speedtest
```

Two files take part in the test itself:

- **`downloading`** — the data blob served to the client during the download
  test. It is **not versioned** (100 MB does not belong in git); generate it
  after cloning:

  ```bash
  sudo dd if=/dev/urandom of=/var/www/speedtest/downloading bs=1M count=100
  ```

  Use `/dev/urandom` (random data): a file full of zeros would be compressed
  by any intermediate layer and inflate the results.

- **`upload`** — the target of the upload test POSTs. It ships with the
  repository (empty); the web server replies `200` and discards the body
  (configured in §4/§5).

Finally, make everything readable by the web server user:

```bash
sudo chown -R www-data:www-data /var/www/speedtest
```

## 4. nginx (recommended)

The configuration below is the one used in Vialink's production deployment,
generalized. Create `/etc/nginx/sites-available/speedtest`:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name speedtest.example.com;   # add aliases if you have more names

    root /var/www/speedtest;
    index index.html;

    # Upload: accept the POST, discard the body and answer 200.
    # A small client_body_buffer_size + return 200 = the body never hits disk.
    location = /upload {
        client_max_body_size 120m;
        client_body_buffer_size 16k;
        add_header "Access-Control-Allow-Origin" "*" always;
        add_header "Access-Control-Allow-Methods" "GET, POST, HEAD, OPTIONS" always;
        add_header "Access-Control-Allow-Headers" "Content-Type" always;
        if ($request_method = OPTIONS) { return 204; }
        return 200;
    }

    # Download: never cache the test blob
    location = /downloading {
        add_header Cache-Control "no-store, no-cache, must-revalidate";
        add_header Pragma no-cache;
        expires off;
        add_header "Access-Control-Allow-Origin" "*" always;
    }

    # (Optional, §8) result-recording API — this file only
    #location = /api/salvar-teste.php {
    #    client_max_body_size 16k;
    #    include fastcgi_params;
    #    fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
    #    fastcgi_pass unix:/run/php/php8.4-fpm.sock;
    #}

    # Maintenance scripts (cron) — never served over the web
    location /scripts/ { deny all; }

    location / {
        try_files $uri $uri/ =404;
        add_header "Access-Control-Allow-Origin" "*" always;
        add_header Cache-Control "no-store";
    }

    # Performance and measurement accuracy
    access_log off;          # per-request logging skews the measurement
    error_log  /var/log/nginx/speedtest-error.log warn;

    client_body_timeout   300s;
    send_timeout          300s;
    keepalive_timeout     300s;

    sendfile      on;
    tcp_nopush    on;
    tcp_nodelay   on;
    gzip          off;       # compression skews the measurement
}
```

Enable and reload:

```bash
sudo ln -s /etc/nginx/sites-available/speedtest /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

**HTTPS (Let's Encrypt):**

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d speedtest.example.com
```

certbot rewrites the site for 443 with an 80 redirect and sets up automatic
renewal (validate with `certbot renew --dry-run`).

Directives that are **not** optional in this configuration:

| Directive | Why |
|---|---|
| `gzip off` | Compressing the test blob falsifies the result |
| `Cache-Control: no-store` | A cached download measures the disk, not the network |
| `access_log off` | Logging every test chunk consumes I/O and skews results |
| `client_max_body_size 120m` | The test sends up to ~100 MB per upload connection |
| 300s timeouts | Stress mode (`?Stress=300`) keeps long-lived connections |

## 5. Apache 2.4

> Reference configuration — Vialink runs the speed test on nginx; the Apache
> setup below covers the same requirements (POST to a static file → 200, no
> caching, no compression, 120 MB request body).

Required modules:

```bash
sudo a2enmod rewrite headers ssl
```

VirtualHost (`/etc/apache2/sites-available/speedtest.conf`):

```apache
<VirtualHost *:80>
    ServerName speedtest.example.com
    DocumentRoot /var/www/speedtest

    <Directory /var/www/speedtest>
        Options -Indexes
        AllowOverride None
        Require all granted
    </Directory>

    # Upload: Apache would answer 405 to a POST on a static file;
    # this rule intercepts it and answers 200 (body is discarded).
    RewriteEngine On
    RewriteCond %{REQUEST_METHOD} =POST
    RewriteRule ^/upload$ - [R=200,L]

    # The test sends up to ~100 MB per upload connection
    LimitRequestBody 125829120

    # Never cache, never compress
    Header always set Cache-Control "no-store"
    Header always set Access-Control-Allow-Origin "*"
    SetEnv no-gzip 1

    # Maintenance scripts are never served
    <DirectoryMatch "^/var/www/speedtest/scripts">
        Require all denied
    </DirectoryMatch>

    # No access log on the test endpoints (measurement accuracy)
    SetEnvIf Request_URI "^/(upload|downloading)" nolog
    CustomLog ${APACHE_LOG_DIR}/speedtest-access.log combined env=!nolog
    ErrorLog ${APACHE_LOG_DIR}/speedtest-error.log
</VirtualHost>
```

Enable and reload:

```bash
sudo a2ensite speedtest
sudo apachectl configtest && sudo systemctl reload apache2
```

**HTTPS (Let's Encrypt):**

```bash
sudo apt install certbot python3-certbot-apache
sudo certbot --apache -d speedtest.example.com
```

> If `mod_deflate` is enabled globally, make sure `/downloading` and `/upload`
> are not compressed (`SetEnv no-gzip 1` above takes care of it). If you use
> HTTP/2 (`mod_http2`), see the performance note in §11.

**(Optional, §8)** for the recording API with PHP-FPM:

```apache
<FilesMatch "^salvar-teste\.php$">
    SetHandler "proxy:unix:/run/php/php8.4-fpm.sock|fcgi://localhost"
</FilesMatch>
```

(requires `a2enmod proxy_fcgi setenvif`)

## 6. Branding — logo, colors and domains (tenants)

The speed test is **multi-tenant**: the same installation serves multiple
domains, each with its own logo, colors and favicon. The table lives in
**`assets/js/tenants.js`** — static configuration, no backend.

> ⚠️ **Trademarks:** the code is MIT, but the **Vialink** and **MaisLink**
> logos, names and colors that ship with the repository are **not** — see
> [COPYRIGHT.md](../COPYRIGHT.md). When self-hosting, configure a tenant with
> **your own brand**.

Step by step to apply your brand:

1. **Create the assets folder** `assets/tenants/my-brand/` with:
   - `logo.svg` — logo for the light theme (a ~3:1 aspect ratio fits the
     gauge well);
   - `logo-white.svg` — dark-theme version (optional; without it the same
     logo is used in both themes);
   - `icon-192.png` — square icon used in the PDF header;
   - favicons (`favicon.ico`, `favicon-16x16.png`, `favicon-32x32.png`,
     `apple-touch-icon.png`).
2. **Add the tenant** to the `TENANTS` object in `assets/js/tenants.js`:

   ```js
   'my-brand': {
     name: 'My Brand',
     domains: ['speedtest.example.com'],
     title: 'My Brand Speed Test',
     description: 'Test your connection speed',
     site: 'https://example.com',
     logo: '/assets/tenants/my-brand/logo.svg',
     logoDark: '/assets/tenants/my-brand/logo-white.svg', // optional
     logoPdf: '/assets/tenants/my-brand/icon-192.png',
     iconsDir: '/assets/tenants/my-brand',
     colors: {
       accent: '#0066CC',      // main color (menus, icons, buttons)
       accentDark: '#004C99',  // end of the gradients
       gaugeStart: '#66AAFF',  // start of the gauge arc
       gaugeEnd: '#003366'     // end of the gauge arc
     },
     poweredBy: true,   // false hides the "Powered by Vialink" footer
     sobre: true        // false hides the "About" menu item
   },
   ```

3. **Set the fallback**: `DEFAULT_TENANT` (same file) is the tenant used when
   the hostname matches none — including access by IP address.
4. **Test without DNS**: any hostname accepts the `?tenant=my-brand` URL
   override.

The "YOUR IP" card queries `ipapi.co` from the client's browser to show
IP/ASN/city — it needs internet access; without it the card just shows dashes
(the test itself works normally). The query originates from each visitor's
own IP, so `ipapi.co`'s free-tier limits are rarely hit; to switch geo-IP
providers, the endpoints are at the top of `assets/js/tenant.js` (fallback:
`api.ipify.org`, IP only).

## 7. Creating a new language

The translation system lives in `assets/js/i18n/` — each language is **a
single JS file** with every text (interface, tooltips, test messages, PDF and
the manual/about/report pages). The language is picked in this order:
`?lang=` in the URL → cookie (the user's choice in the flag selector) →
browser language → English.

Example: adding **Italian (it-IT)**.

1. **Copy the reference dictionary** (English is the fallback and is always
   complete):

   ```bash
   cp assets/js/i18n/en-US.js assets/js/i18n/it-IT.js
   ```

2. **Edit the `register()` header** in the new file:

   ```js
   window.VLK_I18N.register({
     code: 'it-IT',        // BCP 47 code
     country: 'IT',        // abbreviation shown next to the flag
     name: 'Italiano',     // language name, in the language itself
     flag: '/assets/img/flags/it.svg',
     locale: 'it-IT',      // number and date formatting
     // pdfLatin1: false,  // only for languages outside Latin-1 (Cyrillic,
     //                    // CJK): the Share PDF falls back to English
     //                    // (jsPDF's built-in Helvetica lacks those glyphs)
     strings: { /* ... translations ... */ }
   });
   ```

3. **Translate the `strings` values.** Rules:
   - Preserve the placeholders `{name}`, `{d}`, `{u}`, `{p}`, `{dd}`, `{ud}`,
     `{date}`, `{time}`, `{tenant}` — they are substituted at runtime
     (`{name}` becomes the tenant name).
   - Keys used with HTML (the ones applied via `data-i18n-html`, typically
     the long page texts) accept `<strong>`, `<a>`, `<code>` — keep the
     markup, translate the text.
   - You may omit keys you don't want to translate: anything missing falls
     back to English.
4. **Create the flag** `assets/img/flags/it.svg` — viewBox `0 0 20 14`,
   rounded corners `rx="1.5"`, simple shapes (it is displayed at ~14×10 px).
   Use `br.svg`/`us.svg` as templates:

   ```svg
   <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 14">
     <defs><clipPath id="r"><rect width="20" height="14" rx="1.5"/></clipPath></defs>
     <g clip-path="url(#r)">
       <rect width="20" height="14" fill="#fff"/>
       <rect width="6.67" height="14" fill="#009246"/>
       <rect x="13.33" width="6.67" height="14" fill="#CE2B37"/>
     </g>
   </svg>
   ```

5. **Include the script in the 4 pages**, after the existing dictionaries:
   - `index.html` (relative path):
     `<script src="assets/js/i18n/it-IT.js"></script>`
   - `relatorio.html`, `manual.html`, `sobre.html` (absolute path):
     `<script src="/assets/js/i18n/it-IT.js"></script>`
6. **Test it**: open `https://your-server/?lang=it-IT`, check the interface
   and tooltips, and confirm the flag selector lists `IT · Italiano` (menu
   order follows the `<script>` order). Run a full test and generate the
   Share PDF.

More details (key-prefix table, semantics of each group) in
[`assets/js/i18n/README.md`](../assets/js/i18n/README.md). New translations
are welcome back into the project as pull requests.

## 8. Result persistence (optional)

By default the speed test is 100% static and **records nothing**. If you want
to store every test in a database (for reports and history), the repository
ships a minimal PHP API: `api/salvar-teste.php` — the front end calls
`POST /api/salvar-teste.php` at the end of each test, and a recording failure
never affects the user (best-effort).

> **Privacy:** the table stores the IP, user agent and results of every test.
> Check your local legislation (LGPD in Brazil, GDPR in the EU, etc.) before
> enabling this on a public service, and define a retention policy.

1. **Packages:**

   ```bash
   sudo apt install php8.4-fpm php8.4-mysql mariadb-server
   ```

2. **Database and user:**

   ```sql
   CREATE DATABASE speedtest CHARACTER SET utf8mb4;
   CREATE USER 'speedtest_app'@'localhost' IDENTIFIED BY 'CHANGE-THIS-PASSWORD';
   GRANT SELECT, INSERT, UPDATE ON speedtest.* TO 'speedtest_app'@'localhost';
   ```

3. **Table:**

   ```sql
   USE speedtest;
   CREATE TABLE testes (
     id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
     criado_em      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
     tenant         VARCHAR(32)  NOT NULL DEFAULT 'vialink',
     hostname       VARCHAR(100) NOT NULL DEFAULT '',
     site           VARCHAR(32)  NOT NULL DEFAULT '',
     ip             VARCHAR(45)  NOT NULL,
     download_mbps  DECIMAL(10,3) NOT NULL,
     upload_mbps    DECIMAL(10,3) NOT NULL,
     ping_ms        DECIMAL(10,2) NOT NULL,
     jitter_ms      DECIMAL(10,2) NOT NULL,
     dl_dados_mb    DECIMAL(12,3) DEFAULT NULL,
     ul_dados_mb    DECIMAL(12,3) DEFAULT NULL,
     user_agent     VARCHAR(512) NOT NULL DEFAULT '',
     asn            VARCHAR(120) NOT NULL DEFAULT '',
     cidade         VARCHAR(120) NOT NULL DEFAULT '',
     cliente        VARCHAR(200) DEFAULT NULL,
     netbox_dns     VARCHAR(255) DEFAULT NULL,
     netbox_device  VARCHAR(200) DEFAULT NULL,
     netbox_descr   VARCHAR(255) DEFAULT NULL,
     enriquecido_em DATETIME DEFAULT NULL,
     PRIMARY KEY (id),
     KEY idx_criado (criado_em),
     KEY idx_ip (ip),
     KEY idx_tenant_criado (tenant, criado_em),
     KEY idx_enriquecer (enriquecido_em),
     KEY idx_site (site)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
   ```

   (Column and table names are in Portuguese — the API expects them as-is.
   The `cliente`/`netbox_*` columns are filled by an enrichment job specific
   to Vialink's infrastructure — `scripts/enriquecer-netbox.php`, which
   resolves each IP's owner via [NetBox](https://netbox.dev). Without NetBox,
   leave them empty or adapt the script to your own data source.)

4. **Credentials outside the web root** — `/etc/vlk-speedtest/db.ini`
   (owner `root:www-data`, mode `640`):

   ```ini
   [db]
   dsn  = "mysql:unix_socket=/run/mysqld/mysqld.sock;dbname=speedtest;charset=utf8mb4"
   user = "speedtest_app"
   pass = "CHANGE-THIS-PASSWORD"
   ```

5. **Web server:** uncomment the `location = /api/salvar-teste.php` block
   from §4 (nginx) or apply the `FilesMatch` from §5 (Apache) and reload.
6. **Validate:** run a test in the browser and check the new row:

   ```bash
   sudo mariadb speedtest -e 'SELECT * FROM testes ORDER BY id DESC LIMIT 1\G'
   ```

Note: the `site` column classifies the requested hostname as
`vialink`/`maislink`/`por-ip` (by IP)/`outro` (other) — see `classificaSite`
in the API; adapt the function to your own domains if you want this
classification.

## 9. Test tuning

The test parameters live in the configuration `<script>` of **`index.html`**:

| Variable | Default | Meaning |
|---|---|---|
| `dlThreads` / `ulThreads` | 6 | Parallel connections (HTTP/1.1 caps at 6 per origin — higher values don't help) |
| `ulDataSize` | 100 | MB sent per upload connection |
| `dlDuration` / `ulDuration` | 12 | Duration (s) of each stage |
| `pingSamples` | 10 | Ping samples |
| `saveData` / `saveDataURL` | — | Upstream's recording mechanism — **not used**; this fork records via `api/salvar-teste.php` (§8) |

Users can also pass URL parameters (documented in the speed test's own
**Manual** page): `?Run` (auto-start), `?Stress=300` (continuous test),
`?Test=Download|Upload|Ping` (single stage), `?Ping=500` (more samples),
`?lang=` (language), `?tenant=` (brand).

### 9.1. Per-installation local configuration (`vlk-config-local.js`)

Settings specific to **your** installation should not go in `index.html` —
an upgrade (`git pull` or a deploy with `git reset --hard`) would undo the
change. Use the local file instead, which is **not versioned** and therefore
survives updates:

```bash
cp assets/js/vlk-config-local.example.js assets/js/vlk-config-local.js
# edit it and set the values you want
```

If the file does not exist, the `index.html` defaults apply (its 404 in the
console is harmless). Available options:

| Variable | Default | Meaning |
|---|---|---|
| `vlkCorrectionFactor` | 1.0 | Correction factor: **displayed** download/upload values are the measurement multiplied by it (the gauge scale follows). The persistence layer (§8) always records the **raw** value, without the factor. `1.0` = no correction |

## 10. Connectivity analysis (optional)

The `conectividade.html` page (**Network** menu item) measures **latency, jitter
and packet loss** to a list of destinations, in two independent layers:

- **Client (always available):** the browser measures average latency, jitter and
  failure rate for each destination with timed HTTPS requests. It is not ICMP —
  the browser has no raw-socket access, so *ping*/*traceroute* are impossible
  there — but it is a good approximation of the user's real connection
  experience. It needs nothing on the server.
- **Server (optional):** the `api/diagnostico.php` endpoint runs `mtr`
  (real traceroute/ICMP) on the server itself and returns hops, latency, jitter
  and **real packet loss** for the route *from the server* to the destination.

### Destinations

Configured per tenant in `assets/js/tenants.js`, field `connectivityTargets`
(an array of `{ label, host, ip? }`). Without it, the page has no destinations.
For the 8.8.8.8 case, the client probes the name `dns.google` (the browser
can't do TLS against the raw IP); the server measures the IP directly.

### Enabling the server layer (mtr)

1. **Install mtr** with ICMP-socket permission and confirm the PHP-FPM user can
   run it:
   ```bash
   apt-get install -y mtr-tiny
   sudo -u www-data mtr -n -4 -c 3 --json 8.8.8.8   # should print JSON with "hubs"
   ```
   (the package already grants `cap_net_raw` to `mtr-packet`.)
2. **Mirror the allowlist** in `api/diagnostico-targets.php` — a PHP array with
   the same hosts as `connectivityTargets`, **in the same order**. The client
   sends only the destination index; the host comes from here, **never from the
   request** — that is what prevents command injection/SSRF.
3. **Serve the endpoint** in nginx (dedicated block, like the persistence one):
   ```nginx
   location = /api/diagnostico.php {
       client_max_body_size 4k;
       include fastcgi_params;
       fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
       fastcgi_pass unix:/run/php/php8.4-fpm.sock;
       fastcgi_read_timeout 35s;
   }
   ```

Without the endpoint (or without `mtr`), the server section shows "unavailable"
and the page keeps working with the client layer only. Each destination's result
is cached for 60 s on the server to limit load/abuse.

### Netflix via the local OCA (optional)

For the Netflix target, `www.netflix.com` is the *website* (hosted far away,
~170ms); what the subscriber actually experiences is **Open Connect** — the local
streaming CDN (~10ms). The `api/netflix-oca.php` endpoint discovers a local OCA
via the fast.com API (proxied on the server, since the API does not allow CORS for
the page) and the client measures the OCA directly. Serve it in nginx like the
others:

```nginx
location = /api/netflix-oca.php {
    include fastcgi_params;
    fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
    fastcgi_pass unix:/run/php/php8.4-fpm.sock;
    fastcgi_read_timeout 15s;
}
```

Requires PHP with cURL and outbound HTTPS to `api.fast.com`. Without the endpoint,
the Netflix target automatically falls back to measuring the website
(`www.netflix.com`).

## 11. Updates

```bash
cd /var/www/speedtest
sudo -u www-data git pull
```

Nothing needs restarting — the files are static (nginx/Apache serves the new
version immediately; the site is already served with `Cache-Control: no-store`).

To import changes from the original OpenSpeedTest:

```bash
git remote add upstream https://github.com/openspeedtest/Speed-Test.git
git fetch upstream
git log HEAD..upstream/main --oneline   # review what's coming
git merge upstream/main                 # resolve conflicts if any
```

> Tip: at Vialink the deployment is automated with GitLab CI/CD (the
> `.gitlab-ci.yml` in the repository is included as a reference) — a runner
> on the server itself does `git reset --hard origin/main`, ensures the
> `downloading` file exists and reloads nginx on every push.

## 12. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| **"Network Error"** when starting | The browser could not reach `/upload` or `/downloading`. Check the browser console (F12): 404 = `downloading` file not generated (§3); 405 = missing the POST rule from §4/§5; 413 = body limited (raise `client_max_body_size`/`LimitRequestBody`). |
| Error only on **upload** | Missing POST rule, or a reverse proxy in front limiting the body (raise the limit there too — it needs ≥ 120 MB). |
| **Results lower than expected** | `gzip`/`brotli` enabled (disable for this site), `access_log` enabled, a cache serving `/downloading`, antivirus/browser extensions inspecting traffic (try a private window), Wi-Fi. |
| Result **caps around 6 connections** | Normal HTTP/1.1 behavior (6 connections per origin). Upstream recommends HTTP/1.1 for maximum performance; with HTTP/2/HTTP/3 the test works, but multiplexing may slightly alter the numbers. |
| **"YOUR IP" card empty** | The client's browser could not reach `ipapi.co` (no internet or blocked). Does not affect the test. |
| **PDF doesn't download / share doesn't open** | jsPDF is loaded from `assets/js/vendor/` (no CDN) — check the path is served. `navigator.share` only exists over HTTPS. |
| Test behind a **reverse proxy/CDN** | Raise the POST body limit (≥ 120 MB), disable caching and compression for the test host. A CDN in front measures the CDN, not your server. |
| **Recording (§8) not happening** | Check the PHP-FPM `error_log`; permissions of `/etc/vlk-speedtest/db.ini` (`root:www-data 640`); database user grants. The failure is silent for the user, by design. |

## 13. License and credits

- Code: **MIT** — © 2013–2023 OpenSpeedTest™ (original project) and © 2026
  Vialink (fork modifications). Details in [LICENSE](../LICENSE) and
  [COPYRIGHT.md](../COPYRIGHT.md).
- **The Vialink/MaisLink logos and trademarks are not MIT** — replace them
  with your own brand when hosting publicly (§6).
- Improvements of general interest (new languages, fixes) are welcome as
  pull requests.
