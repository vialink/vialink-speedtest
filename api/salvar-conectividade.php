<?php
/**
 * Gravação dos resultados da análise de conectividade (teste "Complete").
 * POST JSON, disparado pelo tenant.js (vlkSalvarConectividade) ao fim da fase
 * de rede, logo após window.vlkNetResults existir.
 *
 * O corpo traz o mesmo `uid` enviado na gravação da velocidade
 * (salvar-teste.php) — é por ele que ligamos estas linhas ao teste pai. Cada
 * destino vira uma linha em `testes_rede` (origem 'cliente' = probe do
 * navegador; 'servidor' = traceroute/mtr da rede Vialink).
 *
 * Idempotente: reenvio (retry/beacon) do mesmo uid regrava as mesmas linhas via
 * upsert (chave única teste_id+origem+ordem) — sem duplicar nem exigir DELETE.
 * Melhor-esforço no front → aqui respondemos rápido e sem efeitos colaterais.
 *
 * Credenciais do banco fora do web root: /etc/vlk-speedtest/db.ini
 */

header('Content-Type: application/json; charset=utf-8');

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    http_response_code(405);
    echo '{"erro":"use POST"}';
    exit;
}

$corpo = file_get_contents('php://input', false, null, 0, 65536);
$dados = json_decode($corpo, true);
if (!is_array($dados)) {
    http_response_code(400);
    echo '{"erro":"JSON invalido"}';
    exit;
}

$uid = substr(preg_replace('/[^a-f0-9]/', '', strtolower((string)($dados['uid'] ?? ''))), 0, 32);
if ($uid === '') {
    http_response_code(400);
    echo '{"erro":"uid ausente"}';
    exit;
}

$cliente  = is_array($dados['cliente']  ?? null) ? $dados['cliente']  : [];
$servidor = is_array($dados['servidor'] ?? null) ? $dados['servidor'] : [];
if (!$cliente && !$servidor) {
    http_response_code(400);
    echo '{"erro":"sem destinos"}';
    exit;
}
// Limite defensivo de tamanho (o front manda ~9 + ~9 destinos)
$cliente  = array_slice($cliente, 0, 40);
$servidor = array_slice($servidor, 0, 40);

// Helpers de sanitização
$txt  = fn($v, $len) => mb_substr(trim((string)($v ?? '')), 0, $len);
$num  = function ($v, $max) {
    if (!is_numeric($v)) return null;
    $f = (float)$v;
    return ($f >= 0 && $f <= $max) ? $f : null;
};
$flag = fn($v) => !empty($v) ? 1 : 0;

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

    // Resolve o teste pai pelo uid (a velocidade grava primeiro).
    $sel = $pdo->prepare('SELECT id FROM testes WHERE uid = ? ORDER BY id DESC LIMIT 1');
    $sel->execute([$uid]);
    $testeId = $sel->fetchColumn();
    if ($testeId === false) {
        // Pai ainda não gravado (ou gravação da velocidade perdida): nada a ligar.
        http_response_code(202);
        echo '{"ok":false,"motivo":"teste pai nao encontrado"}';
        exit;
    }
    $testeId = (int)$testeId;

    $pdo->beginTransaction();
    // Idempotência sem DELETE: upsert pela chave única (teste_id, origem, ordem).
    $ins = $pdo->prepare(
        'INSERT INTO testes_rede
           (teste_id, origem, ordem, label, alvo, latencia_ms, jitter_ms, perda_pct,
            saltos, filtrado, indisponivel)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           label=VALUES(label), alvo=VALUES(alvo), latencia_ms=VALUES(latencia_ms),
           jitter_ms=VALUES(jitter_ms), perda_pct=VALUES(perda_pct), saltos=VALUES(saltos),
           filtrado=VALUES(filtrado), indisponivel=VALUES(indisponivel)'
    );

    $n = 0;
    // Cliente: probe do navegador. Sem amostras => indisponível (sem resposta).
    foreach ($cliente as $i => $r) {
        if (!is_array($r)) continue;
        $indisp = empty($r['amostras']) ? 1 : 0;
        $ins->execute([
            $testeId, 'cliente', $i,
            $txt($r['label'] ?? '', 80),
            $txt($r['sub'] ?? '', 200),
            $indisp ? null : $num($r['latency'] ?? null, 60000),
            $indisp ? null : $num($r['jitter'] ?? null, 60000),
            $indisp ? null : $num($r['loss'] ?? null, 100),
            null, 0, $indisp,
        ]);
        $n++;
    }
    // Servidor: traceroute/mtr. na => indisponível; filtered => latência até o
    // último salto que respondeu (perda não é confiável, fica NULL).
    foreach ($servidor as $i => $r) {
        if (!is_array($r)) continue;
        $indisp = $flag($r['na'] ?? 0);
        $filt   = $flag($r['filtered'] ?? 0);
        $ins->execute([
            $testeId, 'servidor', $i,
            $txt($r['label'] ?? '', 80),
            $txt($r['host'] ?? '', 200),
            $indisp ? null : $num($r['avg'] ?? null, 60000),
            $indisp ? null : $num($r['jitter'] ?? null, 60000),
            ($indisp || $filt) ? null : $num($r['loss'] ?? null, 100),
            $indisp ? null : ($num($r['hops'] ?? null, 255) === null ? null : (int)$r['hops']),
            $filt, $indisp,
        ]);
        $n++;
    }

    $pdo->commit();
    echo json_encode(['ok' => true, 'teste_id' => $testeId, 'linhas' => $n]);
} catch (PDOException $e) {
    if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
    error_log('salvar-conectividade: ' . $e->getMessage());
    http_response_code(500);
    echo '{"erro":"falha ao gravar"}';
}
