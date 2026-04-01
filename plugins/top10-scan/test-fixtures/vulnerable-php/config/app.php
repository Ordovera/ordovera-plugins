<?php

return [
    // A02: Debug mode enabled in production
    'debug' => true,

    // A02: Default APP_KEY - not regenerated
    'key' => 'base64:DEFAULT_KEY_CHANGE_ME_PLEASE==',

    'name' => 'VulnerableApp',
    'url' => 'http://localhost',

    // A02: No HTTPS enforcement
    'force_https' => false,

    'timezone' => 'UTC',
    'locale' => 'en',

    'providers' => [
        // Default Laravel providers
    ],
];
