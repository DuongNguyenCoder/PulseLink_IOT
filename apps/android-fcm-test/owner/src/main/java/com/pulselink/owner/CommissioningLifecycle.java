package com.pulselink.owner;

/** Transport-independent Owner-side lifecycle. Network code must not skip states. */
final class CommissioningLifecycle {
    enum State {
        IDLE,
        SESSION_READY,
        CONNECTING_TO_DEVICE,
        AUTHENTICATING_DEVICE,
        SENDING_CONFIGURATION,
        DEVICE_CONNECTING_WIFI,
        REDEEMING,
        ONLINE,
        FAILED,
        CANCELLED,
        EXPIRED
    }

    private State state = State.IDLE;
    private long deadlineMillis;

    State state() { return state; }

    boolean start(long nowMillis, long timeoutMillis) {
        if (timeoutMillis <= 0 || (state != State.IDLE && state != State.FAILED &&
                state != State.CANCELLED && state != State.EXPIRED)) return false;
        deadlineMillis = nowMillis + timeoutMillis;
        state = State.SESSION_READY;
        return true;
    }

    boolean transition(State next, long nowMillis) {
        if (next == null || expired(nowMillis) || !allowed(state, next)) return false;
        state = next;
        return true;
    }

    boolean cancel() {
        if (state == State.ONLINE || state == State.FAILED || state == State.CANCELLED || state == State.EXPIRED) return false;
        state = State.CANCELLED;
        return true;
    }

    boolean fail() {
        if (state == State.ONLINE || state == State.CANCELLED || state == State.EXPIRED) return false;
        state = State.FAILED;
        return true;
    }

    boolean expire(long nowMillis) {
        if (state == State.ONLINE || state == State.FAILED || state == State.CANCELLED || state == State.EXPIRED) return false;
        if (nowMillis < deadlineMillis) return false;
        state = State.EXPIRED;
        return true;
    }

    private boolean expired(long nowMillis) {
        if (nowMillis < deadlineMillis) return false;
        state = State.EXPIRED;
        return true;
    }

    private static boolean allowed(State from, State to) {
        return switch (from) {
            case SESSION_READY -> to == State.CONNECTING_TO_DEVICE || to == State.CANCELLED;
            case CONNECTING_TO_DEVICE -> to == State.AUTHENTICATING_DEVICE;
            case AUTHENTICATING_DEVICE -> to == State.SENDING_CONFIGURATION;
            case SENDING_CONFIGURATION -> to == State.DEVICE_CONNECTING_WIFI;
            case DEVICE_CONNECTING_WIFI -> to == State.REDEEMING || to == State.ONLINE;
            case REDEEMING -> to == State.ONLINE;
            default -> false;
        };
    }
}
