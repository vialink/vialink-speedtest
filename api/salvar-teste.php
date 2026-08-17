<?php
/**
 * Gravação de resultados de teste (POST JSON, disparado pelo app.js no bloco
 * "SendR", logo após window.vlkResults ser preenchido — a função que envia é
 * a vlkSalvarResultado do tenant.js).
 *
 * O IP, o user agent e o hostname são capturados do próprio request (fonte
 * confiável); o corpo traz só os números do teste e os dados informativos do
 * ipapi.co (ASN/cidade). O nome do cliente é preenchido depois, pelo job de
 * enriquecimento via NetBox (scripts/enriquecer-netbox.php).
 *
 * Credenciais do banco fora do web root: /etc/vlk-speedtest/db.ini
 */

header('Content-Type: application/json; charset=utf-8');

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    http_response_code(405);
    echo '{"erro":"use POST"}';
    exit;
}

$corpo = file_get_contents('php://input', false, null, 0, 8192);
$dados = json_decode($corpo, true);
if (!is_array($dados)) {
    http_response_code(400);
    echo '{"erro":"JSON invalido"}';
    exit;
}

// Números do teste — obrigatórios e dentro de limites plausíveis
function num($v, $max) {
    if (!is_numeric($v)) return null;
    $f = (float)$v;
    return ($f >= 0 && $f <= $max) ? $f : null;
}
$download = num($dados['d'] ?? null, 100000);   // Mbps
$upload   = num($dados['u'] ?? null, 100000);
$ping     = num($dados['p'] ?? null, 60000);    // ms
$jitter   = num($dados['j'] ?? null, 60000);
$dlDados  = num($dados['dd'] ?? null, 1000000); // MB transferidos
$ulDados  = num($dados['ud'] ?? null, 1000000);

if ($download === null || $upload === null || $ping === null || $jitter === null) {
    http_response_code(400);
    echo '{"erro":"resultados ausentes ou invalidos"}';
    exit;
}

$txt = fn($v, $len) => mb_substr(trim((string)($v ?? '')), 0, $len);
$tenant   = $txt($dados['tenant'] ?? 'vialink', 32);
$asn      = $txt($dados['asn'] ?? '', 120);
$cidade   = $txt($dados['cidade'] ?? '', 120);
$ip       = $txt($_SERVER['REMOTE_ADDR'] ?? '', 45);
$hostname = $txt($_SERVER['HTTP_HOST'] ?? '', 100);
$ua       = $txt($_SERVER['HTTP_USER_AGENT'] ?? '', 512);

// Classifica o site chamado a partir do Host do request: 'vialink', 'maislink',
// 'por-ip' (acesso direto pelo endereço) ou 'outro'. O tenant sozinho não basta —
// hostname desconhecido cai no fallback vialink do front.
function classificaSite(string $host): string {
    $h = strtolower($host);
    if (preg_match('/^\[(.+)\](?::\d+)?$/', $h, $m)) $h = $m[1]; // IPv6 literal
    else $h = preg_replace('/:\d+$/', '', $h);                   // remove porta
    if (filter_var($h, FILTER_VALIDATE_IP)) return 'por-ip';
    if ($h === 'vialink.com.br' || str_ends_with($h, '.vialink.com.br')) return 'vialink';
    if ($h === 'maislink.com.br' || str_ends_with($h, '.maislink.com.br')) return 'maislink';
    return $h === '' ? 'desconhecido' : 'outro';
}
$site = classificaSite($hostname);

// UID do teste (gerado no front): liga esta linha às linhas de conectividade
// gravadas depois (salvar-conectividade.php). Só hex, no máx. 32 chars.
$uid = substr(preg_replace('/[^a-f0-9]/', '', strtolower((string)($dados['uid'] ?? ''))), 0, 32);
if ($uid === '') $uid = null;

