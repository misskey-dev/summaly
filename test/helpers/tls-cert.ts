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
