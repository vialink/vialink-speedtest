<?php
/**
 * Atualiza o cache do traceroute do servidor (camada 2 da análise de
 * conectividade). Roda por cron a cada 5 minutos; é o ÚNICO lugar que executa
 * mtr — o endpoint api/diagnostico.php apenas lê o que este script grava.
 *
 * Uso manual: php scripts/atualizar-diagnostico.php [--quiet]
 */

// Instalação no servidor (CT 714, vlk-speedtest) — ver docs/INSTALL.*.md §10:
//
//   install -d -o www-data -g www-data -m 755 /var/cache/vlk-speedtest
//   cat > /etc/cron.d/vlk-speedtest-diagnostico <<'EOF'
//   */5 * * * * www-data flock -n /var/cache/vlk-speedtest/.lock /usr/bin/php \
//       /var/www/speedtest/scripts/atualizar-diagnostico.php --quiet
//   EOF
//
// O `flock -n` evita que uma execução lenta se sobreponha à seguinte (destinos
// que filtram ICMP consomem o timeout inteiro).

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit("uso: CLI apenas\n");
}

require __DIR__ . '/../api/diagnostico-lib.php';

$quiet = in_array('--quiet', $argv, true);
$alvos = require __DIR__ . '/../api/diagnostico-targets.php';

$dir = vlk_diag_cache_dir();
if (!is_dir($dir) || !is_writable($dir)) {
    fwrite(STDERR, "[vlk-diag] diretório de cache não gravável: $dir\n");
    exit(1);
}

// Dispara todos os mtr em paralelo: rodam contra destinos diferentes e não
// competem entre si de forma relevante (5 pacotes por salto). Sequencial
// levaria, no pior caso, 9 x 25 s — perto do intervalo do próprio cron.
$procs = [];
foreach ($alvos as $idx => $host) {
    $pipes = [];
    $p = proc_open(
        vlk_diag_comando($host),
        [1 => ['pipe', 'w']],   // só stdout; o comando já redireciona stderr
        $pipes
    );
    if (!is_resource($p)) {
        fwrite(STDERR, "[vlk-diag] falha ao iniciar mtr para $host\n");
        continue;
    }
    $procs[$idx] = ['proc' => $p, 'pipe' => $pipes[1], 'host' => $host];
}

$t0 = microtime(true);
$ok = 0;
$semDest = 0;

foreach ($procs as $idx => $info) {
    // Bloqueia neste processo enquanto os demais seguem rodando em paralelo.
    // A saída do mtr --json tem poucos KB, bem abaixo do buffer do pipe — não
    // há risco de travar um filho por buffer cheio enquanto lemos outro.
    $saida = stream_get_contents($info['pipe']);
    fclose($info['pipe']);
    proc_close($info['proc']);

    $resp = vlk_diag_normaliza($saida ?: null, $info['host']);
    if (!vlk_diag_grava($idx, $resp)) {
        fwrite(STDERR, "[vlk-diag] falha ao gravar cache do índice $idx ({$info['host']})\n");
        continue;
    }
    $ok++;
    if ($resp['dest'] === null) {
        $semDest++;
    }
}

if (!$quiet) {
    printf(
        "[%s] vlk-diag: %d/%d destinos atualizados em %.1fs%s\n",
        date('Y-m-d H:i:s'),
        $ok,
        count($alvos),
        microtime(true) - $t0,
        $semDest ? " ($semDest sem resposta ICMP)" : ''
    );
}

exit($ok > 0 ? 0 : 1);
