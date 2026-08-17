<?php
// Dados da conexão TCP deste cliente, vistos do lado do servidor.
//
// O navegador não tem como saber a MTU do caminho: HTTP não deixa escolher o
// tamanho do pacote, e ICMP/DF está fora de alcance de qualquer JavaScript. Mas
// o kernel do servidor sabe — ele negociou a MSS no handshake desta mesma
// conexão. MSS 1460 é MTU 1500 (Ethernet); 1452 é 1492 (PPPoE); valores mais
// baixos denunciam túnel/VPN no caminho. É o diagnóstico que explica "abre site
// pela metade", download que trava em certas rotas e VPN lenta.
//
// De quebra sai o RTT medido pelo próprio kernel — latência sem sonda nenhuma,
// imune ao que o JavaScript do navegador esteja fazendo — e o IP público que
// realmente chega aqui, que o módulo de diagnóstico compara com o IP visto pelo
// STUN para reconhecer CGNAT.
//
// SEGURANÇA: o comando é FIXO. Nada vindo do cliente entra na linha de comando —
// a seleção da conexão é feita aqui, comparando strings. `ss` roda sem
// privilégios (o processo do PHP enxerga os sockets do próprio sistema).

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$ip   = isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : '';
$port = isset($_SERVER['REMOTE_PORT']) ? (int) $_SERVER['REMOTE_PORT'] : 0;

$out = array(
    'ip'    => $ip,
    'ipv6'  => false,
    'mss'   => null,
    'mtu'   => null,
    'pmtu'  => null,
    'rtt'   => null,     // ms, medido pelo kernel do servidor
    'rttvar' => null,
    'found' => false,
);

if ($ip !== '' && $port > 0 && filter_var($ip, FILTER_VALIDATE_IP)) {
    $v6 = strpos($ip, ':') !== false;
    $out['ipv6'] = $v6;
    // `ss` imprime endereço IPv6 entre colchetes
    $alvo = ($v6 ? '[' . $ip . ']' : $ip) . ':' . $port;

    $linhas = array();
    $rc = 0;
    @exec('ss -tin state established 2>/dev/null', $linhas, $rc);

    for ($i = 0, $n = count($linhas); $i < $n - 1; $i++) {
        $campos = preg_split('/\s+/', trim($linhas[$i]));
        // Linha do socket: Recv-Q Send-Q Local:Porta Peer:Porta
        // Comparamos com o campo do PEER — o par IP+porta efêmera é único.
        if (count($campos) < 4 || $campos[3] !== $alvo) {
            continue;
        }
        $m = $linhas[$i + 1];   // a linha seguinte traz as métricas do TCP_INFO
        if (preg_match('/\bmss:(\d+)/', $m, $x))    { $out['mss']  = (int) $x[1]; }
        if (preg_match('/\bpmtu:(\d+)/', $m, $x))   { $out['pmtu'] = (int) $x[1]; }
        if (preg_match('/\brtt:([\d.]+)\/([\d.]+)/', $m, $x)) {
            $out['rtt']    = (float) $x[1];
            $out['rttvar'] = (float) $x[2];
        }
        $out['found'] = true;
        break;
    }

    // MTU do caminho = MSS + cabeçalhos. 40 bytes em IPv4 (20 IP + 20 TCP),
    // 60 em IPv6 (40 + 20). As opções de TCP (timestamps etc.) não entram: elas
    // reduzem o payload, não a MTU.
    if ($out['mss'] !== null && $out['mss'] > 100) {
        $out['mtu'] = $out['mss'] + ($v6 ? 60 : 40);
    }
}

echo json_encode($out);
