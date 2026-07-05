<?php
/**
 * Enriquecimento dos testes gravados: consulta o NetBox para descobrir o dono
 * de cada IP ainda não enriquecido e preenche cliente/netbox_* na tabela.
 *
 * Fontes no NetBox (ordem de prioridade para "cliente"):
 *   1. dispositivo ao qual o IP está atribuído (assigned_object.device.name)
 *   2. dns_name (PTR)
 *   3. equipamento que enxergou o IP via ARP ("ARP: <MAC> visto por <dev>/<iface>")
 *
 * Roda por cron no CT 714 (vlk-speedtest) após o sync noturno do NetBox.
 * Uso: php enriquecer-netbox.php [--force]   (--force reprocessa todos os IPs)
 *
 * Config fora do web root: /etc/vlk-speedtest/db.ini (seções [db] e [netbox]).
 * O nginx bloqueia /scripts/ — este arquivo não é acessível via web.
 */

if (php_sapi_name() !== 'cli') {
    http_response_code(403);
    exit;
}

$force = in_array('--force', $argv ?? [], true);

$cfg = parse_ini_file('/etc/vlk-speedtest/db.ini', true);
if (!$cfg || empty($cfg['db']) || empty($cfg['netbox'])) {
    fwrite(STDERR, "config /etc/vlk-speedtest/db.ini incompleta (seções [db] e [netbox])\n");
    exit(1);
}

$pdo = new PDO($cfg['db']['dsn'], $cfg['db']['user'], $cfg['db']['pass'], [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
]);

$where = $force ? '1=1' : 'enriquecido_em IS NULL';
$ips = $pdo->query("SELECT DISTINCT ip FROM testes WHERE $where LIMIT 2000")
           ->fetchAll(PDO::FETCH_COLUMN);
if (!$ips) {
    echo "nada a enriquecer\n";
    exit(0);
}

/** Consulta um IP no NetBox e deriva os campos de identificação. */
function consultaNetbox(string $ip, array $nb): ?array
{
    $url = rtrim($nb['url'], '/') . '/api/ipam/ip-addresses/?address=' . urlencode($ip);
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 10,
        CURLOPT_HTTPHEADER     => ['Authorization: Token ' . $nb['token'], 'Accept: application/json'],
    ]);
    $resp = curl_exec($ch);
    $http = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
    if ($resp === false || $http !== 200) return null; // erro de API: tenta de novo na próxima rodada

    $d = json_decode($resp, true);
    $melhor = null;
    foreach ($d['results'] ?? [] as $r) {
        if ($melhor === null || !empty($r['assigned_object'])) $melhor = $r;
        if (!empty($r['assigned_object'])) break;
    }
    if ($melhor === null) return ['dns' => '', 'device' => '', 'descr' => '', 'cliente' => ''];

    $dns    = (string)($melhor['dns_name'] ?? '');
    $descr  = (string)($melhor['description'] ?? '');
    $device = (string)($melhor['assigned_object']['device']['name'] ?? '');

    // "ARP: BC:24:...:73 visto por mkt-cliente/ether4" → mkt-cliente
    $vistoPor = '';
    if (preg_match('/visto por ([^\/\s]+)/u', $descr, $m)) $vistoPor = $m[1];

    $cliente = $device !== '' ? $device : ($dns !== '' ? $dns : $vistoPor);
    return ['dns' => $dns, 'device' => $device, 'descr' => $descr, 'cliente' => $cliente];
}

$upd = $pdo->prepare(
    'UPDATE testes SET cliente = NULLIF(?, ""), netbox_dns = NULLIF(?, ""),
            netbox_device = NULLIF(?, ""), netbox_descr = NULLIF(?, ""),
            enriquecido_em = NOW()
      WHERE ip = ? AND ' . $where
);

$ok = $falha = 0;
foreach ($ips as $ip) {
    $info = consultaNetbox($ip, $cfg['netbox']);
    if ($info === null) { $falha++; continue; }
    $upd->execute([
        mb_substr($info['cliente'], 0, 200),
        mb_substr($info['dns'], 0, 255),
        mb_substr($info['device'], 0, 200),
        mb_substr($info['descr'], 0, 255),
        $ip,
    ]);
    $ok++;
}
printf("enriquecidos: %d IPs (%d com falha de API, ficam para a próxima)\n", $ok, $falha);
