<?php
/**
 * MyRDPHub — WHMCS Server/Provisioning Module
 *
 * A thin client of the MyRDPHub versioned API (/api/v1). All business logic lives in the panel;
 * this module only translates WHMCS lifecycle hooks into API calls.
 *
 * Install: copy this folder to  <whmcs>/modules/servers/myrdphub/
 * Configure (Setup > Products/Services > Servers > Add New Server):
 *   - Hostname   = API base URL, e.g. https://panel.myrdphub.com
 *   - Password   = a RESELLER API key (rk_live_...) with scopes vm:read,vm:write,vm:reinstall,vm:delete
 * Then set the product's Module to "myrdphub".
 *
 * @package    MyRDPHub
 * @license    Proprietary
 */

if (!defined('WHMCS')) {
    die('This file cannot be accessed directly');
}

/** Module metadata shown in WHMCS. */
function myrdphub_MetaData()
{
    return [
        'DisplayName' => 'MyRDPHub Cloud',
        'APIVersion' => '1.1',
        'RequiresServer' => true,
    ];
}

/** Product config options (mapped to API create payload). */
function myrdphub_ConfigOptions()
{
    return [
        'productSlug' => [
            'FriendlyName' => 'Product Slug',
            'Type' => 'text',
            'Size' => '25',
            'Description' => 'MyRDPHub product/plan slug to provision (e.g. cloud-2vcpu-4gb).',
        ],
        'osTemplate' => [
            'FriendlyName' => 'OS Template ID',
            'Type' => 'text',
            'Size' => '25',
            'Description' => 'Default OS template id for CreateAccount / Reinstall.',
        ],
        'region' => [
            'FriendlyName' => 'Region/Node Class',
            'Type' => 'text',
            'Size' => '25',
            'Description' => 'Optional region or node class hint.',
        ],
    ];
}

/** Internal: perform an API request. Returns [httpCode, decodedBody]. */
function myrdphub_api(array $params, string $method, string $path, array $body = null)
{
    $base = rtrim((strpos($params['serverhostname'], 'http') === 0 ? $params['serverhostname'] : 'https://' . $params['serverhostname']), '/');
    $url = $base . $path;
    $key = $params['serverpassword'] ?: ($params['serveraccesshash'] ?? '');

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 60,
        CURLOPT_HTTPHEADER => [
            'Authorization: Bearer ' . $key,
            'Content-Type: application/json',
            'Accept: application/json',
        ],
    ]);
    if ($body !== null) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
    }
    $raw = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    if ($raw === false) {
        return [0, ['error' => ['message' => $err ?: 'connection failed']]];
    }
    return [$code, json_decode($raw, true) ?: []];
}

/** Verify the server + key are valid (Test Connection button). */
function myrdphub_TestConnection(array $params)
{
    [$code, $body] = myrdphub_api($params, 'GET', '/api/v1/vms');
    if ($code === 200) {
        return ['success' => true, 'error' => ''];
    }
    return ['success' => false, 'error' => $body['error']['message'] ?? ('HTTP ' . $code)];
}

/** Provision a new VM. Stores the returned vmid/id on the WHMCS service. */
function myrdphub_CreateAccount(array $params)
{
    $payload = [
        'productSlug' => $params['configoption1'],
        'osTemplateId' => $params['configoption2'],
        'region' => $params['configoption3'],
        'externalRef' => 'whmcs-' . $params['serviceid'], // idempotency
        'customerEmail' => $params['clientsdetails']['email'] ?? null,
    ];
    [$code, $body] = myrdphub_api($params, 'POST', '/api/v1/vms', $payload);
    if ($code >= 200 && $code < 300 && !empty($body['data']['id'])) {
        // Persist the panel VM id so subsequent hooks target the same VM.
        try {
            \WHMCS\Database\Capsule::table('tblhosting')
                ->where('id', $params['serviceid'])
                ->update(['dedicatedip' => $body['data']['ipAddress'] ?? '', 'username' => $body['data']['id']]);
        } catch (\Throwable $e) { /* non-fatal */ }
        return 'success';
    }
    return $body['error']['message'] ?? ('CreateAccount failed (HTTP ' . $code . ')');
}

/** Suspend = stop the VM. */
function myrdphub_SuspendAccount(array $params)
{
    return myrdphub_power($params, 'stop');
}

/** Unsuspend = start the VM. */
function myrdphub_UnsuspendAccount(array $params)
{
    return myrdphub_power($params, 'start');
}

/** Reboot custom action. */
function myrdphub_Reboot(array $params)
{
    return myrdphub_power($params, 'reboot');
}

function myrdphub_power(array $params, string $action)
{
    $vmId = $params['username']; // panel VM id stored at CreateAccount
    if (!$vmId) return 'No linked VM id on this service';
    [$code, $body] = myrdphub_api($params, 'POST', '/api/v1/vms/' . rawurlencode($vmId) . '/power', ['action' => $action]);
    return ($code >= 200 && $code < 300) ? 'success' : ($body['error']['message'] ?? ('power ' . $action . ' failed'));
}

/** Terminate = delete the VM. */
function myrdphub_TerminateAccount(array $params)
{
    $vmId = $params['username'];
    if (!$vmId) return 'No linked VM id on this service';
    [$code, $body] = myrdphub_api($params, 'DELETE', '/api/v1/vms/' . rawurlencode($vmId));
    return ($code >= 200 && $code < 300) ? 'success' : ($body['error']['message'] ?? 'TerminateAccount failed');
}

/** Client-area buttons (reinstall/reboot). */
function myrdphub_ClientAreaCustomButtonArray()
{
    return [
        'Reboot' => 'Reboot',
        'Reinstall' => 'reinstallVm',
    ];
}

function myrdphub_reinstallVm(array $params)
{
    $vmId = $params['username'];
    if (!$vmId) return 'No linked VM id on this service';
    [$code, $body] = myrdphub_api($params, 'POST', '/api/v1/vms/' . rawurlencode($vmId) . '/reinstall', [
        'osTemplateId' => $params['configoption2'],
    ]);
    return ($code >= 200 && $code < 300) ? 'success' : ($body['error']['message'] ?? 'Reinstall failed');
}
