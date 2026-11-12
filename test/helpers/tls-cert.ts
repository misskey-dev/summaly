/**
 * Self-signed test certificate for `proxied.test` (SAN DNS:proxied.test only, no IP SAN; valid until 2126).
 * Test-only key material, generated with:
 * openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 36500 \
 *   -subj "/CN=proxied.test" -addext "subjectAltName=DNS:proxied.test"
 */
export const TEST_CERT_HOST = 'proxied.test';

export const TEST_CERT = `-----BEGIN CERTIFICATE-----
MIIBnjCCAUSgAwIBAgIUR+5aaJRAozdfenOvbZctlfjswD4wCgYIKoZIzj0EAwIw
FzEVMBMGA1UEAwwMcHJveGllZC50ZXN0MCAXDTI2MTExMTAyMzYyMVoYDzIxMjYx
MDE4MDIzNjIxWjAXMRUwEwYDVQQDDAxwcm94aWVkLnRlc3QwWTATBgcqhkjOPQIB
BggqhkjOPQMBBwNCAARp/KWLnhkpUmYzdWLeB3AWskrih3wC/oui6rOaIE90QyEr
ZAVMkFTjSjkYX6BZoTs3sk09HX941CmPPrXqxMtlo2wwajAdBgNVHQ4EFgQUl5Ui
P70vtJ6QE+lkSqPphSvVvzMwHwYDVR0jBBgwFoAUl5UiP70vtJ6QE+lkSqPphSvV
vzMwDwYDVR0TAQH/BAUwAwEB/zAXBgNVHREEEDAOggxwcm94aWVkLnRlc3QwCgYI
KoZIzj0EAwIDSAAwRQIgPsYtNH3Gq/QNzcuyjhetdsEX+zx7u5TnRKkUynfKteQC
IQDrQ4EV+latY4LCUf/tbhePWLMAaI1JNwKL80sa+xJtgw==
-----END CERTIFICATE-----
`;

export const TEST_KEY = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg7jMOpUsP4na3wulB
Knrkv5D/tWAWqcut9yutkLbQi7OhRANCAARp/KWLnhkpUmYzdWLeB3AWskrih3wC
/oui6rOaIE90QyErZAVMkFTjSjkYX6BZoTs3sk09HX941CmPPrXqxMtl
-----END PRIVATE KEY-----
`;

/**
 * Self-signed test certificate for the loopback address (SAN IP:127.0.0.1 only; valid until 2126).
 * Lets an https test server on 127.0.0.1 be reached through the guarded agents once the test adds it to the default CAs.
 * Test-only key material, generated with:
 * openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 36500 \
 *   -subj "/CN=127.0.0.1" -addext "subjectAltName=IP:127.0.0.1"
 */
export const LOOPBACK_CERT = `-----BEGIN CERTIFICATE-----
MIIBkDCCATagAwIBAgIUDXXXnBjmZIxaNnBlbXkl2d5kzbgwCgYIKoZIzj0EAwIw
FDESMBAGA1UEAwwJMTI3LjAuMC4xMCAXDTI2MTExMTA3NTg1MVoYDzIxMjYxMDE4
MDc1ODUxWjAUMRIwEAYDVQQDDAkxMjcuMC4wLjEwWTATBgcqhkjOPQIBBggqhkjO
PQMBBwNCAAQrUgFR0CUpnF3fHwlUfC/3yzipRyx0Css8f+zr9hy1c4tRjpGtlWk4
Lt6k2z9nR73GaFeDtyiMiIbVRQTKwG3vo2QwYjAdBgNVHQ4EFgQUv6PrSA+s8HFG
uRHM/7lYCSDGdbUwHwYDVR0jBBgwFoAUv6PrSA+s8HFGuRHM/7lYCSDGdbUwDwYD
VR0TAQH/BAUwAwEB/zAPBgNVHREECDAGhwR/AAABMAoGCCqGSM49BAMCA0gAMEUC
IQCQi117+feiFbzORozgBkfiEbLGdO7Zo7hdcw/u974jkgIgCqeC+ipcVzvVYs6o
/SLMtT3HqtZUhhj4ulYws0LpWFE=
-----END CERTIFICATE-----
`;

export const LOOPBACK_KEY = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg3tOATyoTqdQQgEAv
tIHhDnf3DSAsDIe0y2L0+Vo2T+KhRANCAAQrUgFR0CUpnF3fHwlUfC/3yzipRyx0
Css8f+zr9hy1c4tRjpGtlWk4Lt6k2z9nR73GaFeDtyiMiIbVRQTKwG3v
-----END PRIVATE KEY-----
`;
