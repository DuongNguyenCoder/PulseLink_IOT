#include <assert.h>
#include <ctype.h>
#include <openssl/evp.h>
#include <openssl/ec.h>
#include <openssl/err.h>
#include <openssl/kdf.h>
#include <openssl/x509.h>
#include <stdio.h>
#include <string.h>

static int hex(char value) {
    if (value >= '0' && value <= '9') return value - '0';
    if (value >= 'a' && value <= 'f') return value - 'a' + 10;
    if (value >= 'A' && value <= 'F') return value - 'A' + 10;
    return -1;
}

static size_t decode(const char *text, unsigned char *output, size_t capacity) {
    size_t length = strlen(text);
    assert(length % 2U == 0U && length / 2U <= capacity);
    for (size_t i = 0; i < length / 2U; i++) {
        int high = hex(text[i * 2U]);
        int low = hex(text[i * 2U + 1U]);
        assert(high >= 0 && low >= 0);
        output[i] = (unsigned char)((high << 4) | low);
    }
    return length / 2U;
}

static size_t fixture_value(const char *name, char *output, size_t capacity) {
    FILE *file = fopen("tests/fixtures/commissioning_crypto_v1.txt", "rb");
    assert(file != NULL);
    char line[2048];
    size_t name_length = strlen(name);
    while (fgets(line, sizeof(line), file) != NULL) {
        if (strncmp(line, name, name_length) != 0 || line[name_length] != '=') continue;
        char *value = line + name_length + 1U;
        value[strcspn(value, "\r\n")] = '\0';
        assert(strlen(value) < capacity);
        strcpy(output, value);
        fclose(file);
        return strlen(output);
    }
    fclose(file);
    assert(!"fixture key missing");
    return 0U;
}

static size_t read_hex(const char *name, unsigned char *output, size_t capacity) {
    char value[2048];
    fixture_value(name, value, sizeof(value));
    return decode(value, output, capacity);
}

static size_t derive_secret(const unsigned char *private_key, size_t private_length,
                            const unsigned char *peer_public, size_t peer_length,
                            unsigned char *output, size_t capacity) {
    const unsigned char *cursor = private_key;
    EVP_PKEY *local = d2i_AutoPrivateKey(NULL, &cursor, (long)private_length);
    const unsigned char *peer_cursor = peer_public;
    EVP_PKEY *peer = d2i_PUBKEY(NULL, &peer_cursor, (long)peer_length);
    EVP_PKEY_CTX *context = EVP_PKEY_CTX_new(local, NULL);
    assert(local != NULL && peer != NULL && context != NULL);
    assert(EVP_PKEY_derive_init(context) == 1);
    assert(EVP_PKEY_derive_set_peer(context, peer) == 1);
    size_t length = capacity;
    assert(EVP_PKEY_derive(context, output, &length) == 1);
    EVP_PKEY_CTX_free(context);
    EVP_PKEY_free(peer);
    EVP_PKEY_free(local);
    return length;
}

static size_t hkdf(const unsigned char *secret, size_t secret_length,
                   const unsigned char *salt, size_t salt_length,
                   const unsigned char *info, size_t info_length,
                   unsigned char *output, size_t output_length) {
    EVP_PKEY_CTX *context = EVP_PKEY_CTX_new_id(EVP_PKEY_HKDF, NULL);
    assert(context != NULL);
    assert(EVP_PKEY_derive_init(context) == 1);
    assert(EVP_PKEY_CTX_set_hkdf_md(context, EVP_sha256()) == 1);
    assert(EVP_PKEY_CTX_set1_hkdf_salt(context, salt, (int)salt_length) == 1);
    assert(EVP_PKEY_CTX_set1_hkdf_key(context, secret, (int)secret_length) == 1);
    assert(EVP_PKEY_CTX_add1_hkdf_info(context, info, (int)info_length) == 1);
    size_t length = output_length;
    assert(EVP_PKEY_derive(context, output, &length) == 1);
    EVP_PKEY_CTX_free(context);
    return length;
}

static void aes_gcm(const unsigned char *key, const unsigned char *nonce,
                    const unsigned char *aad, size_t aad_length,
                    const unsigned char *plaintext, size_t plaintext_length,
                    unsigned char *ciphertext, unsigned char *tag) {
    EVP_CIPHER_CTX *context = EVP_CIPHER_CTX_new();
    int written = 0;
    assert(context != NULL);
    assert(EVP_EncryptInit_ex(context, EVP_aes_128_gcm(), NULL, NULL, NULL) == 1);
    assert(EVP_CIPHER_CTX_ctrl(context, EVP_CTRL_GCM_SET_IVLEN, 12, NULL) == 1);
    assert(EVP_EncryptInit_ex(context, NULL, NULL, key, nonce) == 1);
    assert(EVP_EncryptUpdate(context, NULL, &written, aad, (int)aad_length) == 1);
    assert(EVP_EncryptUpdate(context, ciphertext, &written, plaintext, (int)plaintext_length) == 1);
    int final_length = 0;
    assert(EVP_EncryptFinal_ex(context, ciphertext + written, &final_length) == 1);
    assert(EVP_CIPHER_CTX_ctrl(context, EVP_CTRL_GCM_GET_TAG, 16, tag) == 1);
    EVP_CIPHER_CTX_free(context);
}

