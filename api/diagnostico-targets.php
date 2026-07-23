<?php
/**
 * Allowlist do traceroute do servidor (usada por api/diagnostico.php).
 *
 * SEGURANÇA: o cliente envia apenas o ÍNDICE do destino; o host de fato vem
 * DAQUI, nunca do request — é o que impede injeção de comando / SSRF. Só estes
 * hosts podem ser alvo do mtr.
 *
 * A ordem DEVE espelhar `connectivityTargets` (DEFAULT_TARGETS) em
 * assets/js/tenants.js — o índice é a chave comum entre cliente e servidor.
 * Diferença proposital no item "Google DNS": o cliente sonda o nome dns.google
 * (o navegador não faz TLS contra IP cru), mas o servidor mede o IP 8.8.8.8
 * direto (o mtr atinge o IP sem problema).
 */
return [
    'www.google.com',    // 0
    'www.youtube.com',   // 1
    'www.netflix.com',   // 2
    '1.1.1.1',           // 3
    '8.8.8.8',           // 4  (cliente: dns.google)
    'www.microsoft.com', // 5
    'whatsapp.com',      // 6
    'www.globo.com',     // 7
    'whitehouse.gov',    // 8
];
