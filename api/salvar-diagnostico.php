<?php
/**
 * Gravação do diagnóstico da conexão (NAT/CGNAT, MTU do caminho, DNS) e do
 * SNAPSHOT do teste — o estado que o relatório precisa para se reconstruir.
 *
 * POST JSON disparado pelo tenant.js quando o diagnóstico termina — depois da
 * gravação da velocidade, como a conexão única. Por isso é um UPDATE pelo `uid`
 * do teste, e não parte do INSERT.
 *
 * Existe por causa do link compartilhável (/r/CODIGO): até aqui, qualidade,
 * conexão única, rede e diagnóstico viviam só no `localStorage` do navegador que
 * fez o teste — o relatório aberto em outra máquina apareceria sem eles,
 * justamente a parte que o suporte quer ver.
 *
 * Duas gravações, de propósito:
 *   - COLUNAS PLANAS (diag_*) — para consulta: "quantos clientes atrás de CGNAT
 *     esta semana?", "quantos com MTU reduzido?". É o que serve ao NOC.
 *   - SNAPSHOT JSON (`snapshot`) — os mesmos objetos que o navegador guardaria
 *     no localStorage (qos, single, diag, rede). É o que permite ao relatório
 *     usar EXATAMENTE os mesmos renderizadores, sem uma segunda implementação
 *     que possa divergir da tela. Colunas não substituem isso: o objeto de
 *     qualidade tem mediana, mínimo e estabilidade por sentido, que as colunas
 *     não guardam.
 *
 * Se as colunas não existirem (instalação sem o ALTER TABLE opcional), responde
 * 202 sem erro: tudo continua na tela, no relatório da própria sessão e no PDF —
 * só o link compartilhável fica sem as partes tardias.
 *
 * Credenciais do banco fora do web root: /etc/vlk-speedtest/db.ini
 */

header('Content-Type: application/json; charset=utf-8');

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    http_response_code(405);
    echo '{"erro":"use POST"}';
    exit;
}

// 96 KB: o snapshot leva as tabelas de rede (até 2 × 9 destinos). O teto existe
// para o endpoint não virar depósito de payload arbitrário.
$corpo = file_get_contents('php://input', false, null, 0, 98304);
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
// Valores fechados: o que não estiver na lista vira null em vez de entrar no
// banco como texto livre vindo do cliente.
$enum = function ($v, array $ok) {
    $s = (string)($v ?? '');
    return in_array($s, $ok, true) ? $s : null;
};

$nat       = $enum($dados['nat'] ?? null, ['nat', 'cgnat', 'symmetric', 'direct', 'unknown']);
$mtu       = $num($dados['mtu'] ?? null, 65535);
$mtuClasse = $enum($dados['mtuClasse'] ?? null, ['ethernet', 'pppoe', 'tunel', 'baixo']);
$rtt       = $num($dados['rtt'] ?? null, 60000);
$dns       = $num($dados['dns'] ?? null, 60000);
$dnsCls    = $enum($dados['dnsCls'] ?? null, ['bom', 'medio', 'ruim']);
// O whois chega junto porque costuma ficar pronto antes do diagnóstico, mas
// depois do INSERT da velocidade em conexão lenta — aqui ele tem uma segunda
// chance de ser gravado.
$whois = mb_substr(trim((string)($dados['whois'] ?? '')), 0, 200);
if ($whois === '') $whois = null;

// Snapshot: só os quatro objetos que o relatório consome, e re-serializado aqui
// — assim o que vai para o banco é JSON que nós montamos a partir de campos
// conhecidos, não a string que o cliente mandou.
$snapshot = null;
if (is_array($dados['snapshot'] ?? null)) {
    $s = [];
    foreach (['qos', 'single', 'diag', 'rede'] as $k) {
        if (is_array($dados['snapshot'][$k] ?? null)) $s[$k] = $dados['snapshot'][$k];
    }
    if ($s) {
        $json = json_encode($s, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if ($json !== false && strlen($json) <= 65535) $snapshot = $json;
    }
}

if ($nat === null && $mtu === null && $dns === null && $whois === null && $snapshot === null) {
    http_response_code(400);
    echo '{"erro":"nada a gravar"}';
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

    // COALESCE: um segundo POST com campo vazio não apaga o que já foi gravado
    // (o whois pode ter vindo no INSERT, e o diagnóstico chega depois).
    $upd = $pdo->prepare(
        'UPDATE testes
            SET diag_nat        = COALESCE(?, diag_nat),
                diag_mtu        = COALESCE(?, diag_mtu),
                diag_mtu_classe = COALESCE(?, diag_mtu_classe),
                diag_rtt_ms     = COALESCE(?, diag_rtt_ms),
                diag_dns_ms     = COALESCE(?, diag_dns_ms),
                diag_dns_cls    = COALESCE(?, diag_dns_cls),
                whois           = COALESCE(?, whois),
                snapshot        = COALESCE(?, snapshot)
          WHERE uid = ?
          ORDER BY id DESC
          LIMIT 1'
    );
    $upd->execute([
        $nat,
        $mtu === null ? null : (int)round($mtu),
        $mtuClasse,
        $rtt,
        $dns,
        $dnsCls,
        $whois,
        $snapshot,
        $uid,
    ]);

    echo json_encode(['ok' => true, 'linhas' => $upd->rowCount()]);
} catch (PDOException $e) {
    if (($e->errorInfo[1] ?? 0) === 1054) {   // coluna desconhecida
        http_response_code(202);
        echo '{"ok":false,"motivo":"colunas diag_* ausentes"}';
        exit;
    }
    error_log('salvar-diagnostico: ' . $e->getMessage());
    http_response_code(500);
    echo '{"erro":"falha ao gravar"}';
}
