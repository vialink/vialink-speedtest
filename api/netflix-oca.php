<?php
/**
 * Descobre uma OCA (Open Connect Appliance) local da Netflix e devolve ao
 * cliente a URL de teste (range pequeno) para ele medir a latência do STREAMING
 * — que é o que o assinante realmente percebe, e não o site www.netflix.com
 * (hospedado em AWS-EUA, ~170ms). A OCA local fica no IX/rede da operadora (~20-30ms).
 *
 * Por que no servidor: a API do fast.com NÃO libera CORS para a nossa origem
 * (só para fast.com), então o navegador não pode chamá-la. Fazemos o proxy aqui.
 * A URL da OCA vem com token ligado ao ASN (não ao IP) e válido ~1h, então uma
 * URL gerada aqui serve qualquer cliente da nossa rede (mesmo ASN).
 *
 * A OCA em si libera CORS (*), então o CLIENTE a mede direto (do navegador dele).
 * Sem parâmetros; sem entrada do usuário → sem superfície de injeção.
 */

header('Content-Type: application/json; charset=utf-8');

const FAST_TOKEN = 'YXNkZmFzZGxmbnNkYWZoYXNkZmhrYWxm'; // token público do fast.com (estável há anos)
const CACHE_TTL  = 600;                                 // 10 min (o token da OCA vale ~1h)

$cacheFile = sys_get_temp_dir() . '/vlk-netflix-oca.json';
if (is_file($cacheFile) && (time() - filemtime($cacheFile)) < CACHE_TTL) {
    $c = file_get_contents($cacheFile);
    if ($c !== false && $c !== '') { echo $c; exit; }
}

$api = 'https://api.fast.com/netflix/speedtest/v2?https=true&token=' . FAST_TOKEN . '&urlCount=1';
$ch = curl_init($api);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => 8,
    CURLOPT_FOLLOWLOCATION => true,
]);
$raw = curl_exec($ch);
curl_close($ch);

$data = $raw ? json_decode($raw, true) : null;
$url  = $data['targets'][0]['url'] ?? null;
if (!$url) { echo '{"ok":false}'; exit; }

// Monta a URL de range pequeno (2 KB) preservando a query com o token.
$q = strpos($url, '?');
$rangeUrl = ($q !== false)
    ? substr($url, 0, $q) . '/range/0-2048' . substr($url, $q)
    : $url . '/range/0-2048';

$resp = json_encode(['ok' => true, 'url' => $rangeUrl]);
@file_put_contents($cacheFile, $resp);
echo $resp;