static void verify_signature(const unsigned char *spki, size_t spki_length,
                             const unsigned char *message, size_t message_length,
                             const unsigned char *signature, size_t signature_length) {
    const unsigned char *cursor = spki;
    EVP_PKEY *key = d2i_PUBKEY(NULL, &cursor, (long)spki_length);
    EVP_MD_CTX *context = EVP_MD_CTX_new();
    assert(key != NULL && context != NULL);
    assert(EVP_DigestVerifyInit(context, NULL, EVP_sha256(), NULL, key) == 1);
    assert(EVP_DigestVerifyUpdate(context, message, message_length) == 1);
    assert(EVP_DigestVerifyFinal(context, signature, signature_length) == 1);
    unsigned char changed = (unsigned char)(message[0] ^ 1U);
    assert(EVP_DigestVerifyInit(context, NULL, EVP_sha256(), NULL, key) == 1);
    assert(EVP_DigestVerifyUpdate(context, &changed, 1U) == 1);
    assert(EVP_DigestVerifyFinal(context, signature, signature_length) != 1);
    EVP_MD_CTX_free(context);
    EVP_PKEY_free(key);
}

int main(void) {
    unsigned char a_private[256], b_private[256], a_public[65], b_public[65], a_spki[128], b_spki[128], expected[256];
    unsigned char shared[64], expected_shared[64], key[16], salt[32], info[64], nonce[12], aad[64], plaintext[128], ciphertext[128], tag[16];
    unsigned char spki[128], message[64], signature[128];
    size_t a_private_length = read_hex("a_private_pkcs8", a_private, sizeof(a_private));
    size_t b_private_length = read_hex("b_private_pkcs8", b_private, sizeof(b_private));
    size_t a_public_length = read_hex("a_public", a_public, sizeof(a_public));
    size_t b_public_length = read_hex("b_public", b_public, sizeof(b_public));
    assert(a_public_length == 65U && b_public_length == 65U);
    size_t a_spki_length = read_hex("a_public_spki", a_spki, sizeof(a_spki));
    size_t b_spki_length = read_hex("b_public_spki", b_spki, sizeof(b_spki));
    size_t expected_shared_length = read_hex("shared_secret", expected_shared, sizeof(expected_shared));
    assert(derive_secret(a_private, a_private_length, b_spki, b_spki_length, shared, sizeof(shared)) == expected_shared_length);
    assert(memcmp(shared, expected_shared, expected_shared_length) == 0);
    assert(derive_secret(b_private, b_private_length, a_spki, a_spki_length, shared, sizeof(shared)) == expected_shared_length);
    assert(memcmp(shared, expected_shared, expected_shared_length) == 0);
    size_t salt_length = read_hex("salt", salt, sizeof(salt));
    size_t info_length = read_hex("info", info, sizeof(info));
    size_t expected_key_length = read_hex("hkdf_key", expected, sizeof(expected));
    assert(hkdf(expected_shared, expected_shared_length, salt, salt_length, info, info_length, key, sizeof(key)) == expected_key_length);
    assert(memcmp(key, expected, expected_key_length) == 0);
    size_t nonce_length = read_hex("nonce", nonce, sizeof(nonce));
    size_t aad_length = read_hex("aad", aad, sizeof(aad));
    size_t plaintext_length = read_hex("plaintext", plaintext, sizeof(plaintext));
    size_t ciphertext_length = read_hex("ciphertext", expected, sizeof(expected));
    size_t tag_length = read_hex("tag", tag, sizeof(tag));
    unsigned char actual_tag[16];
    aes_gcm(key, nonce, aad, aad_length, plaintext, plaintext_length, ciphertext, actual_tag);
    assert(nonce_length == 12U && tag_length == 16U && ciphertext_length == plaintext_length);
    assert(memcmp(ciphertext, expected, ciphertext_length) == 0);
    read_hex("tag", expected, sizeof(expected));
    assert(memcmp(actual_tag, expected, 16U) == 0);
    size_t spki_length = read_hex("public_key_spki", spki, sizeof(spki));
    size_t message_length = read_hex("signature_message", message, sizeof(message));
    size_t signature_length = read_hex("signature_der", signature, sizeof(signature));
    verify_signature(spki, spki_length, message, message_length, signature, signature_length);
    return 0;
}
