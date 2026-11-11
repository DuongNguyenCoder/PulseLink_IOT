package com.pulselink.owner;

import java.net.SocketTimeoutException;

/** A safe timeout marker for one local commissioning HTTP stage. */
final class CommissioningRequestTimeout extends SocketTimeoutException {
    final String stage;
    final String phase;

    CommissioningRequestTimeout(String stage, String phase, Throwable cause) {
        super("Local commissioning request timed out");
        this.stage = stage;
        this.phase = phase;
        initCause(cause);
    }
}
