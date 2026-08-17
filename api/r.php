<?php
/**
 * Leitura de um teste pelo código curto — é o que faz o link /r/CODIGO existir.
 *
 *   GET /api/r.php?c=K7M2QX9P   →   JSON com tudo que o relatório mostra
 *
 * Até aqui o relatório só existia no navegador que fez o teste: os números vinham
 * na query string e as seções de rede, qualidade e diagnóstico saíam do
 * `localStorage`. Ou seja, o cliente não tinha como MOSTRAR o teste a ninguém —
 * mandava print. Com este endpoint, o mesmo relatório abre em qualquer máquina.
 *
 * Somente leitura, e devolve exatamente o que o relatório já exibiria para quem
 * fez o teste — nada além disso. O código é aleatório de 8 caracteres num
 * alfabeto de 32 (~2^40): não dá para andar pelos testes dos outros trocando um
 * caractere, como aconteceria com o `id` sequencial.
 *
 * ⚠️ Quem tem o link vê o teste, incluindo IP, provedor e o navegador usado.
 * É deliberado — o link nasce para ser mandado ao suporte —, mas é a razão de o
 * código não ser adivinhável e de não haver listagem por aqui.
 *
 * Credenciais do banco fora do web root: /etc/vlk-speedtest/db.ini
 */

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$codigo = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', (string)($_GET['c'] ?? '')));
if (strlen($codigo) < 6 || strlen($codigo) > 12) {
    http_response_code(400);
    echo '{"erro":"codigo invalido"}';
    exit;
}

$cfg = parse_ini_file('/etc/vlk-speedtest/db.ini', true);
if (!$cfg || empty($cfg['db'])) {
    http_response_code(500);
    echo '{"erro":"config indisponivel"}';
    exit;
}

try {
    $pdo = new PDO($cfg['db']['dsn'], $cfg['db']['user'], $cfg['db']['pass'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_TIMEOUT => 3,
    ]);

    $st = $pdo->prepare(
        'SELECT id, codigo, criado_em, tenant, hostname, ip, user_agent, asn, cidade, whois,
                download_mbps, upload_mbps, ping_ms, jitter_ms, dl_dados_mb, ul_dados_mb,
                snapshot
           FROM testes
          WHERE codigo = ?
          LIMIT 1'
    );
    $st->execute([$codigo]);
    $t = $st->fetch(PDO::FETCH_ASSOC);

    if (!$t) {
        http_response_code(404);
        echo '{"erro":"teste nao encontrado"}';
        exit;
    }

    $f = fn($v) => $v === null ? null : (float)$v;

    $out = [
        'codigo'   => $t['codigo'],
        'criadoEm' => $t['criado_em'],          // hora do servidor, em ISO local
        'tenant'   => $t['tenant'],
        'host'     => $t['hostname'],
        'ip'       => $t['ip'],
        'org'      => trim(implode(' · ', array_filter([$t['asn'], $t['cidade']]))),
        'whois'    => $t['whois'],
        // O navegador de QUEM FEZ o teste. Sem isto o relatório aberto pelo
        // atendente mostraria o navegador do atendente — errado, e de um jeito
        // difícil de perceber.
        'userAgent' => $t['user_agent'],
        'resultado' => [
            'd'  => $f($t['download_mbps']),
            'u'  => $f($t['upload_mbps']),
            'p'  => $f($t['ping_ms']),
            'j'  => $f($t['jitter_ms']),
            'dd' => $f($t['dl_dados_mb']),
            'ud' => $f($t['ul_dados_mb']),
        ],
    ];

    // Qualidade, conexão única, diagnóstico e rede vêm do snapshot — os mesmos
    // objetos que o navegador teria no localStorage, para o relatório usar os
    // mesmos renderizadores.
    $snap = $t['snapshot'] ? json_decode($t['snapshot'], true) : null;
    if (is_array($snap)) {
        foreach (['qos', 'single', 'diag', 'rede'] as $k) {
            if (isset($snap[$k])) $out[$k] = $snap[$k];
        }
    }

    // Sem snapshot (teste anterior a esta versão, ou aba fechada antes das
    // medições tardias), a rede ainda pode ser remontada da tabela própria.
    if (!isset($out['rede'])) {
        $rq = $pdo->prepare(
            'SELECT origem, label, alvo, latencia_ms, jitter_ms, perda_pct, saltos,
                    filtrado, indisponivel
               FROM testes_rede WHERE teste_id = ? ORDER BY origem, ordem'
        );
        $rq->execute([(int)$t['id']]);
        $cli = $srv = [];
        $houveFiltrado = false;
        foreach ($rq->fetchAll(PDO::FETCH_ASSOC) as $l) {
            if ($l['origem'] === 'cliente') {
                $cli[] = [
                    'label'    => $l['label'],
                    'sub'      => $l['alvo'],
                    // o render só usa `amostras` como "houve medição"
                    'amostras' => $l['indisponivel'] ? 0 : 1,
                    'latency'  => $f($l['latencia_ms']),
                    'jitter'   => $f($l['jitter_ms']),
                    'loss'     => $f($l['perda_pct']),
                ];
            } else {
                if ($l['filtrado']) $houveFiltrado = true;
                $srv[] = [
                    'label'    => $l['label'],
                    'host'     => $l['alvo'],
                    'na'       => (bool)$l['indisponivel'],
                    'filtered' => (bool)$l['filtrado'],
                    'avg'      => $f($l['latencia_ms']),
                    'jitter'   => $f($l['jitter_ms']),
                    'loss'     => $f($l['perda_pct']),
                    'hops'     => $l['saltos'] === null ? null : (int)$l['saltos'],
                ];
            }
        }
        if ($cli || $srv) {
            $out['rede'] = ['cliente' => $cli, 'servidor' => $srv, 'houveFiltrado' => $houveFiltrado];
        }
    }

    echo json_encode($out, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
} catch (PDOException $e) {
    // 1054 = coluna desconhecida: instalação sem o ALTER TABLE do link.
    if (($e->errorInfo[1] ?? 0) === 1054) {
        http_response_code(501);
        echo '{"erro":"instalacao sem suporte a link compartilhavel"}';
        exit;
    }
    error_log('r.php: ' . $e->getMessage());
    http_response_code(500);
    echo '{"erro":"falha ao ler"}';
}