// Qualidade da conexão (assets/js/qualidade.js) — opcional: um teste
// interrompido, ou uma sonda que não respondeu, chega aqui sem estes campos, e
// isso não impede a gravação do resultado de velocidade.
$qos        = is_array($dados['qos'] ?? null) ? $dados['qos'] : [];
$qosIdle    = num($qos['idle'] ?? null, 60000);
$qosDl      = num($qos['dl'] ?? null, 60000);
$qosUl      = num($qos['ul'] ?? null, 60000);
$qosRpm     = num($qos['rpm'] ?? null, 100000);
$qosDlCv    = num($qos['dlCv'] ?? null, 99);
$qosUlCv    = num($qos['ulCv'] ?? null, 99);
$qosBoost   = num($qos['dlBoost'] ?? null, 9999);
$qosQuedas  = num($qos['quedas'] ?? null, 255);
$qosNota    = in_array($qos['nota'] ?? '', ['A+', 'A', 'B', 'C', 'D', 'F'], true)
              ? $qos['nota'] : null;

// A quem o bloco do IP está designado (whois/RDAP — consultado no navegador do
// visitante, ver assets/js/whois-ip.js). Informativo, como o ASN.
$whois = $txt($dados['whois'] ?? '', 200);
if ($whois === '') $whois = null;

$cfg = parse_ini_file('/etc/vlk-speedtest/db.ini', true);
if (!$cfg || empty($cfg['db'])) {
    http_response_code(500);
    echo '{"erro":"config indisponivel"}';
    exit;
}

/**
 * Código curto do teste — é o que vira o link compartilhável (/r/CODIGO).
 *
 * Aleatório, e não derivado do `id`: um código sequencial deixaria qualquer um
 * andar pelos testes dos outros trocando um caractere. O alfabeto exclui os
 * pares que se confundem ao ditar por telefone (0/O, 1/I/L) — o link nasce para
 * ser passado ao suporte, às vezes de viva voz. 8 caracteres de um alfabeto de
 * 32 dão 2^40 combinações, o que torna a varredura inviável.
 */
function geraCodigo(): string {
    $abc = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';   // sem 0 O 1 I L
    $n = strlen($abc) - 1;
    $out = '';
    for ($i = 0; $i < 8; $i++) $out .= $abc[random_int(0, $n)];
    return $out;
}

try {
    $pdo = new PDO($cfg['db']['dsn'], $cfg['db']['user'], $cfg['db']['pass'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_TIMEOUT => 3,
    ]);
    $stmt = $pdo->prepare(
        'INSERT INTO testes
           (uid, codigo, tenant, hostname, site, ip, download_mbps, upload_mbps, ping_ms, jitter_ms,
            dl_dados_mb, ul_dados_mb, user_agent, asn, cidade, whois,
            qos_idle_ms, qos_dl_ms, qos_ul_ms, qos_nota, qos_rpm,
            qos_dl_cv, qos_ul_cv, qos_dl_boost, qos_quedas)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );

    // Colisão de código é improvável, mas a chave é única: tenta de novo em vez
    // de perder o teste. Após as tentativas, grava sem código — o resultado vale
    // mais que o link.
    $codigo = null;
    for ($tentativa = 0; $tentativa < 5; $tentativa++) {
        $codigo = ($tentativa < 4) ? geraCodigo() : null;
        try {
            $stmt->execute([
                $uid, $codigo, $tenant, $hostname, $site, $ip, $download, $upload, $ping, $jitter,
                $dlDados, $ulDados, $ua, $asn, $cidade, $whois,
                $qosIdle, $qosDl, $qosUl, $qosNota, $qosRpm,
                $qosDlCv, $qosUlCv, $qosBoost, $qosQuedas,
            ]);
            break;
        } catch (PDOException $e) {
            if (($e->errorInfo[1] ?? 0) === 1062) continue;   // duplicate key
            throw $e;
        }
    }

    echo json_encode(['ok' => true, 'id' => (int)$pdo->lastInsertId(), 'codigo' => $codigo]);
} catch (PDOException $e) {
    error_log('salvar-teste: ' . $e->getMessage());
    http_response_code(500);
    echo '{"erro":"falha ao gravar"}';
}
