#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

typedef enum {
    COMMISSIONING_STORAGE_OK = 0,
    COMMISSIONING_STORAGE_UNAVAILABLE,
    COMMISSIONING_STORAGE_INVALID,
    COMMISSIONING_STORAGE_IO_ERROR,
} commissioning_storage_result_t;

typedef struct {
    void *context;
    commissioning_storage_result_t (*save)(void *context, const uint8_t *value, size_t length);
    commissioning_storage_result_t (*load)(void *context, uint8_t *value, size_t capacity, size_t *length);
} commissioning_credential_storage_t;

bool commissioning_credential_storage_is_ready(const commissioning_credential_storage_t *storage);
commissioning_storage_result_t commissioning_credential_storage_save(
    commissioning_credential_storage_t *storage, const uint8_t *value, size_t length);
commissioning_storage_result_t commissioning_credential_storage_load(
    commissioning_credential_storage_t *storage, uint8_t *value, size_t capacity, size_t *length);
bool commissioning_credential_token_format_valid(const uint8_t *value, size_t length);
