# Manual de instalação e configuração

> **Read this in English:** [INSTALL.en-US.md](INSTALL.en-US.md)

Este manual explica como instalar o velocímetro em servidor próprio, do zero ao
teste funcionando — incluindo HTTPS, personalização da marca, criação de um novo
idioma e a persistência opcional de resultados em banco de dados.

O projeto é um fork do [OpenSpeedTest](https://github.com/openspeedtest/Speed-Test):
**arquivos 100% estáticos** (HTML, CSS, JavaScript e SVG). Não há build, não há
Node.js, não há backend obrigatório — qualquer servidor web serve. A única parte
opcional com código de servidor é a gravação de resultados (PHP + MariaDB, §8).

## Sumário

1. [Requisitos](#1-requisitos)
2. [Checklist rápido](#2-checklist-rápido)
3. [Obter o código e preparar os arquivos](#3-obter-o-código-e-preparar-os-arquivos)
4. [nginx (recomendado)](#4-nginx-recomendado)
5. [Apache 2.4](#5-apache-24)
6. [Personalização — marca, cores e domínios (tenants)](#6-personalização--marca-cores-e-domínios-tenants)
7. [Criar um novo idioma](#7-criar-um-novo-idioma)
8. [Persistência de resultados (opcional)](#8-persistência-de-resultados-opcional)
9. [Ajustes do teste](#9-ajustes-do-teste)
10. [Análise de conectividade (opcional)](#10-análise-de-conectividade-opcional)
11. [Atualizações](#11-atualizações)
12. [Solução de problemas](#12-solução-de-problemas)
13. [Licença e créditos](#13-licença-e-créditos)

---

## 1. Requisitos

- **Servidor Linux** (os exemplos usam Debian/Ubuntu; qualquer distribuição serve).
- **nginx ≥ 1.18** (recomendado — é o que roda em produção na Vialink) **ou
  Apache ≥ 2.4** (§5).
- **Um nome DNS** apontando para o servidor (ex.: `speedtest.example.com`) e
  **portas 80/443** acessíveis — necessário para HTTPS com Let's Encrypt.
- ~110 MB de disco para o repositório + o arquivo de download de 100 MB.
- **Opcional** (só para gravar resultados, §8): PHP-FPM 8.x e MariaDB/MySQL.

Recomendações de capacidade: o teste satura a banda do **cliente**, não a CPU do
servidor — um servidor modesto mede conexões de 1 Gbps sem esforço, desde que o
**uplink do servidor** seja maior que as conexões que você quer medir. Para medir
clientes de até 1 Gbps, o servidor precisa de uplink ≥ 1 Gbps.

## 2. Checklist rápido

```bash
# 1. Código
sudo git clone https://github.com/vialink/vialink-speedtest.git /var/www/speedtest

# 2. Arquivo de download (100 MB, não versionado)
sudo dd if=/dev/urandom of=/var/www/speedtest/downloading bs=1M count=100

# 3. Permissões
sudo chown -R www-data:www-data /var/www/speedtest

# 4. Servidor web (§4 ou §5) + HTTPS
sudo certbot --nginx -d speedtest.example.com

# 5. Abrir https://speedtest.example.com e rodar um teste
```

## 3. Obter o código e preparar os arquivos

```bash
sudo git clone https://github.com/vialink/vialink-speedtest.git /var/www/speedtest
cd /var/www/speedtest
```

Dois arquivos participam do teste em si:

- **`downloading`** — massa de dados servida ao cliente no teste de download.
  **Não é versionado** (100 MB não pertencem ao git); gere após o clone:

  ```bash
  sudo dd if=/dev/urandom of=/var/www/speedtest/downloading bs=1M count=100
  ```

  Use `/dev/urandom` (dados aleatórios): um arquivo de zeros seria comprimido
  por qualquer camada intermediária e inflaria o resultado.

- **`upload`** — alvo dos POSTs do teste de upload. Já vem no repositório
  (vazio); o servidor web responde `200` e descarta o corpo (configuração nos
  §4/§5).

Por fim, deixe tudo legível pelo usuário do servidor web:

```bash
sudo chown -R www-data:www-data /var/www/speedtest
```

## 4. nginx (recomendado)

A configuração abaixo é a usada em produção na Vialink, generalizada. Crie
`/etc/nginx/sites-available/speedtest`:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name speedtest.example.com;   # adicione aliases se tiver mais nomes

    root /var/www/speedtest;
    index index.html;

    # Upload: aceita o POST, descarta o corpo e responde 200.
    # client_body_buffer_size pequeno + return 200 = o corpo não vai para disco.
    location = /upload {
        client_max_body_size 120m;
        client_body_buffer_size 16k;
        add_header "Access-Control-Allow-Origin" "*" always;
        add_header "Access-Control-Allow-Methods" "GET, POST, HEAD, OPTIONS" always;
        add_header "Access-Control-Allow-Headers" "Content-Type" always;
        if ($request_method = OPTIONS) { return 204; }
        return 200;
    }

    # Download: nunca cachear a massa de teste
    location = /downloading {
        add_header Cache-Control "no-store, no-cache, must-revalidate";
        add_header Pragma no-cache;
        expires off;
        add_header "Access-Control-Allow-Origin" "*" always;
    }

    # (Opcional, §8) API de gravação de resultados — somente este arquivo
    #location = /api/salvar-teste.php {
    #    client_max_body_size 16k;
    #    include fastcgi_params;
    #    fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
    #    fastcgi_pass unix:/run/php/php8.4-fpm.sock;
    #}

    # Scripts de manutenção (cron) — nunca servidos via web
    location /scripts/ { deny all; }

    location / {
        try_files $uri $uri/ =404;
        add_header "Access-Control-Allow-Origin" "*" always;
        add_header Cache-Control "no-store";
    }

    # Performance e precisão da medição
    access_log off;          # log por request distorce a medição
    error_log  /var/log/nginx/speedtest-error.log warn;

    client_body_timeout   300s;
    send_timeout          300s;
    keepalive_timeout     300s;

    sendfile      on;
    tcp_nopush    on;
    tcp_nodelay   on;
    gzip          off;       # compressão distorce a medição
}
```

Ative e recarregue:

```bash
sudo ln -s /etc/nginx/sites-available/speedtest /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

**HTTPS (Let's Encrypt):**

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d speedtest.example.com
```

O certbot reescreve o site para 443 com redirecionamento do 80 e configura a
renovação automática (`certbot renew --dry-run` para validar).

Pontos que **não** são opcionais nesta configuração:

| Diretiva | Por quê |
|---|---|
| `gzip off` | Comprimir a massa de teste falseia o resultado |
| `Cache-Control: no-store` | Download repetido do cache mede o disco, não a rede |
| `access_log off` | Gravar log a cada chunk do teste consome I/O e distorce |
| `client_max_body_size 120m` | O teste envia até ~100 MB por conexão de upload |
| timeouts de 300s | O modo stress (`?Stress=300`) mantém conexões longas |

## 5. Apache 2.4

> Configuração de referência — na Vialink o velocímetro roda sobre nginx; o
> Apache abaixo cobre os mesmos requisitos (POST em arquivo estático → 200,
> sem cache, sem compressão, corpo de 120 MB).

Módulos necessários:

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

    # Upload: Apache devolveria 405 para POST em arquivo estático;
    # esta regra intercepta e responde 200 (corpo é descartado).
    RewriteEngine On
    RewriteCond %{REQUEST_METHOD} =POST
    RewriteRule ^/upload$ - [R=200,L]

    # O teste envia até ~100 MB por conexão de upload
    LimitRequestBody 125829120

    # Nunca cachear, nunca comprimir
    Header always set Cache-Control "no-store"
    Header always set Access-Control-Allow-Origin "*"
    SetEnv no-gzip 1

    # Scripts de manutenção nunca são servidos
    <DirectoryMatch "^/var/www/speedtest/scripts">
        Require all denied
    </DirectoryMatch>

    # Sem log de acesso nos endpoints do teste (precisão da medição)
    SetEnvIf Request_URI "^/(upload|downloading)" nolog
    CustomLog ${APACHE_LOG_DIR}/speedtest-access.log combined env=!nolog
    ErrorLog ${APACHE_LOG_DIR}/speedtest-error.log
</VirtualHost>
```

Ative e recarregue:

```bash
sudo a2ensite speedtest
sudo apachectl configtest && sudo systemctl reload apache2
```

**HTTPS (Let's Encrypt):**

```bash
sudo apt install certbot python3-certbot-apache
sudo certbot --apache -d speedtest.example.com
```

> Se usar `mod_deflate` globalmente, confirme que `/downloading` e `/upload`
> não são comprimidos (`SetEnv no-gzip 1` acima cuida disso). Se usar HTTP/2
> (`mod_http2`), veja a nota de performance no §11.

**(Opcional, §8)** para a API de gravação com PHP-FPM:

```apache
<FilesMatch "^salvar-teste\.php$">
    SetHandler "proxy:unix:/run/php/php8.4-fpm.sock|fcgi://localhost"
</FilesMatch>
```

(requer `a2enmod proxy_fcgi setenvif`)

## 6. Personalização — marca, cores e domínios (tenants)

O velocímetro é **multi-tenant**: a mesma instalação atende vários domínios,
cada um com logo, cores e favicon próprios. A tabela vive em
**`assets/js/tenants.js`** — configuração estática, sem backend.

> ⚠️ **Marcas registradas:** o código é MIT, mas os logotipos, nomes e cores
> **Vialink** e **MaisLink** que acompanham o repositório **não são** — veja
> [COPYRIGHT.md](../COPYRIGHT.md). Ao instalar em servidor próprio, configure
> um tenant com **a sua marca**.

Passo a passo para colocar a sua marca:

1. **Crie a pasta de assets** `assets/tenants/minha-marca/` com:
   - `logo.svg` — logo para tema claro (proporção ~3:1 funciona bem no gauge);
   - `logo-branco.svg` — versão para tema escuro (opcional; sem ela o mesmo
     logo é usado nos dois temas);
   - `icon-192.png` — ícone quadrado usado no cabeçalho do PDF;
   - favicons (`favicon.ico`, `favicon-16x16.png`, `favicon-32x32.png`,
     `apple-touch-icon.png`).
2. **Adicione o tenant** em `assets/js/tenants.js`, no objeto `TENANTS`:

   ```js
   'minha-marca': {
     name: 'Minha Marca',
     domains: ['speedtest.example.com'],
     title: 'Velocímetro Minha Marca',
     description: 'Teste a velocidade da sua conexão',
     site: 'https://example.com',
     logo: '/assets/tenants/minha-marca/logo.svg',
     logoDark: '/assets/tenants/minha-marca/logo-branco.svg', // opcional
     logoPdf: '/assets/tenants/minha-marca/icon-192.png',
     iconsDir: '/assets/tenants/minha-marca',
     colors: {
       accent: '#0066CC',      // cor principal (menus, ícones, botões)
       accentDark: '#004C99',  // fim dos degradês
       gaugeStart: '#66AAFF',  // início do arco do velocímetro
       gaugeEnd: '#003366'     // fim do arco
     },
     poweredBy: true,   // false esconde o rodapé "Powered by Vialink"
     sobre: true        // false esconde o item "Sobre" do menu
   },
   ```

3. **Defina o fallback**: `DEFAULT_TENANT` (no mesmo arquivo) é o tenant usado
   quando o hostname não casa com nenhum — inclusive acesso por IP.
4. **Teste sem DNS**: qualquer hostname aceita o override
   `?tenant=minha-marca` na URL.

O card "SEU IP" consulta `ipapi.co` a partir do navegador do cliente para
mostrar IP/ASN/cidade — precisa de acesso à internet; sem ela o card mostra
apenas travessões (o teste funciona normalmente). A consulta parte do IP de
cada visitante, então o limite do plano gratuito do `ipapi.co` raramente é
atingido; se precisar trocar o provedor de geo-IP, os endpoints ficam no
início de `assets/js/tenant.js` (fallback: `api.ipify.org`, só o IP).

## 7. Criar um novo idioma

O sistema de tradução vive em `assets/js/i18n/` — cada idioma é **um único
arquivo JS** com todos os textos (interface, tooltips, mensagens do teste,
PDF e as páginas manual/sobre/relatório). O idioma é escolhido nesta ordem:
`?lang=` na URL → cookie (escolha do usuário no seletor de bandeira) → idioma
do navegador → inglês.

Exemplo: adicionar **italiano (it-IT)**.

1. **Copie o dicionário de referência** (o inglês é o fallback e está sempre
   completo):

   ```bash
   cp assets/js/i18n/en-US.js assets/js/i18n/it-IT.js
   ```

2. **Edite o cabeçalho** do `register()` no arquivo novo:

   ```js
   window.VLK_I18N.register({
     code: 'it-IT',        // código BCP 47
     country: 'IT',        // sigla exibida ao lado da bandeira
     name: 'Italiano',     // nome do idioma, no próprio idioma
     flag: '/assets/img/flags/it.svg',
     locale: 'it-IT',      // formatação de números e datas
     // pdfLatin1: false,  // só para idiomas fora do Latin-1 (cirílico, CJK):
     //                    // o PDF do Compartilhar cai no inglês (a Helvetica
     //                    // do jsPDF não cobre esses caracteres)
     strings: { /* ... traduções ... */ }
   });
   ```

3. **Traduza os valores** de `strings`. Regras:
   - Preserve os placeholders `{name}`, `{d}`, `{u}`, `{p}`, `{dd}`, `{ud}`,
     `{date}`, `{time}`, `{tenant}` — eles são substituídos em tempo de
     execução (`{name}` vira o nome do tenant).
   - Chaves usadas com HTML (as aplicadas via `data-i18n-html`, tipicamente
     os textos longos das páginas) aceitam `<strong>`, `<a>`, `<code>` —
     preserve a marcação, traduza o texto.
   - Pode omitir chaves que não quiser traduzir: o que faltar cai no inglês.
4. **Crie a bandeira** `assets/img/flags/it.svg` — viewBox `0 0 20 14`,
   cantos arredondados `rx="1.5"`, formas simples (ela é exibida com ~14×10 px).
   Use `br.svg`/`us.svg` como modelo:

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

5. **Inclua o script nas 4 páginas**, depois dos dicionários existentes:
   - `index.html` (caminho relativo):
     `<script src="assets/js/i18n/it-IT.js"></script>`
   - `relatorio.html`, `manual.html`, `sobre.html` (caminho absoluto):
     `<script src="/assets/js/i18n/it-IT.js"></script>`
6. **Teste**: abra `https://seu-servidor/?lang=it-IT`, confira a interface e
   os tooltips, e verifique que o seletor de bandeira lista `IT · Italiano`
   (a ordem do menu segue a ordem dos `<script>`). Rode um teste completo e
   gere o PDF do Compartilhar.

Detalhes adicionais (tabela de prefixos das chaves, semântica de cada grupo)
no [`assets/js/i18n/README.md`](../assets/js/i18n/README.md). Traduções novas
são bem-vindas de volta ao projeto via pull request.

## 8. Persistência de resultados (opcional)

Por padrão o velocímetro é 100% estático e **não grava nada**. Se quiser
armazenar cada teste num banco (para relatórios e histórico), o repositório
traz uma API mínima em PHP: `api/salvar-teste.php` — o front chama
`POST /api/salvar-teste.php` ao fim de cada teste, e a falha da gravação nunca
afeta o usuário (melhor-esforço).

> **Privacidade:** a tabela guarda IP, user agent e resultados de cada teste.
> Verifique as obrigações da legislação local (no Brasil, LGPD) antes de
> ativar em um serviço público, e defina uma política de retenção.

1. **Pacotes:**

   ```bash
   sudo apt install php8.4-fpm php8.4-mysql mariadb-server
   ```

2. **Banco e usuário:**

   ```sql
   CREATE DATABASE speedtest CHARACTER SET utf8mb4;
   CREATE USER 'speedtest_app'@'localhost' IDENTIFIED BY 'TROQUE-ESTA-SENHA';
   GRANT SELECT, INSERT, UPDATE ON speedtest.* TO 'speedtest_app'@'localhost';
   ```

3. **Tabela:**

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
     -- Qualidade da conexão (§9.2): preenchidas pelo próprio teste
     qos_idle_ms    DECIMAL(10,2) DEFAULT NULL,
     qos_dl_ms      DECIMAL(10,2) DEFAULT NULL,
     qos_ul_ms      DECIMAL(10,2) DEFAULT NULL,
     qos_nota       VARCHAR(2) DEFAULT NULL,
     qos_rpm        INT UNSIGNED DEFAULT NULL,
     qos_dl_cv      DECIMAL(6,4) DEFAULT NULL,
     qos_ul_cv      DECIMAL(6,4) DEFAULT NULL,
     qos_dl_boost   DECIMAL(6,2) DEFAULT NULL,
     qos_quedas     TINYINT UNSIGNED DEFAULT NULL,
     PRIMARY KEY (id),
     KEY idx_criado (criado_em),
     KEY idx_ip (ip),
     KEY idx_tenant_criado (tenant, criado_em),
     KEY idx_enriquecer (enriquecido_em),
     KEY idx_site (site)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
   ```

   (As colunas `cliente`/`netbox_*` são preenchidas por um job de
   enriquecimento específico da infraestrutura Vialink —
   `scripts/enriquecer-netbox.php`, que resolve o dono de cada IP via
   [NetBox](https://netbox.dev). Sem NetBox, deixe-as em branco ou adapte o
   script à sua fonte de dados.)

4. **Credenciais fora do web root** — `/etc/vlk-speedtest/db.ini`
   (dono `root:www-data`, modo `640`):

   ```ini
   [db]
   dsn  = "mysql:unix_socket=/run/mysqld/mysqld.sock;dbname=speedtest;charset=utf8mb4"
   user = "speedtest_app"
   pass = "TROQUE-ESTA-SENHA"
   ```

5. **Servidor web:** descomente o bloco `location = /api/salvar-teste.php` do
   §4 (nginx) ou aplique o `FilesMatch` do §5 (Apache) e recarregue.
6. **Valide:** rode um teste no navegador e confira a linha nova:

   ```bash
   sudo mariadb speedtest -e 'SELECT * FROM testes ORDER BY id DESC LIMIT 1\G'
   ```

Observação: a coluna `site` classifica o hostname chamado como
`vialink`/`maislink`/`por-ip`/`outro` (função `classificaSite` na API) —
adapte a função aos seus domínios se quiser essa classificação.

## 9. Ajustes do teste

Os parâmetros do teste ficam no `<script>` de configuração do **`index.html`**:

| Variável | Padrão | Significado |
|---|---|---|
| `dlThreads` / `ulThreads` | 6 | Conexões paralelas (HTTP/1.1 limita a 6 por origem — valores maiores não ajudam) |
| `ulDataSize` | 100 | MB enviados por conexão de upload |
| `dlDuration` / `ulDuration` | 12 | Duração (s) de cada etapa |
| `pingSamples` | 10 | Amostras de ping |
| `saveData` / `saveDataURL` | — | Mecanismo de gravação do upstream — **não usado**; este fork grava via `api/salvar-teste.php` (§8) |

E o usuário pode passar parâmetros na URL (documentados na página **Manual**
do próprio velocímetro): `?Run` (inicia sozinho), `?Stress=300` (teste
contínuo), `?Test=Download|Upload|Ping` (uma etapa só), `?Ping=500` (mais
amostras), `?lang=` (idioma), `?tenant=` (marca).

### 9.1. Configuração local da instalação (`vlk-config-local.js`)

Ajustes específicos da **sua** instalação não devem ser feitos no
`index.html` — um upgrade (`git pull` ou deploy com `git reset --hard`)
desfaria a mudança. Use o arquivo local, que **não é versionado** e por isso
sobrevive a atualizações:

```bash
cp assets/js/vlk-config-local.example.js assets/js/vlk-config-local.js
# editar e definir os valores desejados
```

Se o arquivo não existir, valem os padrões do `index.html` (o 404 dele no
console é inofensivo). Opções disponíveis:

| Variável | Padrão | Significado |
|---|---|---|
| `vlkCorrectionFactor` | 1.0 | Fator de correção: os valores de download/upload **apresentados** são a medição multiplicada por ele (a escala do velocímetro acompanha). A persistência (§8) grava sempre o valor **bruto**, sem o fator. `1.0` = sem correção |

### 9.2. Qualidade da conexão (bufferbloat, turbo e estabilidade)

Aparece automaticamente ao fim de qualquer teste, sem configuração — as três
medidas são derivadas do próprio teste de velocidade
(`assets/js/qualidade.js`). Não há nada a instalar no servidor.

O único ponto que depende da instalação é a **sonda de latência sob carga**.
Em HTTP/1.1 o navegador abre no máximo 6 conexões por origem, e o teste já usa
as 6: uma sonda na mesma origem ficaria na fila do navegador e mediria a espera
dele, não a latência da rede. Por isso a sonda sai por **outro domínio da mesma
instalação**, quando existe.

Para que isso funcione, o `domains` do tenant (§6) precisa listar **mais de um
nome apontando para o mesmo servidor** — todos servidos pelo mesmo vhost e
cobertos pelo certificado. Se preferir controlar quais nomes podem ser usados
como sonda, defina `latencyProbeHosts` no tenant (mesmo formato de `domains`);
na falta dele, `domains` é usado.

Com um único domínio a medição continua funcionando pela mesma origem, e a
interface avisa que o valor pode sair pior do que a realidade. A troca de host
só acontece quando o hostname acessado pertence à lista do tenant — assim uma
instalação de terceiros que caia no tenant padrão nunca envia sondas para
servidores alheios.

## 10. Análise de conectividade (opcional)

A página `conectividade.html` (item **Rede** no menu) mede **latência, jitter e
perda de pacotes** até uma lista de destinos, em duas camadas independentes:

- **Cliente (sempre disponível):** o navegador mede latência média, jitter e
  taxa de falhas de cada destino com requisições HTTPS cronometradas. Não é ICMP
  — o navegador não tem acesso a socket raw, então *ping*/*traceroute* são
  impossíveis ali —, mas é uma boa aproximação da experiência real da conexão do
  usuário. Não exige nada no servidor.
- **Servidor (opcional):** `mtr` (traceroute/ICMP real) rodando no próprio
  servidor devolve saltos, latência, jitter e **perda de pacotes reais** da rota
  *do servidor* até o destino. Essa medição é **a mesma para todos os clientes**
  (é uma propriedade da sua rota, não da conexão de quem testa), então quem a
  executa é um **cron** — `scripts/atualizar-diagnostico.php`, a cada 5 min — e o
  endpoint `api/diagnostico.php` apenas lê o cache. Ver o porquê no passo 4.

### Destinos

Configuráveis por tenant no `assets/js/tenants.js`, campo `connectivityTargets`
(array de `{ label, host, ip? }`). Sem esse campo, a página fica sem destinos.
Para o par 8.8.8.8, o cliente sonda o nome `dns.google` (o navegador não faz TLS
contra o IP cru); o servidor mede o IP direto.

### Ligando a camada do servidor (mtr)

1. **Instale o mtr** com permissão de socket ICMP e confirme que o usuário do
   PHP-FPM consegue rodá-lo:
   ```bash
   apt-get install -y mtr-tiny
   sudo -u www-data mtr -n -4 -c 3 --json 8.8.8.8   # deve sair JSON com "hubs"
   ```
   (o pacote já concede `cap_net_raw` ao `mtr-packet`.)
2. **Espelhe a allowlist** em `api/diagnostico-targets.php` — um array PHP com os
   mesmos hosts do `connectivityTargets`, **na mesma ordem**. O cliente envia só o
   índice do destino; o host vem daqui, **nunca do request** — é o que impede
   injeção de comando/SSRF.
3. **Sirva o endpoint** no nginx (bloco dedicado, como o da persistência):
   ```nginx
   location = /api/diagnostico.php {
       client_max_body_size 4k;
       include fastcgi_params;
       fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
       fastcgi_pass unix:/run/php/php8.4-fpm.sock;
       fastcgi_read_timeout 35s;
   }
   ```
4. **Agende o cron que alimenta o cache** — sem ele a seção do servidor fica
   permanentemente "indisponível", porque o endpoint não executa `mtr`:
   ```bash
   install -d -o www-data -g www-data -m 755 /var/cache/vlk-speedtest
   sudo -u www-data php /var/www/speedtest/scripts/atualizar-diagnostico.php  # primeira carga
   cat > /etc/cron.d/vlk-speedtest-diagnostico <<'EOF'
   */5 * * * * www-data flock -n /var/cache/vlk-speedtest/.lock /usr/bin/php /var/www/speedtest/scripts/atualizar-diagnostico.php --quiet
   EOF
   ```

**Por que o cron, e não medir na requisição.** O `mtr` leva de 10 a 25 s. Se cada
visitante disparasse os seus, cada requisição prenderia um worker do PHP-FPM por
todo esse tempo — com poucos testes simultâneos e cache frio o pool satura
(`pm.max_children`) e o site inteiro para de responder. Como o resultado é
idêntico para todos, produzi-lo fora do caminho da requisição elimina o problema:
o endpoint vira leitura de arquivo, a carga de `mtr` fica constante e previsível,
e a camada do servidor aparece **instantaneamente** para o usuário.

O endpoint recusa cache com mais de 30 minutos (6 ciclos do cron) — se o cron
parar, a seção passa a exibir "indisponível" em vez de apresentar uma medição
velha como se fosse o estado atual da rota. A interface também informa a idade da
medição ("Medição do servidor: há N min"), já que ela é compartilhada e não foi
coletada no clique do usuário.

Sem o endpoint (ou sem o `mtr`/cron), a seção do servidor exibe "indisponível" e a
página continua funcionando só com a camada do cliente.

### Netflix pela OCA local (opcional)

Para o destino Netflix, `www.netflix.com` é o *site* (hospedado longe, ~170ms);
o que o assinante percebe é o **Open Connect** — o CDN local de streaming (~10ms).
O endpoint `api/netflix-oca.php` descobre uma OCA local via API do fast.com (proxy
no servidor, pois a API não libera CORS para a página) e o cliente mede a OCA
direto. Sirva-o no nginx como os demais:

```nginx
location = /api/netflix-oca.php {
    include fastcgi_params;
    fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
    fastcgi_pass unix:/run/php/php8.4-fpm.sock;
    fastcgi_read_timeout 15s;
}
```

Requer PHP com cURL e saída HTTPS para `api.fast.com`. Sem o endpoint, o alvo
Netflix cai automaticamente na medição do site (`www.netflix.com`).

## 11. Atualizações

```bash
cd /var/www/speedtest
sudo -u www-data git pull
```

Nada precisa ser reiniciado — os arquivos são estáticos (o nginx/Apache serve
a versão nova imediatamente; o site já é servido com `Cache-Control: no-store`).

Para importar novidades do OpenSpeedTest original:

```bash
git remote add upstream https://github.com/openspeedtest/Speed-Test.git
git fetch upstream
git log HEAD..upstream/main --oneline   # avaliar o que vem
git merge upstream/main                 # resolver conflitos se houver
```

> Dica: na Vialink o deploy é automatizado com GitLab CI/CD (`.gitlab-ci.yml`
> incluso no repositório como referência) — um runner no próprio servidor faz
> `git reset --hard origin/main`, garante o arquivo `downloading` e recarrega
> o nginx a cada push.

## 12. Solução de problemas

| Sintoma | Causa provável / correção |
|---|---|
| **"Erro de rede" / "Network Error"** ao iniciar | O navegador não alcançou `/upload` ou `/downloading`. Confira o console do navegador (F12): 404 = arquivo `downloading` não gerado (§3); 405 = falta a regra de POST do §4/§5; 413 = corpo limitado (aumente `client_max_body_size`/`LimitRequestBody`). |
| Erro só no **upload** | Regra de POST ausente, ou proxy reverso na frente limitando o corpo (aumente o limite no proxy também — precisa de ≥ 120 MB). |
| **Resultados abaixo do esperado** | `gzip`/`brotli` ligados (desligue para o site), `access_log` ligado, cache servindo `/downloading`, antivírus/extensões do navegador inspecionando tráfego (teste em janela anônima), Wi-Fi. |
| Resultado **trava em ~6 conexões** | Comportamento normal do HTTP/1.1 (6 conexões por origem). O upstream recomenda HTTP/1.1 para máxima performance; com HTTP/2/HTTP/3 o teste funciona, mas o multiplexing pode alterar levemente os números. |
| Card **"SEU IP" vazio** | O navegador do cliente não alcançou `ipapi.co` (sem internet ou bloqueado). Não afeta o teste. |
| **PDF não baixa / share não abre** | O jsPDF é carregado de `assets/js/vendor/` (sem CDN) — confira que o caminho é servido. `navigator.share` só existe em HTTPS. |
| Teste atrás de **proxy reverso/CDN** | Aumente o limite de corpo do POST (≥ 120 MB), desligue cache e compressão para o host do teste. CDN na frente mede a CDN, não o seu servidor. |
| **Gravação (§8) não acontece** | Confira `error_log` do PHP-FPM; permissões do `/etc/vlk-speedtest/db.ini` (`root:www-data 640`); grants do usuário do banco. A falha é silenciosa para o usuário, por design. |

## 13. Licença e créditos

- Código: **MIT** — © 2013–2023 OpenSpeedTest™ (projeto original) e © 2026
  Vialink (modificações do fork). Detalhes em [LICENSE](../LICENSE) e
  [COPYRIGHT.md](../COPYRIGHT.md).
- **Logotipos e marcas Vialink/MaisLink não são MIT** — substitua pela sua
  marca ao hospedar publicamente (§6).
- Melhorias de interesse geral (novos idiomas, correções) são bem-vindas via
  pull request.
