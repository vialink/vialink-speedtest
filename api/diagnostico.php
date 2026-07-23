<?php
/**
 * Traceroute/ping do SERVIDOR até um destino da allowlist (camada 2 da análise
 * de conectividade — ver conectividade.html / assets/js/conectividade.js).
 *
 * Mede da rede Vialink (CT714) até o destino, com mtr (ICMP real): saltos,
 * latência, jitter (desvio-padrão) e PERDA DE PACOTES. É o complemento ao que o
 * navegador mede da conexão do cliente (aquele não faz ICMP nem traceroute).
 *
 * SEGURANÇA (inegociável):
 *   - O cliente envia SÓ o índice do destino; o host vem da allowlist do
 *     servidor (diagnostico-targets.php), nunca do request → sem injeção/SSRF.
 *   - O host ainda passa por escapeshellarg; mtr roda sob `timeout` e com -n.
 *   - Resultado é cacheado por CACHE_TTL para limitar carga/abuso.
 *
 * Requisitos no servidor: binário `mtr` com permissão de socket ICMP
 *   (setcap cap_net_raw+ep /usr/sbin/mtr-packet — feito no provisionamento).
 */

header('Content-Type: application/json; charset=utf-8');

const MTR_CYCLES = 5;    // pacotes por salto
const MTR_TIMEOUT = 25;  // segundos (guarda do processo)
const CACHE_TTL = 60;    // segundos que o resultado fica em cache

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    http_response_code(405);
    echo '{"ok":false,"erro":"use POST"}';
    exit;
}

$corpo = file_get_contents('php://input', false, null, 0, 256);
$dados = json_decode($corpo, true);
if (!is_array($dados) || !isset($dados['target']) || !is_int($dados['target'])) {
    http_response_code(400);
    echo '{"ok":false,"erro":"target invalido"}';
    exit;
}

$targets = require __DIR__ . '/diagnostico-targets.php';
$idx = $dados['target'];
if ($idx < 0 || $idx >= count($targets)) {
    http_response_code(400);
    echo '{"ok":false,"erro":"target fora da allowlist"}';
    exit;
}
$host = $targets[$idx];

// ---- Cache (limita carga e abuso) ----
$cacheFile = sys_get_temp_dir() . '/vlk-diag-' . $idx . '.json';
if (is_file($cacheFile) && (time() - filemtime($cacheFile)) < CACHE_TTL) {
    $c = file_get_contents($cacheFile);
    if ($c !== false && $c !== '') { echo $c; exit; }
}

// ---- Executa o mtr ----
$cmd = 'timeout ' . MTR_TIMEOUT . ' mtr -n -4 -c ' . MTR_CYCLES
     . ' --json ' . escapeshellarg($host) . ' 2>/dev/null';
$saida = shell_exec($cmd);

$mtr = $saida ? json_decode($saida, true) : null;
$hubs = $mtr['report']['hubs'] ?? null;
if (!is_array($hubs) || !count($hubs)) {
    // mtr ausente, sem permissão ICMP, ou destino totalmente inalcançável
    $resp = json_encode(['ok' => true, 'host' => $host, 'hops' => null, 'dest' => null]);
    @file_put_contents($cacheFile, $resp);
    echo $resp;
    exit;
}

// As chaves do mtr vêm com sufixo (Avg, Best, Wrst, StDev, Loss%) — normalizamos.
$num = static function (array $h, string $k) {
    foreach ($h as $key => $v) {
        if (strcasecmp($key, $k) === 0 || stripos($key, $k) === 0) {
            return is_numeric($v) ? (float)$v : null;
        }
    }
    return null;
};

// Escolhe o salto-destino varrendo de trás pra frente até o último salto que
// REALMENTE respondeu (host != '???' e perda < 100%). Muitos destinos (Netflix,
// Microsoft, etc.) filtram ICMP no fim: o último salto viria como '???'/100%,
// o que NÃO é perda real — é ICMP bloqueado. Nesses casos reportamos o salto
// mais profundo que respondeu e marcamos filtered=true (o destino em si não é
// mensurável por ICMP).
$dest = null;
$ultimoIdx = count($hubs) - 1;
for ($k = $ultimoIdx; $k >= 0; $k--) {
    $h = $hubs[$k];
    $loss = $num($h, 'Loss');
    $hhost = $h['host'] ?? '???';
    if ($hhost !== '???' && $loss !== null && $loss < 100) {
        $dest = [
            'avg'      => $num($h, 'Avg'),
            'jitter'   => $num($h, 'StDev'),
            'loss'     => $loss,
            'best'     => $num($h, 'Best'),
            'worst'    => $num($h, 'Wrst'),
            'host'     => $hhost,
            'filtered' => ($k !== $ultimoIdx),
        ];
        break;
    }
}

$resp = json_encode([
    'ok'   => true,
    'host' => $host,
    'hops' => count($hubs),
    'dest' => $dest,
]);
@file_put_contents($cacheFile, $resp);
echo $resp;
