package com.pulselink.owner;

import org.junit.Test;

import static org.junit.Assert.assertThrows;

public final class ApiClientTest {
    @Test
    public void rejectsNonHttpsApiBase() {
        assertThrows(IllegalArgumentException.class, () -> new ApiClient("http://example.invalid"));
    }
}
