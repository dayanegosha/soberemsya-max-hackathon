# CA for MAX Bot API only

Public root certificate downloaded over verified HTTPS on 2026-09-25 from https://gu-st.ru/content/Other/doc/russian_trusted_root_ca.cer (Gosuslugi distribution). MAX's current API documentation explicitly requires the Ministry certificate for platform-api2.max.ru: https://dev.max.ru/docs-api.

SHA-256 fingerprint: D2:6D:2D:02:31:B7:C3:9F:92:CC:73:85:12:BA:54:10:35:19:E4:40:5D:68:B5:BD:70:3E:97:88:CA:8E:CF:31.
Valid 2022-03-01 to 2032-02-27. This is a public trust anchor, not a secret or private key.

Only the bot process receives NODE_EXTRA_CA_CERTS. TLS hostname and certificate verification stay enabled. No host OS certificate store is modified. For local Linux bot start, set NODE_EXTRA_CA_CERTS=certs/russian-trusted-root-ca.pem before starting Node. Review the official source if certificate rotation occurs; never disable TLS verification.
