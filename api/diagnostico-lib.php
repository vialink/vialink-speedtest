<?php
/**
 * Núcleo da camada "servidor" da análise de conectividade: executa o mtr até um
 * destino da allowlist, normaliza a saída e resolve o caminho do cache.
 *
 * Dois consumidores, com papéis separados de propósito:
 *
 *   - scripts/atualizar-diagnostico.php (CLI, cron de 5 em 5 min) — PRODUZ o
 *     cache. É o único que executa mtr.
 *   - api/diagnostico.php (endpoint HTTP) — apenas CONSOME o cache.
 *
 * Por que a separação: o resultado do mtr mede "nossa rede -> destino", é
 * idêntico para todos os clientes e não depende de quem pediu. Produzi-lo na
 * requisição do usuário prendia um worker do PHP-FPM por até 25 s e, com cache
 * frio e vários testes simultâneos, saturava o pool (pm.max_children=20).
 * Com o cron alimentando, o endpoint responde em microssegundos e a carga de
 * mtr passa a ser constante e previsível, em vez de proporcional ao tráfego.
 */

const VLK_DIAG_MTR_CYCLES  = 5;   // pacotes por salto
const VLK_DIAG_MTR_TIMEOUT = 25;  // segundos (guarda do processo)

/**
 * Diretório do cache.
 *
 * Preferimos um diretório próprio a sys_get_temp_dir(): o /tmp é alvo de
 * limpeza periódica e, se um dia o php-fpm subir com PrivateTmp=yes (default de
 * várias distros), o /tmp que o endpoint enxerga deixa de ser o mesmo do cron —
 * o cache gravado jamais seria encontrado, e a falha seria silenciosa.
 */
function vlk_diag_cache_dir(): string
{
    $dir = '/var/cache/vlk-speedtest';
    if (is_dir($dir)) {
        return $dir;
    }
    return sys_get_temp_dir(); // fallback: ambiente local/estático
}

function vlk_diag_cache_file(int $idx): string
{
    return vlk_diag_cache_dir() . '/vlk-diag-' . $idx . '.json';
}

/**
 * Comando do mtr. O host SEMPRE vem da allowlist do servidor
 * (diagnostico-targets.php), nunca do request — mesmo assim passa por
 * escapeshellarg, e o processo roda sob `timeout` e com -n.
 */
function vlk_diag_comando(string $host): string
{
    return 'timeout ' . VLK_DIAG_MTR_TIMEOUT . ' mtr -n -4 -c ' . VLK_DIAG_MTR_CYCLES
         . ' --json ' . escapeshellarg($host) . ' 2>/dev/null';
}

/**
 * Converte a saída JSON do mtr no formato que o front consome.
 * Retorna sempre um array serializável (dest = null quando não deu para medir).
 */
function vlk_diag_normaliza(?string $saida, string $host): array
{
    $mtr  = $saida ? json_decode($saida, true) : null;
    $hubs = $mtr['report']['hubs'] ?? null;

    if (!is_array($hubs) || !count($hubs)) {
        // mtr ausente, sem permissão ICMP, ou destino totalmente inalcançável
        return ['ok' => true, 'host' => $host, 'hops' => null, 'dest' => null];
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
    // mais profundo que respondeu e marcamos filtered=true.
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

    return ['ok' => true, 'host' => $host, 'hops' => count($hubs), 'dest' => $dest];
}

/**
 * Grava o cache de forma atômica: o endpoint lê concorrentemente, e um
 * file_put_contents direto pode ser lido pela metade (JSON truncado).
 */
function vlk_diag_grava(int $idx, array $resp): bool
{
    $alvo = vlk_diag_cache_file($idx);
    $tmp  = $alvo . '.tmp' . getmypid();
    if (@file_put_contents($tmp, json_encode($resp)) === false) {
        return false;
    }
    @chmod($tmp, 0644);
    if (!@rename($tmp, $alvo)) {
        @unlink($tmp);
        return false;
    }
    return true;
}
