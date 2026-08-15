<?php
/**
 * Gravação da medição de conexão única (1 fluxo TCP × as 6 conexões do teste).
 * POST JSON, disparado pelo tenant.js (vlkSalvarSingle) quando a medição
 * termina — alguns segundos DEPOIS da gravação da velocidade, que acontece
 * assim que os resultados existem. Por isso é um UPDATE na linha do teste, e
 * não parte do INSERT: quando a velocidade grava, este número ainda não existe.
 *
 * O corpo traz o mesmo `uid` de salvar-teste.php — é por ele que achamos a
 * linha. Idempotente por natureza (UPDATE com os mesmos valores).
 *
 * Se as colunas single_* não existirem no banco (instalação que não rodou o
 * ALTER TABLE), respondemos 202 sem erro: a medição continua aparecendo na
 * tela, no relatório e no PDF — a persistência é opcional.
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

$uid = substr(preg_replace('/[^a-f0-9]/', '', strtolower((string)($dados['uid'] ?? ''))), 0, 32);
if ($uid === '') {
    http_response_code(400);
    echo '{"erro":"uid ausente"}';
    exit;
}

$num = function ($v, $max) {
    if (!is_numeric($v)) return null;
    $f = (float)$v;
    return ($f >= 0 && $f <= $max) ? $f : null;
};

$single = $num($dados['single'] ?? null, 1000000);
$multi  = $num($dados['multi'] ?? null, 1000000);
$ratio  = $num($dados['ratio'] ?? null, 99);
$grade  = (string)($dados['grade'] ?? '');
if (!in_array($grade, ['full', 'partial', 'limited', 'severe'], true)) $grade = null;
$windowKb = $num($dados['windowKb'] ?? null, 4294967);

if ($single === null || $multi === null) {
    http_response_code(400);
    echo '{"erro":"medicao incompleta"}';
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

    $upd = $pdo->prepare(
        'UPDATE testes
            SET single_mbps = ?, single_multi_mbps = ?, single_ratio = ?,
                single_grade = ?, single_window_kb = ?
          WHERE uid = ?
          ORDER BY id DESC
          LIMIT 1'
    );
    $upd->execute([
        $single, $multi, $ratio, $grade,
        $windowKb === null ? null : (int)round($windowKb),
        $uid,
    ]);

    echo json_encode(['ok' => true, 'linhas' => $upd->rowCount()]);
} catch (PDOException $e) {
    // 1054 = coluna desconhecida: instalação sem o ALTER TABLE opcional.
    if (($e->errorInfo[1] ?? 0) === 1054) {
        http_response_code(202);
        echo '{"ok":false,"motivo":"colunas single_* ausentes"}';
        exit;
    }
    error_log('salvar-single: ' . $e->getMessage());
    http_response_code(500);
    echo '{"erro":"falha ao gravar"}';
}
