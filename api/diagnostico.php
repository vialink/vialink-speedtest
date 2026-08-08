<?php
/**
 * Traceroute/ping do SERVIDOR até um destino da allowlist (camada 2 da análise
 * de conectividade — ver conectividade.html / assets/js/conectividade.js).
 *
 * Mede da rede Vialink (CT714) até o destino, com mtr (ICMP real): saltos,
 * latência, jitter (desvio-padrão) e PERDA DE PACOTES. É o complemento ao que o
 * navegador mede da conexão do cliente (aquele não faz ICMP nem traceroute).
 *
 * ESTE ENDPOINT NÃO EXECUTA mtr — ele só lê o cache alimentado pelo cron
 * (scripts/atualizar-diagnostico.php, de 5 em 5 min). O motivo é que a medição
 * é "nossa rede -> destino": idêntica para todos os clientes e independente de
 * quem pediu. Produzi-la na requisição prendia um worker do PHP-FPM por até
 * 25 s e, com vários testes simultâneos e cache frio, saturava o pool
 * (pm.max_children=20). Ver o cabeçalho de api/diagnostico-lib.php.
 *
 * SEGURANÇA (inegociável):
 *   - O cliente envia SÓ o índice do destino; o host vem da allowlist do
 *     servidor (diagnostico-targets.php), nunca do request → sem injeção/SSRF.
 *   - Como não há execução aqui, o endpoint não tem custo além de ler um arquivo.
 */

require __DIR__ . '/diagnostico-lib.php';

header('Content-Type: application/json; charset=utf-8');

// Idade máxima aceitável do cache: 6 ciclos do cron. Acima disso a medição é
// velha demais para ser apresentada como estado atual da rota — respondemos
// "sem dados" (a UI mostra o aviso) em vez de mostrar verde antigo durante um
// problema em curso. `stale` fica na resposta para diagnóstico.
const CACHE_MAX_AGE = 1800;

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

$cacheFile = vlk_diag_cache_file($idx);
$mtime = is_file($cacheFile) ? filemtime($cacheFile) : 0;
$idade = $mtime ? (time() - $mtime) : null;

if (!$mtime || $idade > CACHE_MAX_AGE) {
    // Cache ausente (cron nunca rodou / recém-instalado) ou velho demais
    // (cron parado). Não medimos aqui — apenas informamos.
    echo json_encode([
        'ok'    => true,
        'host'  => $host,
        'hops'  => null,
        'dest'  => null,
        'age'   => $idade,
        'stale' => true,
    ]);
    exit;
}

$conteudo = @file_get_contents($cacheFile);
$resp = $conteudo ? json_decode($conteudo, true) : null;
if (!is_array($resp)) {
    echo json_encode(['ok' => true, 'host' => $host, 'hops' => null, 'dest' => null, 'age' => $idade, 'stale' => true]);
    exit;
}

// A idade é do arquivo, não do conteúdo — o front usa para dizer ao usuário
// "medição do servidor: há N min", já que o dado é compartilhado e não foi
// coletado no clique dele.
$resp['age'] = $idade;
echo json_encode($resp);
